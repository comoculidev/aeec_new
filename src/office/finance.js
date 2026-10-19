'use strict';
// Accounting: counterparties, the income/expense journal and the yearly finance report.
//
// Journal rules
//  - every entry starts as "Təsdiq gözləyir"; a user with finance.approve confirms it. Changing the
//    money data of a confirmed entry (not only its description) returns it to "Təsdiq gözləyir" (the change and the approvals are in its history);
//  - a new entry that looks like one already recorded (same kind, amount, currency and party within
//    3 days) is refused with code "duplicate" unless the user confirms it (allow_duplicate);
//  - an entry can be linked to a register document (contract, invoice) by its number; the document's
//    payment state is computed from the entries linked to it.
const { get, all, run, tx, now, dayOf } = require('../db');
const { err } = require('../http');
const { v } = require('../validate');
const { can } = require('../auth');
const { audit } = require('../audit');
const { defineResource } = require('../crud');
const files = require('../files');
const { detachAll } = require('./attachments');
const C = require('./common');

const presentLedger = (r) => {
  const l = r.cp_name !== undefined ? r : get('SELECT * FROM ledger_view WHERE id = ?', r.id);
  return { ...l, amount: C.azn(l.amount), vat_amount: C.azn(l.vat_amount), kind_label: C.KIND_LABEL[l.kind], method_label: C.METHOD_LABEL[l.method], status_label: C.LEDGER_STATUS[l.status] };
};

// Possible duplicates of an entry: same kind, amount, currency and counterparty, at most 3 days apart.
function similar(d, exceptId = 0) {
  return all(`SELECT * FROM ledger_view WHERE id <> ? AND kind = ? AND amount = ? AND currency = ? AND counterparty_id IS ?
              AND abs(julianday(entry_date) - julianday(?)) <= 3 ORDER BY entry_date DESC LIMIT 5`, exceptId, d.kind, d.amount, d.currency || 'AZN', d.counterparty_id || null, d.entry_date).map(presentLedger);
}

// Yearly report from the real entries: per month income, expense, turnover (income + expense) and
// the running balance (opening balance = everything before the year), categories, receivables.
function financeSummary(ctx, yearParam) {
  const today = dayOf(), year = /^\d{4}$/.test(yearParam || '') ? +yearParam : +today.slice(0, 4);
  const y = String(year);
  const sumBefore = (kind) => get("SELECT COALESCE(SUM(amount), 0) AS s FROM ledger WHERE kind = ? AND currency = 'AZN' AND entry_date < ?", kind, `${y}-01-01`).s;
  let balance = sumBefore('income') - sumBefore('expense');
  const opening = C.azn(balance);
  const raw = Array.from({ length: 12 }, () => ({ income: 0, expense: 0, payroll: 0 }));
  for (const r of all("SELECT CAST(substr(entry_date, 6, 2) AS INTEGER) AS m, kind, SUM(amount) AS s FROM ledger WHERE substr(entry_date, 1, 4) = ? AND currency = 'AZN' GROUP BY m, kind", y)) raw[r.m - 1][r.kind] = r.s;
  if (ctx.perms.has('hr.view')) for (const r of all('SELECT CAST(substr(period, 6, 2) AS INTEGER) AS m, SUM(gross + dsmf_employer + unemployment_employer + health_employer) AS s FROM payroll WHERE substr(period, 1, 4) = ? GROUP BY m', y)) raw[r.m - 1].payroll = r.s;
  const months = raw.map((m, i) => {
    const open = balance; balance += m.income - m.expense;
    return { month: i + 1, opening: C.azn(open), income: C.azn(m.income), expense: C.azn(m.expense), turnover: C.azn(m.income + m.expense), closing: C.azn(balance), payroll: C.azn(m.payroll) };
  });
  const cats = all("SELECT kind, category, SUM(amount) AS s, COUNT(*) AS n FROM ledger WHERE substr(entry_date, 1, 4) = ? AND currency = 'AZN' GROUP BY kind, category ORDER BY kind DESC, s DESC", y).map((r) => ({ ...r, s: C.azn(r.s), kind_label: C.KIND_LABEL[r.kind] }));
  const other = all("SELECT currency, kind, SUM(amount) AS s FROM ledger WHERE substr(entry_date, 1, 4) = ? AND currency <> 'AZN' GROUP BY currency, kind", y).map((r) => ({ ...r, s: C.azn(r.s) }));
  const receivables = all("SELECT cp_name, currency, SUM(amount - paid) AS debt, COUNT(*) AS n, MIN(due_date) AS due FROM registry_view WHERE pay_state IN ('unpaid','partial') AND status <> ? GROUP BY counterparty_id, currency ORDER BY debt DESC", C.CANCELLED)
    .map((r) => ({ ...r, debt: C.azn(r.debt), cp_name: r.cp_name || '(kontragent seçilməyib)', overdue: Boolean(r.due && r.due < today) }));
  const sum = (k) => Math.round(months.reduce((a, m) => a + m[k] * 100, 0)) / 100;
  const pending = get("SELECT COUNT(*) AS n FROM ledger WHERE status = 'pending' AND substr(entry_date, 1, 4) = ?", y).n;
  return { year, opening, months, pending,
    totals: { income: sum('income'), expense: sum('expense'), turnover: sum('turnover'), payroll: sum('payroll'), balance: Math.round((sum('income') - sum('expense')) * 100) / 100, closing: months[11].closing },
    categories: cats, other_currencies: other, receivables,
    years: [...new Set([year, +today.slice(0, 4), ...all('SELECT DISTINCT CAST(substr(entry_date, 1, 4) AS INTEGER) AS y FROM ledger').map((r) => r.y)])].sort((a, b) => b - a) };
}

function routes(app, reports) {
  /* ---------------------------------------------------------------- counterparties */
  defineResource(app, {
    name: 'kontragentler', path: '/api/counterparties', table: 'counterparties', module: 'Kontragentlər',
    perms: { view: 'finance.view', create: 'finance.edit', edit: 'finance.edit', delete: 'finance.delete' },
    shape: {
      name: v.str({ max: 200, required: true }), kind: v.oneOf(Object.keys(C.CP_KIND), { default: 'client' }), tax_id: v.str({ max: 20, pattern: /^\d*$/, message: 'VÖEN yalnız rəqəmlərdən ibarətdir' }),
      legal_address: v.str({ max: 300 }), bank_name: v.str({ max: 150 }), bank_account: v.str({ max: 40 }), bank_code: v.str({ max: 20 }), swift: v.str({ max: 20 }),
      contact_person: v.str({ max: 150 }), phone: v.str({ max: 60 }), email: v.email(), notes: v.text({ max: 4000 }), is_active: v.bool({ default: true }),
    },
    search: ['name', 'tax_id', 'contact_person', 'email', 'phone'],
    filters: { kind: { col: 'kind', values: Object.keys(C.CP_KIND) }, active: { col: 'is_active', int: true } },
    sortable: { name: 'fold(name)', kind: 'kind', date: 'created_at' }, defaultSort: 'fold(name) ASC',
    label: (r) => `Kontragent «${r.name}»`,
    present: (r) => ({ ...r, kind_label: C.CP_KIND[r.kind] }),
    beforeDelete(ctx, row) {
      const n = get('SELECT (SELECT COUNT(*) FROM registry_docs WHERE counterparty_id = ?) + (SELECT COUNT(*) FROM ledger WHERE counterparty_id = ?) AS n', row.id, row.id).n;
      if (n) throw err(409, `Bu kontragentə ${n} sənəd/ödəniş bağlıdır — əvvəlcə onları dəyişin və ya kontragenti «aktiv deyil» edin`);
    },
    exportColumns: [{ label: 'Ad', get: (r) => r.name }, { label: 'Növ', get: (r) => C.CP_KIND[r.kind] }, { label: 'VÖEN', get: (r) => r.tax_id }, { label: 'Hüquqi ünvan', get: (r) => r.legal_address },
      { label: 'Bank', get: (r) => r.bank_name }, { label: 'Hesab (IBAN)', get: (r) => r.bank_account }, { label: 'Bank kodu', get: (r) => r.bank_code }, { label: 'SWIFT', get: (r) => r.swift },
      { label: 'Əlaqə şəxsi', get: (r) => r.contact_person }, { label: 'Telefon', get: (r) => r.phone }, { label: 'E-poçt', get: (r) => r.email }, { label: 'Qeyd', get: (r) => r.notes }],
    extra(a) {
      a.get('/api/counterparties/:id/details', can('finance.view'), (ctx) => ctx.json(counterpartyCard(ctx.intParam('id'))));
      a.get('/api/counterparties/:id/pdf', can('finance.view'), (ctx) => reports.counterpartyStatement(ctx, counterpartyCard(ctx.intParam('id'))));
    },
  });
  function counterpartyCard(id) {
    const c = get('SELECT * FROM counterparties WHERE id = ?', id);
    if (!c) throw err(404, 'Qeyd tapılmadı');
    const docs = all('SELECT * FROM registry_view WHERE counterparty_id = ? ORDER BY doc_date DESC LIMIT 300', c.id).map(C.presentDoc);
    const ledger = all('SELECT * FROM ledger_view WHERE counterparty_id = ? ORDER BY entry_date DESC LIMIT 300', c.id).map(presentLedger);
    const t = get('SELECT COALESCE(SUM(amount), 0) AS invoiced, COALESCE(SUM(paid), 0) AS paid FROM registry_view WHERE counterparty_id = ? AND amount > 0 AND status <> ?', c.id, C.CANCELLED);
    return { item: { ...c, kind_label: C.CP_KIND[c.kind] }, docs, ledger, totals: { invoiced: C.azn(t.invoiced), paid: C.azn(t.paid), debt: C.azn(Math.max(0, t.invoiced - t.paid)) } };
  }

  /* ---------------------------------------------------------------- journal */
  defineResource(app, {
    name: 'gelir-xerc', path: '/api/ledger', table: 'ledger', from: 'ledger_view', module: 'Gəlir-xərc',
    perms: { view: 'finance.view', create: 'finance.edit', edit: 'finance.edit', delete: 'finance.delete' },
    shape: { entry_date: v.date({ required: true }), kind: v.oneOf(['income', 'expense'], { required: true }), category: v.str({ max: 60 }), counterparty_id: v.int({ min: 1 }),
      doc_id: v.int({ min: 1 }), doc_no: v.str({ max: 40 }), amount: v.money({ required: true, positive: true }), vat_amount: v.money(), currency: v.oneOf(C.CURRENCIES, { default: 'AZN' }),
      method: v.oneOf(Object.keys(C.METHOD_LABEL), { default: 'bank' }), description: v.text({ max: 2000 }), allow_duplicate: v.bool() },
    search: ['description', 'category', 'cp_name', 'doc_no'],
    filters: { kind: { col: 'kind', values: ['income', 'expense'] }, category: { col: 'category' }, method: { col: 'method', values: Object.keys(C.METHOD_LABEL) },
      counterparty_id: { col: 'counterparty_id', int: true }, doc_id: { col: 'doc_id', int: true }, currency: { col: 'currency', values: C.CURRENCIES }, status: { col: 'status', values: Object.keys(C.LEDGER_STATUS) } },
    dateCol: 'entry_date', sortable: { date: 'entry_date', amount: 'amount', category: 'fold(category)', party: 'fold(cp_name)', status: 'status' }, defaultSort: 'entry_date DESC, id DESC',
    label: (r) => `${C.KIND_LABEL[r.kind]} ${C.azn(r.amount)} ${r.currency} (${r.entry_date})`,
    actionName: (a, b) => (a.status === 'approved' && b.status === 'pending' ? 'Redaktə (təsdiq ləğv olundu)' : 'Redaktə'),
    prepare(ctx, d, existing) {
      // The document can be given by its number (either written form) instead of its id.
      const no = C.normalizeNo(d.doc_no || '');
      delete d.doc_no;
      if (no) { const doc = get('SELECT id FROM registry_docs WHERE doc_no = ?', no); if (!doc) throw err(422, 'Bu nömrəli sənəd reyestrdə yoxdur', { fields: { doc_no: `${no} nömrəli sənəd reyestrdə yoxdur` } }); d.doc_id = doc.id; }
      if (d.doc_id) {
        const doc = get('SELECT counterparty_id FROM registry_docs WHERE id = ?', d.doc_id);
        if (!doc) throw err(422, 'Sənəd tapılmadı', { fields: { doc_no: 'Sənəd tapılmadı' } });
        if (!d.counterparty_id) d.counterparty_id = doc.counterparty_id; // the payer is the document's counterparty
      }
      if (d.counterparty_id && !get('SELECT id FROM counterparties WHERE id = ?', d.counterparty_id)) throw err(422, 'Kontragent tapılmadı', { fields: { counterparty_id: 'Kontragent tapılmadı' } });
      if (d.vat_amount && d.amount && d.vat_amount > d.amount) throw err(422, 'ƏDV məbləğdən böyük ola bilməz', { fields: { vat_amount: 'ƏDV ümumi məbləğdən böyük ola bilməz' } });
      const allowDup = d.allow_duplicate; delete d.allow_duplicate;
      if (!existing) {
        d.created_by = ctx.user.id;
        const dup = allowDup ? [] : similar(d);
        if (dup.length) throw err(409, `Oxşar əməliyyat artıq qeydə alınıb: ${dup.map((x) => `${x.entry_date.split('-').reverse().join('.')} · ${x.amount} ${x.currency}${x.cp_name ? ' · ' + x.cp_name : ''}`).join('; ')}`, { code: 'duplicate' });
      } else if (existing.status === 'approved') {
        // a confirmed entry that is changed needs confirming again
        const changed = ['entry_date', 'kind', 'category', 'counterparty_id', 'doc_id', 'amount', 'vat_amount', 'currency', 'method'].some((k) => k in d && d[k] !== existing[k]);
        if (changed) Object.assign(d, { status: 'pending', approved_by: null, approved_at: null });
      }
    },
    present: presentLedger,
    beforeDelete(ctx, row) { this._media = detachAll('ledger', row.id); },
    afterDelete() { for (const m of this._media || []) files.removeMedia(m); this._media = null; },
    exportTitle: 'Gəlir və xərc jurnalı',
    exportColumns: [{ label: 'Tarix', get: (r) => r.entry_date }, { label: 'Növ', get: (r) => C.KIND_LABEL[r.kind] }, { label: 'Kateqoriya', get: (r) => r.category }, { label: 'Kontragent', get: (r) => r.cp_name },
      { label: 'Sənəd nömrəsi', get: (r) => r.doc_no }, { label: 'Məbləğ', get: (r) => C.azn(r.amount) }, { label: 'ƏDV', get: (r) => C.azn(r.vat_amount) }, { label: 'Valyuta', get: (r) => r.currency },
      { label: 'Ödəniş üsulu', get: (r) => C.METHOD_LABEL[r.method] }, { label: 'Təsvir', get: (r) => r.description }, { label: 'Vəziyyət', get: (r) => C.LEDGER_STATUS[r.status] }],
    extra(a) {
      a.get('/api/ledger/totals', can('finance.view'), (ctx) => {
        const from = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.from || '') ? ctx.query.from : '0000-01-01';
        const to = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.to || '') ? ctx.query.to : '9999-12-31';
        const out = {};
        for (const r of all('SELECT currency, kind, SUM(amount) AS s FROM ledger WHERE entry_date BETWEEN ? AND ? GROUP BY currency, kind', from, to)) { const c = out[r.currency] || (out[r.currency] = { income: 0, expense: 0 }); c[r.kind] = C.azn(r.s); }
        for (const c of Object.values(out)) { c.balance = Math.round((c.income - c.expense) * 100) / 100; c.turnover = Math.round((c.income + c.expense) * 100) / 100; }
        ctx.json({ totals: out });
      });
      // Possible duplicates before saving (the form warns while the user types).
      a.get('/api/ledger/similar', can('finance.view'), (ctx) => {
        let amount = 0; try { amount = v.money()(ctx.query.amount); } catch { amount = 0; }
        const date = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.date || '') ? ctx.query.date : null;
        if (!amount || !date || !['income', 'expense'].includes(ctx.query.kind)) return ctx.json({ items: [] });
        ctx.json({ items: similar({ kind: ctx.query.kind, amount, currency: C.CURRENCIES.includes(ctx.query.currency) ? ctx.query.currency : 'AZN', counterparty_id: parseInt(ctx.query.counterparty_id, 10) || null, entry_date: date }, parseInt(ctx.query.except, 10) || 0) });
      });
      a.get('/api/ledger/:id/details', can('finance.view'), (ctx) => {
        const row = get('SELECT * FROM ledger_view WHERE id = ?', ctx.intParam('id'));
        if (!row) throw err(404, 'Qeyd tapılmadı');
        // history of the entry: creation, every change (old -> new values), approvals, files
        const history = all("SELECT created_at, user_name, action, summary, previous_value, new_value FROM audit_logs WHERE module = 'Gəlir-xərc' AND record_id = ? ORDER BY id DESC LIMIT 100", String(row.id));
        ctx.json({ item: presentLedger(row), files: C.fileRows('ledger', row.id), history, can_approve: ctx.perms.has('finance.approve') });
      });
      a.get('/api/ledger/:id/pdf', can('finance.view'), (ctx) => {
        const row = get('SELECT * FROM ledger_view WHERE id = ?', ctx.intParam('id'));
        if (!row) throw err(404, 'Qeyd tapılmadı');
        reports.ledgerVoucher(ctx, presentLedger(row), C.fileRows('ledger', row.id));
      });
      a.post('/api/ledger/:id/approve', can('finance.approve'), async (ctx) => {
        const id = ctx.intParam('id');
        const b = await ctx.readJson(1024);
        const row = get('SELECT * FROM ledger WHERE id = ?', id);
        if (!row) throw err(404, 'Qeyd tapılmadı');
        const approve = b.approve !== false;
        tx(() => {
          run('UPDATE ledger SET status = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?', approve ? 'approved' : 'pending', approve ? ctx.user.id : null, approve ? now() : null, now(), id);
          audit(ctx, { action: approve ? 'Təsdiq' : 'Təsdiqin ləğvi', module: 'Gəlir-xərc', recordId: id, summary: `${ctx.user.name} ${approve ? 'təsdiqlədi' : 'təsdiqi ləğv etdi'}: ${C.KIND_LABEL[row.kind]} ${C.azn(row.amount)} ${row.currency} (${row.entry_date})` });
        });
        ctx.json({ item: presentLedger(get('SELECT * FROM ledger_view WHERE id = ?', id)) });
      });
    },
  });

  /* ---------------------------------------------------------------- yearly report */
  app.get('/api/finance/summary', can('finance.view'), (ctx) => ctx.json(financeSummary(ctx, ctx.query.year)));
  app.get('/api/finance/summary/pdf', can('finance.view'), (ctx) => reports.financeReport(ctx, financeSummary(ctx, ctx.query.year)));
}

module.exports = { routes, financeSummary, presentLedger };
