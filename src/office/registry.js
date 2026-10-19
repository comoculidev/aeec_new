'use strict';
// Sənəd reyestri: outgoing documents with automatic numbering (AE-001/09-26), response tracking,
// amounts and payments, scans, Excel import/export, PDF card and PDF report.
const config = require('../config');
const { get, all, run, tx, now, dayOf } = require('../db');
const { err } = require('../http');
const { v } = require('../validate');
const { can } = require('../auth');
const { audit } = require('../audit');
const { defineResource, fold } = require('../crud');
const { setSetting } = require('../settings');
const files = require('../files');
const { readXlsx, excelDate } = require('../xlsx-read');
const { attach, detachAll } = require('./attachments');
const C = require('./common');

/* ------------------------------------------------------------------ shape and numbering */
const shape = {
  doc_date: v.date({ required: true }), doc_type: v.str({ max: 40, required: true }), doc_no: v.str({ max: 40 }),
  counterparty_id: v.int({ min: 1 }), employee_id: v.int({ min: 1 }), recipient: v.str({ max: 200 }),
  email: v.str({ max: 254 }), phone: v.str({ max: 60 }), subject: v.text({ max: 1000 }), executor: v.str({ max: 80 }),
  send_method: v.str({ max: 40 }), sent_date: v.date(), status: v.str({ max: 40 }), response_required: v.bool(),
  response_date: v.date(), response_no: v.str({ max: 60 }), response_summary: v.text({ max: 2000 }), result: v.str({ max: 40 }),
  amount: v.money(), vat_amount: v.money(), currency: v.oneOf(C.CURRENCIES, { default: 'AZN' }), due_date: v.date(), note: v.text({ max: 4000 }),
};

// A number, once given, stays with the document (changing the type or the date later does not
// renumber it). Clearing the number on edit gives a new automatic number. A number typed in the
// file-name form (P-004-10-26) is stored in its official form (P-004/10-26).
function assignNumber(d, existing) {
  const type = d.doc_type ?? existing.doc_type;
  const date = d.doc_date ?? existing.doc_date;
  let index = C.typeIndex(type);
  if (!index) {
    if (existing && existing.doc_type === type) index = existing.doc_index;
    else throw err(422, 'Sənəd növü siyahıda yoxdur', { fields: { doc_type: 'Sənəd növünü siyahıdan seçin (Siyahılar bölməsində əlavə edilə bilər)' } });
  }
  const wanted = d.doc_no !== undefined ? C.normalizeNo(d.doc_no) : undefined;
  if (existing && (wanted === undefined || wanted === existing.doc_no)) { delete d.doc_no; return; }
  if (wanted) {
    if (get('SELECT id FROM registry_docs WHERE doc_no = ? AND id <> ?', wanted, existing ? existing.id : 0)) throw err(422, 'Bu nömrə artıq istifadə olunur', { fields: { doc_no: `${wanted} nömrəsi artıq başqa sənəddədir` } });
    const m = C.NO_RX.exec(wanted);
    Object.assign(d, m ? { doc_no: wanted, doc_index: m[1], seq: +m[2], doc_year: 2000 + +m[4] } : { doc_no: wanted, doc_index: index, seq: 0, doc_year: +date.slice(0, 4) });
    return;
  }
  const year = +date.slice(0, 4);
  const seq = C.nextSeq(index, year);
  Object.assign(d, { doc_index: index, doc_year: year, seq, doc_no: C.fmtNo(index, seq, date) });
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
  const L = C.lists();
  const types = new Map(L.doc_types.map((t) => [t.name, t.index]));
  const newTypes = [], newCps = new Map(), newEmps = new Map(), items = [], warnings = [];
  const cpByName = new Map(all('SELECT id, name FROM counterparties').map((c) => [fold(c.name).trim(), c.id]));
  const empByName = new Map(all('SELECT id, full_name FROM employees').map((e) => [fold(e.full_name).trim(), e.id]));
  const taken = new Set(all('SELECT doc_no FROM registry_docs').map((r) => r.doc_no));
  for (const r of rows) {
    const doc_date = excelDate(r.doc_date), type = clean(r.doc_type), no = C.normalizeNo(clean(r.doc_no));
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
    if (party && type === C.ORDER_TYPE && !empByName.has(key) && !newEmps.has(key)) newEmps.set(key, party);
    if (party && type !== C.ORDER_TYPE && !cpByName.has(key) && !newCps.has(key)) newCps.set(key, { name: party, email: emailOk ? email.toLowerCase() : '', phone: clean(r.phone) });
    const req = clean(r.response_required).toLowerCase();
    const money = (x) => { try { return v.money()(clean(x)); } catch { warnings.push(`Sətir ${r.line}: məbləğ «${x}» oxunmadı`); return 0; } };
    items.push({ ...base, action: 'add', row: {
      doc_date, doc_type: type, doc_no: no, recipient: party, email: emailOk ? email.toLowerCase() : '', phone: clean(r.phone), subject: clean(r.subject),
      executor: clean(r.executor), send_method: clean(r.send_method), sent_date: excelDate(r.sent_date), status: clean(r.status),
      response_required: req === 'bəli' || req === 'beli' || r.response_required === true ? 1 : 0, response_date: excelDate(r.response_date),
      response_no: clean(r.response_no), response_summary: clean(r.response_summary), result: clean(r.result),
      amount: money(r.amount), vat_amount: money(r.vat_amount), currency: C.CURRENCIES.includes(clean(r.currency)) ? clean(r.currency) : 'AZN', due_date: excelDate(r.due_date),
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
    for (const [key, name] of newEmps) {
      const n = C.splitName(name);
      empByName.set(key, run('INSERT INTO employees (full_name, last_name, first_name, father_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
        n.father_name ? C.fullName(n) : name, n.last_name, n.first_name, n.father_name || '', 'active', ts, ts).lastInsertRowid);
    }
    for (const it of items) {
      if (it.action !== 'add') continue;
      const d = { ...it.row };
      const key = fold(d.recipient).trim();
      if (d.doc_type === C.ORDER_TYPE) d.employee_id = empByName.get(key) || null; else d.counterparty_id = cpByName.get(key) || null;
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

// Overview of a year: documents per type and month, next numbers, awaited responses, unpaid amounts.
function summary(yearParam) {
  const today = dayOf(), year = /^\d{4}$/.test(yearParam || '') ? +yearParam : +today.slice(0, 4);
  const L = C.lists();
  const counts = all('SELECT doc_type, CAST(substr(doc_date, 6, 2) AS INTEGER) AS m, COUNT(*) AS n FROM registry_docs WHERE doc_year = ? GROUP BY doc_type, m', year);
  const types = [...new Set([...L.doc_types.map((t) => t.name), ...counts.map((c) => c.doc_type)])];
  const table = types.map((t) => {
    const months = Array.from({ length: 12 }, (_, i) => (counts.find((c) => c.doc_type === t && c.m === i + 1) || { n: 0 }).n);
    const idx = C.typeIndex(t);
    return { type: t, index: idx || '', months, total: months.reduce((x, y) => x + y, 0), next: idx ? C.fmtNo(idx, C.nextSeq(idx, +today.slice(0, 4)), today) : '' };
  });
  const waiting = all("SELECT * FROM registry_view WHERE response_state = 'waiting' ORDER BY COALESCE(sent_date, doc_date) LIMIT 20").map(C.presentDoc);
  const unpaid = all("SELECT * FROM registry_view WHERE pay_state IN ('unpaid','partial') AND status <> ? ORDER BY COALESCE(due_date, doc_date) LIMIT 50", C.CANCELLED).map(C.presentDoc);
  const years = all('SELECT DISTINCT doc_year AS y FROM registry_docs ORDER BY y DESC').map((r) => r.y);
  return { year, years: years.includes(year) ? years : [year, ...years].sort((x, y) => y - x), table, waiting, waiting_total: get("SELECT COUNT(*) AS n FROM registry_view WHERE response_state = 'waiting'").n,
    unpaid, unpaid_total: C.azn(unpaid.reduce((s, d) => s + Math.round(d.debt * 100), 0)), total: get('SELECT COUNT(*) AS n FROM registry_docs WHERE doc_year = ?', year).n };
}

function routes(app, reports) {
  defineResource(app, {
    name: 'sened-reyestri', path: '/api/registry', table: 'registry_docs', from: 'registry_view', module: 'Sənəd reyestri',
    perms: { view: 'registry.view', create: 'registry.edit', edit: 'registry.edit', delete: 'registry.delete' },
    shape,
    // doc_key = the number as written in file names, so "P-004-10-26" finds "P-004/10-26"
    search: ['doc_no', 'doc_key', 'subject', 'recipient', 'cp_name', 'employee_name', 'note', 'response_summary', 'executor'],
    filters: { doc_type: { col: 'doc_type' }, status: { col: 'status' }, response: { col: 'response_state', values: ['none', 'waiting', 'received', 'cancelled'] },
      pay: { col: 'pay_state', values: ['none', 'unpaid', 'partial', 'paid'] }, counterparty_id: { col: 'counterparty_id', int: true }, employee_id: { col: 'employee_id', int: true }, year: { col: 'doc_year', int: true } },
    dateCol: 'doc_date',
    sortable: { date: 'doc_date', no: 'doc_no', type: 'doc_type', party: 'fold(cp_name || employee_name || recipient)', status: 'status', amount: 'amount' },
    defaultSort: 'doc_date DESC, id DESC',
    label: (r) => `${r.doc_no} (${r.doc_type})`,
    actionName: (a, b) => (a.status !== b.status ? 'Status dəyişikliyi' : 'Redaktə'),
    prepare(ctx, d, existing) {
      assignNumber(d, existing);
      // Orders concern an employee only; other documents may name an organisation and/or an
      // employee (the person the document is addressed to).
      const type = d.doc_type ?? (existing && existing.doc_type);
      if (type === C.ORDER_TYPE && 'counterparty_id' in d) d.counterparty_id = null;
      if (d.counterparty_id && !get('SELECT id FROM counterparties WHERE id = ?', d.counterparty_id)) throw err(422, 'Kontragent tapılmadı', { fields: { counterparty_id: 'Kontragent tapılmadı' } });
      if (d.employee_id && !get('SELECT id FROM employees WHERE id = ?', d.employee_id)) throw err(422, 'Əməkdaş tapılmadı', { fields: { employee_id: 'Əməkdaş tapılmadı' } });
      if (d.vat_amount && d.amount !== undefined && d.vat_amount > d.amount) throw err(422, 'ƏDV məbləğdən böyük ola bilməz', { fields: { vat_amount: 'ƏDV ümumi məbləğdən böyük ola bilməz' } });
      if (!existing) d.created_by = ctx.user.id;
    },
    present: C.presentDoc,
    beforeDelete(ctx, row) { this._media = detachAll('doc', row.id); },
    afterDelete() { for (const m of this._media || []) files.removeMedia(m); this._media = null; },
    exportTitle: 'Sənəd reyestri',
    pdfColumns: ['Sənəd nömrəsi', 'Tarix', 'Sənəd növü', 'Alan tərəf', 'Mövzu / Qısa məzmun', 'İcraçı', 'Göndərilmə tarixi', 'Status', 'Cavab vəziyyəti', 'Nəticə', 'Məbləğ', 'Ödəniş vəziyyəti', 'Skan sayı'],
    exportColumns: [
      { label: 'Tarix', get: (r) => r.doc_date }, { label: 'Sənəd növü', get: (r) => r.doc_type }, { label: 'İndeks', get: (r) => r.doc_index }, { label: 'Sənəd nömrəsi', get: (r) => r.doc_no },
      { label: 'Alan tərəf', get: (r) => (r.doc_type === C.ORDER_TYPE ? r.employee_name : r.cp_name || r.employee_name) || r.recipient }, { label: 'E-poçt ünvanı', get: (r) => r.email }, { label: 'Əlaqə nömrəsi', get: (r) => r.phone },
      { label: 'Mövzu / Qısa məzmun', get: (r) => r.subject }, { label: 'İcraçı', get: (r) => r.executor }, { label: 'Göndərilmə üsulu', get: (r) => r.send_method },
      { label: 'Göndərilmə tarixi', get: (r) => r.sent_date || '' }, { label: 'Status', get: (r) => r.status }, { label: 'Cavab tələb olunur?', get: (r) => (r.response_required ? 'Bəli' : 'Xeyr') },
      { label: 'Cavab tarixi', get: (r) => r.response_date || '' }, { label: 'Cavab nömrəsi', get: (r) => r.response_no }, { label: 'Cavabın qısa məzmunu', get: (r) => r.response_summary },
      { label: 'Nəticə', get: (r) => r.result }, { label: 'Cavab vəziyyəti', get: (r) => C.responseLabel(r) }, { label: 'Məbləğ', get: (r) => (r.amount ? C.azn(r.amount) : '') },
      { label: 'ƏDV', get: (r) => (r.vat_amount ? C.azn(r.vat_amount) : '') }, { label: 'Valyuta', get: (r) => r.currency }, { label: 'Ödənilib', get: (r) => (r.amount ? C.azn(r.paid) : '') },
      { label: 'Ödəniş vəziyyəti', get: (r) => C.PAY_LABEL[r.pay_state] }, { label: 'Ödəniş müddəti', get: (r) => r.due_date || '' }, { label: 'Skan sayı', get: (r) => r.files_count }, { label: 'Qeyd', get: (r) => r.note },
    ],
    extra(a) {
      a.get('/api/registry/summary', can('registry.view'), (ctx) => ctx.json(summary(ctx.query.year)));
      a.get('/api/registry/summary/pdf', can('registry.view'), (ctx) => reports.registrySummary(ctx, summary(ctx.query.year)));
      // The number the next document of a type would get (shown in the form before saving).
      a.get('/api/registry/next-number', can('registry.view'), (ctx) => {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.date || '') ? ctx.query.date : dayOf();
        const idx = C.typeIndex(String(ctx.query.type || ''));
        ctx.json({ number: idx ? C.fmtNo(idx, C.nextSeq(idx, +date.slice(0, 4)), date) : '' });
      });
      // Is a number free? Accepts both written forms (P-004/10-26 and P-004-10-26).
      a.get('/api/registry/check-number', can('registry.view'), (ctx) => {
        const no = C.normalizeNo(ctx.query.no);
        const doc = no ? get('SELECT id FROM registry_docs WHERE doc_no = ?', no) : null;
        ctx.json({ number: no, file_name: C.fileKey(no), taken: Boolean(doc && String(doc.id) !== String(ctx.query.except || '')), id: doc ? doc.id : null });
      });
      a.get('/api/registry/:id/details', can('registry.view'), (ctx) => {
        const row = get('SELECT * FROM registry_view WHERE id = ?', ctx.intParam('id'));
        if (!row) throw err(404, 'Qeyd tapılmadı');
        const payments = ctx.perms.has('finance.view')
          ? all('SELECT id, entry_date, kind, amount, method, description, status FROM ledger WHERE doc_id = ? ORDER BY entry_date', row.id).map((p) => ({ ...p, amount: C.azn(p.amount), kind_label: C.KIND_LABEL[p.kind], method_label: C.METHOD_LABEL[p.method] }))
          : null;
        ctx.json({ item: C.presentDoc(row), files: C.fileRows('doc', row.id), payments });
      });
      a.get('/api/registry/:id/pdf', can('registry.view'), (ctx) => reports.registryCard(ctx, ctx.intParam('id')));
      // Bulk scans: the file name is the document number in file-name form. Accepted:
      // P-004-10-26.pdf, P-004_10-26.pdf, P-004_10_26.pdf, "P-004-10-26 (1).pdf". One file per request.
      a.post('/api/registry/scans', can('registry.edit'), async (ctx) => {
        const form = await ctx.readForm((config.maxUploadMb + 1) * files.MB);
        const file = form.get('file');
        if (!file || typeof file.name !== 'string') throw err(422, 'Fayl seçilməyib');
        const base = file.name.replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/\s*\(\d+\)$/, '').trim();
        let no = C.normalizeNo(base);
        // "P-004-10-26_2" = the second file of that document (the panel's own download names)
        if (!C.NO_RX.test(no)) { const m = /^(.+)_\d{1,2}$/.exec(base); if (m) no = C.normalizeNo(m[1]); }
        const doc = get('SELECT id, doc_no FROM registry_docs WHERE doc_no = ?', no) || get('SELECT id, doc_no FROM registry_docs WHERE doc_no = ?', base.toUpperCase());
        if (!doc) throw err(422, `«${file.name}» adına uyğun sənəd tapılmadı. Ad sənəd nömrəsi olmalıdır: P-004/10-26 üçün P-004-10-26.pdf`, { code: 'no_match' });
        await attach(ctx, 'doc', doc.id, file, { category: 'scan', label: doc.doc_no });
        ctx.json({ ok: true, doc_no: doc.doc_no, id: doc.id }, 201);
      });
      // Excel import: mode=preview shows what would happen, mode=commit does it (one transaction).
      a.post('/api/registry/import', can('registry.edit'), async (ctx) => {
        const form = await ctx.readForm(25 * files.MB);
        const file = form.get('file');
        if (!file || typeof file.arrayBuffer !== 'function') throw err(422, 'Excel faylı seçilməyib');
        if (!/\.xlsx$/i.test(file.name || '')) throw err(422, 'Yalnız .xlsx faylı qəbul olunur');
        ctx.json(importRegister(ctx, Buffer.from(await file.arrayBuffer()), form.get('mode') === 'commit'));
      });
    },
  });
}

module.exports = { routes, summary, assignNumber };
