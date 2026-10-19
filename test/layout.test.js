'use strict';
// Website components and central company data:
//  - header/footer exist once per language (site-templates/partials) and every page uses them;
//  - social links, e-mail, phone and address come from the panel and reach every page;
//  - dangerous social links are refused; new requests are mailed to the company e-mail;
//  - every internal link and asset of every page answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, Client, sleep, mails } = require('./helpers');

const ADMIN = ['office@aeec.az', 'Sinaq-Parol-2026!'];
const NEWPW = 'Komponent-Yoxlama-77!';
let T, admin, db, visitor;

// Every real page of the site (redirect stubs and empty folder guards are not pages).
function sitePages(root) {
  const out = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.html')) { const s = fs.readFileSync(p, 'utf8'); if (/<html lang=/.test(s) && /<body/.test(s) && s.includes('<main')) out.push(path.relative(root, p)); }
    }
  })(root);
  return out;
}
const urlOf = (rel) => (rel === '404.html' ? '/olmayan-sehife/' : '/' + rel.replace(/index\.html$/, ''));
const page = async (u) => { const r = await visitor.get(u); return { status: r.status, html: r.data.toString() }; };

test.before(async () => {
  T = await boot();
  db = T.req('src/db');
  admin = new Client(T.base, '10.8.0.1');
  visitor = new Client(T.base, '10.8.0.2');
  await admin.login(...ADMIN);
  assert.equal((await admin.post('/api/auth/password', { current: ADMIN[1], password: NEWPW })).status, 200);
  await admin.login(ADMIN[0], NEWPW);
});
test.after(() => { T.stop(); setTimeout(() => process.exit(0), 200).unref(); });

test('header and footer are single components used by every page and template', () => {
  const pages = sitePages(T.origSite);
  assert.ok(pages.length >= 40, `pages found: ${pages.length}`);
  for (const rel of pages) {
    const s = fs.readFileSync(path.join(T.origSite, rel), 'utf8');
    assert.equal((s.match(/<!--@header /g) || []).length, 1, `${rel}: one @header directive`);
    assert.equal((s.match(/<!--@footer /g) || []).length, 1, `${rel}: one @footer directive`);
    assert.ok(!s.includes('<header class="site-header">') && !s.includes('<footer class="foot">'), `${rel}: no copied header/footer`);
  }
  const tpl = path.join(T.origSite, '..', 'site-templates');
  for (const f of fs.readdirSync(tpl).filter((x) => x.endsWith('.html'))) assert.match(fs.readFileSync(path.join(tpl, f), 'utf8'), /<!--@header [\s\S]*<!--@footer /, f);
  // Social network addresses are written in ONE place in the code: src/company.js.
  const offenders = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) { if (!['node_modules', 'data', 'test', '.git', 'docs'].includes(f)) walk(p); continue; }
      if (!/\.(html|js|json)$/.test(f) || p.endsWith(path.join('src', 'company.js'))) continue;
      if (/linkedin\.com\/company|facebook\.com\/AeecCompany/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(path.join(T.origSite, '..'), p));
    }
  })(path.join(T.origSite, '..'));
  assert.deepEqual(offenders, [], 'social links hard-coded outside src/company.js');
});

test('served pages: complete layout, active menu item, language links', async () => {
  for (const rel of sitePages(T.siteDir)) {
    const { status, html } = await page(urlOf(rel));
    assert.equal(status, rel === '404.html' ? 404 : 200, rel);
    assert.ok(!html.includes('<!--@'), `${rel}: a directive was left in the page`);
    assert.equal((html.match(/<header class="site-header">/g) || []).length, 1, rel);
    assert.equal((html.match(/<footer class="foot">/g) || []).length, 1, rel);
    assert.match(html, /<p class="social"><a href="https:\/\/www\.linkedin\.com\/company\/9441410\/" target="_blank" rel="noopener noreferrer">LinkedIn/, rel);
  }
  const about = (await page('/en/about/')).html;
  assert.match(about, /<a href="\/en\/about\/" aria-current="page">About<\/a>/);
  assert.match(about, /<a href="\/haqqimizda\/" lang="az" hreflang="az" data-lang="az" aria-label="Azərbaycan dili">AZ<\/a>/);
  assert.match(about, /<a href="\/en\/about\/" lang="en" hreflang="en" data-lang="en" aria-label="English" aria-current="true">EN<\/a>/);
  const news = (await page('/ru/news/iea-energy-efficiency-cop29/')).html;
  assert.match(news, /<a href="\/ru\/news\/" class="is-section">Новости<\/a>/);
  assert.match(news, /<a href="\/xeberler\/iea-enerji-semereliliyi-cop29\/" lang="az"/);
  // the developer comment of a partial is never sent
  assert.ok(!about.includes('Komponent:'));
});

test('social links: one change in the panel appears on every page, contact page and structured data', async () => {
  const ig = 'https://www.instagram.com/aeec_sinaq/';
  const before = (await admin.get('/api/settings')).data.settings.social;
  const r = await admin.put('/api/settings/social', { ...before, instagram: ig });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  for (const rel of sitePages(T.siteDir)) {
    const { html } = await page(urlOf(rel));
    assert.ok(html.includes(`<a href="${ig}" target="_blank" rel="noopener noreferrer">Instagram<span class="sr-only">`), `${rel}: Instagram in the footer`);
  }
  assert.match((await page('/elaqe/')).html, new RegExp(`<dt>Sosial şəbəkələr</dt><dd class="social">.*<a href="${ig}"[^>]*>Instagram`));
  assert.match((await page('/en/contact/')).html, /<dt>Social media<\/dt><dd class="social">/);
  assert.match((await page('/ru/')).html, /"sameAs": \["https:\/\/www\.linkedin\.com\/company\/9441410\/", "https:\/\/www\.facebook\.com\/AeecCompany\/", "https:\/\/www\.instagram\.com\/aeec_sinaq\/"\]/);
  // the public settings API gives the same value (one source)
  assert.equal((await visitor.get('/api/public/settings')).data.social.instagram, ig);
  // the page cache follows the change (no stale ETag)
  const e1 = (await visitor.get('/haqqimizda/')).headers.get('etag');
  await admin.put('/api/settings/social', { ...before, instagram: '' });
  const e2 = (await visitor.get('/haqqimizda/')).headers.get('etag');
  assert.notEqual(e1, e2);
  assert.ok(!(await page('/haqqimizda/')).html.includes('instagram.com'));
  // switching the footer links off (Tənzimləmələr → Footer)
  const foot = (await admin.get('/api/settings')).data.settings.footer;
  await admin.put('/api/settings/footer', { ...foot, show_social: false });
  assert.ok(!(await page('/')).html.includes('<p class="social">'));
  await admin.put('/api/settings/footer', { ...foot, show_social: true });
  assert.ok((await page('/')).html.includes('<p class="social">'));
});

test('social links: unsafe or wrong addresses are refused', async () => {
  const bad = {
    instagram: ['http://www.instagram.com/aeec/', 'javascript:alert(1)', 'https://instagram.com.evil.example/aeec', 'https://evil.example/instagram.com', 'https://user:pw@www.instagram.com/aeec',
      'https://www.instagram.com/a"onmouseover="x', 'data:text/html,<script>alert(1)</script>', 'https://www.instagram.com/<script>'],
    linkedin: ['https://www.facebook.com/AeecCompany/'],
    other: ['ftp://example.az/file', 'https://localhost/'],
  };
  for (const [k, list] of Object.entries(bad)) {
    for (const val of list) {
      const r = await admin.put('/api/settings/social', { [k]: val });
      assert.equal(r.status, 422, `${k}=${val}`);
      assert.ok(r.data.error.fields[k], `${k}=${val}: field error`);
    }
  }
  for (const [k, val] of [['instagram', 'https://instagram.com/aeec'], ['youtube', 'https://youtu.be/x'], ['telegram', 'https://t.me/aeec'], ['other', 'https://www.example.az/aeec']]) {
    const r = await admin.put('/api/settings/social', { linkedin: 'https://www.linkedin.com/company/9441410/', [k]: val });
    assert.equal(r.status, 200, `${k}=${val} ${JSON.stringify(r.data)}`);
  }
  const s = (await admin.get('/api/settings')).data.settings.social;
  assert.equal(s.instagram, '', 'previous save replaced the whole group');
  assert.equal(s.other, 'https://www.example.az/aeec');
  const html = (await page('/')).html;
  assert.match(html, /<a href="https:\/\/www\.example\.az\/aeec" target="_blank" rel="noopener noreferrer">example\.az<span/);
  // restore the defaults for the other tests
  assert.equal((await admin.put('/api/settings/social', { linkedin: 'https://www.linkedin.com/company/9441410/', facebook: 'https://www.facebook.com/AeecCompany/' })).status, 200);
});

test('company e-mail, phone and address from the panel reach every page; requests are mailed to it', async () => {
  const c0 = (await admin.get('/api/settings')).data.settings.contact;
  assert.equal(c0.email, 'office@aeec.az');
  assert.equal((await admin.put('/api/settings/contact', { ...c0, email: 'info@aeec.az', phone: '+994 12 555 66 77', address: 'Bakı şəhəri, Nizami küçəsi 1', i18n: { en: { address: 'Nizami Street 1, Baku' } } })).status, 200);
  for (const rel of sitePages(T.siteDir)) {
    const { html } = await page(urlOf(rel));
    assert.ok(!html.includes('office@aeec.az'), `${rel}: old e-mail left`);
    assert.ok(html.includes('mailto:info@aeec.az'), `${rel}: new e-mail`);
    assert.ok(!html.includes('+994503623038') && html.includes('tel:+994125556677'), `${rel}: phone`);
  }
  assert.match((await page('/elaqe/')).html, /<dt>Ünvan<\/dt><dd>Bakı şəhəri, Nizami küçəsi 1<\/dd>/);
  assert.match((await page('/en/')).html, /<address>Nizami Street 1, Baku<br>/);
  // no RU translation given -> the Azerbaijani address (never the outdated default)
  assert.match((await page('/ru/')).html, /<address>Bakı şəhəri, Nizami küçəsi 1<br>/);
  // a new website request goes to the company e-mail (no recipient list configured)
  mails.length = 0;
  const f = await visitor.req('POST', '/api/public/form', { json: { form: 'contact', lang: 'az', page: '/elaqe/', consent: true, aeec_hp: '', elapsed: 5000, name: 'Sınaq', email: 'sinaq@example.az', message: 'Salam' }, headers: { Origin: 'https://aeec.az' } });
  assert.equal(f.status, 201);
  for (let i = 0; i < 60 && !mails.length; i++) await sleep(50);
  assert.ok(mails.length, 'notification sent');
  assert.deepEqual(mails[0].to, ['info@aeec.az']);
  // restore: the defaults again give the original pages
  assert.equal((await admin.put('/api/settings/contact', c0)).status, 200);
  const home = (await page('/')).html;
  assert.ok(home.includes('mailto:office@aeec.az') && home.includes('tel:+994503623038'));
  assert.ok(home.includes(fs.readFileSync(path.join(T.siteDir, '..', 'site-templates', 'partials', 'footer.az.html'), 'utf8').match(/<address>.*<\/address>/)[0]));
});

test('upgrade 1.3: links saved empty before 1.3 are filled once, other values are kept', async () => {
  db.run("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('social', ?, ?)", JSON.stringify({ linkedin: '', facebook: '', instagram: 'https://www.instagram.com/aeec/' }), new Date().toISOString());
  db.run("DELETE FROM site_meta WHERE key = 'social_v13'");
  T.req('src/seed').upgradeSocialSettings();
  const s = (await admin.get('/api/settings')).data.settings.social;
  assert.equal(s.linkedin, 'https://www.linkedin.com/company/9441410/');
  assert.equal(s.facebook, 'https://www.facebook.com/AeecCompany/');
  assert.equal(s.instagram, 'https://www.instagram.com/aeec/');
  // runs only once: emptying a link afterwards is respected
  await admin.put('/api/settings/social', { ...s, facebook: '' });
  T.req('src/seed').upgradeSocialSettings();
  assert.equal((await admin.get('/api/settings')).data.settings.social.facebook, '');
  await admin.put('/api/settings/social', { linkedin: 'https://www.linkedin.com/company/9441410/', facebook: 'https://www.facebook.com/AeecCompany/' });
});

test('system status reports the mail transport (was hidden by a comment)', async () => {
  const s = (await admin.get('/api/system')).data;
  assert.equal(s.mail_transport, 'smtp');
  assert.equal(s.site_dir, T.siteDir);
});

test('old addresses still redirect (the server does it; the old redirect files were removed)', async () => {
  const s = fs.readFileSync(path.join(T.proj, 'src', 'site-static.js'), 'utf8');
  const pairs = [...s.matchAll(/'([\w/]+\.html)': '(\/[\w/-]*)'/g)].map((m) => [m[1], m[2]]);
  assert.ok(pairs.length >= 30, `redirects found: ${pairs.length}`);
  for (const [from, to] of pairs) {
    for (const u of [`/${from}`, `/${from.replace(/^([a-z]+)/, (x) => x[0].toUpperCase() + x.slice(1))}`].filter((x, i) => i === 0 || /service|more/i.test(from))) {
      const r = await visitor.get(u);
      assert.equal(r.status, 301, u);
      assert.equal(r.headers.get('location'), to, u);
      assert.equal((await visitor.get(to)).status, 200, to);
    }
  }
});

test('no broken internal links or assets on any page', async () => {
  const seen = new Map();
  const bad = [];
  for (const rel of sitePages(T.siteDir)) {
    const { html } = await page(urlOf(rel));
    const refs = [...html.matchAll(/\s(?:href|src)="(\/[^"#?]*)(?:[?#][^"]*)?"/g), ...html.matchAll(/\ssrcset="([^"]+)"/g)]
      .flatMap((m) => (m[0].includes('srcset') ? m[1].split(',').map((x) => x.trim().split(/\s+/)[0]) : [m[1]]))
      .filter((u) => u.startsWith('/') && !u.startsWith('//'));
    for (const u of refs) {
      if (!seen.has(u)) {
        let r = await visitor.get(u);
        if (r.status === 301) r = await visitor.get(r.headers.get('location'));
        seen.set(u, r.status);
      }
      if (seen.get(u) !== 200) bad.push(`${urlOf(rel)} -> ${u} (${seen.get(u)})`);
    }
  }
  assert.ok(seen.size > 50, `links checked: ${seen.size}`);
  assert.deepEqual(bad, []);
});
