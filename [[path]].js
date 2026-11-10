// Cloudflare Pages Function: เป็นตัวกลางระหว่างหน้าเว็บกับ Google Apps Script / Google Drive
// ตัวแปรที่ต้องตั้งใน Cloudflare: APPS_SCRIPT_URL, APPS_SCRIPT_SECRET (Secret)

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8' } });
const norm = s => String(s ?? '').toLowerCase();
const CACHE_KEY = () => new Request('https://cache.internal/papers');

// อ่านรายการจาก Sheet แล้วแคชไว้ 60 วินาที (Apps Script ช้า ~1 วินาที)
async function allPapers(env, waitUntil) {
  let res = await caches.default.match(CACHE_KEY());
  if (!res) {
    const r = await fetch(env.APPS_SCRIPT_URL);
    const d = await r.json();
    if (!Array.isArray(d)) throw new Error(d.error || 'อ่านข้อมูลจาก Google Sheet ไม่ได้');
    const rows = d.map(x => ({
      id: x.id, title: x.title, author: x.author || '', year: x.year || null,
      keywords: x.keywords || '', pdf_key: x.pdf_id, cover_key: x.cover_id || null, created_at: x.created_at
    }));
    res = new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60' } });
    waitUntil(caches.default.put(CACHE_KEY(), res.clone()));
  }
  return res.json();
}

const hit = (p, q) => [p.title, p.author, p.keywords].some(f => norm(f).includes(q));

function b64(buf) {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

async function callScript(env, body) {
  const r = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ ...body, secret: env.APPS_SCRIPT_SECRET })
  });
  return r.json();
}

export async function onRequest({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const p = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const m = request.method;

  try {
    // ---------- สาธารณะ ----------
    if (p[0] === 'papers' && !p[1] && m === 'GET') {
      const q = norm(url.searchParams.get('q')).trim();
      let rows = (await allPapers(env, waitUntil)).filter(x => !q || hit(x, q));
      rows = url.searchParams.get('sort') === 'name'
        ? rows.sort((a, b) => String(a.title).localeCompare(String(b.title), 'th'))
        : rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return json(rows.slice(0, 300));
    }

    if (p[0] === 'papers' && p[1] && m === 'GET') {
      const row = (await allPapers(env, waitUntil)).find(x => x.id === p[1]);
      return row ? json(row) : json({ error: 'ไม่พบงานวิจัย' }, 404);
    }

    if (p[0] === 'suggest' && m === 'GET') {
      const q = norm(url.searchParams.get('q')).trim();
      if (!q) return json([]);
      const rows = (await allPapers(env, waitUntil)).filter(x => hit(x, q));
      rows.sort((a, b) => norm(b.title).startsWith(q) - norm(a.title).startsWith(q));
      return json(rows.slice(0, 8).map(({ id, title, author }) => ({ id, title, author })));
    }

    // ส่งไฟล์จาก Google Drive (ไฟล์ต้องแชร์แบบ "ทุกคนที่มีลิงก์")
    if (p[0] === 'file' && p[1] && m === 'GET') {
      if (!/^[\w-]{10,}$/.test(p[1])) return new Response('Bad id', { status: 400 });
      const range = request.headers.get('range');
      const up = await fetch(`https://drive.usercontent.google.com/download?id=${p[1]}&export=download`,
        { headers: range ? { range } : {} });
      if (!up.ok && up.status !== 206) return new Response('Not found', { status: 404 });
      const h = new Headers();
      for (const k of ['content-type', 'content-length', 'content-range'])
        if (up.headers.get(k)) h.set(k, up.headers.get(k));
      h.set('accept-ranges', 'bytes');
      h.set('cache-control', 'public, max-age=86400');
      return new Response(up.body, { status: up.status, headers: h });
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
        if (pdf.size > 25 * 1024 * 1024) return json({ error: 'ไฟล์ใหญ่เกิน 25 MB' }, 413);

        const res = await callScript(env, {
          action: 'add', title,
          author: f.get('author') || '', year: f.get('year') || '', keywords: f.get('keywords') || '',
          pdf: b64(await pdf.arrayBuffer()),
          cover: cover && cover.size ? b64(await cover.arrayBuffer()) : ''
        });
        if (res.error) return json(res, 500);
        await caches.default.delete(CACHE_KEY());
        return json(res, 201);
      }

      if (p[1] === 'papers' && p[2] && m === 'DELETE') {
        const res = await callScript(env, { action: 'delete', id: p[2] });
        if (res.error) return json(res, 404);
        await caches.default.delete(CACHE_KEY());
        return json(res);
      }
    }

    return json({ error: 'ไม่พบ endpoint' }, 404);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
