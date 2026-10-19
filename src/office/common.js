'use strict';
// Shared rules of the office modules (register, accounting, staff).
// Money is stored as integer qəpik (1 AZN = 100) and returned to the panel as AZN numbers.
const { get, all, dayOf } = require('../db');
const { getSetting } = require('../settings');

const azn = (q) => Math.round(Number(q) || 0) / 100;
const lists = () => getSetting('office');

const ORDER_TYPE = 'Əmr';          // orders concern employees (no counterparty)
const CANCELLED = 'Ləğv edildi';   // this status takes a document out of response and payment tracking
const CURRENCIES = ['AZN', 'USD', 'EUR'];
const KIND_LABEL = { income: 'Gəlir', expense: 'Xərc' };
const METHOD_LABEL = { bank: 'Bank köçürməsi', cash: 'Nağd', card: 'Kart', other: 'Digər' };
const CP_KIND = { client: 'Müştəri', supplier: 'Təchizatçı', state: 'Dövlət qurumu', other: 'Digər' };
const PAY_LABEL = { none: '', unpaid: 'Ödənilməyib', partial: 'Qismən ödənilib', paid: 'Ödənilib' };
const LEDGER_STATUS = { pending: 'Təsdiq gözləyir', approved: 'Təsdiqlənib' };
// Kinds of files that can be attached to an employee's personal file.
const EMPLOYEE_FILE_CATS = { id_card: 'Şəxsiyyət vəsiqəsi', education: 'Təhsil sənədi', certificate: 'Sertifikat', contract: 'Əmək müqaviləsi', order: 'Əmr', other: 'Digər' };

/* ------------------------------------------------------------------ document numbers */
// The official number of a document always keeps "/": P-004/10-26. A file name cannot contain "/",
// so in file names the same number is written P-004-10-26 (or P-004_10-26). Both written forms
// are recognised everywhere a number is typed or read from a file name.
const NO_RX = /^([A-Z]{1,4})-(\d{1,5})\/(\d{2})-(\d{2})$/;
const FILE_NO_RX = /^([A-Za-z]{1,4})-(\d{1,5})[-_ ](\d{2})[-_](\d{2})$/;
const fmtNo = (index, seq, date) => `${index}-${String(seq).padStart(3, '0')}/${date.slice(5, 7)}-${date.slice(2, 4)}`;
function normalizeNo(s) {
  const t = String(s ?? '').trim();
  const m = FILE_NO_RX.exec(t);
  return m ? `${m[1].toUpperCase()}-${m[2]}/${m[3]}-${m[4]}` : t;
}
const fileKey = (no) => String(no || '').replace(/\//g, '-'); // P-004/10-26 -> P-004-10-26

// Next free sequence number of an index in a year (numbers continue across months and start
// again from 001 in a new year - the rule of the company's Excel register).
const nextSeq = (index, year) => (get('SELECT MAX(seq) AS m FROM registry_docs WHERE doc_index = ? AND doc_year = ?', index, year).m || 0) + 1;
function typeIndex(name) { const t = lists().doc_types.find((x) => x.name === name); return t ? t.index : null; }

const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
// Response state exactly as the Excel register's "Cavab vəziyyəti" column computes it.
function responseLabel(d) {
  if (d.response_state === 'cancelled') return '';
  if (d.response_state === 'none') return 'Tələb olunmur';
  if (d.response_state === 'received') return d.sent_date ? `Cavab alındı (${daysBetween(d.sent_date, d.response_date)} gün ərzində)` : 'Cavab alındı';
  return d.sent_date ? `Gözlənilir (${Math.max(0, daysBetween(d.sent_date, dayOf()))} gündür)` : 'Gözlənilir';
}
function presentDoc(row) {
  const d = row.pay_state !== undefined ? row : get('SELECT * FROM registry_view WHERE id = ?', row.id);
  return {
    ...d, amount: azn(d.amount), vat_amount: azn(d.vat_amount), paid: azn(d.paid), debt: azn(Math.max(0, d.amount - d.paid)),
    response_required: !!d.response_required, response_label: responseLabel(d), pay_label: PAY_LABEL[d.pay_state] || '',
    doc_key: d.doc_key || fileKey(d.doc_no),
    // who the document is addressed to: an order -> the employee; otherwise the organisation,
    // then the person (employee), then the free text
    party: d.doc_type === ORDER_TYPE ? d.employee_name || d.recipient : d.cp_name || d.employee_name || d.recipient,
  };
}

/* ------------------------------------------------------------------ employees */
// "Soyad Ad" is the display name; the father's name is printed with oğlu/qızı by the user.
const fullName = (e) => [e.last_name, e.first_name].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
// "Soyad Ad" -> { last_name, first_name }. The traditional full form
// "Soyad Ad Ata-adı oğlu/qızı" also gives father_name ("Rauf oğlu"), so nothing is lost.
const PATRONYMIC = /^(oğlu|oglu|qızı|qizi|кызы|оглы)$/i;
function splitName(full) {
  const w = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (w.length >= 4 && PATRONYMIC.test(w[w.length - 1])) return { last_name: w[0], first_name: w.slice(1, -2).join(' '), father_name: w.slice(-2).join(' ') };
  return { last_name: w[0] || '', first_name: w.slice(1).join(' ') };
}

const fileRows = (type, id) => all(`SELECT f.id, f.category, f.created_at, m.original_name AS name, m.ext, m.size FROM office_files f JOIN media m ON m.id = f.media_id
  WHERE f.owner_type = ? AND f.owner_id = ? ORDER BY f.id`, type, id).map((f) => ({ ...f, url: `/api/office/files/${f.id}`, previewable: ['pdf', 'jpg', 'png'].includes(f.ext) }));

module.exports = {
  azn, lists, ORDER_TYPE, CANCELLED, CURRENCIES, KIND_LABEL, METHOD_LABEL, CP_KIND, PAY_LABEL, LEDGER_STATUS, EMPLOYEE_FILE_CATS,
  NO_RX, fmtNo, normalizeNo, fileKey, nextSeq, typeIndex, responseLabel, presentDoc, fullName, splitName, fileRows, daysBetween,
};
