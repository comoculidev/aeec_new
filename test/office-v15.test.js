'use strict';
// Version 1.5: document numbers vs file names, employees as recipients, scans (new documents,
// replace), PDF exports of every list and printable document, journal approval / duplicates /
// history / balances, personal files (3×4 photo, personal-data permission), WhatsApp button.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { boot, Client, PDF, PNG, JPEG, fileForm } = require('./helpers');

const ADMIN = ['office@aeec.az', 'Sinaq-Parol-2026!'];
const NEWPW = 'Versiya-Bes-Yoxlama-15!';
let T, admin;
const pdfText = (buf) => {
  // Text of a PDF through poppler (when installed) - proves the letters are real, searchable text.
  try { const f = path.join(os.tmpdir(), `aeec-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`); fs.writeFileSync(f, buf); const t = execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }); fs.rmSync(f); return t; } catch { return null; }
};
const pages = (buf) => (buf.toString('latin1').match(/\/Type \/Page /g) || []).length;
const isA4 = (buf) => /\/MediaBox \[0 0 (595\.28 841\.89|841\.89 595\.28)\]/.test(buf.toString('latin1'));

test.before(async () => {
  T = await boot();
  admin = new Client(T.base, '10.6.0.1');
  await admin.login(...ADMIN);
  assert.equal((await admin.post('/api/auth/password', { current: ADMIN[1], password: NEWPW })).status, 200);
  await admin.login(ADMIN[0], NEWPW);
});
test.after(() => { T.stop(); setTimeout(() => process.exit(0), 200).unref(); });

test('1. official number P-004/10-26 and file name P-004-10-26.pdf', async () => {
  for (let i = 1; i <= 4; i++) assert.equal((await admin.post('/api/registry', { doc_date: '2026-10-05', doc_type: 'Protokol', subject: `Protokol ${i}` })).status, 201);
  const p4 = (await admin.get('/api/registry?q=P-004')).data.items[0];
  assert.equal(p4.doc_no, 'P-004/10-26'); assert.equal(p4.doc_key, 'P-004-10-26');
  // searching with the file-name form finds the document
  const byKey = (await admin.get('/api/registry?q=P-004-10-26')).data.items;
  assert.equal(byKey.length, 1); assert.equal(byKey[0].id, p4.id);
  // the scan named P-004-10-26.pdf is attached to P-004/10-26 (also P-004_10-26 and "… (1)")
  for (const name of ['P-004-10-26.pdf', 'p-004_10-26.pdf', 'P-004-10-26 (1).pdf', 'P-004-10-26_2.pdf']) {
    const r = await admin.req('POST', '/api/registry/scans', { form: fileForm({}, [['file', name, PDF, 'application/pdf']]) });
    assert.equal(r.status, 201, `${name}: ${JSON.stringify(r.data)}`); assert.equal(r.data.doc_no, 'P-004/10-26');
  }
  const det = (await admin.get(`/api/registry/${p4.id}/details`)).data;
  assert.equal(det.item.doc_no, 'P-004/10-26', 'the official number is unchanged');
  assert.equal(det.files.length, 4);
  const d1 = await admin.get(det.files[0].url), d2 = await admin.get(det.files[1].url);
  assert.match(d1.headers.get('content-disposition'), /filename="P-004-10-26\.pdf"/);
  assert.match(d2.headers.get('content-disposition'), /filename="P-004-10-26_2\.pdf"/);
  // a number typed in file-name form is stored in the official form; both forms are duplicates
  const m = await admin.post('/api/registry', { doc_date: '2026-10-06', doc_type: 'Protokol', doc_no: 'P-010-10-26' });
  assert.equal(m.status, 201); assert.equal(m.data.item.doc_no, 'P-010/10-26');
  assert.equal((await admin.post('/api/registry', { doc_date: '2026-10-06', doc_type: 'Protokol', doc_no: 'P-010/10-26' })).status, 422);
  assert.equal((await admin.post('/api/registry', { doc_date: '2026-10-06', doc_type: 'Protokol', doc_no: 'P-004-10-26' })).status, 422);
  // the next automatic number continues after the manual one
  assert.equal((await admin.post('/api/registry', { doc_date: '2026-10-07', doc_type: 'Protokol' })).data.item.doc_no, 'P-011/10-26');
  const chk = (await admin.get('/api/registry/check-number?no=P-004-10-26')).data;
  assert.deepEqual([chk.number, chk.file_name, chk.taken], ['P-004/10-26', 'P-004-10-26', true]);
  assert.equal((await admin.get(`/api/registry/check-number?no=P-004-10-26&except=${p4.id}`)).data.taken, false);
  // editing keeps the number; replacing a scan keeps its place
  assert.equal((await admin.patch(`/api/registry/${p4.id}`, { subject: 'Yenilənib' })).data.item.doc_no, 'P-004/10-26');
  const rep = await admin.req('POST', `/api/office/files/${det.files[0].id}/replace`, { form: fileForm({}, [['file', 'yeni-skan.png', PNG, 'image/png']]) });
  assert.equal(rep.status, 200, JSON.stringify(rep.data)); assert.equal(rep.data.item.id, det.files[0].id); assert.equal(rep.data.item.ext, 'png');
  assert.match((await admin.get(det.files[0].url)).headers.get('content-disposition'), /filename="P-004-10-26\.png"/);
  assert.equal((await admin.req('POST', `/api/office/files/${det.files[0].id}/replace`, { form: fileForm({}, [['file', 'x.pdf', Buffer.from('MZ fake'), 'application/pdf']]) })).status, 422);
  // payment linked by the file-name form of an invoice number
  const inv = (await admin.post('/api/registry', { doc_date: '2026-10-08', doc_type: 'Hesab', amount: 200 })).data.item;
  const pay = await admin.post('/api/ledger', { entry_date: '2026-10-09', kind: 'income', amount: 200, doc_no: inv.doc_key });
  assert.equal(pay.status, 201, JSON.stringify(pay.data)); assert.equal(pay.data.item.doc_id, inv.id);
  // the document card as PDF
  const card = await admin.get(`/api/registry/${p4.id}/pdf?inline=1`);
  assert.equal(card.status, 200); assert.equal(card.headers.get('content-type'), 'application/pdf'); assert.match(card.headers.get('content-disposition'), /^inline; filename="P-004-10-26-kart\.pdf"/);
  const txt = pdfText(card.data);
  if (txt !== null) { assert.match(txt, /P-004\/10-26/); assert.match(txt, /P-004-10-26_2\.pdf/); assert.match(txt, /Qeydiyyat nömrəsi/); }
});

test('2. recipient chosen from the staff database; new employees are not duplicated', async () => {
  const e = await admin.post('/api/employees', { last_name: 'Quliyev', first_name: 'Rəşad', father_name: 'Elman', position: 'Mühəndis' });
  assert.equal(e.status, 201, JSON.stringify(e.data)); assert.equal(e.data.item.full_name, 'Quliyev Rəşad');
  // the same person again (other letter case, without ə) is refused
  const dup = await admin.post('/api/employees', { last_name: 'quliyev', first_name: 'Resad', father_name: 'Elman' });
  assert.equal(dup.status, 409); assert.equal(dup.data.error.code, 'exists');
  assert.equal((await admin.post('/api/employees', { last_name: 'Quliyev', first_name: 'Rəşad', father_name: 'Kamal' })).status, 201, 'another father = another person');
  assert.equal((await admin.get('/api/employees/lookup?q=quliy')).data.items.length, 2);
  // a letter (not an order) addressed to an employee keeps the employee and shows the position
  const doc = await admin.post('/api/registry', { doc_date: '2026-10-10', doc_type: 'Məktub', employee_id: e.data.item.id, subject: 'Daxili məktub' });
  assert.equal(doc.status, 201, JSON.stringify(doc.data));
  assert.equal(doc.data.item.employee_id, e.data.item.id); assert.equal(doc.data.item.party, 'Quliyev Rəşad'); assert.equal(doc.data.item.employee_position, 'Mühəndis');
  const meta = (await admin.get('/api/office/meta')).data;
  assert.equal(meta.employees.find((x) => x.id === e.data.item.id).position, 'Mühəndis');
  // documents created before keep their recipient text
  const old = (await admin.post('/api/registry', { doc_date: '2026-10-10', doc_type: 'Məktub', recipient: 'Köhnə alan tərəf' })).data.item;
  assert.equal(old.party, 'Köhnə alan tərəf');
  // the traditional full form gives the father's name separately
  const f = await admin.post('/api/employees', { full_name: 'Həsənova Aysel Vüqar qızı', position: 'Mühasib' });
  assert.equal(f.status, 201, JSON.stringify(f.data));
  assert.deepEqual([f.data.item.last_name, f.data.item.first_name, f.data.item.father_name, f.data.item.full_name], ['Həsənova', 'Aysel', 'Vüqar qızı', 'Həsənova Aysel']);
});

test('3. every list exports to an A4 PDF with Azerbaijani text; long lists span pages with page numbers', async () => {
  for (let i = 0; i < 60; i++) await admin.post('/api/registry', { doc_date: '2026-09-01', doc_type: 'Məktub', subject: `Şəhər, ğ, ı, İ, ə, ö, ü, ç, ş — uzun mövzu mətni ${i} ki, cədvəl hüceyrəsində bir neçə sətrə bölünsün` });
  const urls = ['/api/registry/export', '/api/ledger/export', '/api/counterparties/export', '/api/employees/export', '/api/payroll/export', '/api/news/export', '/api/projects/export',
    '/api/leads/export', '/api/contacts/export', '/api/audit/export', '/api/analytics/export?type=daily'];
  for (const u of urls) {
    const r = await admin.get(u + (u.includes('?') ? '&' : '?') + 'format=pdf');
    assert.equal(r.status, 200, u); assert.equal(r.headers.get('content-type'), 'application/pdf', u);
    assert.equal(r.data.subarray(0, 5).toString(), '%PDF-', u); assert.ok(isA4(r.data), `${u}: A4`);
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="aeec-.*\.pdf"/, u);
  }
  const reg = await admin.get('/api/registry/export?format=pdf&q=uzun');
  if (process.env.PDF_DUMP) { // manual visual check: PDF_DUMP=dir npm test
    require('node:fs').writeFileSync(process.env.PDF_DUMP + '/registry.pdf', reg.data);
    for (const [n, u] of [['audit', '/api/audit/export?format=pdf'], ['payroll', '/api/payroll/sheet/pdf?period=2026-10'], ['summary', '/api/finance/summary/pdf?year=2026'], ['leads', '/api/leads/export?format=pdf']])
      require('node:fs').writeFileSync(`${process.env.PDF_DUMP}/${n}.pdf`, (await admin.get(u)).data);
  }
  assert.ok(pages(reg.data) >= 2, `pages: ${pages(reg.data)}`);
  const txt = pdfText(reg.data);
  if (txt !== null) {
    assert.match(txt, /Şəhər, ğ, ı, İ, ə, ö, ü, ç, ş/);
    assert.match(txt, new RegExp(`Səhifə 1 / ${pages(reg.data)}`)); assert.match(txt, new RegExp(`Səhifə ${pages(reg.data)} / ${pages(reg.data)}`));
    assert.match(txt, /axtarış: «uzun»/, 'the filter is printed');
    assert.equal((txt.match(/Sənəd nömrəsi/g) || []).length, pages(reg.data), 'the header row is repeated on every page');
  }
  // the font is embedded as a subset: a report stays small
  assert.ok(reg.data.length < 400000, `size ${reg.data.length}`);
  // printable reports
  for (const u of ['/api/registry/summary/pdf?year=2026', '/api/finance/summary/pdf?year=2026', '/api/payroll/sheet/pdf?period=2026-10']) {
    const r = await admin.get(u + '&inline=1');
    assert.equal(r.status, 200, u); assert.match(r.headers.get('content-disposition'), /^inline;/, u); assert.ok(isA4(r.data), u);
    assert.equal(r.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'self'");
  }
  assert.equal((await new Client(T.base, '10.6.0.9').get('/api/registry/export?format=pdf')).status, 401);
});

test('4. journal: duplicates, approval, history, balance and turnover from real entries', async () => {
  const cp = (await admin.post('/api/counterparties', { name: 'Sınaq Təchizat MMC', kind: 'supplier' })).data.item;
  const a = await admin.post('/api/ledger', { entry_date: '2026-10-12', kind: 'expense', category: 'Material', counterparty_id: cp.id, amount: '450,00', method: 'cash', description: 'Kabel' });
  assert.equal(a.status, 201); assert.equal(a.data.item.status, 'pending');
  // same kind, amount and party two days later -> possible duplicate
  const sim = (await admin.get(`/api/ledger/similar?kind=expense&amount=450&currency=AZN&counterparty_id=${cp.id}&date=2026-10-14`)).data.items;
  assert.equal(sim.length, 1);
  const dup = await admin.post('/api/ledger', { entry_date: '2026-10-14', kind: 'expense', counterparty_id: cp.id, amount: 450 });
  assert.equal(dup.status, 409); assert.equal(dup.data.error.code, 'duplicate'); assert.match(dup.data.error.message, /12\.10\.2026/);
  assert.equal((await admin.post('/api/ledger', { entry_date: '2026-10-14', kind: 'expense', counterparty_id: cp.id, amount: 450, allow_duplicate: true })).status, 201);
  assert.equal((await admin.post('/api/ledger', { entry_date: '2026-10-20', kind: 'expense', counterparty_id: cp.id, amount: 450 })).status, 201, 'a week later is not a duplicate');
  // approval; a later change of the amount needs approval again
  const id = a.data.item.id;
  const ap = await admin.post(`/api/ledger/${id}/approve`, { approve: true });
  assert.equal(ap.data.item.status, 'approved'); assert.ok(ap.data.item.approved_by_name);
  assert.equal((await admin.patch(`/api/ledger/${id}`, { description: 'Kabel (qəbz əlavə edildi)' })).data.item.status, 'approved', 'text change keeps approval');
  assert.equal((await admin.patch(`/api/ledger/${id}`, { amount: '455' })).data.item.status, 'pending');
  await admin.post(`/api/ledger/${id}/approve`, { approve: true });
  // receipt
  assert.equal((await admin.req('POST', `/api/office/files/ledger/${id}`, { form: fileForm({ category: 'receipt' }, [['file', 'qebz.jpg', JPEG, 'image/jpeg']]) })).status, 201);
  const det = (await admin.get(`/api/ledger/${id}/details`)).data;
  assert.equal(det.files.length, 1); assert.equal(det.files[0].category, 'receipt');
  const actions = det.history.map((x) => x.action);
  for (const want of ['Yaratma', 'Təsdiq', 'Redaktə (təsdiq ləğv olundu)', 'Fayl əlavə etmə']) assert.ok(actions.includes(want), `history has ${want}: ${actions}`);
  const v = await admin.get(`/api/ledger/${id}/pdf`);
  assert.equal(v.status, 200); const vt = pdfText(v.data); if (vt !== null) { assert.match(vt, /Məxaric qeydi/); assert.match(vt, /qebz\.jpg/); }
  // balances: an entry of the previous year becomes the opening balance
  await admin.post('/api/ledger', { entry_date: '2025-12-30', kind: 'income', amount: 1000 });
  const s = (await admin.get('/api/finance/summary?year=2026')).data;
  assert.equal(s.opening, 1000);
  const oct = s.months[9];
  assert.equal(oct.turnover, Math.round((oct.income + oct.expense) * 100) / 100);
  assert.equal(oct.closing, Math.round((oct.opening + oct.income - oct.expense) * 100) / 100);
  assert.equal(s.months[10].opening, oct.closing);
  assert.equal(s.totals.closing, s.months[11].closing);
  assert.ok(s.pending >= 2);
  // only users with finance.approve may approve
  const roles = (await admin.get('/api/roles')).data.roles;
  const editorRole = roles.find((r) => r.key === 'editor');
  const perms = ['finance.view', 'finance.edit'];
  assert.equal((await admin.put(`/api/roles/${editorRole.id}/permissions`, { permissions: [...(editorRole.permissions || []), ...perms] })).status, 200);
  const pw = 'Maliyye-Sinaq-2026!';
  await admin.post('/api/users', { name: 'Redaktor', email: 'redaktor@aeec.az', role_id: editorRole.id, is_active: true, password: pw });
  const ed = new Client(T.base, '10.6.0.5'); await ed.login('redaktor@aeec.az', pw); await ed.post('/api/auth/password', { current: pw, password: pw + 'x' }); await ed.login('redaktor@aeec.az', pw + 'x');
  assert.equal((await ed.get('/api/ledger')).status, 200);
  assert.equal((await ed.post(`/api/ledger/${id}/approve`, { approve: false })).status, 403);
});

test('5. personal file: personal data only with hr.personal, 3×4 photo, documents by category, PDF', async () => {
  const e = (await admin.post('/api/employees', { last_name: 'Əliyeva', first_name: 'Günay', father_name: 'Şahin', birth_date: '1990-05-14', address: 'Bakı, Nizami küç. 5', id_series: 'aze', id_number: '12345678',
    position: 'Mühasib', department: 'Maliyyə', hire_date: '2026-10-01', phone: '+994 55 000 00 00' })).data.item;
  assert.equal(e.id_series, 'AZE'); assert.equal(e.id_number, '12345678'); assert.equal(e.birth_date, '1990-05-14');
  assert.equal((await admin.post('/api/employees', { last_name: 'X', first_name: 'Y', id_number: '12AB' })).status, 422);
  // photo (the panel sends the cropped JPEG)
  const ph = await admin.req('POST', `/api/employees/${e.id}/photo`, { form: fileForm({}, [['file', 'foto.jpg', JPEG, 'image/jpeg']]) });
  assert.equal(ph.status, 200, JSON.stringify(ph.data));
  const img = await admin.get(ph.data.photo_url);
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal((await admin.req('POST', `/api/employees/${e.id}/photo`, { form: fileForm({}, [['file', 'foto.pdf', PDF, 'application/pdf']]) })).status, 422, 'photo must be an image');
  // documents of the personal file
  for (const [cat, name, buf, type] of [['id_card', 'vesiqe.jpg', JPEG, 'image/jpeg'], ['education', 'diplom.pdf', PDF, 'application/pdf'], ['contract', 'muqavile.pdf', PDF, 'application/pdf']])
    assert.equal((await admin.req('POST', `/api/office/files/employee/${e.id}`, { form: fileForm({ category: cat }, [['file', name, buf, type]]) })).status, 201);
  const det = (await admin.get(`/api/employees/${e.id}/details`)).data;
  assert.deepEqual(det.files.map((f) => f.category).sort(), ['contract', 'education', 'id_card']);
  // personal file PDF with the photo embedded
  const pdf = await admin.get(`/api/employees/${e.id}/pdf`);
  assert.equal(pdf.status, 200); assert.match(pdf.data.toString('latin1'), /\/Subtype \/Image/);
  const t = pdfText(pdf.data);
  if (t !== null) { assert.match(t, /Əliyeva/); assert.match(t, /AZE 12345678/); assert.match(t, /Şəxsiyyət vəsiqəsi/); assert.match(t, /diplom\.pdf/); }
  // a user with hr.view but without hr.personal
  const roles = (await admin.get('/api/roles')).data.roles;
  const viewer = roles.find((r) => r.key === 'viewer');
  assert.equal((await admin.put(`/api/roles/${viewer.id}/permissions`, { permissions: ['dashboard.view', 'hr.view'] })).status, 200);
  const pw = 'Kadr-Gorus-2026!';
  await admin.post('/api/users', { name: 'Baxış', email: 'baxis@aeec.az', role_id: viewer.id, is_active: true, password: pw });
  const v = new Client(T.base, '10.6.0.6'); await v.login('baxis@aeec.az', pw); await v.post('/api/auth/password', { current: pw, password: pw + 'x' }); await v.login('baxis@aeec.az', pw + 'x');
  const seen = (await v.get(`/api/employees/${e.id}`)).data.item;
  assert.equal(seen.position, 'Mühasib');
  for (const k of ['birth_date', 'address', 'id_series', 'id_number', 'photo_media_id']) assert.ok(!(k in seen), `${k} hidden`);
  assert.ok(!JSON.stringify((await v.get('/api/employees')).data).includes('12345678'));
  const vd = (await v.get(`/api/employees/${e.id}/details`)).data;
  assert.equal(vd.personal, false); assert.equal(vd.files, null);
  assert.equal((await v.get(ph.data.photo_url)).status, 403);
  assert.equal((await v.get(det.files[0].url)).status, 403, 'personal documents');
  const vt = pdfText((await v.get(`/api/employees/${e.id}/pdf`)).data);
  if (vt !== null) assert.ok(!vt.includes('12345678'), 'no ID number in the PDF either');
  assert.equal((await v.post('/api/employees', { last_name: 'A', first_name: 'B' })).status, 403);
});

test('6. WhatsApp button on the contact pages, number from the panel', async () => {
  const visitor = new Client(T.base, '10.6.0.7');
  assert.ok(!(await visitor.get('/elaqe/')).data.toString().includes('wa.me'), 'no number -> no button');
  const c = (await admin.get('/api/settings')).data.settings.contact;
  assert.equal((await admin.put('/api/settings/contact', { ...c, whatsapp: '+994 50 123 45 67', i18n: { ...c.i18n, en: { ...(c.i18n.en || {}), whatsapp_message: 'Hi AEEC!' } } })).status, 200);
  const az = (await visitor.get('/elaqe/')).data.toString();
  assert.match(az, /<a class="btn btn-wa" href="https:\/\/wa\.me\/994501234567\?text=Salam!%20AEEC%20sayt%C4%B1ndan%20yaz%C4%B1ram\." target="_blank" rel="noopener noreferrer">/);
  assert.match(az, /WhatsApp ilə yazın/);
  assert.match((await visitor.get('/en/contact/')).data.toString(), /wa\.me\/994501234567\?text=Hi%20AEEC!/);
  assert.match((await visitor.get('/ru/contact/')).data.toString(), /Написать в WhatsApp/);
  // a local number (without the country code) would open a wrong chat -> no button
  assert.equal((await admin.put('/api/settings/contact', { ...c, whatsapp: '050 123 45 67' })).status, 200);
  assert.ok(!(await visitor.get('/elaqe/')).data.toString().includes('wa.me'));
  assert.equal((await admin.put('/api/settings/contact', c)).status, 200);
});
