'use strict';
// Office modules (internal - nothing here is shown on the website):
//   /api/registry        Sənəd reyestri: outgoing documents with automatic numbering (AE-001/09-26),
//                        response tracking, amounts/payments, scans, Excel import/export
//   /api/counterparties  Kontragentlər: clients, suppliers, state bodies (VÖEN, bank details)
//   /api/ledger          Gəlir-xərc jurnalı: money in/out, optionally linked to a register document
//   /api/employees       Kadrlar: staff list (linked to orders "Əmr" in the register)
//   /api/payroll         Əmək haqqı: monthly payroll rows per employee (values entered by the accountant)
//   /api/office/*        lists, attached files (scans), summaries
//
// Money is stored as integer qəpik (see src/db.js, migration 3) and returned as AZN numbers.
// Permissions: registry.*, finance.*, hr.* (Super Admin only unless granted to a role).
const config = require('../config');
const { get, all, run, tx, now, dayOf } = require('../db');
const { err, sendFile, FILE_CSP } = require('../http');
const { v, validate } = require('../validate');
const { can } = require('../auth');
const { audit } = require('../audit');
const { defineResource, fold } = require('../crud');
const { getSetting, setSetting } = require('../settings');
const files = require('../files');
const { readXlsx, excelDate } = require('../xlsx-read');

/* ------------------------------------------------------------------ helpers */
const azn = (q) => Math.round(Number(q) || 0) / 100;                    // qəpik -> AZN
const lists = () => getSetting('office');
const ORDER_TYPE = 'Əmr';          // orders concern employees (employee_id instead of a counterparty)
const CANCELLED = 'Ləğv edildi';   // this status takes a document out of response tracking
const NO_RX = /^([A-Z]{1,4})-(\d{1,5})\/(\d{2})-(\d{2})$/;
const fmtNo = (index, seq, date) => `${index}-${String(seq).padStart(3, '0')}/${date.slice(5, 7)}-${date.slice(2, 4)}`;
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const CURRENCIES = ['AZN', 'USD', 'EUR'];
const KIND_LABEL = { income: 'Gəlir', expense: 'Xərc' };
const METHOD_LABEL = { bank: 'Bank köçürməsi', cash: 'Nağd', card: 'Kart', other: 'Digər' };
const CP_KIND = { client: 'Müştəri', supplier: 'Təchizatçı', state: 'Dövlət qurumu', other: 'Digər' };
const PAY_LABEL = { none: '', unpaid: 'Ödənilməyib', partial: 'Qismən ödənilib', paid: 'Ödənilib' };

// Next free sequence number of a document index in a year (numbers continue across months and
// start again from 001 in a new year - the rule of the company's Excel register).
const nextSeq = (index, year) => (get('SELECT MAX(seq) AS m FROM registry_docs WHERE doc_index = ? AND doc_year = ?', index, year).m || 0) + 1;
function typeIndex(name) {
  const t = lists().doc_types.find((x) => x.name === name);
  return t ? t.index : null;
}

// Response state exactly as the Excel register's "Cavab vəziyyəti" column computes it.
function responseLabel(d) {
  if (d.response_state === 'cancelled') return '';
  if (d.response_state === 'none') return 'Tələb olunmur';
  if (d.response_state === 'received') return d.sent_date ? `Cavab alındı (${daysBetween(d.sent_date, d.response_date)} gün ərzində)` : 'Cavab alındı';
  return d.sent_date ? `Gözlənilir (${Math.max(0, daysBetween(d.sent_date, dayOf()))} gündür)` : 'Gözlənilir';
}
const fileRows = (type, id) => all(`SELECT f.id, f.created_at, m.original_name AS name, m.ext, m.size FROM office_files f JOIN media m ON m.id = f.media_id
  WHERE f.owner_type = ? AND f.owner_id = ? ORDER BY f.id`, type, id).map((f) => ({ ...f, url: `/api/office/files/${f.id}`, previewable: files.INLINE_EXT.has(f.ext) }));
function removeOwnerFiles(type, id) {
  const media = all('SELECT m.* FROM office_files f JOIN media m ON m.id = f.media_id WHERE f.owner_type = ? AND f.owner_id = ?', type, id);
  run('DELETE FROM office_files WHERE owner_type = ? AND owner_id = ?', type, id);
  return media;
}

function presentDoc(row) {
  const d = row.pay_state !== undefined ? row : get('SELECT * FROM registry_view WHERE id = ?', row.id);
  return {
    ...d, amount: azn(d.amount), vat_amount: azn(d.vat_amount), paid: azn(d.paid), debt: azn(Math.max(0, d.amount - d.paid)),
    response_required: !!d.response_required, response_label: responseLabel(d), pay_label: PAY_LABEL[d.pay_state] || '',
    party: d.doc_type === ORDER_TYPE ? d.employee_name || d.recipient : d.cp_name || d.recipient,
  };
}

/* ------------------------------------------------------------------ register: shape and rules */
const regShape = {
  doc_date: v.date({ required: true }), doc_type: v.str({ max: 40, required: true }), doc_no: v.str({ max: 40 }),
  counterparty_id: v.int({ min: 1 }), employee_id: v.int({ min: 1 }), recipient: v.str({ max: 200 }),
  email: v.str({ max: 254 }), phone: v.str({ max: 60 }), subject: v.text({ max: 1000 }), executor: v.str({ max: 80 }),
  send_method: v.str({ max: 40 }), sent_date: v.date(), status: v.str({ max: 40 }), response_required: v.bool(),
  response_date: v.date(), response_no: v.str({ max: 60 }), response_summary: v.text({ max: 2000 }), result: v.str({ max: 40 }),
  amount: v.money(), vat_amount: v.money(), currency: v.oneOf(CURRENCIES, { default: 'AZN' }), due_date: v.date(), note: v.text({ max: 4000 }),
};
// Number assignment. A number, once given, stays with the document (changing the type or the date
// later does not renumber it). Clearing the number field on edit gives a new automatic number.
function assignNumber(d, existing) {
  const type = d.doc_type ?? existing.doc_type;
  const date = d.doc_date ?? existing.doc_date;
  let index = typeIndex(type);
  if (!index) {
    if (existing && existing.doc_type === type) index = existing.doc_index;
    else throw err(422, 'Sənəd növü siyahıda yoxdur', { fields: { doc_type: 'Sənəd növünü siyahıdan seçin (Siyahılar bölməsində əlavə edilə bilər)' } });
  }
  const wanted = d.doc_no !== undefined ? d.doc_no.trim() : undefined;
  if (existing && (wanted === undefined || wanted === existing.doc_no)) { delete d.doc_no; return; }
  if (wanted) {
    if (get('SELECT id FROM registry_docs WHERE doc_no = ? AND id <> ?', wanted, existing ? existing.id : 0)) throw err(422, 'Bu nömrə artıq istifadə olunur', { fields: { doc_no: 'Bu nömrə artıq başqa sənəddədir' } });
    const m = NO_RX.exec(wanted);
    Object.assign(d, m ? { doc_no: wanted, doc_index: m[1], seq: +m[2], doc_year: 2000 + +m[4] } : { doc_no: wanted, doc_index: index, seq: 0, doc_year: +date.slice(0, 4) });
    return;
  }
  const year = +date.slice(0, 4);
  const seq = nextSeq(index, year);
  Object.assign(d, { doc_index: index, doc_year: year, seq, doc_no: fmtNo(index, seq, date) });
}

/* ------------------------------------------------------------------ Excel import */
// Column headers of the company's Excel register (and of the panel's own Excel export).
const COLS = {
  'Tarix': 'doc_date', 'Sənəd növü': 'doc_type', 'İndeks': 'doc_index', 'Sənəd nömrəsi': 'doc_no', 'Alan tərəf': 'recipient', 'E-poçt ünvanı': 'email',
  'Əlaqə nömrəsi': 'phone', 'Mövzu / Qısa məzmun': 'subject', 'İcraçı': 'executor', 'Göndərilmə üsulu': 'send_method', 'Göndərilmə tarixi': 'sent_date',
  'Status': 'status', 'Cavab tələb olunur?': 'response_required', 'Cavab tarixi': 'response_date', 'Cavab nömrəsi': 'response_no',
  'Cavabın qısa məzmunu': 'response_summary', 'Nəticə': 'result', 'Qeyd': 'note', 'Məbləğ': 'amount', 'ƏDV': 'vat_amount', 'Valyuta': 'currency', 'Ödəniş müddəti': 'due_date',
};
const EMPTY = new Set(['', '-', '—', 'yoxdur', 'cavab tələb olunmur']);
const clean = (x) => { if (x === null || x === undefined) return ''; const s = String(x).trim(); return EMPTY.has(s.toLowerCase()) ? '' : s; };

function parseRegister(buf) {
  let book;
  try { book = readXlsx(buf); } catch (e) { throw err(422, e.message || 'Excel faylı oxunmadı'); }
  // The sheet whose first row has the register headers ("Reyestr" in the company's file).
  let rows = null, sheet = '';
  for (const name of book.sheets) { const r = book.rows(name); if (r && r[0] && r[0].includes('Sənəd nömrəsi') && r[0].includes('Tarix')) { rows = r; sheet = name; break; } }
  if (!rows) throw err(422, 'Faylda reyestr vərəqi tapılmadı (ilk sətirdə «Tarix» və «Sənəd nömrəsi» sütunları olmalıdır)');
  const head = rows[0].map((h) => COLS[String(h || '').trim()] || null);
  const out = [];
  rows.slice(1).forEach((r, i) => {
    const o = { line: i + 2 };
    head.forEach((k, ci) => { if (k) o[k] = r[ci]; });
    if (!o.doc_date && !o.doc_type && !clean(o.doc_no)) return; // empty template row
    out.push(o);
  });
  return { sheet, rows: out };
}

function importRegister(ctx, buf, commit) {
  const { sheet, rows } = parseRegister(buf);
  const L = lists();
  const types = new Map(L.doc_types.map((t) => [t.name, t.index]));
  const newTypes = [], newCps = new Map(), newEmps = new Map(), items = [], warnings = [];
  const cpByName = new Map(all('SELECT id, name FROM counterparties').map((c) => [fold(c.name).trim(), c.id]));
  const empByName = new Map(all('SELECT id, full_name FROM employees').map((e) => [fold(e.full_name).trim(), e.id]));
  const taken = new Set(all('SELECT doc_no FROM registry_docs').map((r) => r.doc_no));
  for (const r of rows) {
    const doc_date = excelDate(r.doc_date), type = clean(r.doc_type), no = clean(r.doc_no);
    const base = { line: r.line, doc_no: no, doc_date, doc_type: type, party: clean(r.recipient), subject: clean(r.subject) };
    if (!doc_date || !type) { items.push({ ...base, action: 'skip', reason: 'Tarix və ya sənəd növü yoxdur' }); continue; }
    if (no && taken.has(no)) { items.push({ ...base, action: 'skip', reason: 'Bu nömrə panelin reyestrində artıq var' }); continue; }
    if (!types.has(type)) {
      const idx = clean(r.doc_index).toUpperCase();
      if (!/^[A-Z]{1,4}$/.test(idx)) { items.push({ ...base, action: 'skip', reason: `«${type}» növü siyahıda yoxdur və indeksi göstərilməyib` }); continue; }
      types.set(type, idx); newTypes.push({ name: type, index: idx });
    }
    const email = clean(r.email);
    const emailOk = /^[a-z0-9][a-z0-9._+-]{0,63}@[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63}){1,6}$/i.test(email);
    if (email && !emailOk) warnings.push(`Sətir ${r.line}: e-poçt «${email}» düzgün deyil, qeydə köçürüldü`);
    const party = clean(r.recipient);
    const key = fold(party).trim();
    if (party && type === ORDER_TYPE && !empByName.has(key) && !newEmps.has(key)) newEmps.set(key, party);
    if (party && type !== ORDER_TYPE && !cpByName.has(key) && !newCps.has(key)) newCps.set(key, { name: party, email: emailOk ? email.toLowerCase() : '', phone: clean(r.phone) });
    const req = clean(r.response_required).toLowerCase();
    const money = (x) => { try { return v.money()(clean(x)); } catch { warnings.push(`Sətir ${r.line}: məbləğ «${x}» oxunmadı`); return 0; } };
    items.push({ ...base, action: 'add', row: {
      doc_date, doc_type: type, doc_no: no, recipient: party, email: emailOk ? email.toLowerCase() : '', phone: clean(r.phone), subject: clean(r.subject),
      executor: clean(r.executor), send_method: clean(r.send_method), sent_date: excelDate(r.sent_date), status: clean(r.status),
      response_required: req === 'bəli' || req === 'beli' || r.response_required === true ? 1 : 0, response_date: excelDate(r.response_date),
      response_no: clean(r.response_no), response_summary: clean(r.response_summary), result: clean(r.result),
      amount: money(r.amount), vat_amount: money(r.vat_amount), currency: CURRENCIES.includes(clean(r.currency)) ? clean(r.currency) : 'AZN', due_date: excelDate(r.due_date),
      note: [clean(r.note), email && !emailOk ? `E-poçt: ${email}` : ''].filter(Boolean).join('\n'),
    } });
    if (no) taken.add(no);
  }
  const summary = { sheet, total: rows.length, add: items.filter((x) => x.action === 'add').length, skip: items.filter((x) => x.action === 'skip').length,
    new_types: newTypes, new_counterparties: [...newCps.values()].map((c) => c.name), new_employees: [...newEmps.values()], warnings };
  if (!commit) return { ...summary, items: items.map(({ row, ...x }) => x) };
  tx(() => {
    if (newTypes.length) setSetting('office', { ...L, doc_types: [...L.doc_types, ...newTypes] }, ctx.user.id);
    const ts = now();
    for (const [key, c] of newCps) cpByName.set(key, run('INSERT INTO counterparties (name, kind, email, phone, created_at, updated_at) VALUES (?,?,?,?,?,?)', c.name, 'client', c.email, c.phone, ts, ts).lastInsertRowid);
    for (const [key, name] of newEmps) empByName.set(key, run('INSERT INTO employees (full_name, status, created_at, updated_at) VALUES (?,?,?,?)', name, 'active', ts, ts).lastInsertRowid);
    for (const it of items) {
      if (it.action !== 'add') continue;
      const d = { ...it.row };
      const key = fold(d.recipient).trim();
      if (d.doc_type === ORDER_TYPE) d.employee_id = empByName.get(key) || null; else d.counterparty_id = cpByName.get(key) || null;
      assignNumber(d, null);
      const cols = Object.keys(d);
      it.id = run(`INSERT INTO registry_docs (${cols.join(', ')}, created_by, created_at, updated_at) VALUES (${cols.map(() => '?').join(', ')}, ?, ?, ?)`, ...cols.map((c) => d[c]), ctx.user.id, ts, ts).lastInsertRowid;
      it.doc_no = d.doc_no;
    }
    audit(ctx, { action: 'İdxal (Excel)', module: 'Sənəd reyestri', summary: `${ctx.user.name} Excel-dən ${summary.add} sənəd idxal etdi (${summary.skip} sətir buraxıldı)`,
      next: { added: items.filter((x) => x.id).map((x) => x.doc_no), counterparties: summary.new_counterparties, employees: summary.new_employees, types: newTypes } });
  });
  return { ...summary, items: items.map(({ row, ...x }) => x) };
}

module.exports = (app) => {
  /* ---------------------------------------------------------------- lists and meta */
  // Everything the office screens need for their dropdowns, readable with any office permission.
  app.get('/api/office/meta', can('registry.view', 'finance.view', 'hr.view'), (ctx) => {
    const L = lists();
    ctx.json({
      lists: L, currencies: CURRENCIES, kinds: KIND_LABEL, methods: METHOD_LABEL, cp_kinds: CP_KIND, order_type: ORDER_TYPE, cancelled_status: CANCELLED,
      counterparties: all('SELECT id, name FROM counterparties WHERE is_active = 1 ORDER BY fold(name)'),
      employees: all("SELECT id, full_name, status FROM employees ORDER BY status = 'left', fold(full_name)"),
      allowed: files.DOC_EXT, max_mb: config.maxUploadMb, today: dayOf(),
      can_edit_lists: ctx.perms.has('registry.edit'),
    });
  });

  /* ---------------------------------------------------------------- attached files (scans) */
  const FILE_PERMS = { doc: ['registry.view', 'registry.edit', 'registry_docs'], ledger: ['finance.view', 'finance.edit', 'ledger'], employee: ['hr.view', 'hr.edit', 'employees'] };
  const fileOwnerCheck = (ctx, type, need) => {
    const p = FILE_PERMS[type];
    if (!p) throw err(404, 'Tapılmadı');
    if (!ctx.perms.has(p[need === 'edit' ? 1 : 0])) throw err(403, 'Bu əməliyyat üçün icazəniz yoxdur');
    return p;
  };
  async function attach(ctx, type, ownerId, file, label) {
    const m = await files.storeUpload(file, { allowed: files.DOC_EXT, isPrivate: true, userId: ctx.user.id, folder: 'Ofis' });
    const id = run('INSERT INTO office_files (owner_type, owner_id, media_id, created_by, created_at) VALUES (?,?,?,?,?)', type, ownerId, m.id, ctx.user.id, now()).lastInsertRowid;
    audit(ctx, { action: 'Fayl əlavə etmə', module: { doc: 'Sənəd reyestri', ledger: 'Gəlir-xərc', employee: 'Kadrlar' }[type], recordId: ownerId, summary: `${ctx.user.name} fayl əlavə etdi: ${m.original_name}${label ? ` → ${label}` : ''}` });
    return id;
  }
  app.post('/api/office/files/:type/:id', can('registry.edit', 'finance.edit', 'hr.edit'), async (ctx) => {
    const type = ctx.params.type, p = fileOwnerCheck(ctx, type, 'edit'), id = ctx.intParam('id');
    if (!get(`SELECT id FROM ${p[2]} WHERE id = ?`, id)) throw err(404, 'Qeyd tapılmadı');
    const form = await ctx.readForm((config.maxUploadMb + 1) * files.MB);
    const fid = await attach(ctx, type, id, form.get('file'));
    ctx.json({ item: fileRows(type, id).find((f) => f.id === fid) }, 201);
  });
  app.get('/api/office/files/:fid', can('registry.view', 'finance.view', 'hr.view'), (ctx) => {
    const f = get('SELECT f.owner_type, m.* FROM office_files f JOIN media m ON m.id = f.media_id WHERE f.id = ? AND m.is_private = 1', ctx.intParam('fid'));
    if (!f) throw err(404, 'Fayl tapılmadı');
    fileOwnerCheck(ctx, f.owner_type, 'view');
    const inline = ctx.query.inline === '1' && files.INLINE_EXT.has(f.ext);
    sendFile(ctx, config.privateDir, f.stored_name, { type: f.mime, csp: FILE_CSP, download: f.original_name, inline, cache: 'private, no-store' });
  });
  app.delete('/api/office/files/:fid', can('registry.edit', 'finance.edit', 'hr.edit'), (ctx) => {
    const f = get('SELECT f.id, f.owner_type, f.owner_id, m.* FROM office_files f JOIN media m ON m.id = f.media_id WHERE f.id = ?', ctx.intParam('fid'));
    if (!f) throw err(404, 'Fayl tapılmadı');
    fileOwnerCheck(ctx, f.owner_type, 'edit');
    tx(() => {
      run('DELETE FROM office_files WHERE id = ?', ctx.intParam('fid'));
      files.removeMedia(f);
      audit(ctx, { action: 'Fayl silmə', module: 'Ofis faylları', recordId: f.owner_id, summary: `${ctx.user.name} faylı sildi: ${f.original_name}` });
    });
    ctx.json({ ok: true });
  });

  /* ---------------------------------------------------------------- register */
  defineResource(app, {
    name: 'sened-reyestri', path: '/api/registry', table: 'registry_docs', from: 'registry_view', module: 'Sənəd reyestri',
    perms: { view: 'registry.view', create: 'registry.edit', edit: 'registry.edit', delete: 'registry.delete' },
    shape: regShape,
    search: ['doc_no', 'subject', 'recipient', 'cp_name', 'employee_name', 'note', 'response_summary', 'executor'],
    filters: { doc_type: { col: 'doc_type' }, status: { col: 'status' }, response: { col: 'response_state', values: ['none', 'waiting', 'received', 'cancelled'] },
      pay: { col: 'pay_state', values: ['none', 'unpaid', 'partial', 'paid'] }, counterparty_id: { col: 'counterparty_id', int: true }, employee_id: { col: 'employee_id', int: true }, year: { col: 'doc_year', int: true } },
    dateCol: 'doc_date',
    sortable: { date: 'doc_date', no: 'doc_no', type: 'doc_type', party: 'fold(cp_name || employee_name || recipient)', status: 'status', amount: 'amount' },
    defaultSort: 'doc_date DESC, id DESC',
    label: (r) => `${r.doc_no} (${r.doc_type})`,
    actionName: (a, b) => (a.status !== b.status ? 'Status dəyişikliyi' : 'Redaktə'),
    prepare(ctx, d, existing) {
      assignNumber(d, existing);
      const type = d.doc_type ?? (existing && existing.doc_type);
      if (type === ORDER_TYPE) { if ('counterparty_id' in d) d.counterparty_id = null; } else if ('employee_id' in d) d.employee_id = null;
      if (d.counterparty_id && !get('SELECT id FROM counterparties WHERE id = ?', d.counterparty_id)) throw err(422, 'Kontragent tapılmadı', { fields: { counterparty_id: 'Kontragent tapılmadı' } });
      if (d.employee_id && !get('SELECT id FROM employees WHERE id = ?', d.employee_id)) throw err(422, 'Əməkdaş tapılmadı', { fields: { employee_id: 'Əməkdaş tapılmadı' } });
      if (d.vat_amount && d.amount !== undefined && d.vat_amount > d.amount) throw err(422, 'ƏDV məbləğdən böyük ola bilməz', { fields: { vat_amount: 'ƏDV ümumi məbləğdən böyük ola bilməz' } });
      if (!existing) d.created_by = ctx.user.id;
    },
    present: presentDoc,
    beforeDelete(ctx, row) { this._media = removeOwnerFiles('doc', row.id); },
    afterDelete() { for (const m of this._media || []) files.removeMedia(m); this._media = null; },
    exportColumns: [
      { label: 'Tarix', get: (r) => r.doc_date }, { label: 'Sənəd növü', get: (r) => r.doc_type }, { label: 'İndeks', get: (r) => r.doc_index }, { label: 'Sənəd nömrəsi', get: (r) => r.doc_no },
      { label: 'Alan tərəf', get: (r) => (r.doc_type === ORDER_TYPE ? r.employee_name : r.cp_name) || r.recipient }, { label: 'E-poçt ünvanı', get: (r) => r.email }, { label: 'Əlaqə nömrəsi', get: (r) => r.phone },
      { label: 'Mövzu / Qısa məzmun', get: (r) => r.subject }, { label: 'İcraçı', get: (r) => r.executor }, { label: 'Göndərilmə üsulu', get: (r) => r.send_method },
      { label: 'Göndərilmə tarixi', get: (r) => r.sent_date || '' }, { label: 'Status', get: (r) => r.status }, { label: 'Cavab tələb olunur?', get: (r) => (r.response_required ? 'Bəli' : 'Xeyr') },
      { label: 'Cavab tarixi', get: (r) => r.response_date || '' }, { label: 'Cavab nömrəsi', get: (r) => r.response_no }, { label: 'Cavabın qısa məzmunu', get: (r) => r.response_summary },
      { label: 'Nəticə', get: (r) => r.result }, { label: 'Cavab vəziyyəti', get: (r) => responseLabel(r) }, { label: 'Məbləğ', get: (r) => (r.amount ? azn(r.amount) : '') },
      { label: 'ƏDV', get: (r) => (r.vat_amount ? azn(r.vat_amount) : '') }, { label: 'Valyuta', get: (r) => r.currency }, { label: 'Ödənilib', get: (r) => (r.amount ? azn(r.paid) : '') },
      { label: 'Ödəniş vəziyyəti', get: (r) => PAY_LABEL[r.pay_state] }, { label: 'Ödəniş müddəti', get: (r) => r.due_date || '' }, { label: 'Skan sayı', get: (r) => r.files_count }, { label: 'Qeyd', get: (r) => r.note },
    ],
    extra(a) {
      // Overview for the top of the register page: documents per type and month, next numbers,
      // responses still awaited, unpaid amounts.
      a.get('/api/registry/summary', can('registry.view'), (ctx) => {
        const today = dayOf(), year = /^\d{4}$/.test(ctx.query.year || '') ? +ctx.query.year : +today.slice(0, 4);
        const L = lists();
        const counts = all("SELECT doc_type, CAST(substr(doc_date, 6, 2) AS INTEGER) AS m, COUNT(*) AS n FROM registry_docs WHERE doc_year = ? GROUP BY doc_type, m", year);
        const types = [...new Set([...L.doc_types.map((t) => t.name), ...counts.map((c) => c.doc_type)])];
        const table = types.map((t) => {
          const months = Array.from({ length: 12 }, (_, i) => (counts.find((c) => c.doc_type === t && c.m === i + 1) || { n: 0 }).n);
          const idx = typeIndex(t);
          return { type: t, index: idx || '', months, total: months.reduce((x, y) => x + y, 0), next: idx ? fmtNo(idx, nextSeq(idx, +today.slice(0, 4)), today) : '' };
        });
        const waiting = all("SELECT * FROM registry_view WHERE response_state = 'waiting' ORDER BY COALESCE(sent_date, doc_date) LIMIT 20").map(presentDoc);
        const unpaid = all("SELECT * FROM registry_view WHERE pay_state IN ('unpaid','partial') AND status <> ? ORDER BY COALESCE(due_date, doc_date) LIMIT 50", CANCELLED).map(presentDoc);
        const years = all('SELECT DISTINCT doc_year AS y FROM registry_docs ORDER BY y DESC').map((r) => r.y);
        ctx.json({ year, years: years.includes(year) ? years : [year, ...years].sort((x, y) => y - x), table, waiting, waiting_total: get("SELECT COUNT(*) AS n FROM registry_view WHERE response_state = 'waiting'").n,
          unpaid, unpaid_total: azn(unpaid.reduce((s, d) => s + Math.round(d.debt * 100), 0)), total: get('SELECT COUNT(*) AS n FROM registry_docs WHERE doc_year = ?', year).n });
      });
      // The number the next document of a type would get (shown in the form before saving).
      a.get('/api/registry/next-number', can('registry.view'), (ctx) => {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.date || '') ? ctx.query.date : dayOf();
        const idx = typeIndex(String(ctx.query.type || ''));
        ctx.json({ number: idx ? fmtNo(idx, nextSeq(idx, +date.slice(0, 4)), date) : '' });
      });
      // One record with everything shown on its page: scans and the payments linked to it.
      a.get('/api/registry/:id/details', can('registry.view'), (ctx) => {
        const row = get('SELECT * FROM registry_view WHERE id = ?', ctx.intParam('id'));
        if (!row) throw err(404, 'Qeyd tapılmadı');
        const payments = ctx.perms.has('finance.view')
          ? all('SELECT id, entry_date, kind, amount, method, description FROM ledger WHERE doc_id = ? ORDER BY entry_date', row.id).map((p) => ({ ...p, amount: azn(p.amount), kind_label: KIND_LABEL[p.kind], method_label: METHOD_LABEL[p.method] }))
          : null;
        ctx.json({ item: presentDoc(row), files: fileRows('doc', row.id), payments });
      });
      // Bulk scans: the file name is the document number with "/" written as "_"
      // (AE-001/09-26 -> AE-001_09-26.pdf), the rule of the Excel register. One file per request.
      a.post('/api/registry/scans', can('registry.edit'), async (ctx) => {
        const form = await ctx.readForm((config.maxUploadMb + 1) * files.MB);
        const file = form.get('file');
        if (!file || typeof file.name !== 'string') throw err(422, 'Fayl seçilməyib');
        const base = file.name.replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/\s*\(\d+\)$/, '').trim().toUpperCase();
        const candidates = [base, base.replace(/_/g, '/'), base.replace(/_(\d{2})-(\d{2})$/, '/$1-$2'), base.replace(/^([A-Z]+-\d+)[_ -](\d{2})[-_](\d{2})$/, '$1/$2-$3')];
        const doc = candidates.map((c) => get('SELECT id, doc_no FROM registry_docs WHERE doc_no = ?', c)).find(Boolean);
        if (!doc) throw err(422, `«${file.name}» adına uyğun sənəd nömrəsi tapılmadı (ad nömrə kimi olmalıdır, məs. AE-001_09-26.pdf)`, { code: 'no_match' });
        await attach(ctx, 'doc', doc.id, file, doc.doc_no);
        ctx.json({ ok: true, doc_no: doc.doc_no, id: doc.id }, 201);
      });
      // Excel import: mode=preview shows what would happen, mode=commit does it (in one transaction).
      a.post('/api/registry/import', can('registry.edit'), async (ctx) => {
        const form = await ctx.readForm(25 * files.MB);
        const file = form.get('file');
        if (!file || typeof file.arrayBuffer !== 'function') throw err(422, 'Excel faylı seçilməyib');
        if (!/\.xlsx$/i.test(file.name || '')) throw err(422, 'Yalnız .xlsx faylı qəbul olunur');
        const buf = Buffer.from(await file.arrayBuffer());
        ctx.json(importRegister(ctx, buf, form.get('mode') === 'commit'));
      });
    },
  });

  /* ---------------------------------------------------------------- counterparties */
  const cpShape = {
    name: v.str({ max: 200, required: true }), kind: v.oneOf(Object.keys(CP_KIND), { default: 'client' }), tax_id: v.str({ max: 20, pattern: /^\d*$/, message: 'VÖEN yalnız rəqəmlərdən ibarətdir' }),
    legal_address: v.str({ max: 300 }), bank_name: v.str({ max: 150 }), bank_account: v.str({ max: 40 }), bank_code: v.str({ max: 20 }), swift: v.str({ max: 20 }),
    contact_person: v.str({ max: 150 }), phone: v.str({ max: 60 }), email: v.email(), notes: v.text({ max: 4000 }), is_active: v.bool({ default: true }),
  };
  defineResource(app, {
    name: 'kontragentler', path: '/api/counterparties', table: 'counterparties', module: 'Kontragentlər',
    perms: { view: 'finance.view', create: 'finance.edit', edit: 'finance.edit', delete: 'finance.delete' },
    shape: cpShape, search: ['name', 'tax_id', 'contact_person', 'email', 'phone'],
    filters: { kind: { col: 'kind', values: Object.keys(CP_KIND) }, active: { col: 'is_active', int: true } },
    sortable: { name: 'fold(name)', kind: 'kind', date: 'created_at' }, defaultSort: 'fold(name) ASC',
    label: (r) => `Kontragent «${r.name}»`,
    present: (r) => ({ ...r, kind_label: CP_KIND[r.kind] }),
    beforeDelete(ctx, row) {
      const n = get('SELECT (SELECT COUNT(*) FROM registry_docs WHERE counterparty_id = ?) + (SELECT COUNT(*) FROM ledger WHERE counterparty_id = ?) AS n', row.id, row.id).n;
      if (n) throw err(409, `Bu kontragentə ${n} sənəd/ödəniş bağlıdır — əvvəlcə onları dəyişin və ya kontragenti «aktiv deyil» edin`);
    },
    exportColumns: [{ label: 'Ad', get: (r) => r.name }, { label: 'Növ', get: (r) => CP_KIND[r.kind] }, { label: 'VÖEN', get: (r) => r.tax_id }, { label: 'Hüquqi ünvan', get: (r) => r.legal_address },
      { label: 'Bank', get: (r) => r.bank_name }, { label: 'Hesab (IBAN)', get: (r) => r.bank_account }, { label: 'Bank kodu', get: (r) => r.bank_code }, { label: 'SWIFT', get: (r) => r.swift },
      { label: 'Əlaqə şəxsi', get: (r) => r.contact_person }, { label: 'Telefon', get: (r) => r.phone }, { label: 'E-poçt', get: (r) => r.email }, { label: 'Qeyd', get: (r) => r.notes }],
    extra(a) {
      a.get('/api/counterparties/:id/details', can('finance.view'), (ctx) => {
        const c = get('SELECT * FROM counterparties WHERE id = ?', ctx.intParam('id'));
        if (!c) throw err(404, 'Qeyd tapılmadı');
        const docs = all('SELECT * FROM registry_view WHERE counterparty_id = ? ORDER BY doc_date DESC LIMIT 300', c.id).map(presentDoc);
        const ledger = all('SELECT * FROM ledger_view WHERE counterparty_id = ? ORDER BY entry_date DESC LIMIT 300', c.id).map(presentLedger);
        const t = get(`SELECT COALESCE(SUM(amount), 0) AS invoiced, COALESCE(SUM(paid), 0) AS paid FROM registry_view WHERE counterparty_id = ? AND amount > 0 AND status <> ?`, c.id, CANCELLED);
        ctx.json({ item: { ...c, kind_label: CP_KIND[c.kind] }, docs, ledger, totals: { invoiced: azn(t.invoiced), paid: azn(t.paid), debt: azn(Math.max(0, t.invoiced - t.paid)) } });
      });
    },
  });

  /* ---------------------------------------------------------------- income / expense journal */
  const presentLedger = (r) => {
    const l = r.cp_name !== undefined ? r : get('SELECT * FROM ledger_view WHERE id = ?', r.id);
    return { ...l, amount: azn(l.amount), vat_amount: azn(l.vat_amount), kind_label: KIND_LABEL[l.kind], method_label: METHOD_LABEL[l.method] };
  };
  defineResource(app, {
    name: 'gelir-xerc', path: '/api/ledger', table: 'ledger', from: 'ledger_view', module: 'Gəlir-xərc',
    perms: { view: 'finance.view', create: 'finance.edit', edit: 'finance.edit', delete: 'finance.delete' },
    shape: { entry_date: v.date({ required: true }), kind: v.oneOf(['income', 'expense'], { required: true }), category: v.str({ max: 60 }), counterparty_id: v.int({ min: 1 }),
      doc_id: v.int({ min: 1 }), doc_no: v.str({ max: 40 }), amount: v.money({ required: true, positive: true }), vat_amount: v.money(), currency: v.oneOf(CURRENCIES, { default: 'AZN' }),
      method: v.oneOf(Object.keys(METHOD_LABEL), { default: 'bank' }), description: v.text({ max: 2000 }) },
    search: ['description', 'category', 'cp_name', 'doc_no'],
    filters: { kind: { col: 'kind', values: ['income', 'expense'] }, category: { col: 'category' }, method: { col: 'method', values: Object.keys(METHOD_LABEL) },
      counterparty_id: { col: 'counterparty_id', int: true }, doc_id: { col: 'doc_id', int: true }, currency: { col: 'currency', values: CURRENCIES } },
    dateCol: 'entry_date', sortable: { date: 'entry_date', amount: 'amount', category: 'fold(category)', party: 'fold(cp_name)' }, defaultSort: 'entry_date DESC, id DESC',
    label: (r) => `${KIND_LABEL[r.kind]} ${azn(r.amount)} ${r.currency} (${r.entry_date})`,
    prepare(ctx, d, existing) {
      // The document can be given by its number (typed in the form) instead of its id.
      const no = String(d.doc_no || '').trim();
      delete d.doc_no;
      if (no) { const doc = get('SELECT id FROM registry_docs WHERE doc_no = ?', no); if (!doc) throw err(422, 'Bu nömrəli sənəd reyestrdə yoxdur', { fields: { doc_no: 'Bu nömrəli sənəd reyestrdə yoxdur' } }); d.doc_id = doc.id; }
      if (d.doc_id) {
        const doc = get('SELECT counterparty_id FROM registry_docs WHERE id = ?', d.doc_id);
        if (!doc) throw err(422, 'Sənəd tapılmadı', { fields: { doc_no: 'Sənəd tapılmadı' } });
        if (!d.counterparty_id) d.counterparty_id = doc.counterparty_id; // the payer is the document's counterparty
      }
      if (d.counterparty_id && !get('SELECT id FROM counterparties WHERE id = ?', d.counterparty_id)) throw err(422, 'Kontragent tapılmadı', { fields: { counterparty_id: 'Kontragent tapılmadı' } });
      if (d.vat_amount && d.amount && d.vat_amount > d.amount) throw err(422, 'ƏDV məbləğdən böyük ola bilməz', { fields: { vat_amount: 'ƏDV ümumi məbləğdən böyük ola bilməz' } });
      if (!existing) d.created_by = ctx.user.id;
    },
    present: presentLedger,
    beforeDelete(ctx, row) { this._media = removeOwnerFiles('ledger', row.id); },
    afterDelete() { for (const m of this._media || []) files.removeMedia(m); this._media = null; },
    exportColumns: [{ label: 'Tarix', get: (r) => r.entry_date }, { label: 'Növ', get: (r) => KIND_LABEL[r.kind] }, { label: 'Kateqoriya', get: (r) => r.category }, { label: 'Kontragent', get: (r) => r.cp_name },
      { label: 'Sənəd nömrəsi', get: (r) => r.doc_no }, { label: 'Məbləğ', get: (r) => azn(r.amount) }, { label: 'ƏDV', get: (r) => azn(r.vat_amount) }, { label: 'Valyuta', get: (r) => r.currency },
      { label: 'Ödəniş üsulu', get: (r) => METHOD_LABEL[r.method] }, { label: 'Təsvir', get: (r) => r.description }],
    extra(a) {
      a.get('/api/ledger/:id/details', can('finance.view'), (ctx) => {
        const row = get('SELECT * FROM ledger_view WHERE id = ?', ctx.intParam('id'));
        if (!row) throw err(404, 'Qeyd tapılmadı');
        ctx.json({ item: presentLedger(row), files: fileRows('ledger', row.id) });
      });
      // Totals for the filtered period (same filters as the list).
      a.get('/api/ledger/totals', can('finance.view'), (ctx) => {
        const from = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.from || '') ? ctx.query.from : '0000-01-01';
        const to = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.to || '') ? ctx.query.to : '9999-12-31';
        const rows = all('SELECT currency, kind, SUM(amount) AS s, COUNT(*) AS n FROM ledger WHERE entry_date BETWEEN ? AND ? GROUP BY currency, kind', from, to);
        const out = {};
        for (const r of rows) { const c = out[r.currency] || (out[r.currency] = { income: 0, expense: 0 }); c[r.kind] = azn(r.s); }
        for (const c of Object.values(out)) c.balance = Math.round((c.income - c.expense) * 100) / 100;
        ctx.json({ totals: out });
      });
    },
  });

  /* ---------------------------------------------------------------- employees */
  defineResource(app, {
    name: 'kadrlar', path: '/api/employees', table: 'employees', module: 'Kadrlar',
    perms: { view: 'hr.view', create: 'hr.edit', edit: 'hr.edit', delete: 'hr.delete' },
    shape: { full_name: v.str({ max: 150, required: true }), position: v.str({ max: 150 }), phone: v.str({ max: 60 }), email: v.email(), hire_date: v.date(), leave_date: v.date(),
      status: v.oneOf(['active', 'left'], { default: 'active' }), base_salary: v.money(), notes: v.text({ max: 4000 }) },
    search: ['full_name', 'position', 'email', 'phone'], filters: { status: { col: 'status', values: ['active', 'left'] } },
    sortable: { name: 'fold(full_name)', position: 'fold(position)', hire: 'hire_date', salary: 'base_salary' }, defaultSort: "status = 'left', fold(full_name)",
    label: (r) => `Əməkdaş «${r.full_name}»`,
    present: (r) => ({ ...r, base_salary: azn(r.base_salary) }),
    beforeDelete(ctx, row) {
      const n = get('SELECT (SELECT COUNT(*) FROM registry_docs WHERE employee_id = ?) + (SELECT COUNT(*) FROM payroll WHERE employee_id = ?) AS n', row.id, row.id).n;
      if (n) throw err(409, `Bu əməkdaşa ${n} əmr/əmək haqqı qeydi bağlıdır — silmək əvəzinə statusu «İşdən çıxıb» edin`);
      this._media = removeOwnerFiles('employee', row.id);
    },
    afterDelete() { for (const m of this._media || []) files.removeMedia(m); this._media = null; },
    exportColumns: [{ label: 'Ad, soyad', get: (r) => r.full_name }, { label: 'Vəzifə', get: (r) => r.position }, { label: 'Telefon', get: (r) => r.phone }, { label: 'E-poçt', get: (r) => r.email },
      { label: 'İşə qəbul', get: (r) => r.hire_date || '' }, { label: 'İşdən çıxma', get: (r) => r.leave_date || '' }, { label: 'Status', get: (r) => (r.status === 'active' ? 'İşləyir' : 'İşdən çıxıb') },
      { label: 'Əsas maaş (gross)', get: (r) => azn(r.base_salary) }],
    extra(a) {
      a.get('/api/employees/:id/details', can('hr.view'), (ctx) => {
        const e = get('SELECT * FROM employees WHERE id = ?', ctx.intParam('id'));
        if (!e) throw err(404, 'Qeyd tapılmadı');
        ctx.json({ item: { ...e, base_salary: azn(e.base_salary) }, files: fileRows('employee', e.id),
          orders: ctx.perms.has('registry.view') ? all('SELECT * FROM registry_view WHERE employee_id = ? ORDER BY doc_date DESC', e.id).map(presentDoc) : null,
          payroll: all('SELECT * FROM payroll WHERE employee_id = ? ORDER BY period DESC LIMIT 36', e.id).map(presentPay) });
      });
    },
  });

  /* ---------------------------------------------------------------- payroll */
  // Amounts are entered as calculated by the accountant (tax and social insurance rates change);
  // the panel adds them up: net = gross - all employee deductions.
  const PAY_FIELDS = ['gross', 'income_tax', 'dsmf_employee', 'unemployment_employee', 'health_employee', 'other_deductions', 'dsmf_employer', 'unemployment_employer', 'health_employer'];
  const presentPay = (r) => { const o = { ...r }; for (const k of [...PAY_FIELDS, 'net']) o[k] = azn(r[k]); o.employer_cost = azn(r.gross + r.dsmf_employer + r.unemployment_employer + r.health_employer); return o; };
  defineResource(app, {
    name: 'emek-haqqi', path: '/api/payroll', table: 'payroll', from: 'payroll_view', module: 'Əmək haqqı',
    perms: { view: 'hr.view', create: 'hr.edit', edit: 'hr.edit', delete: 'hr.delete' },
    shape: { employee_id: v.int({ min: 1, required: true }), period: v.month({ required: true }), ...Object.fromEntries(PAY_FIELDS.map((k) => [k, v.money()])),
      status: v.oneOf(['draft', 'paid'], { default: 'draft' }), paid_date: v.date(), note: v.text({ max: 1000 }) },
    search: ['full_name', 'note'], filters: { period: { col: 'period' }, employee_id: { col: 'employee_id', int: true }, status: { col: 'status', values: ['draft', 'paid'] } },
    sortable: { period: 'period', name: 'fold(full_name)', gross: 'gross', net: 'net' }, defaultSort: 'period DESC, fold(full_name)',
    label: (r) => `Əmək haqqı ${r.period} (əməkdaş #${r.employee_id})`,
    prepare(ctx, d, existing) {
      const m = { ...(existing || {}), ...d };
      if (!get('SELECT id FROM employees WHERE id = ?', m.employee_id)) throw err(422, 'Əməkdaş tapılmadı', { fields: { employee_id: 'Əməkdaş tapılmadı' } });
      if (get('SELECT id FROM payroll WHERE employee_id = ? AND period = ? AND id <> ?', m.employee_id, m.period, existing ? existing.id : 0)) throw err(422, 'Bu əməkdaş üçün həmin ayın qeydi artıq var', { fields: { period: 'Bu ay üçün qeyd artıq var' } });
      d.net = (m.gross || 0) - ['income_tax', 'dsmf_employee', 'unemployment_employee', 'health_employee', 'other_deductions'].reduce((s, k) => s + (m[k] || 0), 0);
      if (d.net < 0) throw err(422, 'Tutulmalar hesablanmış məbləğdən çoxdur', { fields: { gross: 'Tutulmaların cəmi hesablanmış əmək haqqından çox ola bilməz' } });
      if (m.status === 'paid' && !m.paid_date) d.paid_date = dayOf();
    },
    present: (r) => presentPay(r.full_name !== undefined ? r : get('SELECT * FROM payroll_view WHERE id = ?', r.id)),
    exportColumns: [{ label: 'Ay', get: (r) => r.period }, { label: 'Əməkdaş', get: (r) => r.full_name }, { label: 'Vəzifə', get: (r) => r.position }, { label: 'Hesablanıb (gross)', get: (r) => azn(r.gross) },
      { label: 'Gəlir vergisi', get: (r) => azn(r.income_tax) }, { label: 'DSMF (işçi)', get: (r) => azn(r.dsmf_employee) }, { label: 'İşsizlik sığortası (işçi)', get: (r) => azn(r.unemployment_employee) },
      { label: 'İcbari tibbi sığorta (işçi)', get: (r) => azn(r.health_employee) }, { label: 'Digər tutulmalar', get: (r) => azn(r.other_deductions) }, { label: 'Ödəniləcək (net)', get: (r) => azn(r.net) },
      { label: 'DSMF (işəgötürən)', get: (r) => azn(r.dsmf_employer) }, { label: 'İşsizlik sığortası (işəgötürən)', get: (r) => azn(r.unemployment_employer) },
      { label: 'İcbari tibbi sığorta (işəgötürən)', get: (r) => azn(r.health_employer) }, { label: 'Status', get: (r) => (r.status === 'paid' ? 'Ödənilib' : 'Qaralama') }, { label: 'Ödəniş tarixi', get: (r) => r.paid_date || '' }],
    extra(a) {
      // Creates draft rows of a month for every active employee that has none (gross = base salary).
      a.post('/api/payroll/generate', can('hr.edit'), async (ctx) => {
        const { period } = validate({ period: v.month({ required: true }) }, await ctx.readJson(1024));
        const ts = now();
        const made = tx(() => all("SELECT id, base_salary FROM employees WHERE status = 'active' AND id NOT IN (SELECT employee_id FROM payroll WHERE period = ?)", period)
          .map((e) => run('INSERT INTO payroll (employee_id, period, gross, net, created_at, updated_at) VALUES (?,?,?,?,?,?)', e.id, period, e.base_salary, e.base_salary, ts, ts).lastInsertRowid));
        if (made.length) audit(ctx, { action: 'Yaratma', module: 'Əmək haqqı', summary: `${ctx.user.name} ${period} ayı üçün ${made.length} qaralama yaratdı` });
        ctx.json({ created: made.length });
      });
      a.get('/api/payroll/totals', can('hr.view'), (ctx) => {
        const period = /^\d{4}-\d{2}$/.test(ctx.query.period || '') ? ctx.query.period : null;
        const where = period ? 'WHERE period = ?' : '';
        const t = get(`SELECT COUNT(*) AS n, ${[...PAY_FIELDS, 'net'].map((k) => `COALESCE(SUM(${k}), 0) AS ${k}`).join(', ')} FROM payroll ${where}`, ...(period ? [period] : []));
        ctx.json({ totals: presentPay(t), count: t.n, periods: all('SELECT DISTINCT period FROM payroll ORDER BY period DESC').map((r) => r.period) });
      });
    },
  });

  /* ---------------------------------------------------------------- finance overview */
  app.get('/api/finance/summary', can('finance.view'), (ctx) => {
    const today = dayOf(), year = /^\d{4}$/.test(ctx.query.year || '') ? +ctx.query.year : +today.slice(0, 4);
    const y = String(year);
    const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, income: 0, expense: 0, payroll: 0 }));
    for (const r of all("SELECT CAST(substr(entry_date, 6, 2) AS INTEGER) AS m, kind, SUM(amount) AS s FROM ledger WHERE substr(entry_date, 1, 4) = ? AND currency = 'AZN' GROUP BY m, kind", y)) months[r.m - 1][r.kind] = azn(r.s);
    if (ctx.perms.has('hr.view')) for (const r of all('SELECT CAST(substr(period, 6, 2) AS INTEGER) AS m, SUM(gross + dsmf_employer + unemployment_employer + health_employer) AS s FROM payroll WHERE substr(period, 1, 4) = ? GROUP BY m', y)) months[r.m - 1].payroll = azn(r.s);
    const cats = all("SELECT kind, category, SUM(amount) AS s FROM ledger WHERE substr(entry_date, 1, 4) = ? AND currency = 'AZN' GROUP BY kind, category ORDER BY s DESC", y).map((r) => ({ ...r, s: azn(r.s), kind_label: KIND_LABEL[r.kind] }));
    const other = all("SELECT currency, kind, SUM(amount) AS s FROM ledger WHERE substr(entry_date, 1, 4) = ? AND currency <> 'AZN' GROUP BY currency, kind", y).map((r) => ({ ...r, s: azn(r.s) }));
    const receivables = all("SELECT cp_name, currency, SUM(amount - paid) AS debt, COUNT(*) AS n, MIN(due_date) AS due FROM registry_view WHERE pay_state IN ('unpaid','partial') AND status <> ? GROUP BY counterparty_id, currency ORDER BY debt DESC", CANCELLED)
      .map((r) => ({ ...r, debt: azn(r.debt), cp_name: r.cp_name || '(kontragent seçilməyib)', overdue: Boolean(r.due && r.due < today) }));
    const tot = months.reduce((a, m) => ({ income: a.income + m.income, expense: a.expense + m.expense, payroll: a.payroll + m.payroll }), { income: 0, expense: 0, payroll: 0 });
    for (const k of Object.keys(tot)) tot[k] = Math.round(tot[k] * 100) / 100;
    ctx.json({ year, months, totals: { ...tot, balance: Math.round((tot.income - tot.expense) * 100) / 100 }, categories: cats, other_currencies: other, receivables,
      years: [...new Set([year, +today.slice(0, 4), ...all('SELECT DISTINCT CAST(substr(entry_date, 1, 4) AS INTEGER) AS y FROM ledger').map((r) => r.y)])].sort((a2, b) => b - a2) });
  });
};
