// API ทั้งหมดอยู่ไฟล์เดียว: Cloudflare Pages Functions + D1 + R2
const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8' } });

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const p = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const m = request.method;

  try {
    // ---------- สาธารณะ ----------
    if (p[0] === 'papers' && !p[1] && m === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      const order = url.searchParams.get('sort') === 'name' ? 'title COLLATE NOCASE ASC' : 'created_at DESC';
      const like = `%${q}%`;
      const { results } = await env.DB.prepare(
        `SELECT id,title,author,year,cover_key FROM papers
         WHERE ?1 = '' OR title LIKE ?2 OR author LIKE ?2 OR keywords LIKE ?2
         ORDER BY ${order} LIMIT 300`
      ).bind(q, like).all();
      return json(results);
    }

    if (p[0] === 'papers' && p[1] && m === 'GET') {
      const row = await env.DB.prepare('SELECT * FROM papers WHERE id=?').bind(p[1]).first();
      return row ? json(row) : json({ error: 'ไม่พบงานวิจัย' }, 404);
    }

    if (p[0] === 'suggest' && m === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return json([]);
      const like = `%${q}%`;
      const { results } = await env.DB.prepare(
        `SELECT id,title,author FROM papers
         WHERE title LIKE ?1 OR author LIKE ?1 OR keywords LIKE ?1
         ORDER BY (title LIKE ?2) DESC, title LIMIT 8`
      ).bind(like, `${q}%`).all();
      return json(results);
    }

    if (p[0] === 'file' && m === 'GET') {
      const key = p.slice(1).join('/');
      const obj = await env.BUCKET.get(key, { range: request.headers });
      if (!obj) return new Response('Not found', { status: 404 });
      const h = new Headers();
      obj.writeHttpMetadata(h);
      h.set('etag', obj.httpEtag);
      h.set('accept-ranges', 'bytes');
      h.set('cache-control', 'public, max-age=86400');
      let status = 200;
      if (obj.range) {
        status = 206;
        const { offset = 0, length = obj.size } = obj.range;
        h.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
      }
      return new Response(obj.body, { status, headers: h });
    }

    // ---------- หลังบ้าน (ต้องผ่าน Cloudflare Access) ----------
    if (p[0] === 'admin') {
      if (!request.headers.get('cf-access-authenticated-user-email') && !url.hostname.startsWith('localhost'))
        return json({ error: 'ไม่มีสิทธิ์' }, 401);

      if (p[1] === 'papers' && !p[2] && m === 'POST') {
        const f = await request.formData();
        const pdf = f.get('pdf'), cover = f.get('cover');
        const title = (f.get('title') || '').trim();
        if (!pdf || !pdf.size || !title) return json({ error: 'ต้องมีไฟล์ PDF และชื่อเรื่อง' }, 400);

        const id = crypto.randomUUID();
        const pdfKey = `pdf/${id}.pdf`;
        const coverKey = cover && cover.size ? `cover/${id}.jpg` : null;
        await env.BUCKET.put(pdfKey, pdf.stream(), { httpMetadata: { contentType: 'application/pdf' } });
        if (coverKey) await env.BUCKET.put(coverKey, cover.stream(), { httpMetadata: { contentType: 'image/jpeg' } });
        await env.DB.prepare(
          'INSERT INTO papers (id,title,author,year,keywords,pdf_key,cover_key) VALUES (?,?,?,?,?,?,?)'
        ).bind(id, title, f.get('author') || null, Number(f.get('year')) || null, f.get('keywords') || null, pdfKey, coverKey).run();
        return json({ id }, 201);
      }

      if (p[1] === 'papers' && p[2] && m === 'DELETE') {
        const row = await env.DB.prepare('SELECT pdf_key,cover_key FROM papers WHERE id=?').bind(p[2]).first();
        if (!row) return json({ error: 'ไม่พบงานวิจัย' }, 404);
        await env.BUCKET.delete([row.pdf_key, row.cover_key].filter(Boolean));
        await env.DB.prepare('DELETE FROM papers WHERE id=?').bind(p[2]).run();
        return json({ ok: true });
      }
    }

    return json({ error: 'ไม่พบ endpoint' }, 404);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
