'use strict';
// Printable PDF documents of the office modules (A4, see src/pdf.js). Each function receives the
// data already prepared by its module and sends the PDF (?inline=1 = preview in the browser).
const config = require('../config');
const { PdfDoc, sendPdf, printedNow, dmy } = require('../pdf');
const { dayOf } = require('../db'); // UTC timestamp -> the local (Baku) calendar day
const { getSetting } = require('../settings');
const C = require('./common');

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];
const money = (n, cur = 'AZN') => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const [i, d] = Math.abs(v).toFixed(2).split('.');
  return `${v < 0 ? '−' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${d}${cur ? ' ' + cur : ''}`;
};
const company = () => (getSetting('general') || {}).company_name || 'Azərbaycan Enerji Encinirinq ənd Konsaltinq MMC';
const doc = (title, landscape = false) => new PdfDoc({ title, landscape, company: company(), printed: printedNow(config.tzOffsetMin) });
const safe = (s) => String(s).replace(/[^\w.-]+/g, '-');

function registrySummary(ctx, s) {
  const d = doc(`Sənəd reyestri — ${s.year} hesabatı`, true);
  d.h1(`Sənəd reyestri: ${s.year}-ci il üzrə hesabat`, `Cəmi ${s.total} sənəd · cavab gözlənilən: ${s.waiting_total} · ödənilməmiş qalıq: ${money(s.unpaid_total)}`);
  d.h2('Sənəd növləri və aylar üzrə say');
  const tot = Array.from({ length: 12 }, (_, i) => s.table.reduce((a, r) => a + r.months[i], 0));
  d.table([{ label: 'Sənəd növü', w: 3 }, { label: 'İndeks', w: 1.2 }, ...MONTHS.map((m) => ({ label: m.slice(0, 3), w: 1, align: 'right' })), { label: 'Cəmi', w: 1.2, align: 'right' }, { label: 'Növbəti nömrə', w: 2.4 }],
    s.table.map((r) => [r.type, r.index, ...r.months.map((n) => (n ? String(n) : '·')), String(r.total), r.next]), { totals: ['Cəmi', '', ...tot.map(String), String(s.total), ''] });
  if (s.waiting.length) {
    d.h2('Cavab gözlənilən sənədlər');
    d.table([{ label: 'Nömrə', w: 1.6 }, { label: 'Tarix', w: 1.2 }, { label: 'Alan tərəf', w: 3 }, { label: 'Mövzu', w: 4 }, { label: 'Vəziyyət', w: 2 }],
      s.waiting.map((x) => [x.doc_no, dmy(x.doc_date), x.party, x.subject, x.response_label]));
  }
  if (s.unpaid.length) {
    d.h2('Ödənilməmiş sənədlər');
    d.table([{ label: 'Nömrə', w: 1.6 }, { label: 'Tarix', w: 1.2 }, { label: 'Kontragent', w: 3 }, { label: 'Məbləğ', w: 1.6, align: 'right' }, { label: 'Ödənilib', w: 1.6, align: 'right' }, { label: 'Qalıq', w: 1.6, align: 'right' }, { label: 'Ödəniş müddəti', w: 1.4 }],
      s.unpaid.map((x) => [x.doc_no, dmy(x.doc_date), x.party, money(x.amount, x.currency), money(x.paid, x.currency), money(x.debt, x.currency), dmy(x.due_date) || '—']));
  }
  d.signatures(['Hazırladı', 'Direktor']);
  sendPdf(ctx, d.toBuffer(), `reyestr-hesabat-${s.year}.pdf`);
}

function registryCard(ctx, id) {
  const { get, all } = require('../db');
  const { err } = require('../http');
  const row = get('SELECT * FROM registry_view WHERE id = ?', id);
  if (!row) throw err(404, 'Qeyd tapılmadı');
  const x = C.presentDoc(row);
  const d = doc(`Sənəd ${x.doc_no}`);
  d.h1(`Sənədin qeydiyyat kartı: ${x.doc_no}`, `${x.doc_type} · ${dmy(x.doc_date)}${x.status ? ' · ' + x.status : ''}`);
  d.h2('Sənəd');
  d.meta([['Qeydiyyat nömrəsi', x.doc_no], ['Fayl adı forması', C.fileKey(x.doc_no)], ['Tarix', dmy(x.doc_date)], ['Sənəd növü', x.doc_type],
    ['Alan təşkilat', x.cp_name || (x.doc_type === C.ORDER_TYPE ? '' : x.recipient)], ['Alan şəxs', x.employee_name ? `${x.employee_name}${x.employee_position ? ' — ' + x.employee_position : ''}` : ''],
    ['E-poçt', x.email], ['Telefon', x.phone], ['İcraçı', x.executor], ['Status', x.status]], { cols: 2 });
  d.meta([['Mövzu / qısa məzmun', x.subject]], { cols: 1, labelW: 0.2 });
  d.h2('Göndəriş və cavab');
  d.meta([['Göndərilmə üsulu', x.send_method], ['Göndərilmə tarixi', dmy(x.sent_date)], ['Cavab tələb olunur', x.response_required ? 'Bəli' : 'Xeyr'], ['Cavab vəziyyəti', x.response_label],
    ['Cavab tarixi', dmy(x.response_date)], ['Cavab nömrəsi', x.response_no], ['Nəticə', x.result], ['Cavabın məzmunu', x.response_summary]]);
  if (x.amount) {
    d.h2('Məbləğ və ödəniş');
    d.meta([['Məbləğ', money(x.amount, x.currency)], ['O cümlədən ƏDV', money(x.vat_amount, x.currency)], ['Ödənilib', money(x.paid, x.currency)], ['Qalıq', money(x.debt, x.currency)],
      ['Ödəniş vəziyyəti', x.pay_label], ['Ödəniş müddəti', dmy(x.due_date)]]);
    if (ctx.perms.has('finance.view')) {
      const pays = all('SELECT entry_date, amount, method, description FROM ledger WHERE doc_id = ? ORDER BY entry_date', x.id);
      if (pays.length) d.table([{ label: 'Ödəniş tarixi', w: 1.3 }, { label: 'Məbləğ', w: 1.3, align: 'right' }, { label: 'Üsul', w: 1.4 }, { label: 'Təsvir', w: 3 }],
        pays.map((p) => [dmy(p.entry_date), money(C.azn(p.amount), x.currency), C.METHOD_LABEL[p.method], p.description]));
    }
  }
  const files = C.fileRows('doc', x.id);
  d.h2(`Skanlar və əlavələr (${files.length})`);
  if (files.length) d.table([{ label: '№', w: 0.5 }, { label: 'Paneldə fayl adı', w: 2.4 }, { label: 'Yüklənən fayl', w: 3 }, { label: 'Ölçü', w: 1, align: 'right' }, { label: 'Tarix', w: 1.2 }],
    files.map((f, i) => [String(i + 1), `${C.fileKey(x.doc_no)}${i ? '_' + (i + 1) : ''}.${f.ext}`, f.name, `${Math.max(1, Math.round(f.size / 1024))} KB`, dmy(dayOf(f.created_at))]));
  else d.para('Skan əlavə edilməyib.', { color: '0.45 0.5 0.58' });
  if (x.note) { d.h2('Qeyd'); d.para(x.note); }
  d.signatures(['Qeydə alan', 'Direktor']);
  sendPdf(ctx, d.toBuffer(), `${C.fileKey(x.doc_no)}-kart.pdf`);
}

function counterpartyStatement(ctx, card) {
  const c = card.item;
  const d = doc(`Kontragent: ${c.name}`);
  d.h1(c.name, `${c.kind_label}${c.tax_id ? ' · VÖEN ' + c.tax_id : ''}`);
  d.meta([['VÖEN', c.tax_id], ['Hüquqi ünvan', c.legal_address], ['Bank', c.bank_name], ['Hesab (IBAN)', c.bank_account], ['Bank kodu', c.bank_code], ['SWIFT', c.swift],
    ['Əlaqə şəxsi', c.contact_person], ['Telefon', c.phone], ['E-poçt', c.email]]);
  d.h2('Hesablaşmalar');
  d.meta([['Hesablanıb (sənədlər üzrə)', money(card.totals.invoiced)], ['Ödənilib', money(card.totals.paid)], ['Borc qalığı', money(card.totals.debt)]], { cols: 3, labelW: 0.55 });
  d.h2(`Sənədlər (${card.docs.length})`);
  d.table([{ label: 'Nömrə', w: 1.5 }, { label: 'Tarix', w: 1.1 }, { label: 'Növ', w: 1.1 }, { label: 'Mövzu', w: 3.2 }, { label: 'Məbləğ', w: 1.5, align: 'right' }, { label: 'Ödəniş', w: 1.4 }],
    card.docs.map((x) => [x.doc_no, dmy(x.doc_date), x.doc_type, x.subject, x.amount ? money(x.amount, x.currency) : '—', x.pay_label || '—']));
  d.h2(`Ödənişlər və xərclər (${card.ledger.length})`);
  d.table([{ label: 'Tarix', w: 1.1 }, { label: 'Növ', w: 0.9 }, { label: 'Sənəd', w: 1.5 }, { label: 'Təsvir', w: 3.4 }, { label: 'Məbləğ', w: 1.5, align: 'right' }],
    card.ledger.map((l) => [dmy(l.entry_date), l.kind_label, l.doc_no || '—', l.description, money(l.amount, l.currency)]));
  d.signatures([company(), c.name]);
  sendPdf(ctx, d.toBuffer(), `kontragent-${safe(c.name).slice(0, 40)}.pdf`);
}

function ledgerVoucher(ctx, l, files) {
  const d = doc(`${l.kind_label} #${l.id}`);
  d.h1(`${l.kind === 'income' ? 'Mədaxil' : 'Məxaric'} qeydi № ${l.id}`, `${dmy(l.entry_date)} · ${l.status_label}`);
  d.meta([['Tarix', dmy(l.entry_date)], ['Növ', l.kind_label], ['Məbləğ', money(l.amount, l.currency)], ['O cümlədən ƏDV', money(l.vat_amount, l.currency)], ['Kateqoriya', l.category], ['Ödəniş üsulu', l.method_label],
    ['Kontragent', l.cp_name], ['Əlaqəli sənəd', l.doc_no], ['Vəziyyət', l.status_label], ['Təsdiqlədi', l.approved_by_name ? `${l.approved_by_name}, ${dmy(dayOf(l.approved_at))}` : '']]);
  d.meta([['Təsvir', l.description]], { cols: 1, labelW: 0.2 });
  d.h2(`Qəbz və təsdiqedici sənədlər (${files.length})`);
  if (files.length) d.table([{ label: 'Fayl', w: 4 }, { label: 'Ölçü', w: 1, align: 'right' }, { label: 'Tarix', w: 1.2 }], files.map((f) => [f.name, `${Math.max(1, Math.round(f.size / 1024))} KB`, dmy(dayOf(f.created_at))]));
  else d.para('Qəbz əlavə edilməyib.', { color: '0.45 0.5 0.58' });
  d.signatures(['Qeydə alan', 'Təsdiq edən (mühasib)']);
  sendPdf(ctx, d.toBuffer(), `${l.kind === 'income' ? 'medaxil' : 'mexaric'}-${l.id}.pdf`);
}

function financeReport(ctx, s) {
  const d = doc(`Gəlir və xərc — ${s.year}`, true);
  const t = s.totals;
  d.h1(`Gəlir və xərc hesabatı: ${s.year}`, `AZN · ilin əvvəlinə qalıq ${money(s.opening)} · ilin sonuna qalıq ${money(t.closing)}${s.pending ? ` · ${s.pending} əməliyyat hələ təsdiqlənməyib` : ''}`);
  d.meta([['Gəlir', money(t.income)], ['Xərc', money(t.expense)], ['Fərq', money(t.balance)], ['Dövriyyə', money(t.turnover)], ['Əmək haqqı fondu', money(t.payroll)], ['İlin sonuna qalıq', money(t.closing)]], { cols: 3, labelW: 0.5 });
  d.h2('Aylar üzrə: qalıq və dövriyyə');
  d.table([{ label: 'Ay', w: 1.6 }, { label: 'Ayın əvvəlinə qalıq', w: 1.8, align: 'right' }, { label: 'Gəlir', w: 1.6, align: 'right' }, { label: 'Xərc', w: 1.6, align: 'right' }, { label: 'Dövriyyə', w: 1.6, align: 'right' }, { label: 'Ayın sonuna qalıq', w: 1.8, align: 'right' }, { label: 'Əmək haqqı fondu', w: 1.6, align: 'right' }],
    s.months.map((m, i) => [MONTHS[i], money(m.opening, ''), money(m.income, ''), money(m.expense, ''), money(m.turnover, ''), money(m.closing, ''), money(m.payroll, '')]),
    { totals: ['Cəmi', money(s.opening, ''), money(t.income, ''), money(t.expense, ''), money(t.turnover, ''), money(t.closing, ''), money(t.payroll, '')] });
  d.h2('Kateqoriyalar üzrə');
  d.table([{ label: 'Kateqoriya', w: 4 }, { label: 'Növ', w: 1.2 }, { label: 'Əməliyyat', w: 1.2, align: 'right' }, { label: 'Məbləğ', w: 1.8, align: 'right' }], s.categories.map((c) => [c.category || '(kateqoriyasız)', c.kind_label, String(c.n), money(c.s)]));
  d.h2('Debitor borclar');
  d.table([{ label: 'Kontragent', w: 4 }, { label: 'Sənəd', w: 1, align: 'right' }, { label: 'Qalıq', w: 1.8, align: 'right' }, { label: 'Qeyd', w: 1.6 }], s.receivables.map((r) => [r.cp_name, String(r.n), money(r.debt, r.currency), r.overdue ? 'müddəti keçib' : '']));
  if (s.other_currencies.length) d.para(`Digər valyutalar: ${s.other_currencies.map((o) => `${o.kind === 'income' ? 'gəlir' : 'xərc'} ${money(o.s, o.currency)}`).join('; ')}`);
  d.signatures(['Baş mühasib', 'Direktor']);
  sendPdf(ctx, d.toBuffer(), `gelir-xerc-${s.year}.pdf`);
}

function personalFile(ctx, { item: e, personal, photo, files, categories, orders }) {
  const d = doc(`Şəxsi iş: ${e.full_name}`);
  d.h1('Əməkdaşın şəxsi vərəqəsi', `${e.full_name}${e.father_name ? ' ' + e.father_name : ''} · ${e.position || 'vəzifə göstərilməyib'}`);
  // personal data with the 3×4 photo (30×40 mm) on the right
  d.h2('Şəxsi məlumatlar');
  const y0 = d.y, pw = 30 * 72 / 25.4, gap = 8 * 72 / 25.4;
  let ph = 0;
  if (photo) { try { ph = d.image(photo, d.m.l + d.cw - pw, y0, pw); d.cw -= pw + gap; } catch { ph = 0; } }
  d.meta([['Soyad', e.last_name], ['Ad', e.first_name], ['Ata adı', e.father_name], ...(personal ? [['Doğum tarixi', dmy(e.birth_date)], ['Ünvan', e.address],
    ['Şəxsiyyət vəsiqəsi', [e.id_series, e.id_number].filter(Boolean).join(' ')]] : []), ['Telefon', e.phone], ['E-poçt', e.email]], ph ? { cols: 1, labelW: 0.32 } : { cols: 2 });
  if (ph) { d.cw += pw + gap; d.y = Math.max(d.y, y0 + ph + 10); }
  d.h2('İş məlumatları');
  d.meta([['Vəzifə', e.position], ['Şöbə', e.department], ['İşə qəbul tarixi', dmy(e.hire_date)], ['İşdən çıxma tarixi', dmy(e.leave_date)], ['İş statusu', e.status_label]]);
  d.h2(`Əmrlər və sənədlər (${orders.length})`);
  d.table([{ label: 'Nömrə', w: 1.4 }, { label: 'Növ', w: 1.1 }, { label: 'Tarix', w: 1.1 }, { label: 'Mövzu', w: 4 }, { label: 'Status', w: 1.3 }], orders.map((o) => [o.doc_no, o.doc_type, dmy(o.doc_date), o.subject, o.status]));
  if (personal) {
    d.h2(`Şəxsi iş sənədləri (${files.length})`);
    d.table([{ label: 'Növ', w: 1.8 }, { label: 'Fayl', w: 4 }, { label: 'Tarix', w: 1.1 }], files.map((f) => [categories[f.category] || 'Digər', f.name, dmy(dayOf(f.created_at))]));
  }
  d.signatures(['Kadrlar üzrə məsul şəxs', 'Əməkdaş']);
  sendPdf(ctx, d.toBuffer(), `sexsi-is-${safe(e.full_name).slice(0, 40)}.pdf`);
}

function payrollSheet(ctx, { period, rows, totals }) {
  const label = `${MONTHS[+period.slice(5, 7) - 1]} ${period.slice(0, 4)}`;
  const d = doc(`Əmək haqqı cədvəli — ${label}`, true);
  d.h1(`Əmək haqqı cədvəli: ${label}`, `${rows.length} əməkdaş · məbləğlər AZN ilə`);
  const cols = [{ label: '№', w: 0.5 }, { label: 'Əməkdaş', w: 3 }, { label: 'Vəzifə', w: 2.2 }, { label: 'Hesablanıb', w: 1.4, align: 'right' }, { label: 'Gəlir vergisi', w: 1.3, align: 'right' },
    { label: 'DSMF (işçi)', w: 1.2, align: 'right' }, { label: 'İşsizlik (işçi)', w: 1.2, align: 'right' }, { label: 'Tibbi (işçi)', w: 1.2, align: 'right' }, { label: 'Digər', w: 1, align: 'right' },
    { label: 'Ödəniləcək', w: 1.4, align: 'right' }, { label: 'İşəgötürən xərci', w: 1.5, align: 'right' }, { label: 'İmza', w: 1.6 }];
  const m = (v) => money(v, '');
  d.table(cols, rows.map((r, i) => [String(i + 1), r.full_name, r.position, m(r.gross), m(r.income_tax), m(r.dsmf_employee), m(r.unemployment_employee), m(r.health_employee), m(r.other_deductions), m(r.net), m(r.employer_cost), '']),
    { totals: ['', 'Cəmi', '', m(totals.gross), m(totals.income_tax), m(totals.dsmf_employee), m(totals.unemployment_employee), m(totals.health_employee), m(totals.other_deductions), m(totals.net), m(totals.employer_cost), ''], size: 8 });
  d.para('Məbləğlər mühasib tərəfindən hesablanaraq daxil edilib. Ödəniləcək = hesablanmış − işçidən tutulmalar; işəgötürən xərci = hesablanmış + işəgötürən ödəmələri (DSMF, işsizlik, tibbi sığorta).', { size: 8, color: '0.4 0.45 0.52' });
  d.signatures(['Baş mühasib', 'Direktor']);
  sendPdf(ctx, d.toBuffer(), `emek-haqqi-${period}.pdf`);
}

module.exports = { registrySummary, registryCard, counterpartyStatement, ledgerVoucher, financeReport, personalFile, payrollSheet };
