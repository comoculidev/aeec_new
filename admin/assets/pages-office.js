// Office pages (internal): document register, counterparties, income/expense, employees, payroll.
// Server side: src/routes/office.js. Every list uses the shared dataTable / buildForm helpers.
import { h, raw, setHTML, $, $$, icon, api, qs, can, toast, showError, fmtDate, fmtDateTime, fmtSize, chip, confirmDialog, promptDialog, modal, todayBaku } from './core.js';
import { dataTable, buildForm } from './ui.js';
import { groupBars, chartCard, tableView } from './charts.js';

const go = (hash) => { location.hash = '#/' + hash; };
const backLink = (hash, label) => h`<a class="back" href="#/${hash}">${icon('left', 'sm')}${label}</a>`;
const iconBtn = (act, ic, label) => h`<button class="iconbtn" data-act="${act}" aria-label="${label}" title="${label}">${icon(ic)}</button>`;
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

let META = null;
async function meta(force) { if (!META || force) META = await api.get('/api/office/meta'); return META; }
const delAction = async (url, text, after) => { if (!(await confirmDialog(text, { title: 'Silmə təsdiqi', ok: 'Sil', danger: true }))) return; try { await api.del(url); toast('Silindi', 'ok'); after(); } catch (e) { showError(e); } };

/* ------------------------------------------------------------------ attached files card */
// Scans / attachments of one record. type: doc | ledger | employee.
function filesCard(host, { type, id, files, editable, title = 'Skanlar və fayllar', hint = '' }) {
  const draw = (list) => setHTML(host, h`<section class="card"><div class="card-h"><div><h2>${title}</h2><p>${hint || `PDF, JPG, PNG, DOCX, XLSX · ən çox ${META.max_mb} MB`}</p></div></div><div class="card-b" style="display:grid;gap:10px">
    ${list.length ? h`<ul class="flist">${list.map((f) => h`<li><span class="ft">${String(f.ext).toUpperCase()}</span><span class="fn"><b>${f.name}</b><span class="muted">${fmtSize(f.size)} · ${fmtDateTime(f.created_at)}</span></span>
      <span class="acts">${f.previewable ? h`<a class="iconbtn" href="${f.url}?inline=1" target="_blank" rel="noopener" title="Bax" aria-label="Bax">${icon('eye')}</a>` : ''}<a class="iconbtn" href="${f.url}" download title="Yüklə" aria-label="Yüklə">${icon('down')}</a>
      ${editable ? h`<button class="iconbtn" data-fdel="${f.id}" title="Sil" aria-label="Sil">${icon('trash')}</button>` : ''}</span></li>`)}</ul>` : h`<p class="muted">Hələ fayl əlavə edilməyib.</p>`}
    ${editable ? h`<label class="btn sm pri" style="justify-self:start">${icon('upload', 'sm')}Fayl əlavə et<input type="file" multiple hidden accept="${META.allowed.map((x) => '.' + x).join(',')}" data-fup></label><p class="muted fprog" style="font-size:12.5px" hidden></p>` : ''}</div></section>`);
  let list = files.slice();
  draw(list);
  host.onclick = async (e) => {
    const d = e.target.closest('[data-fdel]');
    if (!d) return;
    if (!(await confirmDialog('Fayl həmişəlik silinəcək.', { title: 'Faylı sil', ok: 'Sil', danger: true }))) return;
    try { await api.del(`/api/office/files/${d.dataset.fdel}`); list = list.filter((f) => String(f.id) !== d.dataset.fdel); draw(list); toast('Fayl silindi', 'ok'); } catch (er) { showError(er); }
  };
  host.onchange = async (e) => {
    if (!e.target.matches('[data-fup]')) return;
    const picked = [...e.target.files], prog = $('.fprog', host), failed = [];
    for (let i = 0; i < picked.length; i++) {
      prog.hidden = false; prog.textContent = `Yüklənir ${i + 1}/${picked.length}: ${picked[i].name}`;
      const fd = new FormData(); fd.append('file', picked[i]);
      try { list.push((await api.upload(`/api/office/files/${type}/${id}`, fd)).item); } catch (er) { failed.push(`${picked[i].name}: ${er.fields ? Object.values(er.fields)[0] : er.message}`); }
    }
    draw(list);
    if (failed.length) toast(failed.join(' · '), 'error'); else toast(picked.length > 1 ? `${picked.length} fayl əlavə edildi` : 'Fayl əlavə edildi', 'ok');
  };
}

/* ================================================================== register */
async function registry(view, args) {
  await meta(true);
  if (args[0] === 'siyahilar') return listsPage(view);
  if (args[0]) return docPage(view, args[0]);
  const L = META.lists, edit = can('registry.edit');
  setHTML(view, h`<div id="regSum" class="grid"></div><section class="card" id="regT"></section>
    <div class="note">${icon('info')}<span>Nömrə avtomatik verilir: <b>indeks-sıra/ay-il</b> (məs. AE-001/09-26). Sıra hər növ üzrə il boyu davam edir, yeni ildə 001-dən başlayır. Skan faylını sənədin nömrəsi ilə adlandırıb («/» əvəzinə «_»: <span class="mono">AE-001_09-26.pdf</span>) «Skanları yüklə» ilə toplu əlavə edə bilərsiniz.</span></div>`);
  let year = Number(todayBaku().slice(0, 4));
  const drawSummary = async () => {
    const s = await api.get('/api/registry/summary' + qs({ year }));
    setHTML($('#regSum'), h`<div class="kpis three">
        <div class="card kpi"><div class="kl">${icon('file')}<span>${s.year}-ci ildə sənəd</span></div><div class="kv">${s.total}</div><div class="kd">reyestrdə qeydə alınıb</div></div>
        <a class="card kpi lnk" href="#/reyestr" data-quick="waiting"><div class="kl">${icon('history')}<span>Cavab gözlənilir</span></div><div class="kv">${s.waiting_total}</div><div class="kd">${s.waiting[0] ? `ən köhnəsi: ${s.waiting[0].doc_no} · ${s.waiting[0].response_label}` : 'gözlənilən cavab yoxdur'}</div></a>
        <a class="card kpi lnk" href="#/reyestr" data-quick="unpaid"><div class="kl">${icon('alert')}<span>Ödənilməmiş sənədlər</span></div><div class="kv sm">${money(s.unpaid_total)}</div><div class="kd">${s.unpaid.length} sənəd üzrə qalıq</div></a></div>
      <section class="card"><div class="card-h"><div><h2>Hesabat: növlər və aylar</h2><p>Hər növ üzrə sənəd sayı və növbəti veriləcək nömrə</p></div><span class="sp"></span>
        <label class="sr" for="regYear">İl</label><select class="in" id="regYear" style="width:auto">${s.years.map((y) => h`<option ${y === s.year ? raw('selected') : ''}>${y}</option>`)}</select></div>
        <div class="tw"><table class="tview"><thead><tr><th>Sənəd növü</th><th>İndeks</th>${MONTHS.map((m) => h`<th class="num">${m}</th>`)}<th class="num">Cəmi</th><th>Növbəti nömrə</th></tr></thead>
        <tbody>${s.table.map((t) => h`<tr><td>${t.type}</td><td class="mono">${t.index}</td>${t.months.map((n) => h`<td class="num ${n ? '' : 'muted'}">${n || '·'}</td>`)}<td class="num"><b>${t.total}</b></td><td class="mono">${t.next}</td></tr>`)}
        <tr class="tot"><td>Cəmi</td><td></td>${t12(s.table).map((n) => h`<td class="num">${n}</td>`)}<td class="num"><b>${s.total}</b></td><td></td></tr></tbody></table></div></section>`);
    $('#regYear').onchange = (e) => { year = Number(e.target.value); drawSummary(); };
  };
  const t12 = (rows) => Array.from({ length: 12 }, (_, i) => rows.reduce((s, r) => s + r.months[i], 0));
  await drawSummary();
  const table = dataTable($('#regT'), { id: 'registry', url: '/api/registry', sort: '-date', dateRange: true, exportUrl: '/api/registry/export', perPage: 25, searchPlaceholder: 'Nömrə, alan tərəf, mövzu…',
    filters: [{ key: 'doc_type', label: 'Növ', options: L.doc_types.map((t) => [t.name, t.name]) }, { key: 'status', label: 'Status', options: L.statuses.map((x) => [x, x]) },
      { key: 'response', label: 'Cavab', options: [['waiting', 'Gözlənilir'], ['received', 'Alınıb'], ['none', 'Tələb olunmur']] }, { key: 'pay', label: 'Ödəniş', options: [['unpaid', 'Ödənilməyib'], ['partial', 'Qismən'], ['paid', 'Ödənilib']] }],
    extra: h`${edit ? h`<button class="btn sm" id="regImp">${icon('upload', 'sm')}Excel-dən idxal</button><button class="btn sm" id="regScans">${icon('upload', 'sm')}Skanları yüklə</button><a class="btn sm" href="#/reyestr/siyahilar">${icon('cog', 'sm')}Siyahılar</a><a class="btn sm pri" href="#/reyestr/yeni">${icon('plus', 'sm')}Yeni sənəd</a>` : ''}`,
    onRow: (d) => go('reyestr/' + d.id), emptyText: 'Reyestr boşdur. «Yeni sənəd» və ya «Excel-dən idxal» ilə başlayın.',
    columns: [
      { label: 'Nömrə', sort: 'no', cls: 'nw', render: (d) => h`<b class="mono">${d.doc_no}</b><br><span class="muted" style="font-size:12.5px">${d.doc_type}</span>` },
      { label: 'Tarix', sort: 'date', cls: 'nw', render: (d) => fmtDate(d.doc_date) },
      { label: 'Alan tərəf', sort: 'party', render: (d) => d.party || h`<span class="muted">—</span>` },
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
    const send = async (mode) => { const fd = new FormData(); fd.append('file', f.file.files[0]); fd.append('mode', mode); return api.upload('/api/registry/import', fd); };
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
      <p class="muted" style="font-size:13.5px">Hər faylın adı sənədin nömrəsi olmalıdır, «/» əvəzinə «_» ilə: <span class="mono">P-003_09-26.pdf</span>. Fayllar avtomatik uyğun sənədə əlavə olunur; uyğun nömrə tapılmasa, fayl yüklənmir və siyahıda göstərilir.</p>
      <label class="btn pri" style="justify-self:start">${icon('upload', 'sm')}Faylları seçin<input type="file" multiple hidden accept="${META.allowed.map((x) => '.' + x).join(',')}" id="scIn"></label>
      <ul class="flist" id="scRes"></ul></div><div class="modal-f"><button type="button" class="btn" data-x>Bağla</button></div>`);
    $('[data-x]', dlg).addEventListener('click', () => close());
    $('#scIn', dlg).addEventListener('change', async (e) => {
      const list = $('#scRes', dlg), files = [...e.target.files];
      let ok = 0;
      for (const file of files) {
        const li = document.createElement('li'); setHTML(li, h`<span class="fn"><b>${file.name}</b><span class="muted">yüklənir…</span></span>`); list.append(li);
        const fd = new FormData(); fd.append('file', file);
        try { const r = await api.upload('/api/registry/scans', fd); ok++; setHTML(li, h`<span class="fn"><b>${file.name}</b><span>→ <a href="#/reyestr/${r.id}">${r.doc_no}</a></span></span>${chip('Əlavə edildi', 'green')}`); }
        catch (x) { setHTML(li, h`<span class="fn"><b>${file.name}</b><span class="muted">${x.message}</span></span>${chip('Yüklənmədi', 'red')}`); }
      }
      e.target.value = '';
      toast(`${ok}/${files.length} skan əlavə edildi`, ok === files.length ? 'ok' : 'error');
      after();
    });
  }, { wide: true, label: 'Skanları toplu yüklə' });
}

async function docPage(view, id) {
  const isNew = id === 'yeni';
  const L = META.lists;
  const data = isNew ? null : await api.get(`/api/registry/${encodeURIComponent(id)}/details`);
  const d = data ? data.item : { doc_date: todayBaku(), doc_type: L.doc_types[0] ? L.doc_types[0].name : '', status: L.statuses[0] || '', executor: L.executors[0] || '', currency: 'AZN' };
  const edit = can('registry.edit');
  const opt = (arr, cur) => { const o = arr.map((x) => [x, x]); if (cur && !arr.includes(cur)) o.unshift([cur, cur]); return [['', '—'], ...o]; };
  setHTML(view, h`${backLink('reyestr', 'Sənəd reyestri')}<div class="row" style="justify-content:space-between;flex-wrap:wrap"><h2 class="ptitle">${isNew ? 'Yeni sənəd' : h`<span class="mono">${d.doc_no}</span> · ${d.doc_type}`}</h2>
    <span class="row">${!isNew && d.amount ? chip(d.pay_label, PAY_COLOR[d.pay_state]) : ''}${!isNew && d.response_label ? chip(d.response_label, RESP_COLOR[d.response_state]) : ''}
    ${!isNew && can('registry.delete') ? h`<button class="btn sm ghost danger" id="docDel">${icon('trash', 'sm')}Sil</button>` : ''}</span></div>
    <div class="grid g21"><div id="docF"></div><div class="grid" style="align-content:start"><div id="docFiles"></div><div id="docPay"></div></div></div>`);
  const typeOpts = L.doc_types.map((t) => [t.name, `${t.name} (${t.index})`]);
  if (d.doc_type && !L.doc_types.some((t) => t.name === d.doc_type)) typeOpts.unshift([d.doc_type, d.doc_type]);
  const values = { ...d, amount: moneyIn(d.amount), vat_amount: moneyIn(d.vat_amount), counterparty_id: d.counterparty_id || '', employee_id: d.employee_id || '' };
  const form = buildForm($('#docF'), { values, readonly: !edit, cancelHref: '#/reyestr', submitLabel: isNew ? 'Qeydə al' : 'Yadda saxla',
    sections: [
      { title: 'Sənəd', fields: [
        { name: 'doc_date', label: 'Tarix', type: 'date', required: true }, { name: 'doc_type', label: 'Sənəd növü', type: 'select', options: typeOpts, required: true },
        { name: 'doc_no', label: 'Sənəd nömrəsi', mono: true, max: 40, help: isNew ? 'Boş qalsa, avtomatik verilir' : 'Nömrə dəyişmir. Silsəniz, yeni nömrə avtomatik veriləcək.' },
        { name: 'counterparty_id', label: 'Alan tərəf (kontragent)', type: 'select', options: [['', '— siyahıdan seçin —'], ...META.counterparties.map((c) => [c.id, c.name])], help: 'Siyahıda yoxdursa, aşağıda adını yazın və ya «Kontragentlər» bölməsində əlavə edin' },
        { name: 'employee_id', label: 'Əməkdaş', type: 'select', options: [['', '— seçin —'], ...META.employees.map((e) => [e.id, e.full_name + (e.status === 'left' ? ' (işdən çıxıb)' : '')])] },
        { name: 'recipient', label: 'Alan tərəf (sərbəst mətn)', max: 200 },
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
      { title: 'Məbləğ və ödəniş', sub: 'Yalnız ödənişi gözlənilən sənəddə (adətən hesab-faktura) doldurun — ödənişlər «Gəlir və xərc»də bu sənədə bağlanır', fields: [
        { name: 'amount', label: 'Ümumi məbləğ (ƏDV daxil)', inputmode: 'decimal', max: 20, placeholder: '0,00' }, { name: 'vat_amount', label: 'O cümlədən ƏDV', max: 20, placeholder: '0,00' },
        { name: 'currency', label: 'Valyuta', type: 'select', options: META.currencies.map((c) => [c, c]) }, { name: 'due_date', label: 'Ödəniş müddəti', type: 'date' }] },
      { title: 'Qeyd', fields: [{ name: 'note', label: 'Qeyd', type: 'textarea', rows: 3, full: true, max: 4000 }] }],
    onSubmit: async (v) => {
      const body = { ...v, counterparty_id: v.counterparty_id ? Number(v.counterparty_id) : null, employee_id: v.employee_id ? Number(v.employee_id) : null };
      if (isNew) { const r = await api.post('/api/registry', body); toast(`Qeydə alındı: ${r.item.doc_no}`, 'ok'); go('reyestr/' + r.item.id); }
      else { await api.put(`/api/registry/${d.id}`, body); toast('Yadda saxlanıldı', 'ok'); registry(view, [String(d.id)]); }
    } });
  // Orders ("Əmr") concern an employee, other documents a counterparty: show the matching field.
  const f = form.form;
  const field = (n) => $(`[data-f="${n}"]`, f).closest('.field').parentElement;
  const syncType = async () => {
    const order = $('[data-f="doc_type"]', f).value === META.order_type;
    field('employee_id').hidden = !order; field('counterparty_id').hidden = order;
    if (isNew && edit) {
      try { const r = await api.get('/api/registry/next-number' + qs({ type: $('[data-f="doc_type"]', f).value, date: $('[data-f="doc_date"]', f).value })); $('[data-f="doc_no"]', f).placeholder = r.number ? `avtomatik: ${r.number}` : ''; } catch { /* ignore */ }
    }
  };
  $('[data-f="doc_type"]', f).addEventListener('change', syncType); $('[data-f="doc_date"]', f).addEventListener('change', syncType);
  $('[data-f="amount"]', f).setAttribute('inputmode', 'decimal'); $('[data-f="vat_amount"]', f).setAttribute('inputmode', 'decimal');
  syncType();
  if (isNew) {
    setHTML($('#docFiles'), h`<div class="note">${icon('info')}<span>Skanı sənəd qeydə alındıqdan sonra əlavə edə bilərsiniz.</span></div>`);
    return;
  }
  filesCard($('#docFiles'), { type: 'doc', id: d.id, files: data.files, editable: edit, title: 'Skan və əlavələr' });
  if (data.payments && d.amount) {
    setHTML($('#docPay'), h`<section class="card"><div class="card-h"><div><h2>Ödənişlər</h2><p>Məbləğ ${money(d.amount, d.currency)} · ödənilib ${money(d.paid, d.currency)} · qalıq <b>${money(d.debt, d.currency)}</b></p></div></div>
      <div class="card-b" style="display:grid;gap:10px">${data.payments.length ? h`<ul class="flist">${data.payments.map((p) => h`<li><span class="fn"><b>${money(p.amount, d.currency)}</b><span class="muted">${fmtDate(p.entry_date)} · ${p.method_label}${p.description ? ' · ' + p.description : ''}</span></span><a class="iconbtn" href="#/gelir-xerc/${p.id}" title="Aç" aria-label="Aç">${icon('edit')}</a></li>`)}</ul>` : h`<p class="muted">Hələ ödəniş qeydə alınmayıb.</p>`}
      ${can('finance.edit') && d.debt > 0 ? h`<button class="btn sm pri" id="payAdd" style="justify-self:start">${icon('plus', 'sm')}Ödəniş qeydə al</button>` : ''}</div></section>`);
    const pa = $('#payAdd');
    if (pa) pa.addEventListener('click', async () => {
      const r = await promptDialog({ title: `Ödəniş — ${d.doc_no}`, ok: 'Qeydə al', fields: [{ name: 'entry_date', label: 'Tarix', type: 'date', value: todayBaku(), required: true }, { name: 'amount', label: `Məbləğ (${d.currency})`, value: moneyIn(d.debt), required: true },
        { name: 'method', label: 'Üsul', type: 'select', options: Object.entries(META.methods), value: 'bank' }, { name: 'category', label: 'Kateqoriya', type: 'select', options: META.lists.income_categories.map((c) => [c, c]), value: META.lists.income_categories[0] }, { name: 'description', label: 'Təsvir' }],
      submit: (v) => api.post('/api/ledger', { ...v, kind: 'income', doc_id: d.id, currency: d.currency }) });
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
    ${!isNew && can('finance.delete') ? h`<button class="btn sm ghost danger" id="cpDel">${icon('trash', 'sm')}Sil</button>` : ''}</div>
    ${data ? h`<div class="kpis three"><div class="card kpi"><div class="kl">${icon('file')}<span>Hesablanıb (sənədlər üzrə)</span></div><div class="kv sm">${money(data.totals.invoiced)}</div></div>
      <div class="card kpi"><div class="kl">${icon('check')}<span>Ödənilib</span></div><div class="kv sm">${money(data.totals.paid)}</div></div>
      <div class="card kpi"><div class="kl">${icon('alert')}<span>Borc qalığı</span></div><div class="kv sm">${money(data.totals.debt)}</div></div></div>` : ''}
    <div id="cpF"></div><div id="cpRel" class="grid"></div>`);
  buildForm($('#cpF'), { values: c, readonly: !edit, cancelHref: '#/kontragentler', sections: cpFields,
    onSubmit: async (v) => { if (isNew) { const r = await api.post('/api/counterparties', v); toast('Kontragent əlavə edildi', 'ok'); go('kontragentler/' + r.item.id); } else { await api.put(`/api/counterparties/${c.id}`, v); toast('Yadda saxlanıldı', 'ok'); } } });
  if (data) {
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
        <div class="card kpi"><div class="kl">${icon('down')}<span>Gəlir (${s.year})</span></div><div class="kv sm">${money(t.income)}</div></div>
        <div class="card kpi"><div class="kl">${icon('up')}<span>Xərc (${s.year})</span></div><div class="kv sm">${money(t.expense)}</div></div>
        <div class="card kpi"><div class="kl">${icon('chart')}<span>Fərq</span></div><div class="kv sm">${money(t.balance)}</div><div class="kd">gəlir − xərc (jurnal üzrə)</div></div>
        <div class="card kpi"><div class="kl">${icon('users')}<span>Əmək haqqı fondu</span></div><div class="kv sm">${money(t.payroll)}</div><div class="kd">hesablanmış + işəgötürən ödəmələri</div></div></div>
      ${chartCard('finChart', 'Aylar üzrə gəlir və xərc', `${s.year}, AZN`, { legend: [['Gəlir', 'var(--k-green)'], ['Xərc', 'var(--k-red)']], controls: h`<label class="sr" for="finYear">İl</label><select class="in" id="finYear" style="width:auto">${s.years.map((y) => h`<option ${y === s.year ? raw('selected') : ''}>${y}</option>`)}</select>` })}
      <div class="grid g2"><section class="card"><div class="card-h"><div><h2>Debitor borclar</h2><p>Ödənilməmiş sənədlər (kontragent üzrə)</p></div></div>${s.receivables.length ? tableView(['Kontragent', 'Sənəd', 'Qalıq'], s.receivables.map((r) => [h`${r.cp_name}${r.overdue ? h` ${chip('müddəti keçib', 'red')}` : ''}`, r.n, money(r.debt, r.currency)])) : h`<div class="empty">Borc yoxdur</div>`}</section>
        <section class="card"><div class="card-h"><div><h2>Kateqoriyalar üzrə</h2><p>${s.year}, AZN</p></div></div>${s.categories.length ? tableView(['Kateqoriya', 'Növ', 'Məbləğ'], s.categories.map((c) => [c.category || '(kateqoriyasız)', c.kind_label, money(c.s)])) : h`<div class="empty">Qeyd yoxdur</div>`}
        ${s.other_currencies.length ? h`<p class="muted" style="padding:10px 16px;font-size:13px">Digər valyutalar: ${s.other_currencies.map((o) => `${o.kind === 'income' ? 'gəlir' : 'xərc'} ${money(o.s, o.currency)}`).join(' · ')}</p>` : ''}</section></div>`);
    groupBars($('#finChart'), MONTHS, [{ name: 'Gəlir', color: 'var(--k-green)', values: s.months.map((m) => m.income) }, { name: 'Xərc', color: 'var(--k-red)', values: s.months.map((m) => m.expense) }]);
    setHTML($('#finChart-t'), tableView(['Ay', 'Gəlir', 'Xərc', 'Fərq', 'Əmək haqqı fondu'], s.months.map((m, i) => [MONTHS_FULL[i], money(m.income), money(m.expense), money(m.income - m.expense), money(m.payroll)])));
    $('#finYear').onchange = (e) => { year = Number(e.target.value); drawSummary(); };
  };
  await drawSummary();
  const cats = [...L.income_categories, ...L.expense_categories];
  dataTable($('#lgT'), { id: 'ledger', url: '/api/ledger', sort: '-date', dateRange: true, exportUrl: '/api/ledger/export', perPage: 25, searchPlaceholder: 'Təsvir, kontragent, sənəd nömrəsi…',
    filters: [{ key: 'kind', label: 'Növ', options: Object.entries(META.kinds) }, { key: 'category', label: 'Kateqoriya', options: cats.map((c) => [c, c]) }, { key: 'method', label: 'Üsul', options: Object.entries(META.methods) }],
    extra: can('finance.edit') ? h`<a class="btn sm" href="#/gelir-xerc/yeni-xerc">${icon('plus', 'sm')}Xərc</a><a class="btn sm pri" href="#/gelir-xerc/yeni-gelir">${icon('plus', 'sm')}Gəlir</a>` : '',
    onRow: (l) => go('gelir-xerc/' + l.id), emptyText: 'Hələ qeyd yoxdur',
    columns: [{ label: 'Tarix', sort: 'date', cls: 'nw', render: (l) => fmtDate(l.entry_date) }, { label: 'Növ', cls: 'nw', render: (l) => chip(l.kind_label, l.kind === 'income' ? 'green' : 'red') },
      { label: 'Kateqoriya', sort: 'category', render: (l) => l.category || '—' }, { label: 'Kontragent', sort: 'party', render: (l) => l.cp_name || '—' },
      { label: 'Sənəd', cls: 'nw mono', render: (l) => (l.doc_no ? h`<a href="#/reyestr/${l.doc_id}">${l.doc_no}</a>` : '—') }, { label: 'Təsvir', render: (l) => h`<span class="clip">${l.description || '—'}</span>` },
      { label: 'Məbləğ', sort: 'amount', cls: 'num nw', render: (l) => h`<b>${l.kind === 'expense' ? '−' : ''}${money(l.amount, l.currency)}</b>` }, { label: '', cls: 'nw', render: (l) => (l.files_count ? h`<span title="Qəbz/sənəd">${icon('file', 'sm')}</span>` : '') }] });
}
async function ledgerPage(view, id) {
  const isNew = /^yeni/.test(id);
  const data = isNew ? null : await api.get(`/api/ledger/${encodeURIComponent(id)}/details`);
  const L = META.lists;
  const l = data ? data.item : { entry_date: todayBaku(), kind: id === 'yeni-gelir' ? 'income' : 'expense', method: 'bank', currency: 'AZN' };
  const edit = can('finance.edit');
  setHTML(view, h`${backLink('gelir-xerc', 'Gəlir və xərc')}<div class="row" style="justify-content:space-between;flex-wrap:wrap"><h2 class="ptitle">${isNew ? (l.kind === 'income' ? 'Yeni gəlir' : 'Yeni xərc') : `${l.kind_label}: ${money(l.amount, l.currency)}`}</h2>
    ${!isNew && can('finance.delete') ? h`<button class="btn sm ghost danger" id="lgDel">${icon('trash', 'sm')}Sil</button>` : ''}</div><div class="grid g21"><div id="lgF"></div><div id="lgFiles"></div></div>`);
  const catOpts = (kind) => { const arr = kind === 'income' ? L.income_categories : L.expense_categories; const o = arr.map((c) => [c, c]); if (l.category && !arr.includes(l.category)) o.unshift([l.category, l.category]); return [['', '—'], ...o]; };
  const form = buildForm($('#lgF'), { values: { ...l, amount: moneyIn(l.amount), vat_amount: moneyIn(l.vat_amount), counterparty_id: l.counterparty_id || '', doc_no: l.doc_no || '' }, readonly: !edit, cancelHref: '#/gelir-xerc',
    sections: [{ title: 'Qeyd', fields: [{ name: 'entry_date', label: 'Tarix', type: 'date', required: true }, { name: 'kind', label: 'Növ', type: 'select', options: Object.entries(META.kinds) },
      { name: 'amount', label: 'Məbləğ', required: true, max: 20, placeholder: '0,00' }, { name: 'vat_amount', label: 'O cümlədən ƏDV', max: 20, placeholder: '0,00' },
      { name: 'currency', label: 'Valyuta', type: 'select', options: META.currencies.map((c) => [c, c]) }, { name: 'method', label: 'Ödəniş üsulu', type: 'select', options: Object.entries(META.methods) },
      { name: 'category', label: 'Kateqoriya', type: 'select', options: catOpts(l.kind) },
      { name: 'counterparty_id', label: 'Kontragent', type: 'select', options: [['', '—'], ...META.counterparties.map((c) => [c.id, c.name])] },
      { name: 'doc_no', label: 'Reyestrdəki sənəd (nömrə)', mono: true, max: 40, placeholder: 'məs. H-003/10-26', help: 'Hesab üzrə ödənişdirsə, nömrəni yazın — sənədin ödəniş vəziyyəti yenilənəcək' },
      { name: 'description', label: 'Təsvir', type: 'textarea', rows: 2, full: true, max: 2000 }] }],
    onSubmit: async (v) => {
      const body = { ...v, counterparty_id: v.counterparty_id ? Number(v.counterparty_id) : null };
      if (isNew) { const r = await api.post('/api/ledger', body); toast('Qeydə alındı', 'ok'); go('gelir-xerc/' + r.item.id); } else { await api.put(`/api/ledger/${l.id}`, body); toast('Yadda saxlanıldı', 'ok'); go('gelir-xerc'); }
    } });
  const kindSel = $('[data-f="kind"]', form.form), catSel = $('[data-f="category"]', form.form);
  kindSel.addEventListener('change', () => { setHTML(catSel, h`${catOpts(kindSel.value).map((o) => h`<option value="${o[0]}">${o[1]}</option>`)}`); });
  $('[data-f="amount"]', form.form).setAttribute('inputmode', 'decimal');
  if (data) filesCard($('#lgFiles'), { type: 'ledger', id: l.id, files: data.files, editable: edit, title: 'Qəbz, çek, hesab-faktura' });
  else setHTML($('#lgFiles'), h`<div class="note">${icon('info')}<span>Qəbz və ya çeki qeyd saxlanıldıqdan sonra əlavə edə bilərsiniz.</span></div>`);
  const del = $('#lgDel');
  if (del) del.addEventListener('click', () => delAction(`/api/ledger/${l.id}`, 'Bu qeyd silinəcək. Bağlı sənədin ödəniş vəziyyəti yenidən hesablanacaq.', () => go('gelir-xerc')));
}

/* ================================================================== employees */
async function employees(view, args) {
  await meta(true);
  if (args[0]) return employeePage(view, args[0]);
  setHTML(view, h`<section class="card" id="emT"></section>`);
  dataTable($('#emT'), { id: 'employees', url: '/api/employees', exportUrl: '/api/employees/export', perPage: 25, searchPlaceholder: 'Ad, vəzifə…',
    filters: [{ key: 'status', label: 'Status', options: [['active', 'İşləyir'], ['left', 'İşdən çıxıb']] }],
    extra: can('hr.edit') ? h`<a class="btn sm pri" href="#/kadrlar/yeni">${icon('plus', 'sm')}Yeni əməkdaş</a>` : '',
    onRow: (e) => go('kadrlar/' + e.id), emptyText: 'Hələ əməkdaş yoxdur',
    columns: [{ label: 'Ad, soyad', sort: 'name', render: (e) => h`<b class="t">${e.full_name}</b>` }, { label: 'Vəzifə', sort: 'position', render: (e) => e.position || '—' },
      { label: 'İşə qəbul', sort: 'hire', cls: 'nw', render: (e) => (e.hire_date ? fmtDate(e.hire_date) : '—') }, { label: 'Əsas maaş', sort: 'salary', cls: 'num nw', render: (e) => (e.base_salary ? money(e.base_salary) : '—') },
      { label: 'Status', render: (e) => chip(e.status === 'active' ? 'İşləyir' : 'İşdən çıxıb', e.status === 'active' ? 'green' : 'grey') }] });
}
async function employeePage(view, id) {
  const isNew = id === 'yeni';
  const data = isNew ? null : await api.get(`/api/employees/${encodeURIComponent(id)}/details`);
  const e = data ? data.item : { status: 'active' };
  const edit = can('hr.edit');
  setHTML(view, h`${backLink('kadrlar', 'Kadrlar')}<div class="row" style="justify-content:space-between;flex-wrap:wrap"><h2 class="ptitle">${isNew ? 'Yeni əməkdaş' : e.full_name}</h2>
    ${!isNew && can('hr.delete') ? h`<button class="btn sm ghost danger" id="emDel">${icon('trash', 'sm')}Sil</button>` : ''}</div>
    <div class="grid g21"><div class="grid" style="align-content:start"><div id="emF"></div><div id="emRel" class="grid"></div></div><div id="emFiles"></div></div>`);
  buildForm($('#emF'), { values: { ...e, base_salary: moneyIn(e.base_salary) }, readonly: !edit, cancelHref: '#/kadrlar',
    sections: [{ title: 'Əməkdaş', fields: [{ name: 'full_name', label: 'Soyad, ad', required: true, max: 150 }, { name: 'position', label: 'Vəzifə', max: 150 },
      { name: 'phone', label: 'Telefon', type: 'tel', max: 60 }, { name: 'email', label: 'E-poçt', type: 'email', max: 254 }, { name: 'hire_date', label: 'İşə qəbul tarixi', type: 'date' }, { name: 'leave_date', label: 'İşdən çıxma tarixi', type: 'date' },
      { name: 'status', label: 'Status', type: 'select', options: [['active', 'İşləyir'], ['left', 'İşdən çıxıb']] }, { name: 'base_salary', label: 'Əsas maaş (hesablanan, AZN)', max: 20, placeholder: '0,00', help: 'Əmək haqqı cədvəlində ayın qaralaması bu məbləğlə yaradılır' },
      { name: 'notes', label: 'Qeyd', type: 'textarea', rows: 3, full: true, max: 4000 }] }],
    onSubmit: async (v) => { if (isNew) { const r = await api.post('/api/employees', v); toast('Əməkdaş əlavə edildi', 'ok'); go('kadrlar/' + r.item.id); } else { await api.put(`/api/employees/${e.id}`, v); toast('Yadda saxlanıldı', 'ok'); } } });
  if (!data) return;
  setHTML($('#emRel'), h`${data.orders ? h`<section class="card"><div class="card-h"><div><h2>Əmrlər (${data.orders.length})</h2><p>Reyestrdə bu əməkdaşa bağlı əmrlər</p></div></div>${data.orders.length ? tableView(['Nömrə', 'Tarix', 'Mövzu'], data.orders.map((d) => [h`<a class="mono" href="#/reyestr/${d.id}">${d.doc_no}</a>`, fmtDate(d.doc_date), d.subject || '—'])) : h`<div class="empty">Əmr yoxdur</div>`}</section>` : ''}
    <section class="card"><div class="card-h"><h2>Əmək haqqı tarixçəsi</h2></div>${data.payroll.length ? tableView(['Ay', 'Hesablanıb', 'Ödəniləcək', 'Status'], data.payroll.map((p) => [periodLabel(p.period), money(p.gross), money(p.net), chip(p.status === 'paid' ? 'Ödənilib' : 'Qaralama', p.status === 'paid' ? 'green' : 'grey')])) : h`<div class="empty">Qeyd yoxdur</div>`}</section>`);
  filesCard($('#emFiles'), { type: 'employee', id: e.id, files: data.files, editable: edit, title: 'Şəxsi iş sənədləri', hint: 'Əmək müqaviləsi, ərizələr və s. — yalnız kadr icazəsi olanlar görür' });
  const del = $('#emDel');
  if (del) del.addEventListener('click', () => delAction(`/api/employees/${e.id}`, `«${e.full_name}» silinəcək.`, () => go('kadrlar')));
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
      <button class="btn sm" id="prExp">${icon('down', 'sm')}Excel</button></div><div id="prBody"></div></section>`);
  const body = $('#prBody');
  const editRow = async (r) => {
    const fields = [...(r ? [] : [{ name: 'employee_id', label: 'Əməkdaş', type: 'select', required: true, options: META.employees.filter((e) => e.status === 'active').map((e) => [e.id, e.full_name]) }]),
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
  if ($('#prGen')) $('#prGen').addEventListener('click', async () => { try { const r = await api.post('/api/payroll/generate', { period }); toast(r.created ? `${r.created} qaralama yaradıldı` : 'Bütün aktiv əməkdaşlar üçün sətir artıq var', r.created ? 'ok' : 'info'); draw(); } catch (er) { showError(er); } });
  if ($('#prAdd')) $('#prAdd').addEventListener('click', () => editRow(null));
  await draw();
}

export const OFFICE_PAGES = { reyestr: registry, kontragentler: counterparties, 'gelir-xerc': ledger, kadrlar: employees, 'emek-haqqi': payroll };
