# ห้องสมุดงานวิจัย คณะบริหารธุรกิจ ม.บูรพา (Google Sheet + Apps Script)

โครงสร้าง: GitHub -> Cloudflare Pages (หน้าเว็บ + Functions) -> Google Apps Script -> Google Sheet (ข้อมูล) + Google Drive (PDF/ปก)

## 1) ฝั่ง Google
1. สร้าง Google Sheet ใหม่ ตั้งชื่ออะไรก็ได้
2. เมนู Extensions -> Apps Script ลบโค้ดเดิม แล้ววางโค้ดจาก apps-script/Code.gs
3. เลือกฟังก์ชัน `setup` แล้วกด Run (อนุญาตสิทธิ์ครั้งแรก)
   ระบบสร้างแท็บ papers, โฟลเดอร์ใน Drive และรหัสลับ
4. เปิด Execution log คัดลอกค่า `SECRET = ...` เก็บไว้
5. Deploy -> New deployment -> ประเภท Web app
   - Execute as: Me
   - Who has access: Anyone
   กด Deploy แล้วคัดลอก Web app URL (ลงท้ายด้วย /exec)

## 2) ฝั่ง GitHub / Cloudflare
1. อัปโหลดโฟลเดอร์นี้ขึ้น GitHub
2. Cloudflare Dashboard -> Workers & Pages -> Create -> Pages -> Connect to Git
   Build command: เว้นว่าง / Build output directory: public
3. โปรเจกต์ -> Settings -> Variables and Secrets เพิ่ม 2 ตัว (แล้ว Redeploy)
   - APPS_SCRIPT_URL = Web app URL
   - APPS_SCRIPT_SECRET = ค่า SECRET (ชนิด Secret)
4. Zero Trust -> Access -> Applications -> Add self-hosted
   ป้องกัน path /admin* และ /api/admin* ให้เฉพาะอีเมลบรรณารักษ์

## ใช้งาน
- / ชั้นหนังสือ + ค้นหา
- /admin/ เพิ่ม/ลบงานวิจัย (ไฟล์ละไม่เกิน 25 MB)

## หมายเหตุ
- หากแก้ Code.gs ต้อง Deploy -> Manage deployments -> Edit -> New version ทุกครั้ง
- รายการแคช 60 วินาที ถ้าแก้ Sheet ตรง ๆ อาจเห็นผลช้าสักครู่
- ถ้าองค์กร Google Workspace ปิดการแชร์ "Anyone" ให้ขอ admin เปิด หรือใช้บัญชี Gmail

## ล็อกอินหลังบ้านด้วยรหัสผ่าน
เพิ่มตัวแปร ADMIN_PASSWORD (ชนิด Secret) ใน Cloudflare Pages -> Settings -> Variables and Secrets แล้ว Redeploy
จากนั้นเปิด /admin/ จะมีช่องให้ใส่รหัสผ่าน (ล็อกอินค้างได้ 12 ชั่วโมง)
ไม่จำเป็นต้องตั้ง Cloudflare Access อีกต่อไป (ถ้าตั้งไว้ก็ยังใช้ได้ควบกัน)
