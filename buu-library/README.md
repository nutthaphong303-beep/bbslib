# ห้องสมุดงานวิจัย คณะบริหารธุรกิจ ม.บูรพา

โครงสร้าง: Cloudflare Pages (หน้าเว็บ + Functions) · D1 (ฐานข้อมูล) · R2 (เก็บ PDF/ปก) · GitHub (ดีพลอยอัตโนมัติ)

## ติดตั้ง
1. ติดตั้งเครื่องมือ: `npm i -g wrangler` แล้ว `wrangler login`
2. สร้างฐานข้อมูล: `wrangler d1 create buu-library` แล้วนำ database_id ไปใส่ใน wrangler.toml
3. สร้างตาราง: `wrangler d1 execute buu-library --remote --file=schema.sql`
4. สร้างที่เก็บไฟล์: `wrangler r2 bucket create buu-library-files`
5. อัปโหลดโค้ดขึ้น GitHub (git init, commit, push)
6. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git → เลือก repo
   - Build command: (เว้นว่าง) · Build output directory: `public`
7. ตรวจว่า Settings → Bindings มี DB (D1) และ BUCKET (R2) ตรงกับ wrangler.toml
8. ป้องกันหลังบ้าน: Zero Trust → Access → Applications → Add self-hosted
   ใส่ path `/admin*` และ `/api/admin*` ของโดเมนเว็บ แล้วกำหนดอีเมลบรรณารักษ์ที่เข้าได้

## ใช้งาน
- หน้าแรก `/` ชั้นหนังสือ + ค้นหา
- `/admin/` เพิ่ม/ลบงานวิจัย (ระบบสร้างปกจากหน้าแรกของ PDF ให้อัตโนมัติ)

## ทดสอบในเครื่อง
`wrangler d1 execute buu-library --local --file=schema.sql` แล้ว `wrangler pages dev public`
