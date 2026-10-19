'use strict';
// Office modules: document register (numbering, Excel import, scans, responses, payments),
// counterparties, income/expense journal, employees and payroll, permissions.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, Client, PDF, PNG, fileForm } = require('./helpers');

const ADMIN = ['office@aeec.az', 'Sinaq-Parol-2026!'];
const NEWPW = 'Reyestr-Yoxlama-2026!';
let T, admin, xlsx;

test.before(async () => {
  T = await boot();
  xlsx = T.req('src/xlsx').xlsx;
  admin = new Client(T.base, '10.7.0.1');
  await admin.login(...ADMIN);
  assert.equal((await admin.post('/api/auth/password', { current: ADMIN[1], password: NEWPW })).status, 200);
  await admin.login(ADMIN[0], NEWPW);
});
test.after(() => { T.stop(); setTimeout(() => process.exit(0), 200).unref(); });

// An Excel file shaped like the company's register (same headers, dates as Excel serials, '-' / 'Yoxdur' placeholders).
const HEAD = ['№', 'Tarix', 'Sənəd növü', 'İndeks', 'Sənəd nömrəsi', 'Skan', 'Alan tərəf', 'E-poçt ünvanı', 'Əlaqə nömrəsi', 'Mövzu / Qısa məzmun', 'İcraçı', 'Göndərilmə üsulu',
  'Göndərilmə tarixi', 'Status', 'Cavab tələb olunur?', 'Cavab tarixi', 'Cavab nömrəsi', 'Cavabın qısa məzmunu', 'Nəticə', 'Cavab vəziyyəti', 'Qeyd'];
const serial = (d) => Date.parse(d + 'T00:00:00Z') / 86400000 + 25569;
const ROWS = [
  [1, serial('2026-09-24'), 'Məktub', 'M', 'M-001/09-26', 'Skana bax', 'Sınaq Nazirliyi', 'Yoxdur', '-', 'Yol vərəqəsi', 'Hacılı T.', 'Şirkət tərəfindən', serial('2026-09-24'), 'Göndərildi', 'Xeyr', '', '-', '', 'İcra edildi', 'Tələb olunmur', ''],
  [2, serial('2026-09-24'), 'Məktub', 'M', 'M-002/09-26', 'Skana bax', 'ONLINE TEST', 'support@online.test', '-', 'Domen', 'Hacılı T.', 'Elektron poçt ilə', serial('2026-09-24'), 'Göndərildi', 'Bəli', serial('2026-09-25'), '-', 'Təmin olundu', 'İcra edildi', '', ''],
  [3, serial('2026-09-23'), 'Hesab', 'H', 'H-001/09-26', 'Skana bax', 'Sınaq Marine MMC', 'a.test@marine.test', '+994 51 000 00 00', 'Təhvil-təslim aktı', 'Hacılı T.', 'Elektron poçt ilə', serial('2026-09-23'), 'Göndərildi', 'Xeyr', '-', '-', 'Cavab tələb olunmur', 'Qismən təmin edildi', '', 'Ödəniş gözlənilir'],
  [4, serial('2026-10-01'), 'Hesab', 'H', 'H-002/10-26', 'Skana bax', 'sınaq marine mmc', 'Yoxdur', '', 'Akt 2', 'Hacılı T.', 'Şirkət tərəfindən', serial('2026-10-01'), 'Hazırlanır', 'Xeyr', '', '', '', '', '', ''],
  [5, serial('2026-09-16'), 'Əmr', 'A', 'A-001/09-26', 'Skana bax', 'Sınaqov Əli', 'Yoxdur', '', 'İşə qəbulu haqqında', 'Hacılı T.', '', '', 'İmzalandı', 'Xeyr', '-', '-', '', 'İcra edildi', '', ''],
  [6, serial('2026-10-05'), 'Bildiriş', 'BL', 'BL-001/10-26', '', 'Sınaq Nazirliyi', 'pis-unvan', '', 'Yeni növ', 'Hacılı T.', '', '', 'Göndərildi', 'Bəli', '', '', '', '', '', ''],
  [7, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
];
const importForm = (mode, rows = ROWS) => fileForm({ mode }, [['file', 'Sened_Reyestri.xlsx', xlsx(HEAD, rows, 'Reyestr'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]);

test('Excel import: preview changes nothing, commit keeps the numbers and links parties', async () => {
  const p = await admin.req('POST', '/api/registry/import', { form: importForm('preview') });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.add, 6); assert.equal(p.data.total, 6);
  assert.deepEqual(p.data.new_types, [{ name: 'Bildiriş', index: 'BL' }]);
  assert.deepEqual(p.data.new_counterparties.sort(), ['ONLINE TEST', 'Sınaq Marine MMC', 'Sınaq Nazirliyi'].sort(), 'same name in other case = one counterparty');
  assert.deepEqual(p.data.new_employees, ['Sınaqov Əli']);
  assert.ok(p.data.warnings.some((w) => w.includes('pis-unvan')));
  assert.equal((await admin.get('/api/registry')).data.total, 0, 'preview writes nothing');

  const c = await admin.req('POST', '/api/registry/import', { form: importForm('commit') });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const list = (await admin.get('/api/registry?per_page=50')).data.items;
  assert.equal(list.length, 6);
  const m2 = list.find((d) => d.doc_no === 'M-002/09-26');
  assert.equal(m2.doc_date, '2026-09-24'); assert.equal(m2.email, 'support@online.test'); assert.equal(m2.response_required, true);
  assert.equal(m2.response_label, 'Cavab alındı (1 gün ərzində)');
  const m1 = list.find((d) => d.doc_no === 'M-001/09-26');
  assert.equal(m1.email, '', '"Yoxdur" is not stored'); assert.equal(m1.response_label, 'Tələb olunmur');
  const h1 = list.find((d) => d.doc_no === 'H-001/09-26'), h2 = list.find((d) => d.doc_no === 'H-002/10-26');
  assert.ok(h1.counterparty_id && h1.counterparty_id === h2.counterparty_id);
  assert.equal(h1.response_summary, '', 'placeholder text dropped');
  const a1 = list.find((d) => d.doc_no === 'A-001/09-26');
  assert.ok(a1.employee_id); assert.equal(a1.counterparty_id, null); assert.equal(a1.party, 'Sınaqov Əli');
  assert.match(list.find((d) => d.doc_no === 'BL-001/10-26').note, /pis-unvan/);
  // importing the same file again adds nothing
  const again = await admin.req('POST', '/api/registry/import', { form: importForm('commit') });
  assert.equal(again.data.add, 0); assert.equal(again.data.skip, 6);
  // wrong files
  assert.equal((await admin.req('POST', '/api/registry/import', { form: fileForm({ mode: 'preview' }, [['file', 'x.xlsx', Buffer.from('salam'), 'application/octet-stream']]) })).status, 422);
  assert.equal((await admin.req('POST', '/api/registry/import', { form: fileForm({ mode: 'preview' }, [['file', 'x.pdf', PDF, 'application/pdf']]) })).status, 422);
  assert.equal((await admin.req('POST', '/api/registry/import', { form: fileForm({ mode: 'preview' }, [['file', 'x.xlsx', xlsx(['A', 'B'], [[1, 2]]), 'application/octet-stream']]) })).status, 422);
});

test('numbering continues per type and year; manual numbers are unique', async () => {
  const nx = (await admin.get('/api/registry/next-number?type=' + encodeURIComponent('Hesab') + '&date=2026-10-20')).data.number;
  assert.equal(nx, 'H-003/10-26');
  const r = await admin.post('/api/registry', { doc_date: '2026-10-20', doc_type: 'Hesab', subject: 'Yeni hesab', amount: '1 180,00', vat_amount: '180', due_date: '2026-10-30', counterparty_id: (await admin.get('/api/registry?q=H-001')).data.items[0].counterparty_id });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.item.doc_no, 'H-003/10-26');
  assert.equal(r.data.item.amount, 1180); assert.equal(r.data.item.pay_state, 'unpaid'); assert.equal(r.data.item.debt, 1180);
  // next year starts from 001; contracts get AE
  assert.equal((await admin.post('/api/registry', { doc_date: '2027-01-05', doc_type: 'Hesab' })).data.item.doc_no, 'H-001/01-27');
  assert.equal((await admin.post('/api/registry', { doc_date: '2026-10-20', doc_type: 'Müqavilə' })).data.item.doc_no, 'AE-001/10-26');
  // a taken number is refused; an unknown type is refused
  assert.equal((await admin.post('/api/registry', { doc_date: '2026-10-20', doc_type: 'Hesab', doc_no: 'H-001/09-26' })).status, 422);
  assert.equal((await admin.post('/api/registry', { doc_date: '2026-10-20', doc_type: 'Uydurma' })).status, 422);
  assert.equal((await admin.post('/api/registry', { doc_date: '2026-10-20', doc_type: 'Hesab', amount: '12,345' })).status, 422);
  assert.equal((await admin.post('/api/registry', { doc_date: '2026-10-20', doc_type: 'Hesab', amount: '100', vat_amount: '200' })).status, 422);
  // the number does not change when the document is edited
  const id = r.data.item.id;
  const e = await admin.patch(`/api/registry/${id}`, { doc_date: '2026-11-02', status: 'Göndərildi', sent_date: '2026-11-02', response_required: true });
  assert.equal(e.status, 200, JSON.stringify(e.data));
  assert.equal(e.data.item.doc_no, 'H-003/10-26');
  assert.match(e.data.item.response_label, /^Gözlənilir \(\d+ gündür\)$/);
  const s = (await admin.get('/api/registry/summary?year=2026')).data;
  const hesab = s.table.find((t) => t.type === 'Hesab');
  assert.equal(hesab.total, 3); assert.equal(hesab.months[8], 1); assert.equal(hesab.months[9], 1); assert.equal(hesab.months[10], 1);
  assert.ok(s.waiting.some((d) => d.id === id));
  assert.ok(s.unpaid.some((d) => d.id === id));
  // cancelled documents leave response tracking
  await admin.patch(`/api/registry/${id}`, { status: 'Ləğv edildi' });
  assert.ok(!(await admin.get('/api/registry/summary?year=2026')).data.waiting.some((d) => d.id === id));
  await admin.patch(`/api/registry/${id}`, { status: 'Göndərildi' });
});

test('scans: attached to a document, bulk upload by file name, private download', async () => {
  const doc = (await admin.get('/api/registry?q=M-001')).data.items[0];
  const up = await admin.req('POST', `/api/office/files/doc/${doc.id}`, { form: fileForm({}, [['file', 'skan.pdf', PDF, 'application/pdf']]) });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  // bulk: AE-001_09-26.pdf style names
  const ok = await admin.req('POST', '/api/registry/scans', { form: fileForm({}, [['file', 'H-001_09-26.pdf', PDF, 'application/pdf']]) });
  assert.equal(ok.status, 201, JSON.stringify(ok.data)); assert.equal(ok.data.doc_no, 'H-001/09-26');
  assert.equal((await admin.req('POST', '/api/registry/scans', { form: fileForm({}, [['file', 'm-002_09-26 (1).png', PNG, 'image/png']]) })).data.doc_no, 'M-002/09-26');
  const miss = await admin.req('POST', '/api/registry/scans', { form: fileForm({}, [['file', 'X-999_01-26.pdf', PDF, 'application/pdf']]) });
  assert.equal(miss.status, 422); assert.equal(miss.data.error.code, 'no_match');
  // renamed non-PDF is refused
  assert.equal((await admin.req('POST', `/api/office/files/doc/${doc.id}`, { form: fileForm({}, [['file', 'fake.pdf', Buffer.from('<script>'), 'application/pdf']]) })).status, 422);
  const det = (await admin.get(`/api/registry/${doc.id}/details`)).data;
  assert.equal(det.files.length, 1); assert.equal(det.item.files_count, 1);
  const dl = await admin.get(det.files[0].url + '?inline=1');
  assert.equal(dl.status, 200); assert.match(dl.headers.get('content-security-policy'), /sandbox/); assert.equal(dl.headers.get('cache-control'), 'private, no-store');
  assert.equal((await new Client(T.base, '10.7.0.9').get(det.files[0].url)).status, 401, 'not without login');
  // deleting the document removes its scans
  const tmp = (await admin.post('/api/registry', { doc_date: '2026-10-21', doc_type: 'Məktub' })).data.item;
  const f = await admin.req('POST', `/api/office/files/doc/${tmp.id}`, { form: fileForm({}, [['file', 'a.pdf', PDF, 'application/pdf']]) });
  assert.equal((await admin.del(`/api/registry/${tmp.id}`)).status, 200);
  assert.equal((await admin.get(f.data.item.url)).status, 404);
});

test('payments: journal entries linked to an invoice update its payment state', async () => {
  const inv = (await admin.get('/api/registry?q=H-003')).data.items[0];
  const p1 = await admin.post('/api/ledger', { entry_date: '2026-11-05', kind: 'income', category: 'Xidmət haqqı (sınaq, ölçmə)', amount: '500', doc_no: 'H-003/10-26', method: 'bank' });
  assert.equal(p1.status, 201, JSON.stringify(p1.data));
  assert.equal(p1.data.item.counterparty_id, inv.counterparty_id, 'counterparty taken from the document');
  let d = (await admin.get(`/api/registry/${inv.id}/details`)).data;
  assert.equal(d.item.pay_state, 'partial'); assert.equal(d.item.paid, 500); assert.equal(d.item.debt, 680); assert.equal(d.payments.length, 1);
  await admin.post('/api/ledger', { entry_date: '2026-11-20', kind: 'income', amount: 680, doc_id: inv.id });
  d = (await admin.get(`/api/registry/${inv.id}/details`)).data;
  assert.equal(d.item.pay_state, 'paid'); assert.equal(d.item.debt, 0);
  await admin.post('/api/ledger', { entry_date: '2026-11-10', kind: 'expense', category: 'İcarə', amount: '300.50', method: 'cash' });
  assert.equal((await admin.post('/api/ledger', { entry_date: '2026-11-10', kind: 'expense', amount: 0 })).status, 422);
  assert.equal((await admin.post('/api/ledger', { entry_date: '2026-11-10', kind: 'expense', amount: 10, doc_no: 'YOX-1' })).status, 422);
  const t = (await admin.get('/api/ledger/totals?from=2026-11-01&to=2026-11-30')).data.totals.AZN;
  assert.deepEqual(t, { income: 1180, expense: 300.5, balance: 879.5 });
  const s = (await admin.get('/api/finance/summary?year=2026')).data;
  assert.equal(s.months[10].income, 1180); assert.equal(s.months[10].expense, 300.5);
  assert.ok(!s.receivables.some((r) => r.debt === 680), 'paid invoice is no longer a receivable');
  // counterparty card: documents, payments, balance
  const cp = (await admin.get(`/api/counterparties/${inv.counterparty_id}/details`)).data;
  assert.equal(cp.totals.invoiced, 1180); assert.equal(cp.totals.paid, 1180); assert.equal(cp.totals.debt, 0);
  assert.ok(cp.docs.length >= 3); assert.equal(cp.ledger.length, 2);
  // a counterparty in use cannot be deleted
  assert.equal((await admin.del(`/api/counterparties/${inv.counterparty_id}`)).status, 409);
  // VÖEN must be digits
  assert.equal((await admin.post('/api/counterparties', { name: 'X', tax_id: '12AB' })).status, 422);
  assert.equal((await admin.post('/api/counterparties', { name: 'Yeni təchizatçı', kind: 'supplier', tax_id: '1234567891', bank_account: 'AZ00TEST00000000000000000000' })).status, 201);
});

test('employees and payroll: net is computed, months generated, orders linked', async () => {
  const emp = (await admin.get('/api/employees?q=Sınaqov')).data.items[0];
  assert.ok(emp);
  assert.equal((await admin.put(`/api/employees/${emp.id}`, { ...emp, position: 'Mühəndis', base_salary: '1500', hire_date: '2026-09-16' })).status, 200);
  const e2 = (await admin.post('/api/employees', { full_name: 'İkinci Sınaq', base_salary: 900 })).data.item;
  const g = await admin.post('/api/payroll/generate', { period: '2026-10' });
  assert.equal(g.data.created, 2);
  assert.equal((await admin.post('/api/payroll/generate', { period: '2026-10' })).data.created, 0, 'no duplicates');
  const rows = (await admin.get('/api/payroll?period=2026-10')).data.items;
  const row = rows.find((r) => r.employee_id === emp.id);
  assert.equal(row.gross, 1500); assert.equal(row.net, 1500);
  const u = await admin.put(`/api/payroll/${row.id}`, { employee_id: emp.id, period: '2026-10', gross: 1500, income_tax: 0, dsmf_employee: 56, unemployment_employee: 7.5, health_employee: 30, other_deductions: 0,
    dsmf_employer: 247, unemployment_employer: 7.5, health_employer: 30, status: 'paid' });
  assert.equal(u.status, 200, JSON.stringify(u.data));
  assert.equal(u.data.item.net, 1406.5); assert.equal(u.data.item.employer_cost, 1784.5); assert.ok(u.data.item.paid_date);
  assert.equal((await admin.put(`/api/payroll/${row.id}`, { employee_id: emp.id, period: '2026-10', gross: 100, dsmf_employee: 200 })).status, 422, 'deductions above gross');
  assert.equal((await admin.post('/api/payroll', { employee_id: e2.id, period: '2026-10' })).status, 422, 'one row per month');
  assert.equal((await admin.post('/api/payroll', { employee_id: e2.id, period: '2026-13' })).status, 422);
  const tot = (await admin.get('/api/payroll/totals?period=2026-10')).data;
  assert.equal(tot.totals.gross, 2400); assert.equal(tot.count, 2);
  const det = (await admin.get(`/api/employees/${emp.id}/details`)).data;
  assert.equal(det.orders.length, 1); assert.equal(det.orders[0].doc_no, 'A-001/09-26'); assert.equal(det.payroll.length, 1);
  assert.equal((await admin.del(`/api/employees/${emp.id}`)).status, 409, 'employee with orders/payroll is kept');
  assert.equal((await admin.get('/api/finance/summary?year=2026')).data.months[9].payroll, 1784.5 + 900);
});

test('lists are editable; office data is only for granted roles; export round-trips', async () => {
  const meta = (await admin.get('/api/office/meta')).data;
  assert.ok(meta.lists.doc_types.some((t) => t.name === 'Bildiriş'), 'type added by the import');
  assert.equal((await admin.put('/api/settings/office', { ...meta.lists, doc_types: [...meta.lists.doc_types, { name: 'Arayış', index: 'ar' }] })).status, 422, 'index must be capital latin');
  assert.equal((await admin.put('/api/settings/office', { ...meta.lists, doc_types: [...meta.lists.doc_types, { name: 'Arayış', index: 'AR' }] })).status, 200);
  assert.equal((await admin.post('/api/registry', { doc_date: '2026-10-22', doc_type: 'Arayış' })).data.item.doc_no, 'AR-001/10-26');
  assert.ok(!('office' in (await admin.get('/api/settings')).data.settings));
  // an Administrator (not Super Admin) does not see office modules unless granted
  const pw = 'Admin-Rolu-Sinaq-55!';
  const roles = (await admin.get('/api/roles')).data.roles;
  const adminRole = roles.find((r) => r.key === 'administrator');
  assert.equal((await admin.post('/api/users', { name: 'Admin Sınaq', email: 'admin.sinaq@aeec.az', role_id: adminRole.id, is_active: true, password: pw })).status, 201);
  const ad = new Client(T.base, '10.7.0.5');
  await ad.login('admin.sinaq@aeec.az', pw);
  await ad.post('/api/auth/password', { current: pw, password: pw + 'x' });
  await ad.login('admin.sinaq@aeec.az', pw + 'x');
  for (const u of ['/api/registry', '/api/ledger', '/api/counterparties', '/api/employees', '/api/payroll', '/api/office/meta', '/api/finance/summary']) assert.equal((await ad.get(u)).status, 403, u);
  // export -> import gives the same documents (nothing new, all recognised)
  const ex = await admin.get('/api/registry/export?format=xlsx');
  assert.equal(ex.status, 200);
  const back = await admin.req('POST', '/api/registry/import', { form: fileForm({ mode: 'preview' }, [['file', 'eksport.xlsx', ex.data, 'application/octet-stream']]) });
  assert.equal(back.status, 200, JSON.stringify(back.data));
  assert.equal(back.data.add, 0); assert.ok(back.data.skip >= 9);
  // audit trail
  const audit = (await admin.get('/api/audit?q=' + encodeURIComponent('İdxal'))).data.items;
  assert.ok(audit.some((x) => x.module === 'Sənəd reyestri'));
});
