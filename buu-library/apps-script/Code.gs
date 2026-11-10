// วางไฟล์นี้ใน Apps Script ที่ผูกกับ Google Sheet (Extensions → Apps Script)
// Sheet = ฐานข้อมูล (แท็บ papers), Drive = ที่เก็บ PDF และภาพปก

const SHEET_NAME = 'papers';
const HEADERS = ['id', 'title', 'author', 'year', 'keywords', 'pdf_id', 'cover_id', 'created_at'];
const P = PropertiesService.getScriptProperties();

// รันฟังก์ชันนี้ 1 ครั้งตอนเริ่มต้น แล้วดู SECRET ใน Execution log
function setup() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
  if (!P.getProperty('FOLDER_ID')) P.setProperty('FOLDER_ID', DriveApp.createFolder('buu-library-files').getId());


}

function sheet_() { return SpreadsheetApp.getActive().getSheetByName(SHEET_NAME); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function rows_() {
  const v = sheet_().getDataRange().getValues();
  const h = v.shift();
  return v.filter(r => r[0]).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

// อ่านรายการทั้งหมด (สาธารณะ)
function doGet() { return out_(rows_()); }

// เพิ่ม/ลบ ต้องมี secret ตรงกับที่ตั้งไว้
function doPost(e) {
  const b = JSON.parse(e.postData.contents);
  const S = P.getProperty('SECRET'); // ถ้าไม่ได้ตั้ง SECRET ไว้ จะไม่ตรวจรหัส
  if (S && b.secret !== S) return out_({ error: 'unauthorized' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (b.action === 'add') {
      const id = Utilities.getUuid();
      const folder = DriveApp.getFolderById(P.getProperty('FOLDER_ID'));
      const share = f => f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      const pdf = folder.createFile(Utilities.newBlob(Utilities.base64Decode(b.pdf), 'application/pdf', id + '.pdf'));
      share(pdf);
      let coverId = '';
      if (b.cover) {
        const c = folder.createFile(Utilities.newBlob(Utilities.base64Decode(b.cover), 'image/jpeg', id + '.jpg'));
        share(c);
        coverId = c.getId();
      }
      sheet_().appendRow([id, b.title, b.author || '', b.year || '', b.keywords || '', pdf.getId(), coverId, new Date()]);
      return out_({ id: id });
    }

    if (b.action === 'delete') {
      const sh = sheet_();
      const v = sh.getDataRange().getValues();
      for (let i = 1; i < v.length; i++) {
        if (v[i][0] === b.id) {
          [v[i][5], v[i][6]].filter(String).forEach(f => { try { DriveApp.getFileById(f).setTrashed(true); } catch (_) {} });
          sh.deleteRow(i + 1);
          return out_({ ok: true });
        }
      }
      return out_({ error: 'ไม่พบงานวิจัย' });
    }
    return out_({ error: 'unknown action' });
  } finally {
    lock.releaseLock();
  }
}
