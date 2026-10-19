'use strict';
// Website layout: shared components (header, footer) and company data from the panel.
//
// The pages in site/ are static HTML files. Parts that are the same on every page are NOT copied
// into each file any more; a page contains a one-line directive instead:
//
//   <!--@header page="/haqqimizda/" az="/haqqimizda/" en="/en/about/" ru="/ru/about/"-->
//   <!--@footer page="/haqqimizda/" az="/haqqimizda/" en="/en/about/" ru="/ru/about/"-->
//
//   page      address of this page (marks the active menu item; "" = none)
//   az/en/ru  where the language switcher leads (the same page in that language)
//
// The component itself lives in site-templates/partials/{header,footer}.<lang>.html — one file
// per language; the language is taken from <html lang="…"> of the page. To change the menu, the
// footer links or the logo, edit those six files only.
//
// While a page is being served (src/site-static.js) this module also applies the panel values
// (Tənzimləmələr → Əlaqə / Sosial şəbəkələr), so they appear everywhere at once:
//   - WhatsApp button: <!--@whatsapp--> on the Contact pages (number and greeting from the panel);
//   - social links: footer of every page, <!--@social-row--> on the Contact pages, and the JSON-LD
//     "sameAs": [] of the home and contact pages (filled in here; empty list removed);
//   - e-mail, phone and address: every place where a page shows the default value from
//     src/company.js is replaced by the current value.
// Nothing here writes to the files; the result is cached in memory until the file or a setting changes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { company, SOCIAL_NETWORKS, phoneHref } = require('./company');
const { v } = require('./validate');

const LANGS = ['az', 'en', 'ru'];
const PARTIALS_DIR = path.join(__dirname, '..', 'site-templates', 'partials');
// Visually hidden note after links that open a new window (accessibility), per language.
const NEW_WINDOW = { az: ' (yeni pəncərədə açılır)', en: ' (opens in a new window)', ru: ' (откроется в новом окне)' };
const SOCIAL_ROW_LABEL = { az: 'Sosial şəbəkələr', en: 'Social media', ru: 'Соцсети' };
const WA_LABEL = { az: 'WhatsApp ilə yazın', en: 'Message us on WhatsApp', ru: 'Написать в WhatsApp' };
const WA_TEXT = { az: 'Salam! AEEC saytından yazıram.', en: 'Hello! I am writing from the AEEC website.', ru: 'Здравствуйте! Пишу с сайта AEEC.' };

const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unescHtml = (s) => String(s ?? '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/* ------------------------------------------------------------------ partials */
const partialCache = new Map();
function partial(name, lang) {
  const file = path.join(PARTIALS_DIR, `${name}.${lang}.html`);
  let st;
  try { st = fs.statSync(file); } catch { throw new Error(`Komponent tapılmadı: site-templates/partials/${name}.${lang}.html`); }
  const key = `${file}|${st.mtimeMs}|${st.size}`;
  // The explanatory comment at the top of a partial is for developers and is not sent to visitors.
  if (!partialCache.has(key)) partialCache.set(key, fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/^<!--[\s\S]*?-->\n/, '').replace(/\n$/, ''));
  return partialCache.get(key);
}

// Attributes of a directive: page="/x/" az="/" … Only site paths are accepted (no other domains).
function parseAttrs(s) {
  const out = {};
  for (const m of String(s).matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = unescHtml(m[2]);
  for (const k of ['page', ...LANGS]) if (out[k] !== undefined && !/^(\/[\w\-./#]*)?$/.test(out[k])) out[k] = '/';
  return out;
}

// Marks the active item of the main menu: the page itself -> aria-current="page";
// a page inside that section (e.g. one news item under /xeberler/) -> class="is-section".
function markNav(html, page) {
  if (!page) return html;
  return html.replace(/(<nav class="nav"[^>]*>)([\s\S]*?)(<\/nav>)/, (m, open, body, close) => open + body.replace(/<a href="([^"]+)">/g, (a, href) => {
    if (href === page) return `<a href="${href}" aria-current="page">`;
    if (href !== '/' && page.startsWith(href)) return `<a href="${href}" class="is-section">`;
    return a;
  }) + close);
}

/* ------------------------------------------------------------------ panel values */
// Current values of the panel groups the website uses. Values that would not pass today's rules
// (e.g. an old http:// link) are not shown.
function siteData(getSetting) {
  const contact = getSetting('contact') || {};
  const social = getSetting('social') || {};
  const footer = getSetting('footer') || {};
  const links = [];
  for (const n of SOCIAL_NETWORKS) {
    let url = '';
    try { url = v.socialUrl(n.hosts)(social[n.key] || ''); } catch { url = ''; }
    if (url) links.push({ key: n.key, url, label: n.label || new URL(url).hostname.replace(/^www\./, '') });
  }
  let i18n = contact.i18n || {};
  if (typeof i18n === 'string') { try { i18n = JSON.parse(i18n); } catch { i18n = {}; } }
  // Address per language: the translation from the panel; if there is none and the main address is
  // still the default one, the default translation of that language (the site never shows an
  // Azerbaijani address on an English page just because the translation field was left empty).
  const address = {};
  for (const l of LANGS) {
    const own = l === 'az' ? contact.address : i18n[l] && i18n[l].address;
    address[l] = own || (contact.address && contact.address !== company.address.az ? contact.address : company.address[l]);
  }
  // WhatsApp: wa.me needs the number with its country code, digits only; a number that is not in
  // international form (e.g. starts with 0) is not shown rather than leading to a wrong chat.
  const waDigits = String(contact.whatsapp || '').replace(/\D/g, '');
  const waMessage = {};
  for (const l of LANGS) waMessage[l] = (l === 'az' ? contact.whatsapp_message : i18n[l] && i18n[l].whatsapp_message) || contact.whatsapp_message || WA_TEXT[l];
  return {
    whatsapp: /^[1-9]\d{9,14}$/.test(waDigits) ? waDigits : '',
    waMessage,
    email: contact.email || company.email,
    phone: contact.phone || company.phone,
    address,
    links,
    showSocial: footer.show_social === undefined ? true : !!footer.show_social,
  };
}

const socialLinks = (d, lang) => d.links.map((x) => `<a href="${escHtml(x.url)}" target="_blank" rel="noopener noreferrer">${escHtml(x.label)}<span class="sr-only">${NEW_WINDOW[lang]}</span></a>`).join('');

/* ------------------------------------------------------------------ rendering */
// Builds the page that visitors receive from the file in site/.
function renderPage(html, data) {
  const lang = (/<html lang="(az|en|ru)"/.exec(html) || [])[1] || 'az';
  let out = html.replace(/<!--@(header|footer)\b([^>]*?)-->/g, (m, name, attrs) => {
    const a = parseAttrs(attrs);
    const cur = (l) => (l === lang ? ' aria-current="true"' : '');
    let p = partial(name, lang).replace(/\{\{(href|cur)_(az|en|ru)\}\}/g, (x, kind, l) => (kind === 'href' ? escHtml(a[l] || (l === 'az' ? '/' : `/${l}/`)) : cur(l)));
    if (name === 'header') p = markNav(p, a.page || '');
    const social = data.showSocial && data.links.length ? `<p class="social">${socialLinks(data, lang)}</p>` : '';
    // The line that holds {{social}} disappears completely when there is nothing to show.
    return p.replace(/\n[ \t]*\{\{social\}\}/, social ? (s) => s.replace('{{social}}', social) : '');
  });
  // Contact page: a "Social media" row in the office details (only when there are links).
  out = out.replace(/<!--@social-row-->/g, () => (data.links.length ? `<dt>${SOCIAL_ROW_LABEL[lang]}</dt><dd class="social">${socialLinks(data, lang)}</dd>` : ''));
  // Contact page: WhatsApp button (only when a number is set in the panel).
  out = out.replace(/<!--@whatsapp-->/g, () => (data.whatsapp
    ? `<p class="wa-row"><a class="btn btn-wa" href="https://wa.me/${data.whatsapp}?text=${encodeURIComponent(data.waMessage[lang])}" target="_blank" rel="noopener noreferrer"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5z"/></svg>${WA_LABEL[lang]}<span class="sr-only">${NEW_WINDOW[lang]}</span></a></p>`
    : ''));
  // Structured data for search engines: the organisation's profiles.
  out = out.replace(/, "sameAs": \[[^\]]*\]/g, () => (data.links.length ? `, "sameAs": ${JSON.stringify(data.links.map((x) => x.url)).replace(/,/g, ', ')}` : ''));
  // Contact details: the defaults written in the pages -> current panel values.
  if (data.email !== company.email) out = out.split(company.email).join(escHtml(data.email));
  if (data.phone !== company.phone) {
    out = out.split(company.phone).join(escHtml(data.phone));
    out = out.split(phoneHref(company.phone)).join(escHtml(phoneHref(data.phone)));
  }
  if (data.address[lang] !== company.address[lang]) out = out.split(escHtml(company.address[lang])).join(escHtml(data.address[lang]));
  return out;
}

/* ------------------------------------------------------------------ cache */
// Rendered pages are kept in memory, keyed by the file's size/time and by the settings version
// (src/settings.js increases it on every save), so a change is visible on the next request.
const pageCache = new Map();
function servedPage(full, st, settings) {
  const key = `${full}|${st.size}|${st.mtimeMs}|${settings.version()}`;
  let entry = pageCache.get(key);
  if (!entry) {
    const body = Buffer.from(renderPage(fs.readFileSync(full, 'utf8'), siteData(settings.getSetting)), 'utf8');
    entry = { body, etag: `"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 22)}"` };
    if (pageCache.size > 400) pageCache.clear();
    pageCache.set(key, entry);
  }
  return entry;
}

module.exports = { renderPage, siteData, servedPage, parseAttrs, markNav, LANGS, PARTIALS_DIR };
