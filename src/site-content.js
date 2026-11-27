'use strict';
// The website, edited from the panel.
//
// The pages in site/ stay static HTML files that nobody has to change by hand any more. When a page
// is served (src/site-layout.js -> renderPage) this module applies what was saved in the panel:
//
// 1. Texts, images and SEO of every page ("Səhifələr" in the panel, table page_blocks)
//    Every heading, paragraph, list item, button, label… inside <main> is a "block". A block is
//    identified by its tag and its ORIGINAL content (hash), so it stays the same block even if other
//    parts of the file change; an override whose original text is no longer in the file is simply
//    not applied (the panel shows it as "not found"). The HTML files are never written.
//    Images (<picture>/<img> inside <main>) can be replaced with a picture from the media library.
//    The page <title> and description (also og:/twitter:) can be changed per page.
// 2. Project list on /layiheler/, /en/projects/, /ru/projects/ (table projects)
//    The part of the page between <!--@projects--> and <!--/@projects--> is built from the projects
//    marked "Saytda göstər". On first start the projects that were written in the pages are imported
//    into the panel, so the generated list is identical to the hand-written one.
// 3. Project pages /layiheler/<slug>/, /en/projects/<slug>/, /ru/projects/<slug>/ (served directly)
//    for projects with a picture, a gallery, indicators or a longer description; plus sitemap.xml.
// 4. Team on the About pages: <!--@team--> shows the active members of "Komanda".
// 5. "Seçilmiş layihələr" cards on the home pages: between <!--@featured--> and <!--/@featured-->
//    the first three shown projects that have a picture, in the panel order (arrows in "Layihələr").
//    While no project has a picture the hand-written cards stay.
//
// Every change in the panel increases version(); the page cache uses it, so a saved change is
// visible on the next request.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const { get, all, run, tx, now } = require('./db');
const md = require('./markdown');
const { imageSize } = require('./imagesize');
const { localize } = require('./settings');

const LANGS = ['az', 'en', 'ru'];
const PROJ_DIR = { az: 'layiheler', en: 'en/projects', ru: 'ru/projects' };
const L = {
  az: { home: 'Ana səhifə', crumbs: 'Naviqasiya yolu', projects: 'Layihələr', all: 'Hamısı', back: 'Bütün layihələr', details: 'Ətraflı', client: 'Sifarişçi', location: 'Yer', sector: 'Sektor', type: 'Layihə növü', period: 'Müddət', gallery: 'Qalereya', indicators: 'Göstəricilər', empty: 'Hazırda saytda göstərilən layihə yoxdur.', team: 'Komanda', team_h: 'Komandamız', locale: 'az_AZ' },
  en: { home: 'Home', crumbs: 'Breadcrumb', projects: 'Projects', all: 'All', back: 'All projects', details: 'Details', client: 'Client', location: 'Location', sector: 'Sector', type: 'Project type', period: 'Period', gallery: 'Gallery', indicators: 'Key figures', empty: 'There are no projects to show yet.', team: 'Team', team_h: 'Our team', locale: 'en_US' },
  ru: { home: 'Главная', crumbs: 'Навигационная цепочка', projects: 'Проекты', all: 'Все', back: 'Все проекты', details: 'Подробнее', client: 'Заказчик', location: 'Место', sector: 'Сектор', type: 'Тип проекта', period: 'Сроки', gallery: 'Галерея', indicators: 'Показатели', empty: 'Пока нет проектов для показа.', team: 'Команда', team_h: 'Наша команда', locale: 'ru_RU' },
};

const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const decode = (s) => String(s ?? '').replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: '\u00a0' }[e]));
const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');

/* ------------------------------------------------------------------ version */
let ver = 0;
const version = () => ver;
function bump() { ver++; overrideCache.clear(); }

/* ------------------------------------------------------------------ safe inline HTML */
// A text block may keep simple formatting: bold, italic, links, line breaks and the decorative
// <span class="…"> the design uses. Everything else is removed; text is escaped; tags are balanced.
const INLINE = new Set(['strong', 'b', 'em', 'i', 'br', 'a', 'span', 'small', 'sup', 'sub', 'abbr', 'mark']);
const SAFE_HREF = /^(?:https?:\/\/[^\s"'<>]+|\/[^\s"'<>]*|#[\w-]*|mailto:[^\s"'<>]+|tel:[+\d\s()-]+)$/i;
const SAFE_CLASS = /^[a-z0-9 _-]{1,60}$/i;
function cleanInline(input) {
  const s = String(input ?? '').replace(/\r\n?/g, '\n').slice(0, 20000);
  const out = [];
  const stack = [];
  const text = (t) => t.replace(/&(?!(?:[a-z]+|#\d{1,6}|#x[0-9a-f]{1,6});)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rx = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
  let last = 0, m;
  while ((m = rx.exec(s))) {
    out.push(text(s.slice(last, m.index)));
    last = rx.lastIndex;
    const closing = !!m[1], tag = m[2].toLowerCase();
    if (!INLINE.has(tag)) continue;
    if (tag === 'br') { if (!closing) out.push('<br>'); continue; }
    if (closing) {
      const i = stack.lastIndexOf(tag);
      if (i === -1) continue;
      while (stack.length > i) out.push(`</${stack.pop()}>`);
      continue;
    }
    const attrs = {};
    for (const a of m[3].matchAll(/([^\s=>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
    let keep = '';
    if (tag === 'a') {
      const href = String(attrs.href || '').trim();
      if (!SAFE_HREF.test(href)) continue; // a link without a safe address is dropped, its text kept
      keep += ` href="${escHtml(href)}"`;
      if (/^https?:\/\//i.test(href)) keep += ' target="_blank" rel="noopener noreferrer"';
    }
    if (attrs.class && SAFE_CLASS.test(attrs.class) && (tag === 'span' || tag === 'a')) keep += ` class="${escHtml(attrs.class)}"`;
    if (tag === 'abbr' && attrs.title) keep += ` title="${escHtml(attrs.title.slice(0, 200))}"`;
    if (attrs['aria-hidden'] === 'true' && tag === 'span') keep += ' aria-hidden="true"';
    out.push(`<${tag}${keep}>`);
    stack.push(tag);
  }
  out.push(text(s.slice(last)));
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join('').replace(/\n/g, '<br>');
}

/* ------------------------------------------------------------------ blocks */
const TEXT_TAGS = 'h1|h2|h3|h4|h5|h6|p|li|dt|dd|figcaption|blockquote|th|td|label|summary|button|legend|caption';
const CONTAINER = /<(?:p|ul|ol|li|div|h[1-6]|table|section|form|dl|figure|picture|img|input|select|textarea|svg|article|aside|nav|button|iframe|video)\b/i;
const TAG_LABEL = { h1: 'Əsas başlıq', h2: 'Başlıq', h3: 'Alt başlıq', h4: 'Alt başlıq', h5: 'Alt başlıq', h6: 'Alt başlıq', p: 'Mətn', li: 'Siyahı bəndi', dt: 'Ad', dd: 'Dəyər', figcaption: 'Şəkil yazısı', blockquote: 'Sitat', th: 'Cədvəl başlığı', td: 'Cədvəl xanası', label: 'Forma sahəsi', summary: 'Açılan başlıq', button: 'Düymə', legend: 'Forma başlığı', caption: 'Cədvəl başlığı' };
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

// Parts of <main> that are built from the panel elsewhere and therefore are not text blocks.
function excludedRanges(html, start, end) {
  const out = [];
  for (const rx of [/<!--@(projects|team|featured)-->[\s\S]*?<!--\/@\1-->/g, /<script\b[\s\S]*?<\/script>/gi, /<!--@team-->/g]) {
    rx.lastIndex = start;
    let m;
    while ((m = rx.exec(html)) && m.index < end) out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

// All blocks of a page, in document order: { id, kind, tag, start, end (of the inner part), inner }
function scan(html) {
  const mainOpen = /<main\b[^>]*>/i.exec(html);
  if (!mainOpen) return [];
  const start = mainOpen.index + mainOpen[0].length;
  const end = html.indexOf('</main>', start);
  if (end === -1) return [];
  const skip = excludedRanges(html, start, end);
  const inSkip = (i) => skip.some(([a, b]) => i >= a && i < b);
  const blocks = [];
  const seen = new Map();
  const ident = (prefix, key) => { const base = prefix + sha(key).slice(0, 10); const n = (seen.get(base) || 0) + 1; seen.set(base, n); return n > 1 ? `${base}-${n}` : base; };
  // images first (their alt text is part of the image, not a text block)
  const pics = [];
  const prx = /<picture\b[^>]*>[\s\S]*?<\/picture>|<img\b[^>]*>/gi;
  prx.lastIndex = start;
  let m;
  while ((m = prx.exec(html)) && m.index < end) {
    if (inSkip(m.index)) continue;
    const img = /<img\b[^>]*>/i.exec(m[0]);
    const src = img && (/\ssrc="([^"]+)"/.exec(img[0]) || [])[1];
    if (!src) continue;
    pics.push({ kind: 'image', tag: 'img', start: m.index, end: m.index + m[0].length, outer: m[0], src, alt: decode((/\salt="([^"]*)"/.exec(img[0]) || [])[1] || '') });
  }
  const trx = new RegExp(`<(${TEXT_TAGS})(\\s[^>]*)?>([\\s\\S]*?)<\\/\\1>`, 'gi');
  trx.lastIndex = start;
  while ((m = trx.exec(html)) && m.index < end) {
    const tag = m[1].toLowerCase();
    const innerStart = m.index + m[0].indexOf('>') + 1;
    const inner = m[3];
    // a container (e.g. <li><p>…</p></li>): look inside it instead
    if (CONTAINER.test(inner) || inSkip(m.index)) { trx.lastIndex = innerStart; continue; }
    if (!norm(inner.replace(/<[^>]+>/g, ''))) continue; // nothing to read
    if (m.index + m[0].length > end) break;
    blocks.push({ kind: 'text', tag, start: innerStart, end: innerStart + inner.length, inner, attrs: m[2] || '' });
  }
  const list = [...pics, ...blocks].sort((a, b) => a.start - b.start);
  for (const b of list) b.id = b.kind === 'image' ? ident('i-', b.src) : ident('t-', `${b.tag}|${norm(b.inner)}`);
  return list;
}

// SEO of a page: <title>, description and their og:/twitter: copies.
const SEO_RX = {
  title: /<title>([\s\S]*?)<\/title>/,
  description: /<meta name="description" content="([^"]*)">/,
};
function seoOf(html) { return { title: decode((SEO_RX.title.exec(html) || [])[1] || ''), description: decode((SEO_RX.description.exec(html) || [])[1] || '') }; }
function applySeo(html, o) {
  let out = html;
  if (o['seo-title']) {
    const t = escHtml(o['seo-title'].value);
    out = out.replace(SEO_RX.title, () => `<title>${t}</title>`);
    for (const p of ['og:title', 'twitter:title']) out = out.replace(new RegExp(`(<meta (?:property|name)="${p}" content=")[^"]*(")`), (m, a, b) => a + t + b);
  }
  if (o['seo-desc']) {
    const d = escHtml(o['seo-desc'].value);
    out = out.replace(SEO_RX.description, () => `<meta name="description" content="${d}">`);
    for (const p of ['og:description', 'twitter:description']) out = out.replace(new RegExp(`(<meta (?:property|name)="${p}" content=")[^"]*(")`), (m, a, b) => a + d + b);
  }
  return out;
}

const overrideCache = new Map();
function overridesFor(page) {
  if (!overrideCache.has(page)) {
    const o = {};
    for (const r of all('SELECT block, kind, value FROM page_blocks WHERE page = ?', page)) o[r.block] = r;
    if (overrideCache.size > 500) overrideCache.clear();
    overrideCache.set(page, o);
  }
  return overrideCache.get(page);
}

function imageMarkup(b, val) {
  let v;
  try { v = JSON.parse(val); } catch { return null; }
  const m = v && v.media_id ? get("SELECT * FROM media WHERE id = ? AND is_private = 0 AND kind = 'image'", v.media_id) : null;
  if (!m || !/^[a-f0-9]{32}\.[a-z0-9]{2,5}$/.test(m.stored_name)) return null;
  let size = null;
  try { size = imageSize(fs.readFileSync(path.join(config.uploadDir, m.stored_name))); } catch { size = null; }
  const img = /<img\b[^>]*>/i.exec(b.outer)[0];
  const attr = (n) => (new RegExp(`\\s${n}="([^"]*)"`).exec(img) || [])[1];
  const alt = v.alt !== undefined && v.alt !== '' ? v.alt : m.alt || b.alt;
  const parts = [`src="/media/${m.stored_name}"`, `alt="${escHtml(alt)}"`];
  if (size) parts.push(`width="${size.width}"`, `height="${size.height}"`);
  for (const k of ['class', 'loading', 'fetchpriority', 'decoding']) if (attr(k)) parts.push(`${k}="${attr(k)}"`);
  const tag = `<img ${parts.join(' ')}>`;
  const pic = /^<picture\b[^>]*>/i.exec(b.outer);
  return pic ? `${pic[0]}${tag}</picture>` : tag;
}

// The page with the panel's texts/images/SEO applied. `rel` = file path inside site/ (e.g. "en/about/index.html").
function applyBlocks(html, rel) {
  let o;
  try { o = overridesFor(rel); } catch { return html; } // database not ready (tests of the layout alone)
  if (!Object.keys(o).length) return html;
  let out = '';
  let pos = 0;
  const swapped = [];
  for (const b of scan(html)) {
    const ov = o[b.id];
    if (!ov) continue;
    let repl = null;
    if (b.kind === 'text' && ov.kind === 'text') { repl = ov.value; out += html.slice(pos, b.start) + repl; pos = b.end; continue; }
    if (b.kind === 'image' && ov.kind === 'image') { repl = imageMarkup(b, ov.value); if (repl) { out += html.slice(pos, b.start) + repl; pos = b.end; swapped.push([b.outer, (/\ssrc="([^"]*)"/.exec(repl) || [])[1]]); } }
  }
  out += html.slice(pos);
  // A replaced picture must not leave the browser preloading the old file (e.g. the home hero).
  for (const [oldMarkup, to] of swapped) {
    if (!to) continue;
    out = out.replace(/<link rel="preload" as="image"[^>]*>/g, (tag) => {
      const href = (/\shref="([^"]*)"/.exec(tag) || [])[1];
      return href && (oldMarkup.includes(`${href} `) || oldMarkup.includes(`"${href}"`)) ? `<link rel="preload" as="image" href="${to}" fetchpriority="high">` : tag;
    });
  }
  return applySeo(out, o);
}

/* ------------------------------------------------------------------ pages for the panel */
const siteRel = (full) => path.relative(config.siteDir, full).split(path.sep).join('/');
function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'assets') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name === 'index.html' || (dir === config.siteDir && e.name === '404.html')) out.push(full);
  }
  return out;
}
const langOf = (html) => (/<html lang="(az|en|ru)"/.exec(html) || [])[1] || 'az';
const urlOf = (rel) => '/' + rel.replace(/(^|\/)index\.html$/, '$1');
function isPanelPage(rel) {
  // pages the panel itself creates (news) are edited in "Xəbərlər", not here
  try { return !!get('SELECT 1 FROM site_files WHERE path = ?', rel); } catch { return false; }
}
function listPages() {
  const edited = new Map();
  for (const r of all('SELECT page, COUNT(*) AS n FROM page_blocks GROUP BY page')) edited.set(r.page, r.n);
  const pages = [];
  for (const full of walk(config.siteDir)) {
    const rel = siteRel(full);
    if (isPanelPage(rel)) continue;
    let html;
    try { html = fs.readFileSync(full, 'utf8'); } catch { continue; }
    const blocks = scan(html);
    const h1 = blocks.find((b) => b.tag === 'h1');
    pages.push({ path: rel, url: urlOf(rel), lang: langOf(html), title: seoOf(html).title.replace(/\s*\|\s*AEEC$/, ''), h1: h1 ? norm(decode(h1.inner.replace(/<[^>]+>/g, ''))) : '',
      blocks: blocks.length, edited: edited.get(rel) || 0, projects: html.includes('<!--@projects-->'), team: html.includes('<!--@team-->') });
  }
  const order = (p) => [p.url === '/' || p.url === '/en/' || p.url === '/ru/' ? 0 : p.path === '404.html' ? 2 : 1, p.url.replace(/^\/(en|ru)\//, '/')];
  pages.sort((a, b) => { const x = order(a), y = order(b); return x[0] - y[0] || x[1].localeCompare(y[1]) || LANGS.indexOf(a.lang) - LANGS.indexOf(b.lang); });
  // header and footer first: they are on every page
  const parts = [];
  for (const name of ['header', 'footer']) for (const l of LANGS) {
    const rel = `partials/${name}.${l}.html`;
    if (!safePage(rel)) continue;
    parts.push({ path: rel, url: l === 'az' ? '/' : `/${l}/`, lang: l, partial: name, title: PARTIAL_LABEL[name], h1: PARTIAL_LABEL[name], blocks: scanPartial(stripDevComment(fs.readFileSync(safePage(rel), 'utf8'))).length, edited: edited.get(rel) || 0 });
  }
  return [...parts, ...pages];
}
/* ------------------------------------------------------------------ header and footer */
// The header and the footer are shared components (site-templates/partials/{header,footer}.<lang>.html,
// put into every page by src/site-layout.js). In the panel they are edited like a page, with the key
// "partials/header.az.html" etc.:
//   link  - a menu item / button: text, address, hidden            (value {text, href, hidden})
//   links - items added at the end of a menu                       (value [{text, href}, …])
//   text  - footer slogan, column headings, copyright line          (inline HTML, like page texts)
const PARTIALS_DIR = path.join(__dirname, '..', 'site-templates', 'partials');
const PARTIAL_RX = /^partials\/(header|footer)\.(az|en|ru)\.html$/;
const isPartial = (rel) => PARTIAL_RX.test(String(rel || ''));
const stripDevComment = (s) => s.replace(/\r\n/g, '\n').replace(/^<!--[\s\S]*?-->\n/, '').replace(/\n$/, '');
const PARTIAL_LABEL = { header: 'Header — yuxarı menyu', footer: 'Footer — altbilgi' };
function scanPartial(html) {
  const out = [];
  const seen = new Map();
  const ident = (prefix, key) => { const base = prefix + sha(key).slice(0, 10); const n = (seen.get(base) || 0) + 1; seen.set(base, n); return n > 1 ? `${base}-${n}` : base; };
  let m;
  const lrx = /<a\b([^>]*?)\shref="([^"]*)"([^>]*)>([^<]*)<\/a>/g;
  while ((m = lrx.exec(html))) {
    if (m[2].includes('{{') || !m[4].trim()) continue;
    const start = m.index, end = m.index + m[0].length;
    const inLi = html.slice(start - 4, start) === '<li>' && html.startsWith('</li>', end);
    out.push({ kind: 'link', tag: 'a', start, end, liStart: inLi ? start - 4 : start, liEnd: inLi ? end + 5 : end, before: m[1], after: m[3], href: decode(m[2]), text: decode(m[4]).trim(), button: /\bbtn\b/.test(m[1] + m[3]) });
  }
  const trx = /<(h2|p|span)(\s[^>]*)?>([^<{]+)<\/\1>/g;
  while ((m = trx.exec(html))) {
    if (m[1] === 'span' && m[2]) continue; // decorative / structural spans
    const innerStart = m.index + m[0].indexOf('>') + 1;
    out.push({ kind: 'text', tag: m[1] === 'span' ? 'copy' : m[1], start: innerStart, end: innerStart + m[3].length, inner: m[3] });
  }
  const nrx = /<nav\b([^>]*)>([\s\S]*?)<\/nav>/g;
  let n = 0;
  while ((m = nrx.exec(html))) {
    const label = decode((/aria-label="([^"]*)"/.exec(m[1]) || [])[1] || `Menyu ${n + 1}`);
    const body = m[0];
    const ul = body.lastIndexOf('</ul>');
    const cta = body.indexOf('<a class="btn btn-primary nav-cta"');
    const at = m.index + (ul !== -1 ? ul : cta !== -1 ? cta : body.lastIndexOf('</nav>'));
    out.push({ kind: 'links', tag: 'nav', start: at, end: at, li: ul !== -1, indent: cta !== -1 ? '      ' : '', navLabel: label, id: `n-${n++}` });
  }
  out.sort((a, b) => a.start - b.start || (a.kind === 'links' ? -1 : 1));
  for (const b of out) if (!b.id) b.id = b.kind === 'link' ? ident('l-', `${b.href}|${b.text}|${b.before}${b.after}`) : ident('t-', `${b.tag}|${norm(b.inner)}`);
  return out;
}
const partialLink = (b, href, text) => `<a${b.before} href="${escHtml(href)}"${b.after}>${escHtml(text)}</a>`;
function applyPartial(html, rel) {
  let o;
  try { o = overridesFor(rel); } catch { return html; }
  if (!Object.keys(o).length) return html;
  const reps = [];
  for (const b of scanPartial(html)) {
    const ov = o[b.id];
    if (!ov) continue;
    let v;
    if (b.kind === 'text' && ov.kind === 'text') reps.push([b.start, b.end, ov.value]);
    else if (b.kind === 'link' && ov.kind === 'link') {
      try { v = JSON.parse(ov.value); } catch { continue; }
      if (v.hidden) reps.push([b.liStart, b.liEnd, '']);
      else reps.push([b.start, b.end, partialLink(b, v.href || b.href, v.text || b.text)]);
    } else if (b.kind === 'links' && ov.kind === 'links') {
      try { v = JSON.parse(ov.value); } catch { continue; }
      if (!Array.isArray(v) || !v.length) continue;
      const items = v.map((x) => `<a href="${escHtml(x.href)}">${escHtml(x.text)}</a>`);
      reps.push([b.start, b.end, b.li ? items.map((a) => `<li>${a}</li>`).join('') : b.indent ? items.map((a) => `${a}\n${b.indent}`).join('') : items.join('')]);
    }
  }
  if (!reps.length) return html;
  reps.sort((a, b) => a[0] - b[0]);
  let out = '', pos = 0;
  for (const [s, e, r] of reps) { if (s < pos) continue; out += html.slice(pos, s) + r; pos = e; }
  return out + html.slice(pos);
}
const cleanLink = (x) => {
  const text = String((x && x.text) || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const href = String((x && x.href) || '').trim().slice(0, 500);
  return { text, href };
};

function safePage(rel) {
  rel = String(rel || '');
  if (isPartial(rel)) {
    const full = path.join(PARTIALS_DIR, rel.slice('partials/'.length));
    return fs.existsSync(full) ? full : null;
  }
  if (!/^(?:[a-z0-9-]+\/)*(?:index|404)\.html$/.test(rel)) return null;
  const full = path.resolve(config.siteDir, rel);
  if (!full.startsWith(config.siteDir + path.sep) || !fs.existsSync(full) || isPanelPage(rel)) return null;
  return full;
}
function partialDetail(rel, o) {
  const [, name, lang] = PARTIAL_RX.exec(rel);
  const html = stripDevComment(fs.readFileSync(safePage(rel), 'utf8'));
  const blocks = scanPartial(html).map((b) => {
    const ov = o[b.id];
    const base = { id: b.id, kind: b.kind, tag: b.tag, edited: !!ov, updated_at: ov ? ov.updated_at : null, updated_by: ov ? ov.updated_by_name || '' : '' };
    let v = null;
    if (ov && ov.kind !== 'text') { try { v = JSON.parse(ov.value); } catch { v = null; } }
    const cls = `${b.before} ${b.after}`;
    if (b.kind === 'link') return { ...base, label: /nav-cta/.test(cls) ? 'Düymə — açılan (mobil) menyuda' : /hdr-cta/.test(cls) ? 'Düymə — yuxarı sağda' : b.button ? 'Düymə' : /\binline\b/.test(cls) ? 'Altbilgi keçidi' : 'Menyu bəndi', original: { text: b.text, href: b.href }, value: v };
    if (b.kind === 'links') return { ...base, label: `Əlavə bəndlər: ${b.navLabel}`, nav: b.navLabel, value: Array.isArray(v) ? v : [] };
    return { ...base, label: b.tag === 'copy' ? 'Müəllif hüququ sətri' : b.tag === 'h2' ? 'Sütun başlığı' : 'Mətn', original: b.inner.trim(), value: ov ? ov.value : null };
  });
  const found = new Set(blocks.map((b) => b.id));
  return { path: rel, url: lang === 'az' ? '/' : `/${lang}/`, lang, partial: name, title: `${PARTIAL_LABEL[name]} (${lang.toUpperCase()})`, seo: null,
    blocks, missing: Object.keys(o).filter((k) => !found.has(k)).length, projects: false, team: false };
}
function pageDetail(rel) {
  const full = safePage(rel);
  if (!full) return null;
  const o = {};
  for (const r of all('SELECT p.block, p.kind, p.value, p.updated_at, u.name AS updated_by_name FROM page_blocks p LEFT JOIN users u ON u.id = p.updated_by WHERE p.page = ?', rel)) o[r.block] = r;
  if (isPartial(rel)) return partialDetail(rel, o);
  const html = fs.readFileSync(full, 'utf8');
  const blocks = scan(html).map((b) => {
    const ov = o[b.id];
    const base = { id: b.id, kind: b.kind, tag: b.tag, label: b.kind === 'image' ? 'Şəkil' : TAG_LABEL[b.tag] || 'Mətn', edited: !!ov, updated_at: ov ? ov.updated_at : null, updated_by: ov ? ov.updated_by_name || '' : '' };
    if (b.kind === 'image') {
      let v = {};
      try { v = ov ? JSON.parse(ov.value) : {}; } catch { v = {}; }
      const m = v.media_id ? get('SELECT id, stored_name, alt FROM media WHERE id = ? AND is_private = 0', v.media_id) : null;
      return { ...base, original_src: b.src, original_alt: b.alt, media_id: m ? m.id : null, src: m ? `/media/${m.stored_name}` : b.src, alt: v.alt || '' };
    }
    return { ...base, original: b.inner.trim(), value: ov ? ov.value : null };
  });
  const seo = seoOf(html);
  const found = new Set(blocks.map((b) => b.id));
  const missing = Object.keys(o).filter((k) => !found.has(k) && !k.startsWith('seo-')).length;
  return { path: rel, url: urlOf(rel), lang: langOf(html), title: seo.title, seo: { title: seo.title, description: seo.description, title_value: o['seo-title'] ? o['seo-title'].value : null, desc_value: o['seo-desc'] ? o['seo-desc'].value : null },
    blocks, missing, projects: html.includes('<!--@projects-->'), team: html.includes('<!--@team-->'), featured: html.includes('<!--@featured-->') };
}
function blockOf(rel, id) {
  const full = safePage(rel);
  if (!full) return null;
  if (isPartial(rel)) return scanPartial(stripDevComment(fs.readFileSync(full, 'utf8'))).find((b) => b.id === id) || null;
  if (id === 'seo-title' || id === 'seo-desc') return { id, kind: 'text', seo: true, original: seoOf(fs.readFileSync(full, 'utf8'))[id === 'seo-title' ? 'title' : 'description'] };
  return scan(fs.readFileSync(full, 'utf8')).find((b) => b.id === id) || null;
}
// Checks a menu value from the panel; throws a message for the person editing it.
function validLink(x, what) {
  const l = cleanLink(x);
  if (!l.text) throw Object.assign(new Error(`${what}: mətn boşdur`), { field: 'text' });
  if (!SAFE_HREF.test(l.href)) throw Object.assign(new Error(`${what}: ünvan düzgün deyil. Saytdakı səhifə (/elaqe/), https://… , mailto: və ya tel: yazın.`), { field: 'href' });
  return l;
}
// value: text -> inline HTML (cleaned); image -> { media_id, alt }; null -> back to the original.
function saveBlock(rel, id, value, user) {
  const b = blockOf(rel, id);
  if (!b) return null;
  let stored = null;
  if (value !== null && value !== undefined) {
    if (b.kind === 'image') stored = JSON.stringify({ media_id: value.media_id, alt: String(value.alt || '').slice(0, 300) });
    else if (b.kind === 'link') stored = JSON.stringify(value.hidden ? { ...cleanLink({ text: value.text || b.text, href: value.href || b.href }), hidden: true } : validLink(value, 'Menyu bəndi'));
    else if (b.kind === 'links') {
      const list = (Array.isArray(value) ? value : []).slice(0, 12).filter((x) => x && (String(x.text || '').trim() || String(x.href || '').trim())).map((x, i) => validLink(x, `${i + 1}-ci bənd`));
      stored = list.length ? JSON.stringify(list) : null;
    } else if (b.seo) stored = String(value).replace(/\s+/g, ' ').trim().slice(0, id === 'seo-title' ? 120 : 300);
    else stored = cleanInline(String(value).trim());
  }
  tx(() => {
    if (stored === null) run('DELETE FROM page_blocks WHERE page = ? AND block = ?', rel, id);
    else run(`INSERT INTO page_blocks (page, block, kind, value, original, updated_at, updated_by) VALUES (?,?,?,?,?,?,?)
              ON CONFLICT(page, block) DO UPDATE SET kind=excluded.kind, value=excluded.value, original=excluded.original, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
    rel, id, b.kind, stored, b.kind === 'image' ? b.src : b.seo ? b.original : b.kind === 'link' ? JSON.stringify({ text: b.text, href: b.href }) : b.kind === 'links' ? '' : b.inner.trim(), now(), user ? user.id : null);
    run('INSERT INTO page_block_history (page, block, kind, value, user_name, created_at) VALUES (?,?,?,?,?,?)', rel, id, b.kind, stored, user ? user.name : '', now());
  });
  bump();
  return { block: b, stored };
}
function history(rel, id) {
  return all('SELECT id, kind, value, user_name, created_at FROM page_block_history WHERE page = ? AND block = ? ORDER BY id DESC LIMIT 30', rel, id);
}

/* ------------------------------------------------------------------ projects */
const pj = (s, d) => { try { const x = JSON.parse(s || ''); return x ?? d; } catch { return d; } };
const slugKey = (s) => String(s || '').toLowerCase().replace(/[əƏ]/g, 'e').replace(/[ıI]/g, 'i').replace(/[öÖ]/g, 'o').replace(/[üÜ]/g, 'u').replace(/[çÇ]/g, 'c').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'diger';
slugKey.full = (s) => String(s || '').toLowerCase().replace(/[əƏ]/g, 'e').replace(/[ıI]/g, 'i').replace(/[öÖ]/g, 'o').replace(/[üÜ]/g, 'u').replace(/[çÇ]/g, 'c').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
const firstPara = (s) => String(s || '').split(/\n\s*\n/)[0].replace(/[*_`#>]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
// Address of a project page per language: Azerbaijani = the panel slug; English and Russian = a latin
// slug made from the English name (so /en/projects/ shows English words), unless two projects would
// get the same one - then the panel slug is used.
function projectSlugs() {
  let rows;
  try { rows = all('SELECT id, slug, i18n FROM projects'); } catch { return new Map(); }
  const en = rows.map((r) => { const t = pj(r.i18n, {}); return [r, String(slugKey.full((t.en && t.en.name) || '') || '')]; });
  const taken = new Map();
  for (const [r, s] of en) if (s) taken.set(s, (taken.get(s) || 0) + 1);
  const azSlugs = new Set(rows.map((r) => r.slug));
  const out = new Map();
  for (const [r, s] of en) {
    const ok = s && taken.get(s) === 1 && (!azSlugs.has(s) || s === r.slug);
    out.set(r.id, { az: r.slug, en: ok ? s : r.slug, ru: ok ? s : r.slug });
  }
  return out;
}
function projectsFor(lang) {
  let rows;
  try { rows = all("SELECT * FROM projects WHERE is_active = 1 AND status <> 'archived' ORDER BY sort_order ASC, id ASC"); } catch { return []; }
  const slugs = projectSlugs();
  return rows.map((r) => {
    const t = localize({ ...r, stats: pj(r.stats, []), i18n: r.i18n }, lang);
    const sl = slugs.get(r.id) || { az: r.slug, en: r.slug, ru: r.slug };
    const gallery = pj(r.gallery, []);
    const stats = (Array.isArray(t.stats) ? t.stats : []).filter((x) => x && (x.label || x.value));
    const paras = String(t.description || '').split(/\n\s*\n/).filter((x) => x.trim()).length;
    const hasPage = !!(r.main_media_id || gallery.length || stats.length || paras > 1);
    const label = t.client || t.sector || t.project_type || '';
    return { row: r, t, gallery, stats, label, key: r.filter_key || slugKey(r.client || r.sector || r.project_type), hasPage, slugs: sl, slug: sl[lang], url: `/${PROJ_DIR[lang]}/${sl[lang]}/` };
  });
}
function filterLabels() {
  try { return pj((get("SELECT value FROM site_meta WHERE key = 'project_filters'") || {}).value, {}); } catch { return {}; }
}
function mediaFile(id) {
  if (!id) return null;
  const m = get("SELECT * FROM media WHERE id = ? AND is_private = 0 AND kind = 'image'", id);
  if (!m || !/^[a-f0-9]{32}\.[a-z0-9]{2,5}$/.test(m.stored_name)) return null;
  let size = null;
  try { size = imageSize(fs.readFileSync(path.join(config.uploadDir, m.stored_name))); } catch { size = null; }
  return { src: `/media/${m.stored_name}`, alt: m.alt || '', width: size ? size.width : 1200, height: size ? size.height : 800 };
}

// The list part of the projects page (between <!--@projects--> and <!--/@projects-->).
function projectsSection(lang, indent) {
  const list = projectsFor(lang);
  const labels = filterLabels();
  // Chips of the imported list keep their original order; new groups follow in the order of the projects.
  const present = new Set(list.map((p) => p.key));
  const keys = Object.keys(labels).filter((k) => present.has(k));
  for (const p of list) if (!keys.includes(p.key)) keys.push(p.key);
  const chipLabel = (k) => (labels[k] && labels[k][lang]) || (list.find((p) => p.key === k) || {}).label || k;
  const ind = indent;
  const lines = [];
  lines.push(`${ind}<div class="filters" role="group" aria-label="${escHtml({ az: 'Sifarişçiyə görə filtr', en: 'Filter by client', ru: 'Фильтр по заказчику' }[lang])}">`);
  lines.push(`${ind}  <button class="chip" type="button" data-f="all" aria-pressed="true">${escHtml(L[lang].all)}</button>`);
  for (const k of keys) lines.push(`${ind}  <button class="chip" type="button" data-f="${escHtml(k)}" aria-pressed="false">${escHtml(chipLabel(k))}</button>`);
  lines.push(`${ind}</div>`);
  lines.push(`${ind}<div class="plist" id="plist">`);
  if (!list.length) lines.push(`${ind}  <p>${escHtml(L[lang].empty)}</p>`);
  for (const p of list) {
    const img = p.hasPage ? mediaFile(p.row.main_media_id) : null;
    const tag = p.label ? `<span class="tag${p.row.tag_style ? ' ' + escHtml(p.row.tag_style) : ''}">${escHtml(p.label)}</span>` : '';
    const thumb = img ? `<img class="pthumb" src="${escHtml(img.src)}" alt="" width="${img.width}" height="${img.height}" loading="lazy" decoding="async">` : '';
    const title = p.hasPage ? `<a href="${escHtml(p.url)}">${escHtml(p.t.name)}</a>` : escHtml(p.t.name);
    const text = firstPara(p.t.description);
    lines.push(`${ind}  <div class="prow" data-f="${escHtml(p.key)}"><div class="who">${tag}${thumb}</div><h3>${title}</h3>${text ? `<p>${escHtml(text)}</p>` : ''}</div>`);
  }
  lines.push(`${ind}</div>`);
  return lines.join('\n') + '\n';
}

// A project page, built like the news pages (same header, footer, styles).
function projectPage(lang, slug) {
  const all_ = projectsFor(lang);
  const p = all_.find((x) => x.slug === slug && x.hasPage);
  if (!p) {
    // an older address of the page (e.g. /en/projects/<Azerbaijani slug>/) -> its current one
    const old = all_.find((x) => x.hasPage && (x.row.slug === slug || x.slugs.en === slug));
    return old ? { redirect: old.url } : null;
  }
  const t = p.t;
  const base = config.siteUrl;
  const l = L[lang];
  const href = {};
  for (const x of LANGS) href[x] = `/${PROJ_DIR[x]}/${p.slugs[x]}/`;
  const main = mediaFile(p.row.main_media_id);
  const gal = p.gallery.map(mediaFile).filter(Boolean);
  const facts = [[l.client, t.client], [l.location, t.location], [l.sector, t.sector], [l.type, t.project_type],
    [l.period, [p.row.start_date, p.row.end_date].filter(Boolean).map((d) => d.split('-').reverse().join('.')).join(' – ')]].filter((x) => x[1]);
  const desc = t.seo_description || firstPara(t.description).slice(0, 300);
  const title = String(t.seo_title || t.name).replace(/\s*[|—–-]\s*AEEC\s*$/i, '') || t.name; // the suffix is added below
  const body = md.render(t.description || '').split('\n').filter((x) => x.trim()).map((x) => '        ' + x).join('\n');
  const parts = [];
  if (main) parts.push(`      <picture class="art-img"><img src="${escHtml(main.src)}" alt="${escHtml(main.alt || t.name)}" width="${main.width}" height="${main.height}" fetchpriority="high" decoding="async"></picture>`);
  if (facts.length) parts.push(`      <dl class="kv pfacts">${facts.map(([k, val]) => `<dt>${escHtml(k)}</dt><dd>${escHtml(val)}</dd>`).join('')}</dl>`);
  if (body) parts.push(`      <div class="art-body">\n${body}\n      </div>`);
  if (p.stats.length) parts.push(`      <h2 class="psub">${escHtml(l.indicators)}</h2>\n      <div class="pstats">${p.stats.map((s) => `<div><b>${escHtml(s.value)}</b><span>${escHtml(s.label)}</span></div>`).join('')}</div>`);
  if (gal.length) parts.push(`      <h2 class="psub">${escHtml(l.gallery)}</h2>\n      <div class="pgal">${gal.map((g) => `<a href="${escHtml(g.src)}" target="_blank" rel="noopener"><img src="${escHtml(g.src)}" alt="${escHtml(g.alt || t.name)}" width="${g.width}" height="${g.height}" loading="lazy" decoding="async"></a>`).join('')}</div>`);
  const og = main ? base + main.src : `${base}/assets/img/og-image.jpg`;
  const ld = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: l.home, item: `${base}${lang === 'az' ? '/' : `/${lang}/`}` },
    { '@type': 'ListItem', position: 2, name: l.projects, item: `${base}/${PROJ_DIR[lang]}/` },
    { '@type': 'ListItem', position: 3, name: t.name, item: base + p.url }] };
  const css = (fs.existsSync(path.join(config.siteDir, 'index.html')) && /style\.css\?v=([\w.]+)/.exec(fs.readFileSync(path.join(config.siteDir, 'index.html'), 'utf8'))) || [];
  const jsv = (fs.existsSync(path.join(config.siteDir, 'index.html')) && /main\.js\?v=([\w.]+)/.exec(fs.readFileSync(path.join(config.siteDir, 'index.html'), 'utf8'))) || [];
  const skip = { az: 'Əsas məzmuna keç', en: 'Skip to main content', ru: 'Перейти к содержимому' }[lang];
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escHtml(title)} | AEEC</title>
<meta name="description" content="${escHtml(desc)}">
<link rel="canonical" href="${escHtml(base + p.url)}">
${LANGS.map((x) => `<link rel="alternate" hreflang="${x}" href="${escHtml(base + href[x])}">`).join('\n')}
<link rel="alternate" hreflang="x-default" href="${escHtml(base + href.az)}">
<meta name="theme-color" content="#0E2147">
<meta name="format-detection" content="telephone=no">
<meta property="og:type" content="article">
<meta property="og:site_name" content="AEEC">
<meta property="og:title" content="${escHtml(title)} | AEEC">
<meta property="og:description" content="${escHtml(desc)}">
<meta property="og:url" content="${escHtml(base + p.url)}">
<meta property="og:image" content="${escHtml(og)}">
<meta property="og:locale" content="${l.locale}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Display:wght@600;700;800&amp;family=Noto+Sans:wght@400;500;600;700&amp;family=Noto+Sans+Mono:wght@500&amp;display=swap">
<link rel="stylesheet" href="/assets/css/style.css?v=${escHtml(css[1] || '3.3')}">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
</head>
<body data-site-lang="${lang}">
<a class="skip" href="#main">${skip}</a>
<!--@header page="/${PROJ_DIR[lang]}/" az="${href.az}" en="${href.en}" ru="${href.ru}"-->

<main id="main" class="reveal" tabindex="-1">
<section class="hero-page"><div class="wrap">
    <nav class="crumbs" aria-label="${escHtml(l.crumbs)}"><a href="${lang === 'az' ? '/' : `/${lang}/`}">${escHtml(l.home)}</a><span aria-hidden="true">/</span><a href="/${PROJ_DIR[lang]}/">${escHtml(l.projects)}</a></nav>
    ${p.label ? `<p class="eyebrow">${escHtml(p.label)}</p>\n    ` : ''}<h1 class="art-title">${escHtml(t.name)}</h1>
  </div></section>
  <section class="band"><div class="wrap">
    <article class="article project">
${parts.join('\n')}
      <p class="art-foot"><a class="btn btn-line" href="/${PROJ_DIR[lang]}/"><span aria-hidden="true">←</span> ${escHtml(l.back)}</a></p>
    </article>
  </div></section>
</main>

<!--@footer page="/${PROJ_DIR[lang]}/" az="${href.az}" en="${href.en}" ru="${href.ru}"-->
<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
<script src="/assets/js/main.js?v=${escHtml(jsv[1] || '3.3')}" defer></script>
</body>
</html>
`;
}
// "/layiheler/foo/" -> { lang, slug } when it is a project page address.
function matchProjectPath(p) {
  for (const l of LANGS) {
    const m = new RegExp(`^/${PROJ_DIR[l].replace('/', '\\/')}/([a-z0-9]+(?:-[a-z0-9]+)*)/$`).exec(p);
    if (m) return { lang: l, slug: m[1] };
  }
  return null;
}

// Project pages in sitemap.xml (added when the sitemap is served; the file itself is not changed).
function sitemapWithProjects(xml) {
  let pages;
  try { pages = projectsFor('az').filter((p) => p.hasPage); } catch { return xml; }
  if (!pages.length) return xml;
  const base = config.siteUrl;
  const add = pages.map((p) => {
    const day = String(p.row.updated_at || '').slice(0, 10);
    const lines = LANGS.map((l) => [
      '  <url>', `    <loc>${escHtml(`${base}/${PROJ_DIR[l]}/${p.slugs[l]}/`)}</loc>`, `    <lastmod>${day}</lastmod>`,
      ...LANGS.map((x) => `    <xhtml:link rel="alternate" hreflang="${x}" href="${escHtml(`${base}/${PROJ_DIR[x]}/${p.slugs[x]}/`)}"/>`),
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${escHtml(`${base}/${PROJ_DIR.az}/${p.row.slug}/`)}"/>`, '  </url>'].join('\n'));
    return lines.join('\n') + '\n';
  }).join('');
  return xml.replace('</urlset>', add + '</urlset>');
}

/* ------------------------------------------------------------------ home page project cards */
const RESULT = { az: 'Nəticə', en: 'Result', ru: 'Результат' };
// The text under a "## Nəticə" / "## Result" / "## Результат" heading of the description, if any.
function resultOf(desc, lang) {
  const rx = /^##\s*(Nəticə|Result|Результат)\s*$/im;
  const m = rx.exec(String(desc || ''));
  if (!m) return '';
  return firstPara(String(desc).slice(m.index + m[0].length).replace(/^\s+/, '').split(/\n##\s/)[0]);
}
function featuredSection(lang, ind) {
  if (!projectsManaged()) return '';
  const cards = [];
  for (const p of projectsFor(lang)) {
    if (cards.length === 3) break;
    const img = p.hasPage ? mediaFile(p.row.main_media_id) : null;
    if (!img) continue;
    const text = firstPara(p.t.description);
    const res = resultOf(p.t.description, lang);
    const tag = p.label ? `<span class="tag${p.row.tag_style ? ' ' + escHtml(p.row.tag_style) : ''}">${escHtml(p.label)}</span>` : '';
    cards.push(`${ind}<article class="proj">
${ind}  <a class="ph" href="${escHtml(p.url)}" tabindex="-1" aria-hidden="true"><img src="${escHtml(img.src)}" alt="" width="${img.width}" height="${img.height}" loading="lazy" decoding="async"></a>
${ind}  <div class="bd">${tag}<h3><a href="${escHtml(p.url)}">${escHtml(p.t.name)}</a></h3>${text ? `<p>${escHtml(text)}</p>` : ''}${res ? `<p class="res"><b>${RESULT[lang]}:</b> ${escHtml(res)}</p>` : ''}</div>
${ind}</article>`);
  }
  return cards.length ? cards.join('\n') + '\n' : '';
}

/* ------------------------------------------------------------------ team */
function teamSection(lang) {
  let rows;
  try { rows = all('SELECT * FROM team_members WHERE is_active = 1 ORDER BY sort_order ASC, id ASC'); } catch { return ''; }
  if (!rows.length) return '';
  const l = L[lang];
  const cards = rows.map((r) => {
    const t = localize(r, lang);
    const ph = mediaFile(r.photo_media_id);
    return `<div class="tcard">${ph ? `<img src="${escHtml(ph.src)}" alt="${escHtml(t.name)}" width="${ph.width}" height="${ph.height}" loading="lazy" decoding="async">` : `<span class="tavatar" aria-hidden="true">${escHtml(String(t.name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase())}</span>`}`
      + `<h3>${escHtml(t.name)}</h3>${t.position ? `<p class="tpos">${escHtml(t.position)}</p>` : ''}${t.biography ? `<p>${escHtml(firstPara(t.biography))}</p>` : ''}</div>`;
  }).join('');
  return `<section class="band"><div class="wrap">\n    <div class="sec-head"><div><p class="eyebrow">${escHtml(l.team)}</p><h2>${escHtml(l.team_h)}</h2></div></div>\n    <div class="tgrid">${cards}</div>\n  </div></section>`;
}

/* ------------------------------------------------------------------ directives (used by site-layout) */
function renderDirectives(html, lang) {
  let out = html;
  if (out.includes('<!--@projects-->') && projectsManaged()) {
    out = out.replace(/([ \t]*)<!--@projects-->\n[\s\S]*?[ \t]*<!--\/@projects-->\n/, (m, ind) => projectsSection(lang, ind));
  } else {
    out = out.replace(/[ \t]*<!--\/?@projects-->\n/g, '');
  }
  out = out.replace(/[ \t]*<!--@team-->\n?/g, () => { const s = teamSection(lang); return s ? `  ${s}\n` : ''; });
  if (out.includes('<!--@featured-->')) {
    out = out.replace(/([ \t]*)<!--@featured-->\n([\s\S]*?)[ \t]*<!--\/@featured-->\n/, (m, ind, orig) => featuredSection(lang, ind) || orig);
  }
  return out;
}
function projectsManaged() {
  try { return !!get("SELECT value FROM site_meta WHERE key = 'projects_imported'"); } catch { return false; }
}

/* ------------------------------------------------------------------ first-run import of the project list */
function importProjects() {
  if (projectsManaged()) return 0;
  const read = (l) => { try { return fs.readFileSync(path.join(config.siteDir, PROJ_DIR[l], 'index.html'), 'utf8'); } catch { return null; } };
  const pages = {};
  for (const l of LANGS) pages[l] = read(l);
  if (!pages.az || !pages.az.includes('<!--@projects-->')) return 0;
  const region = (html) => (/<!--@projects-->\n([\s\S]*?)<!--\/@projects-->/.exec(html || '') || [])[1] || '';
  const rows = (html) => [...region(html).matchAll(/<div class="prow" data-f="([^"]*)"><div class="who"><span class="tag( [^"]*)?">([^<]*)<\/span><\/div><h3>([\s\S]*?)<\/h3><p>([\s\S]*?)<\/p><\/div>/g)]
    .map((m) => ({ key: m[1], style: (m[2] || '').trim(), tag: decode(m[3]), name: decode(m[4]), text: decode(m[5]) }));
  const chips = (html) => Object.fromEntries([...region(html).matchAll(/<button class="chip" type="button" data-f="([^"]+)" aria-pressed="[^"]*">([^<]*)<\/button>/g)].filter((m) => m[1] !== 'all').map((m) => [m[1], decode(m[2])]));
  const az = rows(pages.az), en = rows(pages.en), ru = rows(pages.ru);
  const labels = {};
  for (const l of LANGS) for (const [k, v] of Object.entries(chips(pages[l]))) { labels[k] = labels[k] || {}; labels[k][l] = v; }
  const existing = get('SELECT COUNT(*) AS n FROM projects').n;
  const { slugify, uniqueSlug } = require('./crud');
  let n = 0;
  tx(() => {
    az.forEach((r, i) => {
      const i18n = {};
      for (const [l, list] of [['en', en], ['ru', ru]]) {
        const x = list[i];
        if (x && x.key === r.key) i18n[l] = { name: x.name, description: x.text, client: x.tag };
      }
      const ts = now();
      run(`INSERT INTO projects (slug, name, client, description, status, is_active, i18n, sort_order, filter_key, tag_style, created_at, updated_at)
           VALUES (?,?,?,?,?,1,?,?,?,?,?,?)`, uniqueSlug('projects', slugify(i18n.en ? i18n.en.name : r.name) || slugify(r.name), 0), r.name, r.tag, r.text, 'completed',
      JSON.stringify(i18n), i + 1, r.key, r.style, ts, ts);
      n++;
    });
    // Projects that already existed in the panel (added before this version) come after the imported
    // ones and keep their "Saytda göstər" setting.
    if (existing) run('UPDATE projects SET sort_order = sort_order + ? WHERE filter_key = \'\'', az.length);
    run('INSERT OR REPLACE INTO site_meta (key, value) VALUES (?, ?)', 'project_filters', JSON.stringify(labels));
    run('INSERT OR REPLACE INTO site_meta (key, value) VALUES (?, ?)', 'projects_imported', now());
  });
  if (n) console.log(`[site-content] Saytdakı ${n} layihə panelə köçürüldü.`);
  bump();
  return n;
}

function init() {
  try { importProjects(); } catch (e) { console.error('[site-content] layihələrin idxalı', e); }
}

module.exports = {
  version, bump, init, importProjects, applyBlocks, applyPartial, scanPartial, isPartial, renderDirectives, scan, cleanInline, listPages, pageDetail, saveBlock, history, blockOf,
  projectPage, matchProjectPath, sitemapWithProjects, projectsSection, teamSection, PROJ_DIR, LANGS,
};
