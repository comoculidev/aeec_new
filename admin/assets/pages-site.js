// "Səhifələr": every text, picture and SEO line of the website pages, edited here (AZ / EN / RU).
// The server keeps the HTML files untouched and applies the saved values when a page is served
// (src/site-content.js). Each change is visible on the site at the next page load.
import { h, raw, setHTML, $, $$, icon, api, can, toast, showError, fmtDateTime, confirmDialog, modal } from './core.js';
import { pickMedia } from './ui.js';

const LANG = { az: 'AZ', en: 'EN', ru: 'RU' };
const go = (hash) => { location.hash = '#/' + hash; };
const enc = (p) => p.replace(/\//g, '~');
const dec = (p) => String(p || '').replace(/~/g, '/');
const plain = (s) => String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

// Saved HTML <-> what the editor shows: **qalın**, *kursiv*, [mətn](ünvan), new line = line break.
// Other decorative tags of the design (e.g. <span class="arrow">→</span>) stay as they are.
function toEditable(html) {
  return String(html || '').replace(/\s*\n\s*/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .trim();
}
function fromEditable(text) {
  return String(text || '').trim()
    .replace(/&(?![a-z]+;|#\d+;)/gi, '&amp;')
    .replace(/\[([^\]\n]{1,300})\]\(([^)\s]{1,500})\)/g, (m, t, u) => `<a href="${u.replace(/"/g, '&quot;')}">${t}</a>`)
    .replace(/\*\*([^*\n]{1,2000})\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]{1,2000})\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/ /g, '&nbsp;')
    .replace(/\n/g, '<br>');
}

/* ------------------------------------------------------------------ list */
async function pagesList(view) {
  const everything = (await api.get('/api/pages')).items;
  const parts = everything.filter((p) => p.partial);
  const items = everything.filter((p) => !p.partial);
  // The same page in three languages = one row (the site's folder names per language).
  const pairs = { '': '', 'haqqimizda/': 'about/', 'heller/': 'solutions/', 'layiheler/': 'projects/', 'dayaniqliliq/': 'sustainability/', 'akademiya/': 'academy/', 'xeberler/': 'news/', 'elaqe/': 'contact/', 'mexfilik/': 'privacy/' };
  const rows = [];
  const used = new Set();
  for (const p of items.filter((x) => x.lang === 'az')) {
    const az = p.path.replace(/index\.html$/, '');
    const other = Object.hasOwn(pairs, az) ? pairs[az] : null;
    const en = other !== null ? items.find((x) => x.path === `en/${other}index.html`) : null;
    const ru = other !== null ? items.find((x) => x.path === `ru/${other}index.html`) : null;
    [p, en, ru].filter(Boolean).forEach((x) => used.add(x.path));
    rows.push({ title: p.h1 || p.title, az: p, en, ru });
  }
  for (const p of items) if (!used.has(p.path)) rows.push({ title: p.h1 || p.title, az: p.lang === 'az' ? p : null, en: p.lang === 'en' ? p : null, ru: p.lang === 'ru' ? p : null });
  const cell = (p) => (p ? h`<a class="btn sm" href="#/sehifeler/${enc(p.path)}" title="${p.url}">${LANG[p.lang]}${p.edited ? h` <span class="tag" title="Dəyişdirilmiş mətn/şəkil">${p.edited}</span>` : ''}</a>` : h`<span class="muted">—</span>`);
  setHTML(view, h`<div class="note" style="margin-bottom:16px">${icon('info')}<span>Saytın bütün səhifələrinin <b>mətnləri, şəkilləri və SEO başlıqları</b> buradan dəyişdirilir. Dəyişiklik saxlanan kimi saytda görünür. Hər dəyişiklik tarixçədə qalır və istənilən vaxt orijinala qaytarıla bilər.
    Layihə siyahısı <a href="#/layiheler">Layihələr</a>, komanda <a href="#/komanda">Komanda</a>, xəbərlər <a href="#/xeberler">Xəbərlər</a>, əlaqə məlumatları <a href="#/tenzimlemeler">Tənzimləmələr</a> bölməsindən gəlir.</span></div>
    <section class="card" style="margin-bottom:16px"><div class="card-h"><h2>Bütün səhifələrdə olan hissələr</h2><p>Yuxarı menyu (header) və altbilgi (footer): menyu bəndləri və onların ünvanı, düymələr, şüar, sütun başlıqları, müəllif hüququ sətri</p></div>
    <div class="tw" style="margin-top:12px"><table><thead><tr><th>Hissə</th><th>Azərbaycanca</th><th>English</th><th>Русский</th></tr></thead><tbody>
    ${['header', 'footer'].map((n) => { const ps = parts.filter((p) => p.partial === n); return ps.length ? h`<tr><td><b class="t">${ps[0].title}</b></td>${['az', 'en', 'ru'].map((l) => h`<td>${cell(ps.find((p) => p.lang === l))}</td>`)}</tr>` : ''; })}</tbody></table></div></section>
    <section class="card"><div class="tbar"><div class="search">${icon('search')}<label class="sr" for="pq">Səhifə axtar</label><input class="in" id="pq" type="search" placeholder="Səhifə axtar…"></div><span class="sp"></span><span class="muted" style="font-size:13px">Dili seçin: AZ · EN · RU — rəqəm = dəyişdirilmiş yerlərin sayı</span></div>
    <div class="tw"><table><thead><tr><th>Səhifə</th><th>Ünvan</th><th>Azərbaycanca</th><th>English</th><th>Русский</th></tr></thead>
    <tbody>${rows.map((r) => h`<tr data-q="${(r.title + ' ' + [r.az, r.en, r.ru].filter(Boolean).map((x) => x.url + ' ' + x.title).join(' ')).toLowerCase()}"><td><b class="t">${r.title}</b>${(r.az || r.en || r.ru).projects ? h` <span class="tag">layihə siyahısı</span>` : ''}${(r.az || r.en || r.ru).team ? h` <span class="tag">komanda</span>` : ''}</td>
      <td class="mono muted">${(r.az || r.en || r.ru).url}</td><td>${cell(r.az)}</td><td>${cell(r.en)}</td><td>${cell(r.ru)}</td></tr>`)}</tbody></table></div></section>`);
  $('#pq').addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase(); $$('tbody tr[data-q]', view).forEach((tr) => { tr.hidden = q && !tr.dataset.q.includes(q); }); });
}

/* ------------------------------------------------------------------ one page */
async function pageEditor(view, path) {
  let d = (await api.get('/api/pages/page?path=' + encodeURIComponent(path))).item;
  const editable = can('pages.edit');
  const draw = () => {
    const seoEdited = !!d.seo && (d.seo.title_value !== null || d.seo.desc_value !== null);
    setHTML(view, h`<a class="back" href="#/sehifeler">${icon('left', 'sm')}Bütün səhifələr</a>
      <div class="row" style="margin:6px 0 16px"><h2 class="ptitle" style="margin:0">${plain(d.title).replace(/\s*\|\s*AEEC$/, '')} <span class="tag">${LANG[d.lang]}</span> <span class="mono muted" style="font-size:13px">${d.url}</span></h2>
        <div class="tbar" style="padding:0;flex:1 1 260px;justify-content:flex-end"><div class="search">${icon('search')}<label class="sr" for="bq">Mətn axtar</label><input class="in" id="bq" type="search" placeholder="Mətn axtar…"></div>
        <a class="btn sm" href="${d.url}" target="_blank" rel="noopener">${icon('eye', 'sm')}Saytda bax</a></div></div>
      ${d.missing ? h`<div class="note warn" style="margin-bottom:12px">${icon('alert')}<span>${d.missing} dəyişiklik bu səhifədə artıq tapılmır (səhifənin faylı proqramçı tərəfindən dəyişdirilib). Onlar saytda göstərilmir.</span></div>` : ''}
      ${d.featured ? h`<div class="note" style="margin-bottom:12px">${icon('info')}<span>«Seçilmiş layihələr» kartları <a href="#/layiheler">Layihələr</a> bölməsindən qurulur: şəkli olan və «Saytda göstər» işarəli ilk 3 layihə, oradakı sıra ilə.</span></div>` : ''}
      ${d.projects ? h`<div class="note" style="margin-bottom:12px">${icon('info')}<span>Bu səhifədəki layihə siyahısı <a href="#/layiheler">Layihələr</a> bölməsindən qurulur: «Saytda göstər» işarəli layihələr, onların sırası və filtr düymələri.</span></div>` : ''}
      ${d.team ? h`<div class="note" style="margin-bottom:12px">${icon('info')}<span>Bu səhifənin sonunda <a href="#/komanda">Komanda</a> bölməsindəki aktiv əməkdaşlar göstərilir (əməkdaş yoxdursa, bölmə görünmür).</span></div>` : ''}
      ${d.partial ? h`<div class="note" style="margin-bottom:12px">${icon('info')}<span>Bu hissə saytın <b>bütün ${LANG[d.lang]} səhifələrində</b> görünür. Menyu bəndinin mətnini və ünvanını dəyişmək, bəndi gizlətmək və menyunun sonuna yeni bənd əlavə etmək olar. Ünvan, telefon, e-poçt və sosial şəbəkələr <a href="#/tenzimlemeler">Tənzimləmələr</a> bölməsindən gəlir.</span></div>` : ''}
      ${d.seo ? h`<section class="card" style="margin-bottom:16px"><div class="card-h"><h2>SEO — axtarış sistemləri və paylaşım</h2>${seoEdited ? h`<span class="chip c-blue"><i></i>dəyişdirilib</span>` : ''}</div><div class="card-b" style="display:grid;gap:12px">
        <label class="field"><span>Səhifənin başlığı (brauzer pəncərəsi, Google, Facebook)</span><input class="in" id="seoT" maxlength="120" value="${d.seo.title_value ?? d.seo.title}" ${editable ? '' : raw('disabled')}></label>
        <label class="field"><span>Qısa təsvir (Google-da başlığın altında)</span><textarea class="in" id="seoD" rows="2" maxlength="300" ${editable ? '' : raw('disabled')}>${d.seo.desc_value ?? d.seo.description}</textarea></label>
        ${editable ? h`<div class="row"><button class="btn sm pri" data-seo="save">${icon('save', 'sm')}Yadda saxla</button>${seoEdited ? h`<button class="btn sm" data-seo="reset">${icon('refresh', 'sm')}Orijinala qaytar</button>` : ''}</div>` : ''}</div></section>` : ''}
      <div id="blocks" style="display:grid;gap:12px">${d.blocks.map((b) => blockCard(b, editable))}</div>`);
  };
  draw();

  const reload = (item) => { d = item; const y = window.scrollY; draw(); window.scrollTo(0, y); };
  const save = async (body, msg) => { try { const r = await api.put('/api/pages/block', { path: d.path, ...body }); toast(msg || 'Yadda saxlanıldı — saytda görünür', 'ok'); reload(r.item); } catch (e) { showError(e); } };
  const reset = async (block) => {
    if (!(await confirmDialog('Bu yer saytın əvvəlki (orijinal) mətninə qayıdacaq. Dəyişiklik tarixçədə qalır.', { title: 'Orijinala qaytarılsın?', ok: 'Qaytar' }))) return;
    try { const r = await api.del(`/api/pages/block?path=${encodeURIComponent(d.path)}&block=${encodeURIComponent(block)}`); toast('Orijinal mətn bərpa olundu', 'ok'); reload(r.item); } catch (e) { showError(e); }
  };

  view.addEventListener('click', async (e) => {
    const s = e.target.closest('[data-seo]');
    if (s) {
      if (s.dataset.seo === 'reset') {
        for (const id of ['seo-title', 'seo-desc']) { try { await api.del(`/api/pages/block?path=${encodeURIComponent(d.path)}&block=${id}`); } catch { /* not changed */ } }
        toast('SEO orijinala qaytarıldı', 'ok');
        reload((await api.get('/api/pages/page?path=' + encodeURIComponent(d.path))).item);
        return;
      }
      const t = $('#seoT').value.trim(), ds = $('#seoD').value.trim();
      try {
        if (t !== (d.seo.title_value ?? d.seo.title)) await api.put('/api/pages/block', { path: d.path, block: 'seo-title', value: t });
        if (ds !== (d.seo.desc_value ?? d.seo.description)) await api.put('/api/pages/block', { path: d.path, block: 'seo-desc', value: ds });
        toast('SEO yadda saxlanıldı', 'ok');
        reload((await api.get('/api/pages/page?path=' + encodeURIComponent(d.path))).item);
      } catch (er) { showError(er); }
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('[data-block]');
    const b = d.blocks.find((x) => x.id === card.dataset.block);
    const act = btn.dataset.act;
    if (act === 'save' && b.kind === 'link') return save({ block: b.id, text: $('input[name=text]', card).value.trim(), href: $('input[name=href]', card).value.trim(), hidden: $('input[name=hidden]', card).checked });
    if (act === 'save' && b.kind === 'links') {
      const items = $$('.lrow', card).map((r) => ({ text: $('input[name=text]', r).value.trim(), href: $('input[name=href]', r).value.trim() })).filter((x) => x.text || x.href);
      return save({ block: b.id, items });
    }
    if (act === 'addrow') { $('.lrows', card).insertAdjacentHTML('beforeend', linkRow({ text: '', href: '' }, true).s); return; }
    if (act === 'delrow') { btn.closest('.lrow').remove(); return; }
    if (act === 'save') return save({ block: b.id, value: fromEditable($('textarea', card).value) });
    if (act === 'reset') return reset(b.id);
    if (act === 'hist') return showHistory(d, b, reload);
    if (act === 'pick') {
      const m = await pickMedia({ kind: 'image' });
      if (m) return save({ block: b.id, media_id: m.id, alt: $('input[name=alt]', card).value.trim() || m.alt || b.original_alt }, 'Şəkil dəyişdirildi — saytda görünür');
    }
    if (act === 'alt') return b.media_id ? save({ block: b.id, media_id: b.media_id, alt: $('input[name=alt]', card).value.trim() }) : toast('Əvvəlcə yeni şəkil seçin', 'error');
  });
  view.addEventListener('input', (e) => {
    if (e.target.id !== 'bq') return;
    const q = e.target.value.trim().toLowerCase();
    $$('[data-block]', view).forEach((c) => { c.hidden = q && !c.dataset.q.includes(q); });
  });
}

const linkRow = (x, editable, removable = true) => h`<div class="lrow row" style="gap:8px;align-items:flex-end">
  <label class="field" style="flex:1 1 180px"><span>Mətn</span><input class="in" name="text" maxlength="80" value="${x.text}" ${editable ? '' : raw('disabled')}></label>
  <label class="field" style="flex:1 1 220px"><span>Ünvan</span><input class="in mono" name="href" maxlength="500" placeholder="/elaqe/ və ya https://…" value="${x.href}" ${editable ? '' : raw('disabled')}></label>
  ${editable && removable ? h`<button class="iconbtn" data-act="delrow" aria-label="Bəndi sil" title="Bəndi sil">${icon('trash')}</button>` : ''}</div>`;

function blockCard(b, editable) {
  const head = h`<div class="row" style="gap:8px"><span class="tag">${b.label}</span>${b.edited ? h`<span class="chip c-blue"><i></i>dəyişdirilib${b.updated_at ? ` · ${fmtDateTime(b.updated_at)}` : ''}${b.updated_by ? ` · ${b.updated_by}` : ''}</span>` : ''}<span class="sp" style="flex:1"></span>
    <button class="btn sm ghost" data-act="hist" title="Əvvəlki versiyalar">${icon('history', 'sm')}Tarixçə</button></div>`;
  if (b.kind === 'link') {
    const v = b.value || {};
    return h`<section class="card" data-block="${b.id}" data-q="${(b.original.text + ' ' + b.original.href + ' ' + (v.text || '')).toLowerCase()}"><div class="card-b" style="display:grid;gap:10px">${head}
      ${linkRow({ text: v.text || b.original.text, href: v.href || b.original.href }, editable, false)}
      <label class="check"><input type="checkbox" name="hidden" ${v.hidden ? raw('checked') : ''} ${editable ? '' : raw('disabled')}> Saytda göstərmə (gizlət)</label>
      ${b.edited ? h`<span class="muted" style="font-size:12.5px">Orijinal: ${b.original.text} → <span class="mono">${b.original.href}</span></span>` : ''}
      ${editable ? h`<div class="row"><button class="btn sm pri" data-act="save">${icon('save', 'sm')}Yadda saxla</button>${b.edited ? h`<button class="btn sm" data-act="reset">${icon('refresh', 'sm')}Orijinala qaytar</button>` : ''}</div>` : ''}</div></section>`;
  }
  if (b.kind === 'links') {
    return h`<section class="card" data-block="${b.id}" data-q="${(b.nav + ' ' + (b.value || []).map((x) => x.text).join(' ')).toLowerCase()}"><div class="card-b" style="display:grid;gap:10px">${head}
      <span class="muted" style="font-size:13px">Bu menyunun sonuna əlavə olunan bəndlər (ən çox 12).</span>
      <div class="lrows" style="display:grid;gap:8px">${(b.value || []).map((x) => linkRow(x, editable))}</div>
      ${editable ? h`<div class="row"><button class="btn sm" data-act="addrow">${icon('plus', 'sm')}Bənd əlavə et</button><button class="btn sm pri" data-act="save">${icon('save', 'sm')}Yadda saxla</button></div>` : ''}</div></section>`;
  }
  if (b.kind === 'image') {
    return h`<section class="card" data-block="${b.id}" data-q="${(b.original_alt + ' ' + b.alt).toLowerCase()}"><div class="card-b" style="display:grid;gap:10px">${head}
      <div class="row" style="align-items:flex-start;gap:16px"><img src="${b.src}" alt="" style="width:220px;max-width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;border:1px solid var(--line)">
        <div style="flex:1;min-width:220px;display:grid;gap:8px"><span class="muted" style="font-size:12.5px">Orijinal: <span class="mono">${b.original_src}</span></span>
          <label class="field"><span>Şəklin təsviri (alt mətn)</span><input class="in" name="alt" maxlength="300" value="${b.alt || b.original_alt}" ${editable ? '' : raw('disabled')}></label>
          ${editable ? h`<div class="row"><button class="btn sm pri" data-act="pick">${icon('image', 'sm')}Şəkli dəyiş</button>${b.media_id ? h`<button class="btn sm" data-act="alt">${icon('save', 'sm')}Təsviri saxla</button><button class="btn sm" data-act="reset">${icon('refresh', 'sm')}Orijinala qaytar</button>` : ''}</div>` : ''}</div></div></div></section>`;
  }
  const value = b.value ?? b.original;
  const text = toEditable(value);
  const rows = Math.min(10, Math.max(1, Math.ceil(text.length / 90) + (text.match(/\n/g) || []).length));
  return h`<section class="card" data-block="${b.id}" data-q="${plain(value + ' ' + b.original).toLowerCase()}"><div class="card-b" style="display:grid;gap:8px">${head}
    <textarea class="in" rows="${rows}" ${editable ? '' : raw('disabled')} style="${['h1', 'h2'].includes(b.tag) ? 'font-weight:700;font-size:16px' : ''}">${text}</textarea>
    ${b.edited ? h`<span class="muted" style="font-size:12.5px">Orijinal: ${plain(b.original)}</span>` : ''}
    ${editable ? h`<div class="row"><button class="btn sm pri" data-act="save">${icon('save', 'sm')}Yadda saxla</button>${b.edited ? h`<button class="btn sm" data-act="reset">${icon('refresh', 'sm')}Orijinala qaytar</button>` : ''}
      <span class="muted" style="font-size:12px">**qalın** · *kursiv* · [keçid](https://…) · yeni sətir = sətir keçidi</span></div>` : ''}</div></section>`;
}

async function showHistory(d, b, reload) {
  let items;
  try { items = (await api.get(`/api/pages/history?path=${encodeURIComponent(d.path)}&block=${encodeURIComponent(b.id)}`)).items; } catch (e) { return showError(e); }
  const asJson = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const show = (it) => {
    if (it.value === null) return h`<i class="muted">orijinala qaytarıldı</i>`;
    if (it.kind === 'image') return 'şəkil dəyişdirildi';
    if (it.kind === 'link') { const v = asJson(it.value) || {}; return v.hidden ? `gizlədildi: ${v.text}` : `${v.text} → ${v.href}`; }
    if (it.kind === 'links') return (asJson(it.value) || []).map((x) => `${x.text} → ${x.href}`).join(' · ');
    return plain(it.value);
  };
  modal((m, close) => {
    setHTML(m, h`<div class="modal-h"><h2>Tarixçə</h2><span class="sp"></span><button class="iconbtn" data-close aria-label="Bağla">${icon('x')}</button></div>
      <div class="modal-b">${items.length ? h`<div style="display:grid;gap:10px">${items.map((it) => h`<div class="card"><div class="card-b" style="display:grid;gap:6px">
        <span class="muted" style="font-size:12.5px">${fmtDateTime(it.created_at)} · ${it.user_name || '—'}</span><div>${show(it)}</div>
        ${can('pages.edit') ? h`<div><button class="btn sm" data-restore="${it.id}">${icon('refresh', 'sm')}Bu versiyanı bərpa et</button></div>` : ''}</div></div>`)}</div>`
        : h`<div class="empty">Bu yer hələ dəyişdirilməyib.</div>`}</div>`);
    m.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) return close();
      const r = e.target.closest('[data-restore]');
      if (!r) return;
      try { const res = await api.post(`/api/pages/history/${r.dataset.restore}/restore`); toast('Versiya bərpa olundu', 'ok'); close(); reload(res.item); } catch (er) { showError(er); }
    });
  }, { label: 'Tarixçə' });
}

async function sitePages(view, args) {
  if (args[0]) return pageEditor(view, dec(args.join('/')));
  return pagesList(view);
}

export const SITE_PAGES = { sehifeler: sitePages };
export { toEditable, fromEditable };
