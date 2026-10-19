'use strict';
// Staff: employees' electronic personal files and payroll.
//
// Personal data (date of birth, address, identity card, photo, personal documents) is returned
// and accepted only for users with the "hr.personal" permission; other HR users see the work
// data (name, position, department, dates, status). The check is made here, on the server.
const config = require('../config');
const { get, all, run, tx, now, dayOf } = require('../db');
const { err, sendFile, FILE_CSP } = require('../http');
const { v, validate } = require('../validate');
const { can } = require('../auth');
const { audit } = require('../audit');
const { defineResource, fold } = require('../crud');
const files = require('../files');
const { detachAll } = require('./attachments');
const C = require('./common');

const PERSONAL = ['birth_date', 'address', 'id_series', 'id_number', 'photo_media_id', 'notes'];
const STATUS = { active: 'İşləyir', left: 'İşdən çıxıb' };

function presentEmployee(ctx, r) {
  const e = { ...r, base_salary: C.azn(r.base_salary), status_label: STATUS[r.status], has_photo: Boolean(r.photo_media_id) };
  if (!ctx.perms.has('hr.personal')) for (const k of PERSONAL) delete e[k];
  else e.photo_url = r.photo_media_id ? `/api/employees/${r.id}/photo?v=${r.photo_media_id}` : null;
  return e;
}
// Same person = same surname, name and father's name (case and diacritics ignored).
const sameName = (a, b) => fold(a).replace(/\s+/g, ' ').trim() === fold(b).replace(/\s+/g, ' ').trim();
function findSame(d, exceptId = 0) {
  const name = C.fullName(d) || d.full_name;
  return all('SELECT id, full_name, father_name, position FROM employees WHERE id <> ?', exceptId)
    .find((e) => sameName(e.full_name, name) && (!d.father_name || !e.father_name || sameName(e.father_name, d.father_name)));
}

function routes(app, reports) {
  /* ---------------------------------------------------------------- employees */
  defineResource(app, {
    name: 'kadrlar', path: '/api/employees', table: 'employees', module: 'Kadrlar',
    perms: { view: 'hr.view', create: 'hr.edit', edit: 'hr.edit', delete: 'hr.delete' },
    shape: {
      last_name: v.str({ max: 80 }), first_name: v.str({ max: 80 }), father_name: v.str({ max: 80 }), full_name: v.str({ max: 150 }),
      position: v.str({ max: 150 }), department: v.str({ max: 150 }), phone: v.str({ max: 60 }), email: v.email(),
      hire_date: v.date(), leave_date: v.date(), status: v.oneOf(Object.keys(STATUS), { default: 'active' }), base_salary: v.money(),
      birth_date: v.date(), address: v.str({ max: 300 }),
      id_series: v.str({ max: 10, pattern: /^[A-Za-z]{0,5}$/, message: 'Seriya yalnız latın hərfləri (məs. AZE, AA)' }), id_number: v.str({ max: 12, pattern: /^\d*$/, message: 'Nömrə yalnız rəqəmlər' }),
      notes: v.text({ max: 4000 }),
    },
    search: ['full_name', 'father_name', 'position', 'department', 'email', 'phone'], filters: { status: { col: 'status', values: Object.keys(STATUS) }, department: { col: 'department' } },
    sortable: { name: 'fold(full_name)', position: 'fold(position)', hire: 'hire_date', salary: 'base_salary' }, defaultSort: "status = 'left', fold(full_name)",
    label: (r) => `Əməkdaş «${r.full_name}»`,
    prepare(ctx, d, existing) {
      // personal fields are ignored for users without the personal-data permission
      if (!ctx.perms.has('hr.personal')) for (const k of PERSONAL) delete d[k];
      const m = { ...(existing || {}), ...d };
      if ((d.last_name !== undefined || d.first_name !== undefined) && (m.last_name || m.first_name)) d.full_name = C.fullName(m);
      else if (d.full_name) {
        const n = C.splitName(d.full_name);
        if (n.father_name && d.father_name) delete n.father_name; // an explicitly given father's name wins
        Object.assign(d, n);
        if (n.father_name) d.full_name = C.fullName(n);
      }
      if (!d.full_name && !(existing && existing.full_name)) throw err(422, 'Soyad və ad yazılmalıdır', { fields: { last_name: 'Soyadı yazın', first_name: 'Adı yazın' } });
      if (d.id_series) d.id_series = d.id_series.toUpperCase();
      // the same person is not created twice
      const same = findSame({ ...m, ...d }, existing ? existing.id : 0);
      if (same) throw err(409, `Bu əməkdaş artıq bazada var: ${same.full_name}${same.position ? ' — ' + same.position : ''}`, { code: 'exists' });
    },
    present: (r, ctx) => presentEmployee(ctx, r),
    beforeDelete(ctx, row) {
      const n = get('SELECT (SELECT COUNT(*) FROM registry_docs WHERE employee_id = ?) + (SELECT COUNT(*) FROM payroll WHERE employee_id = ?) AS n', row.id, row.id).n;
      if (n) throw err(409, `Bu əməkdaşa ${n} sənəd/əmək haqqı qeydi bağlıdır — silmək əvəzinə statusu «İşdən çıxıb» edin`);
      this._media = detachAll('employee', row.id);
      if (row.photo_media_id) this._media.push(get('SELECT * FROM media WHERE id = ?', row.photo_media_id));
    },
    afterDelete() { for (const m of this._media || []) files.removeMedia(m); this._media = null; },
    exportTitle: 'Kadrlar',
    exportColumns: [{ label: 'Soyad, ad', get: (r) => r.full_name }, { label: 'Ata adı', get: (r) => r.father_name }, { label: 'Vəzifə', get: (r) => r.position }, { label: 'Şöbə', get: (r) => r.department },
      { label: 'Telefon', get: (r) => r.phone }, { label: 'E-poçt', get: (r) => r.email }, { label: 'İşə qəbul', get: (r) => r.hire_date || '' }, { label: 'İşdən çıxma', get: (r) => r.leave_date || '' },
      { label: 'Status', get: (r) => STATUS[r.status] }],
    extra(a) {
      // Who is already in the database (used before adding a new employee from the register form).
      a.get('/api/employees/lookup', can('hr.view', 'registry.view'), (ctx) => {
        const q = String(ctx.query.q || '').trim();
        if (q.length < 2) return ctx.json({ items: [] });
        const f = fold(q);
        ctx.json({ items: all("SELECT id, full_name, position, status FROM employees ORDER BY status = 'left', fold(full_name)").filter((e) => fold(e.full_name).includes(f)).slice(0, 10) });
      });
      a.get('/api/employees/:id/details', can('hr.view'), (ctx) => {
        const e = get('SELECT * FROM employees WHERE id = ?', ctx.intParam('id'));
        if (!e) throw err(404, 'Qeyd tapılmadı');
        const personal = ctx.perms.has('hr.personal');
        ctx.json({ item: presentEmployee(ctx, e), personal, files: personal ? C.fileRows('employee', e.id) : null, categories: C.EMPLOYEE_FILE_CATS,
          orders: ctx.perms.has('registry.view') ? all('SELECT * FROM registry_view WHERE employee_id = ? ORDER BY doc_date DESC', e.id).map(C.presentDoc) : null,
          payroll: all('SELECT * FROM payroll WHERE employee_id = ? ORDER BY period DESC LIMIT 36', e.id).map(presentPay) });
      });
      a.get('/api/employees/:id/pdf', can('hr.view'), (ctx) => {
        const e = get('SELECT * FROM employees WHERE id = ?', ctx.intParam('id'));
        if (!e) throw err(404, 'Qeyd tapılmadı');
        const personal = ctx.perms.has('hr.personal');
        let photo = null;
        if (personal && e.photo_media_id) { const m = get('SELECT * FROM media WHERE id = ?', e.photo_media_id); if (m && m.ext === 'jpg') { try { photo = require('node:fs').readFileSync(require('node:path').join(config.privateDir, m.stored_name)); } catch { photo = null; } } }
        reports.personalFile(ctx, { item: presentEmployee(ctx, e), personal, photo, files: personal ? C.fileRows('employee', e.id) : [], categories: C.EMPLOYEE_FILE_CATS,
          orders: ctx.perms.has('registry.view') ? all('SELECT * FROM registry_view WHERE employee_id = ? ORDER BY doc_date', e.id).map(C.presentDoc) : [] });
      });
      // 3×4 photo: the panel crops it in the browser and sends a JPEG; stored as private media.
      a.post('/api/employees/:id/photo', can('hr.edit'), async (ctx) => {
        if (!ctx.perms.has('hr.personal')) throw err(403, 'Şəxsi məlumatlar üçün icazəniz yoxdur');
        const e = get('SELECT * FROM employees WHERE id = ?', ctx.intParam('id'));
        if (!e) throw err(404, 'Qeyd tapılmadı');
        const form = await ctx.readForm(6 * files.MB);
        const m = await files.storeUpload(form.get('file'), { allowed: ['jpg', 'png'], isPrivate: true, userId: ctx.user.id, folder: 'Kadrlar', maxMb: 5 });
        const old = e.photo_media_id ? get('SELECT * FROM media WHERE id = ?', e.photo_media_id) : null;
        tx(() => {
          run('UPDATE employees SET photo_media_id = ?, updated_at = ? WHERE id = ?', m.id, now(), e.id);
          audit(ctx, { action: 'Fotoşəkil', module: 'Kadrlar', recordId: e.id, summary: `${ctx.user.name}: ${e.full_name} — fotoşəkil ${old ? 'yeniləndi' : 'əlavə edildi'}` });
        });
        if (old) files.removeMedia(old);
        ctx.json({ photo_url: `/api/employees/${e.id}/photo?v=${m.id}` });
      });
      a.get('/api/employees/:id/photo', can('hr.view'), (ctx) => {
        if (!ctx.perms.has('hr.personal')) throw err(403, 'Şəxsi məlumatlar üçün icazəniz yoxdur');
        const e = get('SELECT photo_media_id FROM employees WHERE id = ?', ctx.intParam('id'));
        const m = e && e.photo_media_id ? get('SELECT * FROM media WHERE id = ?', e.photo_media_id) : null;
        if (!m) throw err(404, 'Fotoşəkil yoxdur');
        sendFile(ctx, config.privateDir, m.stored_name, { type: m.mime, csp: FILE_CSP, inline: true, download: 'foto.' + m.ext, cache: 'private, max-age=600' });
      });
      a.delete('/api/employees/:id/photo', can('hr.edit'), (ctx) => {
        if (!ctx.perms.has('hr.personal')) throw err(403, 'Şəxsi məlumatlar üçün icazəniz yoxdur');
        const e = get('SELECT * FROM employees WHERE id = ?', ctx.intParam('id'));
        if (!e || !e.photo_media_id) throw err(404, 'Fotoşəkil yoxdur');
        const m = get('SELECT * FROM media WHERE id = ?', e.photo_media_id);
        tx(() => { run('UPDATE employees SET photo_media_id = NULL, updated_at = ? WHERE id = ?', now(), e.id); audit(ctx, { action: 'Fotoşəkil', module: 'Kadrlar', recordId: e.id, summary: `${ctx.user.name}: ${e.full_name} — fotoşəkil silindi` }); });
        files.removeMedia(m);
        ctx.json({ ok: true });
      });
    },
  });
  /* ---------------------------------------------------------------- payroll */
  // Amounts are entered as calculated by the accountant (tax and social insurance rates change);
  // the panel adds them up: net = gross - all employee deductions.
  const PAY_FIELDS = ['gross', 'income_tax', 'dsmf_employee', 'unemployment_employee', 'health_employee', 'other_deductions', 'dsmf_employer', 'unemployment_employer', 'health_employer'];
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
    exportTitle: 'Əmək haqqı cədvəli',
    pdfColumns: ['Ay', 'Əməkdaş', 'Hesablanıb (gross)', 'Gəlir vergisi', 'DSMF (işçi)', 'İşsizlik sığortası (işçi)', 'İcbari tibbi sığorta (işçi)', 'Digər tutulmalar', 'Ödəniləcək (net)', 'Status'],
    exportColumns: [{ label: 'Ay', get: (r) => r.period }, { label: 'Əməkdaş', get: (r) => r.full_name }, { label: 'Vəzifə', get: (r) => r.position }, { label: 'Hesablanıb (gross)', get: (r) => C.azn(r.gross) },
      { label: 'Gəlir vergisi', get: (r) => C.azn(r.income_tax) }, { label: 'DSMF (işçi)', get: (r) => C.azn(r.dsmf_employee) }, { label: 'İşsizlik sığortası (işçi)', get: (r) => C.azn(r.unemployment_employee) },
      { label: 'İcbari tibbi sığorta (işçi)', get: (r) => C.azn(r.health_employee) }, { label: 'Digər tutulmalar', get: (r) => C.azn(r.other_deductions) }, { label: 'Ödəniləcək (net)', get: (r) => C.azn(r.net) },
      { label: 'DSMF (işəgötürən)', get: (r) => C.azn(r.dsmf_employer) }, { label: 'İşsizlik sığortası (işəgötürən)', get: (r) => C.azn(r.unemployment_employer) },
      { label: 'İcbari tibbi sığorta (işəgötürən)', get: (r) => C.azn(r.health_employer) }, { label: 'Status', get: (r) => (r.status === 'paid' ? 'Ödənilib' : 'Qaralama') }, { label: 'Ödəniş tarixi', get: (r) => r.paid_date || '' }],
    extra(a) {
      a.post('/api/payroll/generate', can('hr.edit'), async (ctx) => {
        const { period } = validate({ period: v.month({ required: true }) }, await ctx.readJson(1024));
        const ts = now();
        const made = tx(() => all("SELECT id, base_salary FROM employees WHERE status = 'active' AND id NOT IN (SELECT employee_id FROM payroll WHERE period = ?)", period)
          .map((e) => run('INSERT INTO payroll (employee_id, period, gross, net, created_at, updated_at) VALUES (?,?,?,?,?,?)', e.id, period, e.base_salary, e.base_salary, ts, ts).lastInsertRowid));
        if (made.length) audit(ctx, { action: 'Yaratma', module: 'Əmək haqqı', summary: `${ctx.user.name} ${period} ayı üçün ${made.length} qaralama yaratdı` });
        ctx.json({ created: made.length });
      });
      a.get('/api/payroll/totals', can('hr.view'), (ctx) => ctx.json(payrollTotals(ctx.query.period)));
      // Monthly payroll sheet with signatures (A4 landscape).
      a.get('/api/payroll/sheet/pdf', can('hr.view'), (ctx) => {
        const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(ctx.query.period || '') ? ctx.query.period : dayOf().slice(0, 7);
        reports.payrollSheet(ctx, { period, rows: all('SELECT * FROM payroll_view WHERE period = ? ORDER BY fold(full_name)', period).map(presentPay), totals: payrollTotals(period).totals });
      });
    },
  });
  function payrollTotals(periodParam) {
    const period = /^\d{4}-\d{2}$/.test(periodParam || '') ? periodParam : null;
    const t = get(`SELECT COUNT(*) AS n, ${[...PAY_FIELDS, 'net'].map((k) => `COALESCE(SUM(${k}), 0) AS ${k}`).join(', ')} FROM payroll ${period ? 'WHERE period = ?' : ''}`, ...(period ? [period] : []));
    return { totals: presentPay(t), count: t.n, periods: all('SELECT DISTINCT period FROM payroll ORDER BY period DESC').map((r) => r.period) };
  }
  function presentPay(r) { const o = { ...r }; for (const k of [...PAY_FIELDS, 'net']) o[k] = C.azn(r[k]); o.employer_cost = C.azn(r.gross + r.dsmf_employer + r.unemployment_employer + r.health_employer); return o; }
}

module.exports = { routes, STATUS };
