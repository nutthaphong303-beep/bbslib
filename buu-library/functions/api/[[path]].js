// Cloudflare Pages Function: เป็นตัวกลางระหว่างหน้าเว็บกับ Google Apps Script / Google Drive
// ตัวแปรที่ต้องตั้งใน Cloudflare: APPS_SCRIPT_URL, APPS_SCRIPT_SECRET (Secret)

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8' } });
// ถ้าตั้งตัวแปร APPS_SCRIPT_URL ไม่สำเร็จ ให้วางลิงก์ Web app (ลงท้าย /exec) ในเครื่องหมายคำพูดนี้แทนได้
const SCRIPT_URL_FALLBACK = 'https://script.google.com/macros/s/AKfycbyvWy6FoduFQi95jnQ1CftYWs8uPLwvEK9gcVR6Haq2QzMhTwnp0cVLeRvtlYHhQvsfew/exec';
function scriptUrl(env) {
  const u = String(env.APPS_SCRIPT_URL || SCRIPT_URL_FALLBACK).trim();
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(u))
    throw new Error('ยังไม่ได้ตั้งค่าลิงก์ Apps Script (APPS_SCRIPT_URL) หรือลิงก์ไม่ถูกต้อง');
  return u;
}
const norm = s => String(s ?? '').toLowerCase();
const CACHE_KEY = () => new Request('https://cache.internal/papers');

// อ่านรายการจาก Sheet แล้วแคชไว้ 60 วินาที (Apps Script ช้า ~1 วินาที)
async function allPapers(env, waitUntil) {
  let res = await caches.default.match(CACHE_KEY());
  if (!res) {
    const r = await fetch(scriptUrl(env));
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
  const r = await fetch(scriptUrl(env), {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ ...body, secret: env.APPS_SCRIPT_SECRET })
  });
  return r.json();
}

// ---------- ล็อกอินด้วยรหัสผ่าน (คุกกี้ลงลายเซ็น HMAC) ----------
const enc = new TextEncoder();
async function sign(env, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(env.ADMIN_PASSWORD), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(s)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function isAdmin(request, env) {
  if (request.headers.get('cf-access-authenticated-user-email')) return true; // ผ่าน Cloudflare Access (ถ้าตั้งไว้)
  if (!env.ADMIN_PASSWORD) return false;
  const c = /(?:^|;\s*)admin=([^;]+)/.exec(request.headers.get('cookie') || '');
  if (!c) return false;
  const [exp, sig] = c[1].split('.');
  return Number(exp) > Date.now() && sig === await sign(env, exp);
}
const cookie = v => `admin=${v}; Path=/; HttpOnly; Secure; SameSite=Strict`;

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
    if (p[0] === 'login' && m === 'POST') {
      const { password } = await request.json().catch(() => ({}));
      if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
        await new Promise(r => setTimeout(r, 800)); // หน่วงเล็กน้อยกันการเดารหัส
        return json({ error: 'รหัสผ่านไม่ถูกต้อง' }, 401);
      }
      const exp = Date.now() + 12 * 3600 * 1000;
      return new Response('{"ok":true}', { headers: {
        'content-type': 'application/json',
        'set-cookie': cookie(`${exp}.${await sign(env, String(exp))}`) + '; Max-Age=43200'
      } });
    }
    if (p[0] === 'logout' && m === 'POST')
      return new Response('{"ok":true}', { headers: { 'content-type': 'application/json', 'set-cookie': cookie('') + '; Max-Age=0' } });

    if (p[0] === 'admin') {
      if (!(await isAdmin(request, env)) && !url.hostname.startsWith('localhost'))
        return json({ error: 'ไม่มีสิทธิ์' }, 401);
      if (p[1] === 'me') return json({ ok: true });

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

      // แก้ไขงานวิจัย: เปลี่ยนไฟล์ PDF / ปก เฉพาะเมื่อส่งมาใหม่
      if (p[1] === 'papers' && p[2] && m === 'POST') {
        const f = await request.formData();
        const pdf = f.get('pdf'), cover = f.get('cover');
        const title = (f.get('title') || '').trim();
        if (!title) return json({ error: 'ต้องมีชื่อเรื่อง' }, 400);
        if (pdf && pdf.size > 25 * 1024 * 1024) return json({ error: 'ไฟล์ใหญ่เกิน 25 MB' }, 413);
        const res = await callScript(env, {
          action: 'update', id: p[2], title,
          author: f.get('author') || '', year: f.get('year') || '', keywords: f.get('keywords') || '',
          pdf: pdf && pdf.size ? b64(await pdf.arrayBuffer()) : '',
          cover: cover && cover.size ? b64(await cover.arrayBuffer()) : ''
        });
        if (res.error) return json(res, 500);
        await caches.default.delete(CACHE_KEY());
        return json(res);
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
