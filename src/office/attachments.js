'use strict';
// Scans and attachments of office records: register documents (doc), journal entries (ledger)
// and employees' personal files (employee).
//
// - Files are private media (data/private): never a public URL; every download checks the
//   permission of the record the file belongs to.
// - Accepted: PDF, JPG, PNG (scans, receipts, photos) and DOCX/XLSX; size and real content are
//   checked (src/files.js), the stored name is random.
// - The file of a register document is downloaded under the document number written for file
//   systems (P-004/10-26 -> "P-004-10-26.pdf"; the second file "P-004-10-26_2.pdf").
const config = require('../config');
const { get, all, run, tx, now } = require('../db');
const { err, sendFile, FILE_CSP } = require('../http');
const { can } = require('../auth');
const { audit } = require('../audit');
const files = require('../files');
const { EMPLOYEE_FILE_CATS, fileKey, fileRows } = require('./common');

const ALLOWED = ['pdf', 'jpg', 'png', 'docx', 'xlsx'];
const MODULE = { doc: 'Sənəd reyestri', ledger: 'Gəlir-xərc', employee: 'Kadrlar' };
const TABLE = { doc: 'registry_docs', ledger: 'ledger', employee: 'employees' };
const CATEGORIES = { doc: { scan: 'Skan', attachment: 'Əlavə' }, ledger: { receipt: 'Qəbz / ödəniş sənədi', invoice: 'Hesab-faktura', other: 'Digər' }, employee: EMPLOYEE_FILE_CATS };

// Who may see / change the files of each kind of record. Employee documents are personal data:
// they need the separate "hr.personal" permission.
function allowed(ctx, type, write) {
  if (type === 'doc') return ctx.perms.has(write ? 'registry.edit' : 'registry.view');
  if (type === 'ledger') return ctx.perms.has(write ? 'finance.edit' : 'finance.view');
  if (type === 'employee') return ctx.perms.has('hr.personal') && (!write || ctx.perms.has('hr.edit'));
  return false;
}
function check(ctx, type, write) {
  if (!TABLE[type]) throw err(404, 'Tapılmadı');
  if (!allowed(ctx, type, write)) throw err(403, 'Bu əməliyyat üçün icazəniz yoxdur');
}

async function attach(ctx, type, ownerId, file, { category = '', label = '' } = {}) {
  const m = await files.storeUpload(file, { allowed: ALLOWED, isPrivate: true, userId: ctx.user.id, folder: 'Ofis' });
  const id = run('INSERT INTO office_files (owner_type, owner_id, media_id, category, created_by, created_at) VALUES (?,?,?,?,?,?)', type, ownerId, m.id, category, ctx.user.id, now()).lastInsertRowid;
  audit(ctx, { action: 'Fayl əlavə etmə', module: MODULE[type], recordId: ownerId, summary: `${ctx.user.name} fayl əlavə etdi: ${m.original_name}${label ? ` → ${label}` : ''}` });
  return id;
}
// Removes all files of a record (when the record is deleted). Returns the media rows, whose disk
// files are deleted after the database transaction succeeded.
function detachAll(type, id) {
  const media = all('SELECT m.* FROM office_files f JOIN media m ON m.id = f.media_id WHERE f.owner_type = ? AND f.owner_id = ?', type, id);
  run('DELETE FROM office_files WHERE owner_type = ? AND owner_id = ?', type, id);
  return media;
}
function downloadName(f) {
  if (f.owner_type !== 'doc') return f.original_name;
  const doc = get('SELECT doc_no FROM registry_docs WHERE id = ?', f.owner_id);
  if (!doc) return f.original_name;
  const ids = all("SELECT id FROM office_files WHERE owner_type = 'doc' AND owner_id = ? ORDER BY id", f.owner_id).map((r) => r.id);
  const i = ids.indexOf(f.fid);
  return `${fileKey(doc.doc_no)}${i > 0 ? `_${i + 1}` : ''}.${f.ext}`;
}
const category = (type, c) => (c && Object.hasOwn(CATEGORIES[type], c) ? c : '');

function routes(app) {
  // Replace a file with a new version (e.g. a better scan); the old file is deleted.
  // (Registered before the upload route, whose pattern would also match ".../123/replace".)
  app.post('/api/office/files/:fid/replace', can('registry.edit', 'finance.edit', 'hr.edit'), async (ctx) => {
    const f = get('SELECT f.id AS fid, f.owner_type, f.owner_id, f.media_id, m.original_name FROM office_files f JOIN media m ON m.id = f.media_id WHERE f.id = ?', ctx.intParam('fid'));
    if (!f) throw err(404, 'Fayl tapılmadı');
    check(ctx, f.owner_type, true);
    const form = await ctx.readForm((config.maxUploadMb + 1) * files.MB);
    const m = await files.storeUpload(form.get('file'), { allowed: ALLOWED, isPrivate: true, userId: ctx.user.id, folder: 'Ofis' });
    const old = get('SELECT * FROM media WHERE id = ?', f.media_id);
    tx(() => {
      run('UPDATE office_files SET media_id = ?, created_by = ?, created_at = ? WHERE id = ?', m.id, ctx.user.id, now(), f.fid);
      audit(ctx, { action: 'Fayl yeniləmə', module: MODULE[f.owner_type], recordId: f.owner_id, summary: `${ctx.user.name} faylı yenilədi: ${old.original_name} → ${m.original_name}` });
    });
    files.removeMedia(old);
    ctx.json({ item: fileRows(f.owner_type, f.owner_id).find((x) => x.id === f.fid) });
  });
  // Upload (one file per request; the panel sends several one after another).
  app.post('/api/office/files/:type/:id', can('registry.edit', 'finance.edit', 'hr.edit'), async (ctx) => {
    const type = ctx.params.type; check(ctx, type, true);
    const id = ctx.intParam('id');
    if (!get(`SELECT id FROM ${TABLE[type]} WHERE id = ?`, id)) throw err(404, 'Qeyd tapılmadı');
    const form = await ctx.readForm((config.maxUploadMb + 1) * files.MB);
    const fid = await attach(ctx, type, id, form.get('file'), { category: category(type, String(form.get('category') || '')) });
    ctx.json({ item: fileRows(type, id).find((f) => f.id === fid) }, 201);
  });
  app.get('/api/office/files/:fid', can('registry.view', 'finance.view', 'hr.view'), (ctx) => {
    const f = get('SELECT m.*, f.id AS fid, f.owner_type, f.owner_id FROM office_files f JOIN media m ON m.id = f.media_id WHERE f.id = ? AND m.is_private = 1', ctx.intParam('fid'));
    if (!f) throw err(404, 'Fayl tapılmadı');
    check(ctx, f.owner_type, false);
    const inline = ctx.query.inline === '1' && ['pdf', 'jpg', 'png'].includes(f.ext);
    // Uploaded files are untrusted: images get the sandbox CSP; PDFs are shown by the browser's
    // own viewer, which a sandbox would block, so they get a CSP that forbids everything else.
    const csp = f.ext === 'pdf' ? "default-src 'none'; frame-ancestors 'self'" : FILE_CSP;
    sendFile(ctx, config.privateDir, f.stored_name, { type: f.mime, csp, download: downloadName(f), inline, cache: 'private, no-store' });
  });
  app.delete('/api/office/files/:fid', can('registry.edit', 'finance.edit', 'hr.edit'), (ctx) => {
    const f = get('SELECT f.id AS fid, f.owner_type, f.owner_id, m.* FROM office_files f JOIN media m ON m.id = f.media_id WHERE f.id = ?', ctx.intParam('fid'));
    if (!f) throw err(404, 'Fayl tapılmadı');
    check(ctx, f.owner_type, true);
    tx(() => {
      run('DELETE FROM office_files WHERE id = ?', f.fid);
      audit(ctx, { action: 'Fayl silmə', module: MODULE[f.owner_type], recordId: f.owner_id, summary: `${ctx.user.name} faylı sildi: ${f.original_name}` });
    });
    files.removeMedia(f);
    ctx.json({ ok: true });
  });
}

module.exports = { routes, attach, detachAll, allowed, ALLOWED, CATEGORIES };
