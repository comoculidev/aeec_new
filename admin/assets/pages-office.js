// Office pages (internal): document register, counterparties, income/expense, employees, payroll.
// Server side: src/routes/office.js and src/office/*. Every list uses the shared dataTable /
// buildForm helpers; every printable view has a PDF button (opens the A4 PDF in a new tab).
import { h, raw, setHTML, $, $$, icon, api, qs, can, toast, showError, fmtDate, fmtDateTime, fmtSize, chip, confirmDialog, promptDialog, modal, todayBaku } from './core.js';
import { dataTable, buildForm, openPdf } from './ui.js';
import { groupBars, chartCard, tableView } from './charts.js';

const go = (hash) => { location.hash = '#/' + hash; };
const backLink = (hash, label) => h`<a class="back" href="#/${hash}">${icon('left', 'sm')}${label}</a>`;
const iconBtn = (act, ic, label) => h`<button class="iconbtn" data-act="${act}" aria-label="${label}" title="${label}">${icon(ic)}</button>`;
const pdfBtn = (id, label = 'PDF') => h`<button class="btn sm" id="${id}" title="A4 PDF: baxış, çap və yükləmə">${icon('file', 'sm')}${label}</button>`;
const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'İyn', 'İyl', 'Avq', 'Sen', 'Okt', 'Noy', 'Dek'];
const MONTHS_FULL = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];
// 1234.5 -> "1 234,50 AZN"
export const money = (n, cur = 'AZN') => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const [i, d] = Math.abs(v).toFixed(2).split('.');
  return `${v < 0 ? '−' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${d}${cur ? ' ' + cur : ''}`;
};
const moneyIn = (n) => (n ? String(n).replace('.', ',') : ''); // value shown in a money input
const PAY_COLOR = { unpaid: 'red', partial: 'amber', paid: 'green' };
const RESP_COLOR = { waiting: 'amber', received: 'green', none: 'grey', cancelled: 'grey' };
const periodLabel = (p) => (p ? `${MONTHS_FULL[+p.slice(5, 7) - 1]} ${p.slice(0, 4)}` : '');
// P-004/10-26 -> P-004-10-26 (how the number is written in file names)
const fileKey = (no) => String(no || '').replace(/\//g, '-');
const empLabel = (e) => `${e.full_name}${e.position ? ' — ' + e.position : ''}${e.status === 'left' ? ' (işdən çıxıb)' : ''}`;

let META = null;
async function meta(force) { if (!META || force) META = await api.get('/api/office/meta'); return META; }
const delAction = async (url, text, after) => { if (!(await confirmDialog(text, { title: 'Silmə təsdiqi', ok: 'Sil', danger: true }))) return; try { await api.del(url); toast('Silindi', 'ok'); after(); } catch (e) { showError(e); } };
const uploadOne = (url, file, extra = {}) => { const fd = new FormData(); fd.append('file', file); for (const [k, v] of Object.entries(extra)) fd.append(k, v); return api.upload(url, fd); };

/* ------------------------------------------------------------------ attached files card */
// Scans / attachments of one record. type: doc | ledger | employee. With `categories` the user
// picks the kind of document before uploading (e.g. Şəxsiyyət vəsiqəsi). Each file can be viewed,
// downloaded, replaced by a new version or deleted.
function filesCard(host, { type, id, files, editable, title = 'Skanlar və fayllar', hint = '', categories = null, downloadBase = '' }) {
  const accept = META.allowed.map((x) => '.' + x).join(',');
  const catName = (c) => (categories && categories[c]) || '';
  const draw = (list) => setHTML(host, h`<section class="card"><div class="card-h"><div><h2>${title}</h2><p>${hint || `PDF, JPG, PNG (DOCX, XLSX) · ən çox ${META.max_mb} MB`}</p></div></div><div class="card-b" style="display:grid;gap:10px">
    ${list.length ? h`<ul class="flist">${list.map((f, i) => h`<li><span class="ft">${String(f.ext).toUpperCase()}</span><span class="fn"><b title="${f.name}">${downloadBase ? `${downloadBase}${i ? '_' + (i + 1) : ''}.${f.ext}` : f.name}</b><span class="muted">${catName(f.category) ? catName(f.category) + ' · ' : ''}${downloadBase ? f.name + ' · ' : ''}${fmtSize(f.size)} · ${fmtDateTime(f.created_at)}</span></span>
      <span class="acts">${f.previewable ? h`<a class="iconbtn" href="${f.url}?inline=1" target="_blank" rel="noopener" title="Bax" aria-label="Bax">${icon('eye')}</a>` : ''}<a class="iconbtn" href="${f.url}" download title="Yüklə" aria-label="Yüklə">${icon('down')}</a>
      ${editable ? h`<label class="iconbtn" title="Yeni versiya ilə əvəz et" aria-label="Yeni versiya ilə əvəz et">${icon('refresh')}<input type="file" hidden accept="${accept}" data-frep="${f.id}"></label><button class="iconbtn" data-fdel="${f.id}" title="Sil" aria-label="Sil">${icon('trash')}</button>` : ''}</span></li>`)}</ul>` : h`<p class="muted">Hələ fayl əlavə edilməyib.</p>`}
    ${editable ? h`<div class="row" style="flex-wrap:wrap">${categories ? h`<label class="sr" for="fcat-${type}">Sənədin növü</label><select class="in" id="fcat-${type}" style="width:auto" data-fcat>${Object.entries(categories).map(([k, v]) => h`<option value="${k}">${v}</option>`)}</select>` : ''}
      <label class="btn sm pri">${icon('upload', 'sm')}Fayl əlavə et<input type="file" multiple hidden accept="${accept}" data-fup></label></div><p class="muted fprog" style="font-size:12.5px" hidden></p>` : ''}</div></section>`);
  let list = files.slice();
  draw(list);
  host.onclick = async (e) => {
    const d = e.target.closest('[data-fdel]');
    if (!d) return;
    if (!(await confirmDialog('Fayl həmişəlik silinəcək.', { title: 'Faylı sil', ok: 'Sil', danger: true }))) return;
    try { await api.del(`/api/office/files/${d.dataset.fdel}`); list = list.filter((f) => String(f.id) !== d.dataset.fdel); draw(list); toast('Fayl silindi', 'ok'); } catch (er) { showError(er); }
  };
  host.onchange = async (e) => {
    if (e.target.matches('[data-frep]')) {
      const file = e.target.files[0]; if (!file) return;
      try { const r = await uploadOne(`/api/office/files/${e.target.dataset.frep}/replace`, file); list = list.map((f) => (f.id === r.item.id ? r.item : f)); draw(list); toast('Fayl yeniləndi', 'ok'); } catch (er) { showError(er); }
      return;
    }
    if (!e.target.matches('[data-fup]')) return;
    const picked = [...e.target.files], prog = $('.fprog', host), failed = [];
    const category = categories ? ($('[data-fcat]', host) || {}).value || '' : '';
    for (let i = 0; i < picked.length; i++) {
      prog.hidden = false; prog.textContent = `Yüklənir ${i + 1}/${picked.length}: ${picked[i].name}`;
      try { list.push((await uploadOne(`/api/office/files/${type}/${id}`, picked[i], { category })).item); } catch (er) { failed.push(`${picked[i].name}: ${er.fields ? Object.values(er.fields)[0] : er.message}`); }
    }
    draw(list);
    if (failed.length) toast(failed.join(' · '), 'error'); else toast(picked.length > 1 ? `${picked.length} fayl əlavə edildi` : 'Fayl əlavə edildi', 'ok');
  };
}

/* ------------------------------------------------------------------ new employee (from any form) */
// Adds an employee to the staff database; if the person already exists, returns the existing one.
async function quickEmployee() {
  let created = null;
  const r = await promptDialog({ title: 'Yeni əməkdaş', ok: 'Əlavə et', intro: 'Əməkdaş kadrlar bazasına əlavə olunacaq. Eyni soyad, ad və ata adı ilə ikinci dəfə yaradılmır.',
    fields: [{ name: 'last_name', label: 'Soyad', required: true }, { name: 'first_name', label: 'Ad', required: true }, { name: 'father_name', label: 'Ata adı' },
      { name: 'position', label: 'Vəzifə' }, { name: 'phone', label: 'Telefon', type: 'tel' }],
    submit: async (v) => {
      try { created = (await api.post('/api/employees', v)).item; return v; }
      catch (er) {
        if (er.code !== 'exists') throw er;
        const found = (await api.get('/api/employees/lookup' + qs({ q: `${v.last_name} ${v.first_name}` }))).items[0];
        if (!found) throw er;
        toast(`Əməkdaş artıq bazada var: ${found.full_name}`, 'info'); created = found; return v;
      }
    } });
  return r ? created : null;
}

/* ================================================================== register */
async function registry(view, args) {
  await meta(true);
  const a0 = String(args[0] || '').split('?')[0]; // "yeni?type=Əmr&employee=5" (from an employee's card)
  if (a0 === 'siyahilar') return listsPage(view);
  if (a0) return docPage(view, a0);
  const L = META.lists, edit = can('registry.edit');
  setHTML(view, h`<div id="regSum" class="grid"></div><section class="card" id="regT"></section>
    <div class="note">${icon('info')}<span>Rəsmi nömrə: <b>indeks-sıra/ay-il</b> (P-004/10-26). Fayl adında «/» olmadığı üçün eyni nömrə <b>P-004-10-26</b> kimi yazılır — panel hər iki yazılışı tanıyır (axtarış, skan yükləmə, ödəniş bağlantısı). «Skanları yüklə» ilə <span class="mono">P-004-10-26.pdf</span> kimi adlanan faylları toplu əlavə edə bilərsiniz.</span></div>`);
  let year = Number(todayBaku().slice(0, 4));
  const t12 = (rows) => Array.from({ length: 12 }, (_, i) => rows.reduce((s, r) => s + r.months[i], 0));
  const drawSummary = async () => {
    const s = await api.get('/api/registry/summary' + qs({ year }));
    setHTML($('#regSum'), h`<div class="kpis three">
        <div class="card kpi"><div class="kl">${icon('file')}<span>${s.year}-ci ildə sənəd</span></div><div class="kv">${s.total}</div><div class="kd">reyestrdə qeydə alınıb</div></div>
        <a class="card kpi lnk" href="#/reyestr" data-quick="waiting"><div class="kl">${icon('history')}<span>Cavab gözlənilir</span></div><div class="kv">${s.waiting_total}</div><div class="kd">${s.waiting[0] ? `ən köhnəsi: ${s.waiting[0].doc_no} · ${s.waiting[0].response_label}` : 'gözlənilən cavab yoxdur'}</div></a>
        <a class="card kpi lnk" href="#/reyestr" data-quick="unpaid"><div class="kl">${icon('alert')}<span>Ödənilməmiş sənədlər</span></div><div class="kv sm">${money(s.unpaid_total)}</div><div class="kd">${s.unpaid.length} sənəd üzrə qalıq</div></a></div>
      <section class="card"><div class="card-h"><div><h2>Hesabat: növlər və aylar</h2><p>Hər növ üzrə sənəd sayı və növbəti veriləcək nömrə</p></div><span class="sp"></span>
        <label class="sr" for="regYear">İl</label><select class="in" id="regYear" style="width:auto">${s.years.map((y) => h`<option ${y === s.year ? raw('selected') : ''}>${y}</option>`)}</select>${pdfBtn('regSumPdf', 'Hesabat (PDF)')}</div>
        <div class="tw"><table class="tview"><thead><tr><th>Sənəd növü</th><th>İndeks</th>${MONTHS.map((m) => h`<th class="num">${m}</th>`)}<th class="num">Cəmi</th><th>Növbəti nömrə</th></tr></thead>
        <tbody>${s.table.map((t) => h`<tr><td>${t.type}</td><td class="mono">${t.index}</td>${t.months.map((n) => h`<td class="num ${n ? '' : 'muted'}">${n || '·'}</td>`)}<td class="num"><b>${t.total}</b></td><td class="mono">${t.next}</td></tr>`)}
        <tr class="tot"><td>Cəmi</td><td></td>${t12(s.table).map((n) => h`<td class="num">${n}</td>`)}<td class="num"><b>${s.total}</b></td><td></td></tr></tbody></table></div></section>`);
    $('#regYear').onchange = (e) => { year = Number(e.target.value); drawSummary(); };
    $('#regSumPdf').onclick = () => openPdf('/api/registry/summary/pdf' + qs({ year }));
  };
  await drawSummary();
  const table = dataTable($('#regT'), { id: 'registry', url: '/api/registry', sort: '-date', dateRange: true, exportUrl: '/api/registry/export', perPage: 25, searchPlaceholder: 'Nömrə (P-004/10-26 və ya P-004-10-26), alan tərəf, mövzu…',
    filters: [{ key: 'doc_type', label: 'Növ', options: L.doc_types.map((t) => [t.name, t.name]) }, { key: 'status', label: 'Status', options: L.statuses.map((x) => [x, x]) },
      { key: 'response', label: 'Cavab', options: [['waiting', 'Gözlənilir'], ['received', 'Alınıb'], ['none', 'Tələb olunmur']] }, { key: 'pay', label: 'Ödəniş', options: [['unpaid', 'Ödənilməyib'], ['partial', 'Qismən'], ['paid', 'Ödənilib']] }],
    extra: h`${edit ? h`<button class="btn sm" id="regImp">${icon('upload', 'sm')}Excel-dən idxal</button><button class="btn sm" id="regScans">${icon('upload', 'sm')}Skanları yüklə</button><a class="btn sm" href="#/reyestr/siyahilar">${icon('cog', 'sm')}Siyahılar</a><a class="btn sm pri" href="#/reyestr/yeni">${icon('plus', 'sm')}Yeni sənəd</a>` : ''}`,
    onRow: (d) => go('reyestr/' + d.id), emptyText: 'Reyestr boşdur. «Yeni sənəd» və ya «Excel-dən idxal» ilə başlayın.',
    columns: [
      { label: 'Nömrə', sort: 'no', cls: 'nw', render: (d) => h`<b class="mono">${d.doc_no}</b><br><span class="muted" style="font-size:12.5px">${d.doc_type}</span>` },
      { label: 'Tarix', sort: 'date', cls: 'nw', render: (d) => fmtDate(d.doc_date) },
      { label: 'Alan tərəf', sort: 'party', render: (d) => h`${d.party || h`<span class="muted">—</span>`}${d.employee_name && d.employee_name !== d.party ? h`<br><span class="muted" style="font-size:12.5px">${d.employee_name}</span>` : ''}` },
      { label: 'Mövzu', render: (d) => h`<span class="clip">${d.subject || '—'}</span>` },
      { label: 'Status', sort: 'status', cls: 'nw', render: (d) => (d.status ? chip(d.status, d.status === META.cancelled_status ? 'grey' : 'blue') : '—') },
      { label: 'Cavab', cls: 'nw', render: (d) => (d.response_label ? chip(d.response_label, RESP_COLOR[d.response_state]) : '') },
      { label: 'Məbləğ', sort: 'amount', cls: 'num nw', render: (d) => (d.amount ? h`${money(d.amount, d.currency)}<br>${chip(d.pay_label, PAY_COLOR[d.pay_state])}` : h`<span class="muted">—</span>`) },
      { label: 'Skan', cls: 'nw', render: (d) => (d.files_count ? h`<span class="row nowrap" title="${d.files_count} fayl">${icon('file', 'sm')}${d.files_count}</span>` : h`<span class="muted" title="Skan yoxdur">—</span>`) }],
  });
  view.addEventListener('click', (e) => {
    const q = e.target.closest('[data-quick]');
    if (!q) return;
    e.preventDefault();
    const sel = $(`#f-registry-${q.dataset.quick === 'waiting' ? 'response' : 'pay'}`);
    if (sel) { sel.value = q.dataset.quick === 'waiting' ? 'waiting' : 'unpaid'; sel.dispatchEvent(new Event('change', { bubbles: true })); $('#regT').scrollIntoView({ behavior: 'smooth' }); }
  });
  const reload = () => { table.reload(); drawSummary(); };
  if ($('#regImp')) $('#regImp').addEventListener('click', () => importDialog(reload));
  if ($('#regScans')) $('#regScans').addEventListener('click', () => scansDialog(reload));
}

function importDialog(after) {
  modal((dlg, close) => {
    setHTML(dlg, h`<form novalidate><div class="modal-h"><h2>Excel-dən idxal</h2></div><div class="modal-b" style="display:grid;gap:12px">
      <p class="muted" style="font-size:13.5px">Şirkətin Excel reyestrini (Sened_Reyestri.xlsx) seçin. Əvvəlcə nəyin əlavə olunacağı göstərilir — təsdiq etməsəniz heç nə dəyişmir. Paneldə artıq olan nömrələr təkrar əlavə olunmur. «Alan tərəf»dən kontragentlər, «Əmr»lərdən əməkdaşlar avtomatik yaradılır.</p>
      <label class="field"><span>Excel faylı (.xlsx) *</span><input class="in" type="file" name="file" accept=".xlsx"></label>
      <div id="impRes"></div><p class="ferr" hidden></p></div>
      <div class="modal-f"><button type="button" class="btn" data-x>Bağla</button><button type="button" class="btn" id="impPrev">${icon('eye', 'sm')}Yoxla</button><button type="button" class="btn pri" id="impGo" disabled>${icon('check', 'sm')}İdxal et</button></div></form>`);
    const f = $('form', dlg), er = $('.ferr', dlg), res = $('#impRes', dlg);
    const fail = (m) => { er.textContent = m; er.hidden = false; };
    const send = async (mode) => uploadOne('/api/registry/import', f.file.files[0], { mode });
    $('[data-x]', dlg).addEventListener('click', () => close());
    f.file.addEventListener('change', () => { $('#impGo', dlg).disabled = true; setHTML(res, ''); });
    const show = (r, done) => setHTML(res, h`<div class="note ${r.skip && !done ? 'warn' : ''}">${icon(done ? 'check' : 'info')}<span>${done ? h`<b>${r.add} sənəd əlavə edildi.</b>` : h`«${r.sheet}» vərəqində ${r.total} sətir: <b>${r.add} əlavə olunacaq</b>, ${r.skip} buraxılacaq.`}</span></div>
      ${r.new_counterparties.length ? h`<p style="font-size:13.5px"><b>Yeni kontragentlər (${r.new_counterparties.length}):</b> ${r.new_counterparties.join(', ')}</p>` : ''}
      ${r.new_employees.length ? h`<p style="font-size:13.5px"><b>Yeni əməkdaşlar:</b> ${r.new_employees.join(', ')}</p>` : ''}
      ${r.new_types.length ? h`<p style="font-size:13.5px"><b>Yeni sənəd növləri:</b> ${r.new_types.map((t) => `${t.name} (${t.index})`).join(', ')}</p>` : ''}
      ${r.warnings.length ? h`<ul class="muted" style="font-size:13px;padding-left:18px">${r.warnings.map((w) => h`<li>${w}</li>`)}</ul>` : ''}
      <div class="tw" style="max-height:260px;overflow:auto"><table class="tview"><thead><tr><th>Sətir</th><th>Nömrə</th><th>Tarix</th><th>Növ</th><th>Alan tərəf</th><th></th></tr></thead><tbody>
      ${r.items.map((x) => h`<tr><td>${x.line}</td><td class="mono">${x.doc_no || 'avtomatik'}</td><td class="nw">${x.doc_date ? fmtDate(x.doc_date) : '—'}</td><td>${x.doc_type}</td><td>${x.party}</td><td>${x.action === 'add' ? chip(done ? 'Əlavə edildi' : 'Əlavə olunacaq', 'green') : chip(x.reason, 'grey')}</td></tr>`)}</tbody></table></div>`);
    $('#impPrev', dlg).addEventListener('click', async () => {
      er.hidden = true;
      if (!f.file.files[0]) return fail('Excel faylını seçin');
      try { const r = await send('preview'); show(r, false); $('#impGo', dlg).disabled = !r.add; } catch (x) { fail(x.message); }
    });
    $('#impGo', dlg).addEventListener('click', async (e) => {
      e.target.disabled = true; er.hidden = true;
      try { const r = await send('commit'); show(r, true); toast(`${r.add} sənəd idxal edildi`, 'ok'); await meta(true); after(); } catch (x) { fail(x.message); e.target.disabled = false; }
    });
  }, { wide: true, label: 'Excel-dən idxal' });
}

function scansDialog(after) {
  modal((dlg, close) => {
    setHTML(dlg, h`<div class="modal-h"><h2>Skanları toplu yüklə</h2></div><div class="modal-b" style="display:grid;gap:12px">
      <p class="muted" style="font-size:13.5px">Faylın adı sənədin nömrəsi olmalıdır. «/» fayl adında yazıla bilmədiyi üçün onun yerinə «-» və ya «_» yazın: <b>P-004/10-26</b> → <span class="mono">P-004-10-26.pdf</span> (və ya <span class="mono">P-004_10-26.pdf</span>). Fayl avtomatik həmin sənədə əlavə olunur; uyğun nömrə tapılmasa, yüklənmir və siyahıda göstərilir. PDF, JPG, PNG; çoxsəhifəli PDF də olar.</p>
      <label class="btn pri" style="justify-self:start">${icon('upload', 'sm')}Faylları seçin<input type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png" id="scIn"></label>
      <ul class="flist" id="scRes"></ul></div><div class="modal-f"><button type="button" class="btn" data-x>Bağla</button></div>`);
    $('[data-x]', dlg).addEventListener('click', () => close());
    $('#scIn', dlg).addEventListener('change', async (e) => {
      const list = $('#scRes', dlg), picked = [...e.target.files];
      let ok = 0;
      for (const file of picked) {
        const li = document.createElement('li'); setHTML(li, h`<span class="fn"><b>${file.name}</b><span class="muted">yüklənir…</span></span>`); list.append(li);
        try { const r = await uploadOne('/api/registry/scans', file); ok++; setHTML(li, h`<span class="fn"><b>${file.name}</b><span>→ <a href="#/reyestr/${r.id}">${r.doc_no}</a></span></span>${chip('Əlavə edildi', 'green')}`); }
        catch (x) { setHTML(li, h`<span class="fn"><b>${file.name}</b><span class="muted">${x.message}</span></span>${chip('Yüklənmədi', 'red')}`); }
      }
      e.target.value = '';
      toast(`${ok}/${picked.length} skan əlavə edildi`, ok === picked.length ? 'ok' : 'error');
      after();
    });
  }, { wide: true, label: 'Skanları toplu yüklə' });
}

async function docPage(view, id) {
  const isNew = id === 'yeni';
  const L = META.lists;
  const data = isNew ? null : await api.get(`/api/registry/${encodeURIComponent(id)}/details`);
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const d = data ? data.item : { doc_date: todayBaku(), doc_type: params.get('type') || (L.doc_types[0] ? L.doc_types[0].name : ''), employee_id: params.get('employee') || '', status: L.statuses[0] || '', executor: L.executors[0] || '', currency: 'AZN' };
  const edit = can('registry.edit');
  const opt = (arr, cur) => { const o = arr.map((x) => [x, x]); if (cur && !arr.includes(cur)) o.unshift([cur, cur]); return [['', '—'], ...o]; };
  setHTML(view, h`${backLink('reyestr', 'Sənəd reyestri')}<div class="row" style="justify-content:space-between;flex-wrap:wrap"><h2 class="ptitle">${isNew ? 'Yeni sənəd' : h`<span class="mono">${d.doc_no}</span> · ${d.doc_type}`}</h2>
    <span class="row">${!isNew && d.amount ? chip(d.pay_label, PAY_COLOR[d.pay_state]) : ''}${!isNew && d.response_label ? chip(d.response_label, RESP_COLOR[d.response_state]) : ''}
    ${!isNew ? pdfBtn('docPdf', 'Qeydiyyat kartı (PDF)') : ''}${!isNew && can('registry.delete') ? h`<button class="btn sm ghost danger" id="docDel">${icon('trash', 'sm')}Sil</button>` : ''}</span></div>
    <div class="grid g21"><div id="docF"></div><div class="grid" style="align-content:start"><div id="docFiles"></div><div id="docPay"></div></div></div>`);
  const typeOpts = L.doc_types.map((t) => [t.name, `${t.name} (${t.index})`]);
  if (d.doc_type && !L.doc_types.some((t) => t.name === d.doc_type)) typeOpts.unshift([d.doc_type, d.doc_type]);
  const empOpts = () => [['', '— seçin —'], ...META.employees.map((e) => [e.id, empLabel(e)])];
  const values = { ...d, amount: moneyIn(d.amount), vat_amount: moneyIn(d.vat_amount), counterparty_id: d.counterparty_id || '', employee_id: d.employee_id || '' };
  let pending = []; // scans chosen for a new document, uploaded right after it is saved
  const form = buildForm($('#docF'), { values, readonly: !edit, cancelHref: '#/reyestr', submitLabel: isNew ? 'Qeydə al' : 'Yadda saxla',
    sections: [
      { title: 'Sənəd', fields: [
        { name: 'doc_date', label: 'Tarix', type: 'date', required: true }, { name: 'doc_type', label: 'Sənəd növü', type: 'select', options: typeOpts, required: true },
        { name: 'doc_no', label: 'Qeydiyyat nömrəsi', mono: true, max: 40, help: isNew ? 'Boş qalsa, avtomatik verilir. P-004-10-26 kimi yazsanız da, P-004/10-26 kimi saxlanılır.' : 'Nömrə dəyişmir. Silsəniz, yeni nömrə avtomatik veriləcək.' },
        { name: 'counterparty_id', label: 'Alan təşkilat (kontragent)', type: 'select', options: [['', '— siyahıdan seçin —'], ...META.counterparties.map((c) => [c.id, c.name])], help: 'Siyahıda yoxdursa, «Kontragentlər» bölməsində əlavə edin və ya aşağıda adını yazın' },
        { name: 'employee_id', label: 'Alan şəxs (əməkdaş)', type: 'select', options: empOpts() },
        { name: 'recipient', label: 'Alan tərəf (sərbəst mətn)', max: 200, help: 'Siyahıda olmayan təşkilat və ya şəxs üçün' },
        { name: 'email', label: 'E-poçt ünvanı', type: 'email', max: 254 }, { name: 'phone', label: 'Əlaqə nömrəsi', type: 'tel', max: 60 },
        { name: 'subject', label: 'Mövzu / qısa məzmun', type: 'textarea', rows: 2, full: true, max: 1000 },
        { name: 'executor', label: 'İcraçı', max: 80, list: L.executors }] },
      { title: 'Göndəriş və status', fields: [
        { name: 'send_method', label: 'Göndərilmə üsulu', type: 'select', options: opt(L.send_methods, d.send_method) }, { name: 'sent_date', label: 'Göndərilmə tarixi', type: 'date' },
        { name: 'status', label: 'Status', type: 'select', options: opt(L.statuses, d.status), help: `«${META.cancelled_status}» statusu sənədi cavab və ödəniş izləməsindən çıxarır` }] },
      { title: 'Cavab', fields: [
        { name: 'response_required', label: 'Cavab tələb olunur', type: 'checkbox', full: true }, { name: 'response_date', label: 'Cavab tarixi', type: 'date' },
        { name: 'response_no', label: 'Cavab nömrəsi', max: 60 }, { name: 'response_summary', label: 'Cavabın qısa məzmunu', type: 'textarea', rows: 2, full: true, max: 2000 },
        { name: 'result', label: 'Nəticə', type: 'select', options: opt(L.results, d.result) }] },
      { title: 'Məbləğ və ödəniş', sub: 'Ödənişi gözlənilən sənəddə (hesab-faktura, müqavilə) doldurun — ödənişlər «Gəlir və xərc»də bu sənədə bağlanır', fields: [
        { name: 'amount', label: 'Ümumi məbləğ (ƏDV daxil)', max: 20, placeholder: '0,00' }, { name: 'vat_amount', label: 'O cümlədən ƏDV', max: 20, placeholder: '0,00' },
        { name: 'currency', label: 'Valyuta', type: 'select', options: META.currencies.map((c) => [c, c]) }, { name: 'due_date', label: 'Ödəniş müddəti', type: 'date' }] },
      { title: 'Qeyd', fields: [{ name: 'note', label: 'Qeyd', type: 'textarea', rows: 3, full: true, max: 4000 }] }],
    onSubmit: async (v) => {
      const body = { ...v, counterparty_id: v.counterparty_id ? Number(v.counterparty_id) : null, employee_id: v.employee_id ? Number(v.employee_id) : null };
      if (isNew) {
        const r = await api.post('/api/registry', body);
        let failed = 0;
        for (const file of pending) { try { await uploadOne(`/api/office/files/doc/${r.item.id}`, file, { category: 'scan' }); } catch { failed++; } }
        toast(`Qeydə alındı: ${r.item.doc_no}${pending.length ? ` · ${pending.length - failed} skan əlavə edildi` : ''}`, failed ? 'error' : 'ok');
        go('reyestr/' + r.item.id);
      } else { await api.put(`/api/registry/${d.id}`, body); toast('Yadda saxlanıldı', 'ok'); registry(view, [String(d.id)]); }
    } });
  const f = form.form;
  const el = (n) => $(`[data-f="${n}"]`, f);
  const wrap = (n) => el(n).closest('.field').parentElement;
  // the employee's position under the selection; "+ Yeni əməkdaş" next to it
  const empSmall = document.createElement('small');
  el('employee_id').after(empSmall);
  const showPos = () => { const e = META.employees.find((x) => String(x.id) === el('employee_id').value); empSmall.textContent = e ? `Vəzifə: ${e.position || 'göstərilməyib'}` : 'Kadrlar bazasından seçin'; };
  if (edit && META.can.hr_edit) {
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'btn sm'; add.style.justifySelf = 'start';
    setHTML(add, h`${icon('plus', 'sm')}Yeni əməkdaş`);
    empSmall.after(add);
    add.addEventListener('click', async () => {
      const emp = await quickEmployee();
      if (!emp) return;
      await meta(true);
      setHTML(el('employee_id'), h`${empOpts().map((o) => h`<option value="${o[0]}">${o[1]}</option>`)}`);
      el('employee_id').value = String(emp.id); showPos();
    });
  }
  el('employee_id').addEventListener('change', showPos); showPos();
  // Orders concern an employee only: the organisation field is hidden for them.
  const numHint = document.createElement('small');
  el('doc_no').closest('.field').append(numHint);
  const syncType = async () => {
    const order = el('doc_type').value === META.order_type;
    wrap('counterparty_id').hidden = order;
    $('label', el('employee_id').closest('.field')).textContent = order ? 'Əməkdaş (əmrin aid olduğu şəxs)' : 'Alan şəxs (əməkdaş)';
    if (isNew && edit) {
      try { const r = await api.get('/api/registry/next-number' + qs({ type: el('doc_type').value, date: el('doc_date').value })); el('doc_no').placeholder = r.number ? `avtomatik: ${r.number}` : ''; } catch { /* ignore */ }
    }
  };
  // Typed number: official form, file-name form and whether it is free.
  let tm;
  const checkNo = () => {
    clearTimeout(tm);
    tm = setTimeout(async () => {
      const val = el('doc_no').value.trim();
      if (!val) { numHint.textContent = ''; return; }
      try {
        const r = await api.get('/api/registry/check-number' + qs({ no: val, except: isNew ? '' : d.id }));
        numHint.className = r.taken ? 'ferr' : 'muted';
        numHint.textContent = r.taken ? `${r.number} artıq başqa sənəddədir` : `Rəsmi nömrə: ${r.number} · fayl adı: ${r.file_name}.pdf`;
      } catch { /* ignore */ }
    }, 300);
  };
  el('doc_no').addEventListener('input', checkNo); checkNo();
  el('doc_type').addEventListener('change', syncType); el('doc_date').addEventListener('change', syncType);
  el('amount').setAttribute('inputmode', 'decimal'); el('vat_amount').setAttribute('inputmode', 'decimal');
  syncType();
  if (isNew) {
    if (!edit) return;
    // scans can be chosen together with the new document
    const drawPending = () => setHTML($('#docFiles'), h`<section class="card"><div class="card-h"><div><h2>Skan</h2><p>PDF, JPG, PNG · bir neçə fayl və ya çoxsəhifəli PDF · ən çox ${META.max_mb} MB</p></div></div><div class="card-b" style="display:grid;gap:10px">
      ${pending.length ? h`<ul class="flist">${pending.map((p, i) => h`<li><span class="ft">${p.name.split('.').pop().toUpperCase()}</span><span class="fn"><b>${p.name}</b><span class="muted">${fmtSize(p.size)} · sənəd qeydə alınanda yüklənəcək</span></span><button type="button" class="iconbtn" data-prm="${i}" aria-label="Çıxar" title="Çıxar">${icon('x')}</button></li>`)}</ul>` : h`<p class="muted">Skan seçilməyib (sonra da əlavə etmək olar).</p>`}
      <label class="btn sm" style="justify-self:start">${icon('upload', 'sm')}Skan seçin<input type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png" id="pendIn"></label></div></section>`);
    drawPending();
    $('#docFiles').addEventListener('change', (e) => {
      if (e.target.id !== 'pendIn') return;
      for (const file of e.target.files) {
        if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) { toast(`${file.name}: yalnız PDF, JPG, PNG`, 'error'); continue; }
        if (file.size > META.max_mb * 1048576) { toast(`${file.name}: fayl çox böyükdür (ən çox ${META.max_mb} MB)`, 'error'); continue; }
        pending.push(file);
      }
      drawPending();
    });
    $('#docFiles').addEventListener('click', (e) => { const b = e.target.closest('[data-prm]'); if (b) { pending.splice(Number(b.dataset.prm), 1); drawPending(); } });
    return;
  }
  $('#docPdf').addEventListener('click', () => openPdf(`/api/registry/${d.id}/pdf`));
  filesCard($('#docFiles'), { type: 'doc', id: d.id, files: data.files, editable: edit, title: 'Skan və əlavələr', downloadBase: fileKey(d.doc_no),
    hint: `Rəsmi nömrə ${d.doc_no}; yüklənən fayl ${fileKey(d.doc_no)}.pdf adı ilə saxlanılır · PDF, JPG, PNG` });
  if (data.payments && d.amount) {
    setHTML($('#docPay'), h`<section class="card"><div class="card-h"><div><h2>Ödənişlər</h2><p>Məbləğ ${money(d.amount, d.currency)} · ödənilib ${money(d.paid, d.currency)} · qalıq <b>${money(d.debt, d.currency)}</b></p></div></div>
      <div class="card-b" style="display:grid;gap:10px">${data.payments.length ? h`<ul class="flist">${data.payments.map((p) => h`<li><span class="fn"><b>${money(p.amount, d.currency)}</b><span class="muted">${fmtDate(p.entry_date)} · ${p.method_label}${p.status === 'approved' ? ' · təsdiqlənib' : ''}${p.description ? ' · ' + p.description : ''}</span></span><a class="iconbtn" href="#/gelir-xerc/${p.id}" title="Aç" aria-label="Aç">${icon('edit')}</a></li>`)}</ul>` : h`<p class="muted">Hələ ödəniş qeydə alınmayıb.</p>`}
      ${can('finance.edit') && d.debt > 0 ? h`<button class="btn sm pri" id="payAdd" style="justify-self:start">${icon('plus', 'sm')}Ödəniş qeydə al</button>` : ''}</div></section>`);
    const pa = $('#payAdd');
    if (pa) pa.addEventListener('click', async () => {
      const r = await promptDialog({ title: `Ödəniş — ${d.doc_no}`, ok: 'Qeydə al', fields: [{ name: 'entry_date', label: 'Tarix', type: 'date', value: todayBaku(), required: true }, { name: 'amount', label: `Məbləğ (${d.currency})`, value: moneyIn(d.debt), required: true },
        { name: 'method', label: 'Üsul', type: 'select', options: Object.entries(META.methods), value: 'bank' }, { name: 'category', label: 'Kateqoriya', type: 'select', options: META.lists.income_categories.map((c) => [c, c]), value: META.lists.income_categories[0] }, { name: 'description', label: 'Təsvir' }],
      submit: (v) => api.post('/api/ledger', { ...v, kind: 'income', doc_id: d.id, currency: d.currency, allow_duplicate: true }) });
      if (r) { toast('Ödəniş qeydə alındı', 'ok'); registry(view, [String(d.id)]); }
    });
  }
  const del = $('#docDel');
  if (del) del.addEventListener('click', () => delAction(`/api/registry/${d.id}`, `${d.doc_no} sənədi və onun skanları silinəcək. Bu nömrə yenidən istifadə oluna bilər.`, () => go('reyestr')));
}

async function listsPage(view) {
  const L = META.lists, edit = can('registry.edit');
  setHTML(view, h`${backLink('reyestr', 'Sənəd reyestri')}<h2 class="ptitle">Reyestr və mühasibatlıq siyahıları</h2>
    <div class="note">${icon('info')}<span>Bu siyahılar formalardakı seçimlərdir. Növün <b>indeksi</b> nömrənin əvvəlidir (AE-001/09-26); indeksi dəyişsəniz, yalnız yeni sənədlər yeni indekslə nömrələnir. Növün adını dəyişsəniz, köhnə sənədlər köhnə adla qalır. «${META.order_type}» növü əməkdaşa bağlanır, «${META.cancelled_status}» statusu sənədi izləmədən çıxarır — bu iki adı dəyişməyin.</span></div><div id="lf"></div>`);
  const one = (name, label, add) => ({ name, label, type: 'rows', full: true, columns: [{ key: '', label }], addLabel: add });
  buildForm($('#lf'), { values: L, readonly: !edit, sections: [
    { title: 'Sənəd növləri', fields: [{ name: 'doc_types', label: 'Növ və indeks', type: 'rows', full: true, columns: [{ key: 'name', label: 'Növ' }, { key: 'index', label: 'İndeks (məs. AE)', width: '160px' }], addLabel: 'Növ əlavə et' }] },
    { title: 'Reyestr', fields: [one('statuses', 'Status', 'Status əlavə et'), one('send_methods', 'Göndərilmə üsulu', 'Üsul əlavə et'), one('results', 'Nəticə', 'Nəticə əlavə et'), one('executors', 'İcraçı', 'İcraçı əlavə et')] },
    { title: 'Gəlir və xərc kateqoriyaları', fields: [one('income_categories', 'Gəlir kateqoriyası', 'Kateqoriya əlavə et'), one('expense_categories', 'Xərc kateqoriyası', 'Kateqoriya əlavə et')] }],
  onSubmit: async (v) => {
    v.doc_types = (v.doc_types || []).map((t) => ({ name: t.name, index: String(t.index || '').toUpperCase() }));
    await api.put('/api/settings/office', v); await meta(true); toast('Siyahılar yadda saxlanıldı', 'ok');
  } });
}

/* ================================================================== counterparties */
const cpFields = [{ title: 'Kontragent', fields: [
  { name: 'name', label: 'Adı', required: true, full: true, max: 200 }, { name: 'kind', label: 'Növ', type: 'select', options: [] }, { name: 'tax_id', label: 'VÖEN', max: 20, mono: true },
  { name: 'legal_address', label: 'Hüquqi ünvan', full: true, max: 300 }, { name: 'contact_person', label: 'Əlaqə şəxsi', max: 150 }, { name: 'phone', label: 'Telefon', type: 'tel', max: 60 }, { name: 'email', label: 'E-poçt', type: 'email', max: 254 },
  { name: 'is_active', label: 'Aktiv (formalarda siyahıda görünür)', type: 'checkbox', full: true }] },
{ title: 'Bank rekvizitləri', fields: [{ name: 'bank_name', label: 'Bank', max: 150 }, { name: 'bank_account', label: 'Hesab (IBAN)', max: 40, mono: true }, { name: 'bank_code', label: 'Bank kodu', max: 20, mono: true }, { name: 'swift', label: 'SWIFT', max: 20, mono: true }] },
{ title: 'Qeyd', fields: [{ name: 'notes', label: 'Qeyd', type: 'textarea', rows: 3, full: true, max: 4000 }] }];

async function counterparties(view, args) {
  await meta(true);
  const kinds = Object.entries(META.cp_kinds);
  cpFields[0].fields[1].options = kinds;
  if (args[0]) return cpPage(view, args[0]);
  setHTML(view, h`<section class="card" id="cpT"></section>`);
  dataTable($('#cpT'), { id: 'cps', url: '/api/counterparties', sort: 'name', exportUrl: '/api/counterparties/export', perPage: 25, searchPlaceholder: 'Ad, VÖEN, əlaqə şəxsi…',
    filters: [{ key: 'kind', label: 'Növ', options: kinds }, { key: 'active', label: 'Vəziyyət', options: [['1', 'Aktiv'], ['0', 'Aktiv deyil']] }],
    extra: can('finance.edit') ? h`<a class="btn sm pri" href="#/kontragentler/yeni">${icon('plus', 'sm')}Yeni kontragent</a>` : '',
    onRow: (c) => go('kontragentler/' + c.id), emptyText: 'Hələ kontragent yoxdur',
    columns: [{ label: 'Ad', sort: 'name', render: (c) => h`<b class="t">${c.name}</b>${c.is_active ? '' : h` ${chip('aktiv deyil', 'grey')}`}` }, { label: 'Növ', sort: 'kind', cls: 'nw', key: 'kind_label' },
      { label: 'VÖEN', cls: 'mono nw', render: (c) => c.tax_id || '—' }, { label: 'Əlaqə', render: (c) => h`${c.contact_person || ''}${c.contact_person && (c.phone || c.email) ? h`<br>` : ''}<span class="muted">${[c.phone, c.email].filter(Boolean).join(' · ')}</span>` }] });
}
async function cpPage(view, id) {
  const isNew = id === 'yeni';
  const data = isNew ? null : await api.get(`/api/counterparties/${encodeURIComponent(id)}/details`);
  const c = data ? data.item : { kind: 'client', is_active: 1 };
  const edit = can('finance.edit');
  setHTML(view, h`${backLink('kontragentler', 'Kontragentlər')}<div class="row" style="justify-content:space-between;flex-wrap:wrap"><h2 class="ptitle">${isNew ? 'Yeni kontragent' : c.name}</h2>
    <span class="row">${!isNew ? pdfBtn('cpPdf', 'Hesablaşma (PDF)') : ''}${!isNew && can('finance.delete') ? h`<button class="btn sm ghost danger" id="cpDel">${icon('trash', 'sm')}Sil</button>` : ''}</span></div>
    ${data ? h`<div class="kpis three"><div class="card kpi"><div class="kl">${icon('file')}<span>Hesablanıb (sənədlər üzrə)</span></div><div class="kv sm">${money(data.totals.invoiced)}</div></div>
      <div class="card kpi"><div class="kl">${icon('check')}<span>Ödənilib</span></div><div class="kv sm">${money(data.totals.paid)}</div></div>
      <div class="card kpi"><div class="kl">${icon('alert')}<span>Borc qalığı</span></div><div class="kv sm">${money(data.totals.debt)}</div></div></div>` : ''}
    <div id="cpF"></div><div id="cpRel" class="grid"></div>`);
  buildForm($('#cpF'), { values: c, readonly: !edit, cancelHref: '#/kontragentler', sections: cpFields,
    onSubmit: async (v) => { if (isNew) { const r = await api.post('/api/counterparties', v); toast('Kontragent əlavə edildi', 'ok'); go('kontragentler/' + r.item.id); } else { await api.put(`/api/counterparties/${c.id}`, v); toast('Yadda saxlanıldı', 'ok'); } } });
  if (data) {
    $('#cpPdf').addEventListener('click', () => openPdf(`/api/counterparties/${c.id}/pdf`));
    setHTML($('#cpRel'), h`<section class="card"><div class="card-h"><h2>Sənədlər (${data.docs.length})</h2></div>${data.docs.length ? tableView(['Nömrə', 'Tarix', 'Mövzu', 'Məbləğ', 'Ödəniş'], data.docs.map((d) => [h`<a class="mono" href="#/reyestr/${d.id}">${d.doc_no}</a>`, fmtDate(d.doc_date), d.subject || '—', d.amount ? money(d.amount, d.currency) : '—', d.pay_label ? chip(d.pay_label, PAY_COLOR[d.pay_state]) : '—'])) : h`<div class="empty">Sənəd yoxdur</div>`}</section>
      <section class="card"><div class="card-h"><h2>Gəlir və xərclər (${data.ledger.length})</h2></div>${data.ledger.length ? tableView(['Tarix', 'Növ', 'Məbləğ', 'Sənəd', 'Təsvir'], data.ledger.map((l) => [h`<a href="#/gelir-xerc/${l.id}">${fmtDate(l.entry_date)}</a>`, l.kind_label, money(l.amount, l.currency), l.doc_no || '—', l.description || '—'])) : h`<div class="empty">Qeyd yoxdur</div>`}</section>`);
  }
  const del = $('#cpDel');
  if (del) del.addEventListener('click', () => delAction(`/api/counterparties/${c.id}`, `«${c.name}» silinəcək.`, () => go('kontragentler')));
}

/* ================================================================== income / expense */
async function ledger(view, args) {
  await meta(true);
  if (args[0]) return ledgerPage(view, args[0]);
  const L = META.lists;
  let year = Number(todayBaku().slice(0, 4));
  setHTML(view, h`<div id="finSum" class="grid"></div><section class="card" id="lgT"></section>`);
  const drawSummary = async () => {
    const s = await api.get('/api/finance/summary' + qs({ year }));
    const t = s.totals;
    setHTML($('#finSum'), h`<div class="kpis">
        <div class="card kpi"><div class="kl">${icon('down')}<span>Gəlir (${s.year})</span></div><div class="kv sm">${money(t.income)}</div><div class="kd">dövriyyə ${money(t.turnover)}</div></div>
        <div class="card kpi"><div class="kl">${icon('up')}<span>Xərc (${s.year})</span></div><div class="kv sm">${money(t.expense)}</div><div class="kd">əmək haqqı fondu ${money(t.payroll)}</div></div>
        <div class="card kpi"><div class="kl">${icon('chart')}<span>Qalıq</span></div><div class="kv sm">${money(t.closing)}</div><div class="kd">ilin əvvəlinə ${money(s.opening)} · fərq ${money(t.balance)}</div></div>
        <div class="card kpi"><div class="kl">${icon('check')}<span>Təsdiq gözləyir</span></div><div class="kv">${s.pending}</div><div class="kd">${s.year}-ci il əməliyyatları</div></div></div>
      ${chartCard('finChart', 'Aylar üzrə gəlir və xərc', `${s.year}, AZN · «Cədvəl» — qalıq və dövriyyə`, { legend: [['Gəlir', 'var(--k-green)'], ['Xərc', 'var(--k-red)']], controls: h`<label class="sr" for="finYear">İl</label><select class="in" id="finYear" style="width:auto">${s.years.map((y) => h`<option ${y === s.year ? raw('selected') : ''}>${y}</option>`)}</select>${pdfBtn('finPdf', 'Hesabat (PDF)')}` })}
      <div class="grid g2"><section class="card"><div class="card-h"><div><h2>Debitor borclar</h2><p>Ödənilməmiş sənədlər (kontragent üzrə)</p></div></div>${s.receivables.length ? tableView(['Kontragent', 'Sənəd', 'Qalıq'], s.receivables.map((r) => [h`${r.cp_name}${r.overdue ? h` ${chip('müddəti keçib', 'red')}` : ''}`, r.n, money(r.debt, r.currency)])) : h`<div class="empty">Borc yoxdur</div>`}</section>
        <section class="card"><div class="card-h"><div><h2>Kateqoriyalar üzrə</h2><p>${s.year}, AZN</p></div></div>${s.categories.length ? tableView(['Kateqoriya', 'Növ', 'Məbləğ'], s.categories.map((c) => [c.category || '(kateqoriyasız)', c.kind_label, money(c.s)])) : h`<div class="empty">Qeyd yoxdur</div>`}
        ${s.other_currencies.length ? h`<p class="muted" style="padding:10px 16px;font-size:13px">Digər valyutalar: ${s.other_currencies.map((o) => `${o.kind === 'income' ? 'gəlir' : 'xərc'} ${money(o.s, o.currency)}`).join(' · ')}</p>` : ''}</section></div>`);
    groupBars($('#finChart'), MONTHS, [{ name: 'Gəlir', color: 'var(--k-green)', values: s.months.map((m) => m.income) }, { name: 'Xərc', color: 'var(--k-red)', values: s.months.map((m) => m.expense) }]);
    setHTML($('#finChart-t'), tableView(['Ay', 'Ayın əvvəlinə qalıq', 'Gəlir', 'Xərc', 'Dövriyyə', 'Ayın sonuna qalıq', 'Əmək haqqı fondu'], s.months.map((m, i) => [MONTHS_FULL[i], money(m.opening), money(m.income), money(m.expense), money(m.turnover), money(m.closing), money(m.payroll)])));
    $('#finYear').onchange = (e) => { year = Number(e.target.value); drawSummary(); };
    $('#finPdf').onclick = () => openPdf('/api/finance/summary/pdf' + qs({ year }));
  };
  await drawSummary();
  const cats = [...L.income_categories, ...L.expense_categories];
  dataTable($('#lgT'), { id: 'ledger', url: '/api/ledger', sort: '-date', dateRange: true, exportUrl: '/api/ledger/export', perPage: 25, searchPlaceholder: 'Təsvir, kontragent, sənəd nömrəsi…',
    filters: [{ key: 'kind', label: 'Növ', options: Object.entries(META.kinds) }, { key: 'category', label: 'Kateqoriya', options: cats.map((c) => [c, c]) }, { key: 'method', label: 'Üsul', options: Object.entries(META.methods) },
      { key: 'status', label: 'Təsdiq', options: Object.entries(META.ledger_status) }],
    extra: can('finance.edit') ? h`<a class="btn sm" href="#/gelir-xerc/yeni-xerc">${icon('plus', 'sm')}Xərc</a><a class="btn sm pri" href="#/gelir-xerc/yeni-gelir">${icon('plus', 'sm')}Gəlir</a>` : '',
    onRow: (l) => go('gelir-xerc/' + l.id), emptyText: 'Hələ qeyd yoxdur',
    columns: [{ label: 'Tarix', sort: 'date', cls: 'nw', render: (l) => fmtDate(l.entry_date) }, { label: 'Növ', cls: 'nw', render: (l) => chip(l.kind_label, l.kind === 'income' ? 'green' : 'red') },
      { label: 'Kateqoriya', sort: 'category', render: (l) => l.category || '—' }, { label: 'Kontragent', sort: 'party', render: (l) => l.cp_name || '—' },
      { label: 'Sənəd', cls: 'nw mono', render: (l) => (l.doc_no ? h`<a href="#/reyestr/${l.doc_id}">${l.doc_no}</a>` : '—') }, { label: 'Təsvir', render: (l) => h`<span class="clip">${l.description || '—'}</span>` },
      { label: 'Məbləğ', sort: 'amount', cls: 'num nw', render: (l) => h`<b>${l.kind === 'expense' ? '−' : ''}${money(l.amount, l.currency)}</b>` },
      { label: 'Təsdiq', sort: 'status', cls: 'nw', render: (l) => chip(l.status === 'approved' ? 'Təsdiqlənib' : 'Gözləyir', l.status === 'approved' ? 'green' : 'amber') },
      { label: '', cls: 'nw', render: (l) => (l.files_count ? h`<span title="Qəbz əlavə edilib">${icon('file', 'sm')}</span>` : h`<span class="muted" title="Qəbz yoxdur">—</span>`) }] });
}
async function ledgerPage(view, id) {
  const isNew = /^yeni/.test(id);
  const data = isNew ? null : await api.get(`/api/ledger/${encodeURIComponent(id)}/details`);
  const L = META.lists;
  const l = data ? data.item : { entry_date: todayBaku(), kind: id === 'yeni-gelir' ? 'income' : 'expense', method: 'bank', currency: 'AZN' };
  const edit = can('finance.edit');
  setHTML(view, h`${backLink('gelir-xerc', 'Gəlir və xərc')}<div class="row" style="justify-content:space-between;flex-wrap:wrap"><h2 class="ptitle">${isNew ? (l.kind === 'income' ? 'Yeni gəlir' : 'Yeni xərc') : `${l.kind_label}: ${money(l.amount, l.currency)}`}</h2>
    <span class="row">${!isNew ? chip(l.status_label, l.status === 'approved' ? 'green' : 'amber') : ''}${!isNew && data.can_approve ? h`<button class="btn sm ${l.status === 'approved' ? '' : 'pri'}" id="lgAppr">${icon('check', 'sm')}${l.status === 'approved' ? 'Təsdiqi ləğv et' : 'Təsdiq et'}</button>` : ''}
    ${!isNew ? pdfBtn('lgPdf', 'Qeyd (PDF)') : ''}${!isNew && can('finance.delete') ? h`<button class="btn sm ghost danger" id="lgDel">${icon('trash', 'sm')}Sil</button>` : ''}</span></div>
    <div class="grid g21"><div class="grid" style="align-content:start"><div id="lgF"></div><div id="lgDup"></div><div id="lgHist"></div></div><div id="lgFiles"></div></div>`);
  const catOpts = (kind) => { const arr = kind === 'income' ? L.income_categories : L.expense_categories; const o = arr.map((c) => [c, c]); if (l.category && !arr.includes(l.category)) o.unshift([l.category, l.category]); return [['', '—'], ...o]; };
  let pendingReceipts = [];
  const save = async (body, allowDuplicate) => {
    const b = { ...body, allow_duplicate: allowDuplicate };
    if (isNew) {
      const r = await api.post('/api/ledger', b);
      for (const file of pendingReceipts) { try { await uploadOne(`/api/office/files/ledger/${r.item.id}`, file, { category: 'receipt' }); } catch (er) { showError(er); } }
      toast('Qeydə alındı', 'ok'); go('gelir-xerc/' + r.item.id);
    } else { await api.put(`/api/ledger/${l.id}`, b); toast('Yadda saxlanıldı', 'ok'); go('gelir-xerc/' + l.id); ledger(view, [String(l.id)]); }
  };
  const form = buildForm($('#lgF'), { values: { ...l, amount: moneyIn(l.amount), vat_amount: moneyIn(l.vat_amount), counterparty_id: l.counterparty_id || '', doc_no: l.doc_no || '' }, readonly: !edit, cancelHref: '#/gelir-xerc',
    footerNote: !isNew && l.status === 'approved' ? 'Təsdiqlənmiş qeyd dəyişdirilsə, yenidən təsdiq tələb olunur.' : '',
    sections: [{ title: 'Əməliyyat', fields: [{ name: 'entry_date', label: 'Tarix', type: 'date', required: true }, { name: 'kind', label: 'Növ', type: 'select', options: Object.entries(META.kinds) },
      { name: 'amount', label: 'Məbləğ', required: true, max: 20, placeholder: '0,00' }, { name: 'vat_amount', label: 'O cümlədən ƏDV', max: 20, placeholder: '0,00' },
      { name: 'currency', label: 'Valyuta', type: 'select', options: META.currencies.map((c) => [c, c]) }, { name: 'method', label: 'Ödəniş üsulu', type: 'select', options: Object.entries(META.methods) },
      { name: 'category', label: 'Kateqoriya', type: 'select', options: catOpts(l.kind) },
      { name: 'counterparty_id', label: 'Qarşı tərəf (kontragent)', type: 'select', options: [['', '—'], ...META.counterparties.map((c) => [c.id, c.name])] },
      { name: 'doc_no', label: 'Müqavilə / hesab-faktura (reyestr nömrəsi)', mono: true, max: 40, placeholder: 'məs. H-003/10-26', help: 'Ödəniş bu sənədə bağlanır və sənədin ödəniş vəziyyəti yenilənir. P-004-10-26 yazılışı da qəbul olunur.' },
      { name: 'description', label: 'İzahat', type: 'textarea', rows: 2, full: true, max: 2000 }] }],
    onSubmit: async (v) => {
      const body = { ...v, counterparty_id: v.counterparty_id ? Number(v.counterparty_id) : null };
      try { await save(body, false); }
      catch (er) {
        if (er.code !== 'duplicate') throw er;
        if (await confirmDialog(er.message, { title: 'Təkrar əməliyyat ola bilər', ok: 'Yenə də qeydə al', detail: 'Eyni məbləğ, növ və qarşı tərəf ilə 3 gün ərzində əməliyyat artıq var. Bu ayrıca əməliyyatdırsa, təsdiq edin.' })) await save(body, true);
      }
    } });
  const f = form.form, el = (n) => $(`[data-f="${n}"]`, f);
  el('kind').addEventListener('change', () => { setHTML(el('category'), h`${catOpts(el('kind').value).map((o) => h`<option value="${o[0]}">${o[1]}</option>`)}`); });
  el('amount').setAttribute('inputmode', 'decimal');
  // live warning about possible duplicates while the user fills in the form
  let dt;
  const checkDup = () => { clearTimeout(dt); dt = setTimeout(async () => {
    try {
      const r = await api.get('/api/ledger/similar' + qs({ kind: el('kind').value, amount: el('amount').value, currency: el('currency').value, counterparty_id: el('counterparty_id').value, date: el('entry_date').value, except: isNew ? '' : l.id }));
      setHTML($('#lgDup'), r.items.length ? h`<div class="note warn">${icon('alert')}<span><b>Oxşar əməliyyat var:</b> ${r.items.map((x) => h`<a href="#/gelir-xerc/${x.id}">${fmtDate(x.entry_date)} · ${money(x.amount, x.currency)}${x.cp_name ? ' · ' + x.cp_name : ''}</a> `)}</span></div>` : '');
    } catch { /* ignore */ }
  }, 400); };
  if (edit) for (const n of ['kind', 'amount', 'currency', 'counterparty_id', 'entry_date']) el(n).addEventListener(n === 'amount' ? 'input' : 'change', checkDup);
  if (data) {
    filesCard($('#lgFiles'), { type: 'ledger', id: l.id, files: data.files, editable: edit, title: 'Qəbz və ödəniş sənədləri', categories: META.file_categories.ledger, hint: 'Qəbz, çek, ödəniş tapşırığı, hesab-faktura · PDF, JPG, PNG' });
    setHTML($('#lgHist'), h`<section class="card"><div class="card-h"><div><h2>Tarixçə</h2><p>Yaradılma, dəyişikliklər, təsdiqlər və fayllar</p></div></div>
      ${data.history.length ? h`<ul class="hist">${data.history.map((x) => h`<li><span class="muted nw">${fmtDateTime(x.created_at)}</span><span><b>${x.action}</b> — ${x.user_name}<br><span class="muted" style="font-size:12.5px">${x.summary}</span></span></li>`)}</ul>` : h`<div class="empty">Tarixçə yoxdur</div>`}</section>`);
    $('#lgPdf').addEventListener('click', () => openPdf(`/api/ledger/${l.id}/pdf`));
    const ap = $('#lgAppr');
    if (ap) ap.addEventListener('click', async () => { try { await api.post(`/api/ledger/${l.id}/approve`, { approve: l.status !== 'approved' }); toast(l.status === 'approved' ? 'Təsdiq ləğv edildi' : 'Təsdiq edildi', 'ok'); ledger(view, [String(l.id)]); } catch (er) { showError(er); } });
  } else if (edit) {
    // receipts can be chosen together with a new entry
    const draw = () => setHTML($('#lgFiles'), h`<section class="card"><div class="card-h"><div><h2>Qəbz</h2><p>PDF, JPG, PNG · qeyd saxlananda yüklənəcək</p></div></div><div class="card-b" style="display:grid;gap:10px">
      ${pendingReceipts.length ? h`<ul class="flist">${pendingReceipts.map((p, i) => h`<li><span class="fn"><b>${p.name}</b><span class="muted">${fmtSize(p.size)}</span></span><button type="button" class="iconbtn" data-prm="${i}" aria-label="Çıxar" title="Çıxar">${icon('x')}</button></li>`)}</ul>` : h`<p class="muted">Qəbz seçilməyib.</p>`}
      <label class="btn sm" style="justify-self:start">${icon('upload', 'sm')}Qəbz seçin<input type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png" id="rcIn"></label></div></section>`);
    draw();
    $('#lgFiles').addEventListener('change', (e) => { if (e.target.id === 'rcIn') { pendingReceipts.push(...[...e.target.files].filter((x) => /\.(pdf|jpe?g|png)$/i.test(x.name) && x.size <= META.max_mb * 1048576)); draw(); } });
    $('#lgFiles').addEventListener('click', (e) => { const b = e.target.closest('[data-prm]'); if (b) { pendingReceipts.splice(Number(b.dataset.prm), 1); draw(); } });
  }
  const del = $('#lgDel');
  if (del) del.addEventListener('click', () => delAction(`/api/ledger/${l.id}`, 'Bu qeyd silinəcək. Bağlı sənədin ödəniş vəziyyəti yenidən hesablanacaq.', () => go('gelir-xerc')));
}

/* ================================================================== employees */
async function employees(view, args) {
  await meta(true);
  if (args[0]) return employeePage(view, args[0]);
  setHTML(view, h`<section class="card" id="emT"></section>`);
  dataTable($('#emT'), { id: 'employees', url: '/api/employees', exportUrl: '/api/employees/export', perPage: 25, searchPlaceholder: 'Ad, ata adı, vəzifə, şöbə…',
    filters: [{ key: 'status', label: 'Status', options: [['active', 'İşləyir'], ['left', 'İşdən çıxıb']] }],
    extra: can('hr.edit') ? h`<a class="btn sm pri" href="#/kadrlar/yeni">${icon('plus', 'sm')}Yeni əməkdaş</a>` : '',
    onRow: (e) => go('kadrlar/' + e.id), emptyText: 'Hələ əməkdaş yoxdur',
    columns: [
      { label: '', render: (e) => (e.photo_url ? h`<img class="avatar34" src="${e.photo_url}" alt="" loading="lazy">` : h`<span class="avatar34 none">${(e.first_name || e.full_name || '?')[0]}</span>`) },
      { label: 'Soyad, ad', sort: 'name', render: (e) => h`<b class="t">${e.full_name}</b>${e.father_name ? h`<br><span class="muted" style="font-size:12.5px">${e.father_name}</span>` : ''}` },
      { label: 'Vəzifə', sort: 'position', render: (e) => h`${e.position || '—'}${e.department ? h`<br><span class="muted" style="font-size:12.5px">${e.department}</span>` : ''}` },
      { label: 'İşə qəbul', sort: 'hire', cls: 'nw', render: (e) => (e.hire_date ? fmtDate(e.hire_date) : '—') },
      { label: 'Status', render: (e) => chip(e.status_label, e.status === 'active' ? 'green' : 'grey') }] });
}
async function employeePage(view, id) {
  const isNew = id === 'yeni';
  const data = isNew ? null : await api.get(`/api/employees/${encodeURIComponent(id)}/details`);
  const personal = isNew ? META.can.hr_personal : data.personal;
  const e = data ? data.item : { status: 'active' };
  const edit = can('hr.edit');
  setHTML(view, h`${backLink('kadrlar', 'Kadrlar')}<div class="row" style="justify-content:space-between;flex-wrap:wrap"><h2 class="ptitle">${isNew ? 'Yeni əməkdaş — şəxsi iş' : `${e.full_name}${e.father_name ? ' ' + e.father_name : ''}`}</h2>
    <span class="row">${!isNew ? pdfBtn('emPdf', 'Şəxsi vərəqə (PDF)') : ''}${!isNew && can('registry.edit') ? h`<a class="btn sm" href="#/reyestr/yeni?type=${encodeURIComponent(META.order_type)}&employee=${e.id}">${icon('plus', 'sm')}Əmr</a>` : ''}
    ${!isNew && can('hr.delete') ? h`<button class="btn sm ghost danger" id="emDel">${icon('trash', 'sm')}Sil</button>` : ''}</span></div>
    ${!personal ? h`<div class="note">${icon('lock')}<span>Şəxsi məlumatlar (doğum tarixi, ünvan, şəxsiyyət vəsiqəsi, fotoşəkil, şəxsi sənədlər) yalnız «Şəxsi məlumatlar» icazəsi olan istifadəçilərə görünür.</span></div>` : ''}
    <div class="grid g21"><div class="grid" style="align-content:start"><div id="emF"></div><div id="emRel" class="grid"></div></div><div class="grid" style="align-content:start"><div id="emPhoto"></div><div id="emFiles"></div></div></div>`);
  buildForm($('#emF'), { values: { ...e, base_salary: moneyIn(e.base_salary) }, readonly: !edit, cancelHref: '#/kadrlar',
    sections: [
      { title: 'Şəxsi məlumatlar', fields: [{ name: 'last_name', label: 'Soyad', required: true, max: 80 }, { name: 'first_name', label: 'Ad', required: true, max: 80 }, { name: 'father_name', label: 'Ata adı', max: 80 },
        ...(personal ? [{ name: 'birth_date', label: 'Doğum tarixi', type: 'date' }] : []), { name: 'phone', label: 'Əlaqə nömrəsi', type: 'tel', max: 60 }, { name: 'email', label: 'E-poçt', type: 'email', max: 254 },
        ...(personal ? [{ name: 'address', label: 'Ünvan', full: true, max: 300 }, { name: 'id_series', label: 'Şəxsiyyət vəsiqəsi — seriya', max: 10, mono: true, placeholder: 'AZE' }, { name: 'id_number', label: 'Şəxsiyyət vəsiqəsi — nömrə', max: 12, mono: true }] : [])] },
      { title: 'İş məlumatları', fields: [{ name: 'position', label: 'Vəzifə', max: 150 }, { name: 'department', label: 'Şöbə', max: 150 }, { name: 'hire_date', label: 'İşə qəbul tarixi', type: 'date' }, { name: 'leave_date', label: 'İşdən azad edilmə tarixi', type: 'date' },
        { name: 'status', label: 'İş statusu', type: 'select', options: [['active', 'İşləyir'], ['left', 'İşdən çıxıb']] }, { name: 'base_salary', label: 'Əsas maaş (hesablanan, AZN)', max: 20, placeholder: '0,00', help: 'Əmək haqqı cədvəlində ayın qaralaması bu məbləğlə yaradılır' }] },
      ...(personal ? [{ title: 'Qeyd', fields: [{ name: 'notes', label: 'Qeyd', type: 'textarea', rows: 3, full: true, max: 4000 }] }] : [])],
    onSubmit: async (v) => {
      try {
        if (isNew) { const r = await api.post('/api/employees', v); toast('Əməkdaş əlavə edildi — indi fotoşəkil və sənədləri əlavə edə bilərsiniz', 'ok'); go('kadrlar/' + r.item.id); }
        else { await api.put(`/api/employees/${e.id}`, v); toast('Yadda saxlanıldı', 'ok'); employeePage(view, String(e.id)); }
      } catch (er) { if (er.code === 'exists') { toast(er.message, 'error'); return; } throw er; }
    } });
  if (!data) { if (personal) setHTML($('#emPhoto'), h`<div class="note">${icon('info')}<span>Fotoşəkil və sənədləri əməkdaş yadda saxlanıldıqdan sonra əlavə edə bilərsiniz.</span></div>`); return; }
  $('#emPdf').addEventListener('click', () => openPdf(`/api/employees/${e.id}/pdf`));
  if (personal) {
    const drawPhoto = (url) => setHTML($('#emPhoto'), h`<section class="card"><div class="card-h"><div><h2>Fotoşəkil 3×4</h2><p>Şəxsi vərəqədə çap olunur</p></div></div><div class="card-b photo34">
      ${url ? h`<img src="${url}" alt="${e.full_name}">` : h`<div class="ph-empty">${icon('user')}<span>Foto yoxdur</span></div>`}
      ${edit ? h`<div class="row"><label class="btn sm pri">${icon('upload', 'sm')}${url ? 'Dəyiş' : 'Foto əlavə et'}<input type="file" hidden accept=".jpg,.jpeg,.png" id="phIn"></label>${url ? h`<button class="btn sm ghost danger" id="phDel">Sil</button>` : ''}</div>` : ''}</div></section>`);
    drawPhoto(e.photo_url);
    $('#emPhoto').addEventListener('change', async (ev) => {
      if (ev.target.id !== 'phIn' || !ev.target.files[0]) return;
      const blob = await cropPhoto(ev.target.files[0]);
      ev.target.value = '';
      if (!blob) return;
      try { const r = await uploadOne(`/api/employees/${e.id}/photo`, new File([blob], 'foto.jpg', { type: 'image/jpeg' })); drawPhoto(r.photo_url); toast('Fotoşəkil yadda saxlanıldı', 'ok'); } catch (er) { showError(er); }
    });
    $('#emPhoto').addEventListener('click', async (ev) => {
      if (!ev.target.closest('#phDel')) return;
      if (!(await confirmDialog('Fotoşəkil silinəcək.', { title: 'Fotoşəkil', ok: 'Sil', danger: true }))) return;
      try { await api.del(`/api/employees/${e.id}/photo`); drawPhoto(null); } catch (er) { showError(er); }
    });
    filesCard($('#emFiles'), { type: 'employee', id: e.id, files: data.files, editable: edit, title: 'Şəxsi iş sənədləri', categories: data.categories, hint: 'Şəxsiyyət vəsiqəsi, təhsil sənədləri, sertifikatlar, əmək müqaviləsi, əmrlər · PDF, JPG, PNG' });
  }
  setHTML($('#emRel'), h`${data.orders ? h`<section class="card"><div class="card-h"><div><h2>Əmrlər və sənədlər (${data.orders.length})</h2><p>Əməkdaşa aid əmrlər və ona ünvanlanan sənədlər — sənəd reyestrindən</p></div></div>${data.orders.length ? tableView(['Nömrə', 'Növ', 'Tarix', 'Mövzu'], data.orders.map((d) => [h`<a class="mono" href="#/reyestr/${d.id}">${d.doc_no}</a>`, d.doc_type, fmtDate(d.doc_date), d.subject || '—'])) : h`<div class="empty">Sənəd yoxdur</div>`}</section>` : ''}
    <section class="card"><div class="card-h"><h2>Əmək haqqı tarixçəsi</h2></div>${data.payroll.length ? tableView(['Ay', 'Hesablanıb', 'Ödəniləcək', 'Status'], data.payroll.map((p) => [periodLabel(p.period), money(p.gross), money(p.net), chip(p.status === 'paid' ? 'Ödənilib' : 'Qaralama', p.status === 'paid' ? 'green' : 'grey')])) : h`<div class="empty">Qeyd yoxdur</div>`}</section>`);
  const del = $('#emDel');
  if (del) del.addEventListener('click', () => delAction(`/api/employees/${e.id}`, `«${e.full_name}» silinəcək.`, () => go('kadrlar')));
}

// 3×4 photo: the user moves and zooms the picture inside a 3:4 frame; the result is a 600×800
// JPEG made in the browser (canvas), so the server stores exactly the cropped picture.
function cropPhoto(file) {
  return new Promise((resolve) => {
    if (!/\.(jpe?g|png)$/i.test(file.name)) { toast('Yalnız JPG və ya PNG şəkil', 'error'); resolve(null); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); toast('Şəkil açılmadı', 'error'); resolve(null); };
    img.onload = () => modal((dlg, close) => {
      const FW = 240, FH = 320; // frame on screen (3:4)
      const minScale = Math.max(FW / img.width, FH / img.height);
      let scale = minScale, x = (FW - img.width * scale) / 2, y = (FH - img.height * scale) / 2;
      setHTML(dlg, h`<div class="modal-h"><h2>Fotoşəkil 3×4</h2></div><div class="modal-b" style="display:grid;gap:12px;justify-items:center">
        <p class="muted" style="font-size:13.5px">Şəkli çəkərək yerləşdirin, sürüşdürücü ilə böyüdün. Çərçivənin içi saxlanılacaq.</p>
        <div class="crop34" style="width:${FW}px;height:${FH}px"><img src="${url}" alt="" draggable="false"></div>
        <label class="field" style="width:${FW}px"><span>Böyütmə</span><input type="range" min="100" max="400" value="100" id="zoom"></label></div>
        <div class="modal-f"><button type="button" class="btn" data-x>Ləğv et</button><button type="button" class="btn pri" id="cropOk">${icon('check', 'sm')}Yadda saxla</button></div>`);
      const frame = $('.crop34', dlg), pic = $('img', frame);
      const clamp = () => { x = Math.min(0, Math.max(FW - img.width * scale, x)); y = Math.min(0, Math.max(FH - img.height * scale, y)); };
      const draw = () => { clamp(); pic.style.width = img.width * scale + 'px'; pic.style.height = img.height * scale + 'px'; pic.style.transform = `translate(${x}px, ${y}px)`; };
      draw();
      $('#zoom', dlg).addEventListener('input', (ev) => {
        const ns = minScale * (Number(ev.target.value) / 100);
        x = FW / 2 - ((FW / 2 - x) * ns) / scale; y = FH / 2 - ((FH / 2 - y) * ns) / scale; scale = ns; draw();
      });
      let drag = null;
      frame.addEventListener('pointerdown', (ev) => { drag = { px: ev.clientX, py: ev.clientY, x, y }; frame.setPointerCapture(ev.pointerId); });
      frame.addEventListener('pointermove', (ev) => { if (!drag) return; x = drag.x + ev.clientX - drag.px; y = drag.y + ev.clientY - drag.py; draw(); });
      frame.addEventListener('pointerup', () => { drag = null; });
      const done = (val) => { URL.revokeObjectURL(url); close(val); };
      $('[data-x]', dlg).addEventListener('click', () => done(null));
      $('#cropOk', dlg).addEventListener('click', () => {
        const k = 600 / FW, c = document.createElement('canvas');
        c.width = 600; c.height = 800;
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 800);
        g.drawImage(img, x * k, y * k, img.width * scale * k, img.height * scale * k);
        c.toBlob((b) => done(b), 'image/jpeg', 0.9);
      });
    }, { label: 'Fotoşəkil 3×4' }).then(resolve);
    img.src = url;
  });
}

/* ================================================================== payroll */
const PAY_INPUTS = [['gross', 'Hesablanmış əmək haqqı (gross)'], ['income_tax', 'Gəlir vergisi'], ['dsmf_employee', 'DSMF — işçidən'], ['unemployment_employee', 'İşsizlikdən sığorta — işçidən'],
  ['health_employee', 'İcbari tibbi sığorta — işçidən'], ['other_deductions', 'Digər tutulmalar'], ['dsmf_employer', 'DSMF — işəgötürən'], ['unemployment_employer', 'İşsizlikdən sığorta — işəgötürən'], ['health_employer', 'İcbari tibbi sığorta — işəgötürən']];
async function payroll(view) {
  await meta(true);
  const edit = can('hr.edit');
  let period = todayBaku().slice(0, 7);
  setHTML(view, h`<div class="note">${icon('info')}<span>Məbləğləri mühasibin hesabladığı kimi daxil edin (vergi və sığorta dərəcələri dəyişə bilər, panel onları özü hesablamır). Ödəniləcək məbləğ = hesablanmış − işçidən tutulmalar; işəgötürənin xərci = hesablanmış + işəgötürən ödəmələri.</span></div>
    <section class="card"><div class="tbar"><label class="field" style="display:flex;gap:8px;align-items:center"><span>Ay</span><input class="in" type="month" id="prM" value="${period}" style="width:auto"></label><span class="sp"></span>
      ${edit ? h`<button class="btn sm" id="prGen">${icon('refresh', 'sm')}Aktiv əməkdaşlar üçün qaralama yarat</button><button class="btn sm pri" id="prAdd">${icon('plus', 'sm')}Sətir əlavə et</button>` : ''}
      ${pdfBtn('prPdf', 'Cədvəl (PDF)')}<button class="btn sm" id="prExp">${icon('down', 'sm')}Excel</button></div><div id="prBody"></div></section>`);
  const body = $('#prBody');
  const editRow = async (r) => {
    const fields = [...(r ? [] : [{ name: 'employee_id', label: 'Əməkdaş', type: 'select', required: true, options: META.employees.filter((e) => e.status === 'active').map((e) => [e.id, empLabel(e)]) }]),
      ...PAY_INPUTS.map(([k, label]) => ({ name: k, label, value: r ? moneyIn(r[k]) : '' })),
      { name: 'status', label: 'Status', type: 'select', options: [['draft', 'Qaralama'], ['paid', 'Ödənilib']], value: r ? r.status : 'draft' }, { name: 'paid_date', label: 'Ödəniş tarixi', type: 'date', value: r ? r.paid_date || '' : '' }, { name: 'note', label: 'Qeyd', value: r ? r.note : '' }];
    const res = await promptDialog({ title: r ? `${r.full_name} — ${periodLabel(r.period)}` : `Yeni sətir — ${periodLabel(period)}`, fields,
      submit: (v) => { const b = { ...v, period: r ? r.period : period, employee_id: r ? r.employee_id : Number(v.employee_id) }; return r ? api.put(`/api/payroll/${r.id}`, b) : api.post('/api/payroll', b); } });
    if (res) { toast('Yadda saxlanıldı', 'ok'); draw(); }
  };
  const draw = async () => {
    const [list, tot] = await Promise.all([api.get('/api/payroll' + qs({ period, per_page: 100, sort: 'name' })), api.get('/api/payroll/totals' + qs({ period }))]);
    const t = tot.totals;
    setHTML(body, list.items.length ? h`<div class="tw"><table><thead><tr><th>Əməkdaş</th><th class="num">Hesablanıb</th><th class="num">Gəlir vergisi</th><th class="num">DSMF</th><th class="num">İşsizlik</th><th class="num">Tibbi</th><th class="num">Digər</th><th class="num">Ödəniləcək</th><th class="num">İşəgötürən xərci</th><th>Status</th>${edit ? h`<th></th>` : ''}</tr></thead>
      <tbody>${list.items.map((r) => h`<tr class="click" data-pid="${r.id}"><td><b class="t">${r.full_name}</b><br><span class="muted" style="font-size:12.5px">${r.position || ''}</span></td><td class="num nw">${money(r.gross, '')}</td><td class="num nw">${money(r.income_tax, '')}</td><td class="num nw">${money(r.dsmf_employee, '')}</td>
        <td class="num nw">${money(r.unemployment_employee, '')}</td><td class="num nw">${money(r.health_employee, '')}</td><td class="num nw">${money(r.other_deductions, '')}</td><td class="num nw"><b>${money(r.net, '')}</b></td><td class="num nw">${money(r.employer_cost, '')}</td>
        <td>${chip(r.status === 'paid' ? 'Ödənilib' : 'Qaralama', r.status === 'paid' ? 'green' : 'grey')}</td>${edit ? h`<td><div class="acts">${can('hr.delete') ? iconBtn('del', 'trash', 'Sil') : ''}</div></td>` : ''}</tr>`)}
      <tr class="tot"><td>Cəmi (${tot.count})</td><td class="num nw">${money(t.gross, '')}</td><td class="num nw">${money(t.income_tax, '')}</td><td class="num nw">${money(t.dsmf_employee, '')}</td><td class="num nw">${money(t.unemployment_employee, '')}</td><td class="num nw">${money(t.health_employee, '')}</td>
        <td class="num nw">${money(t.other_deductions, '')}</td><td class="num nw"><b>${money(t.net, '')}</b></td><td class="num nw">${money(t.employer_cost, '')}</td><td></td>${edit ? h`<td></td>` : ''}</tr></tbody></table></div><p class="muted" style="padding:10px 16px;font-size:12.5px">Məbləğlər AZN ilə. Sətrə basaraq redaktə edin.</p>`
      : h`<div class="empty">${periodLabel(period)} üçün qeyd yoxdur.${edit ? ' «Aktiv əməkdaşlar üçün qaralama yarat» düyməsi ilə başlayın.' : ''}</div>`);
    body.onclick = async (ev) => {
      const tr = ev.target.closest('[data-pid]'); if (!tr) return;
      const r = list.items.find((x) => String(x.id) === tr.dataset.pid);
      if (ev.target.closest('[data-act="del"]')) return delAction(`/api/payroll/${r.id}`, `${r.full_name} — ${periodLabel(r.period)} sətri silinəcək.`, draw);
      if (edit) editRow(r);
    };
  };
  $('#prM').addEventListener('change', (e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { period = e.target.value; draw(); } });
  $('#prExp').addEventListener('click', () => { location.href = '/api/payroll/export' + qs({ period, format: 'xlsx' }); });
  $('#prPdf').addEventListener('click', () => openPdf('/api/payroll/sheet/pdf' + qs({ period })));
  if ($('#prGen')) $('#prGen').addEventListener('click', async () => { try { const r = await api.post('/api/payroll/generate', { period }); toast(r.created ? `${r.created} qaralama yaradıldı` : 'Bütün aktiv əməkdaşlar üçün sətir artıq var', r.created ? 'ok' : 'info'); draw(); } catch (er) { showError(er); } });
  if ($('#prAdd')) $('#prAdd').addEventListener('click', () => editRow(null));
  await draw();
}

export const OFFICE_PAGES = { reyestr: registry, kontragentler: counterparties, 'gelir-xerc': ledger, kadrlar: employees, 'emek-haqqi': payroll };
