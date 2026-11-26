'use strict';
// The website edited from the panel (src/site-content.js, src/routes/pages.js):
// project list and project pages, texts / images / SEO of the pages ("Səhifələr"), team, roles.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, Client, PNG, fileForm } = require('./helpers');

const ADMIN = ['office@aeec.az', 'Sinaq-Parol-2026!'];
const NEWPW = 'Sehifeler-Parol-77!';
let T, admin;
const html = async (c, url) => { const r = await c.get(url); return { status: r.status, text: Buffer.isBuffer(r.data) ? r.data.toString('utf8') : JSON.stringify(r.data), headers: r.headers }; };
const region = (s) => (/(<div class="filters"[\s\S]*?<div class="plist" id="plist">[\s\S]*?\n {4}<\/div>\n)/.exec(s) || [])[1];

test.before(async () => {
  T = await boot();
  admin = new Client(T.base, '10.30.0.1');
  await admin.login(...ADMIN);
  assert.equal((await admin.post('/api/auth/password', { current: ADMIN[1], password: NEWPW })).status, 200);
  await admin.login(ADMIN[0], NEWPW);
});
test.after(() => { T.stop(); setTimeout(() => process.exit(0), 200).unref(); });

test('project list: the hand-written projects are imported and the page stays exactly the same', async () => {
  const c = new Client(T.base, '10.30.1.1');
  for (const [file, url] of [['layiheler/index.html', '/layiheler/'], ['en/projects/index.html', '/en/projects/'], ['ru/projects/index.html', '/ru/projects/']]) {
    const original = region(fs.readFileSync(path.join(T.origSite, file), 'utf8'));
    assert.ok(original, `region in ${file}`);
    const page = await html(c, url);
    assert.equal(page.status, 200);
    assert.ok(!page.text.includes('<!--@projects'), 'markers are not sent to visitors');
    assert.equal(region(page.text), original, `${url}: generated list = hand-written list`);
  }
  const items = (await admin.get('/api/projects?per_page=100')).data.items;
  assert.equal(items.length, 11);
  const ggf = items.find((p) => p.filter_key === 'ggf');
  assert.equal(ggf.client, 'Green for Growth Fund');
  assert.equal(ggf.i18n.en.name, 'Staff training and energy audit services');
});

test('a project made in the panel: list, own page in 3 languages, sitemap, hide', async () => {
  const c = new Client(T.base, '10.30.2.1');
  const up = await admin.req('POST', '/api/media', { form: fileForm({ folder: 'Layihələr' }, [['file', 'ayirici.png', PNG, 'image/png']]) });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  const mid = up.data.item.id;
  const p = await admin.post('/api/projects', {
    name: 'Hava xətləri və açıq paylayıcı qurğu', sector: 'Enerji mühəndisliyi', status: 'completed', is_active: true, main_media_id: mid, gallery: [mid],
    description: 'Dayaqlar və ayırıcılar.\n\n## Məsələ\nObyektin şəbəkəyə qoşulması.', stats: [{ label: 'Gərginlik', value: '110 kV' }],
    i18n: { en: { name: 'Overhead lines and outdoor switchyard', sector: 'Power engineering', description: 'Towers and disconnectors.\n\n## The task\nGrid connection.' } },
  });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  const slug = p.data.item.slug;
  const list = await html(c, '/layiheler/');
  assert.ok(list.text.includes(`<a href="/layiheler/${slug}/">Hava xətləri və açıq paylayıcı qurğu</a>`), 'linked from the list');
  assert.ok(list.text.includes('data-f="enerji-muhendisliyi" aria-pressed="false">Enerji mühəndisliyi</button>'), 'new filter chip');
  assert.ok(list.text.includes('class="pthumb" src="/media/'), 'picture in the list');
  const az = await html(c, `/layiheler/${slug}/`);
  assert.equal(az.status, 200);
  assert.match(az.text, /<h1 class="art-title">Hava xətləri və açıq paylayıcı qurğu<\/h1>/);
  assert.match(az.text, /<h2>Məsələ<\/h2>/);
  assert.match(az.text, /<b>110 kV<\/b><span>Gərginlik<\/span>/);
  assert.ok(az.text.includes('<header') || az.text.includes('class="site-header"'), 'normal header');
  assert.ok(!az.text.includes('<!--@header'), 'components are assembled');
  const en = await html(c, `/en/projects/${slug}/`);
  assert.equal(en.status, 200);
  assert.match(en.text, /<h1 class="art-title">Overhead lines and outdoor switchyard<\/h1>/);
  assert.match(en.text, /<html lang="en">/);
  assert.equal((await c.get(`/layiheler/${slug}`)).status, 301, 'address without the final slash');
  const sm = await html(c, '/sitemap.xml');
  assert.ok(sm.text.includes(`/en/projects/${slug}/</loc>`), 'sitemap lists the project pages');
  assert.equal((await admin.patch(`/api/projects/${p.data.item.id}`, { is_active: false })).status, 200);
  assert.equal((await c.get(`/layiheler/${slug}/`)).status, 404, 'hidden project has no page');
  assert.ok(!(await html(c, '/layiheler/')).text.includes(slug), 'and is not in the list');
  assert.equal((await c.get('/layiheler/yoxdur-bele-layihe/')).status, 404);
});

test('pages: texts, SEO and images are changed from the panel, with history and restore', async () => {
  const c = new Client(T.base, '10.30.3.1');
  const pages = (await admin.get('/api/pages')).data.items;
  const about = pages.find((p) => p.path === 'haqqimizda/index.html');
  assert.ok(about && about.blocks > 10, 'About page is listed with its blocks');
  assert.ok(pages.find((p) => p.path === 'en/index.html' && p.lang === 'en'));
  assert.ok(!pages.some((p) => p.path.startsWith('xeberler/') && p.path !== 'xeberler/index.html' && p.path.split('/').length > 2), 'news pages are edited in Xəbərlər');
  const d = (await admin.get('/api/pages/page?path=haqqimizda/index.html')).data.item;
  const h1 = d.blocks.find((b) => b.tag === 'h1');
  const before = (await html(c, '/haqqimizda/')).text;
  assert.ok(before.includes(h1.original));
  // text: formatting is kept, anything dangerous is removed
  let r = await admin.put('/api/pages/block', { path: d.path, block: h1.id, value: 'Yeni <strong>başlıq</strong><script>alert(1)</script> <a href="javascript:alert(1)">x</a>' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  let after = (await html(c, '/haqqimizda/')).text;
  assert.match(after, /<h1[^>]*>Yeni <strong>başlıq<\/strong>alert\(1\) x<\/h1>/);
  assert.ok(!after.includes('<script>alert'));
  assert.ok(!after.includes(h1.original));
  assert.equal((await admin.put('/api/pages/block', { path: d.path, block: h1.id, value: '  ' })).status, 422, 'empty text');
  // SEO
  assert.equal((await admin.put('/api/pages/block', { path: d.path, block: 'seo-title', value: 'Haqqımızda — 30 il | AEEC' })).status, 200);
  after = (await html(c, '/haqqimizda/')).text;
  assert.match(after, /<title>Haqqımızda — 30 il \| AEEC<\/title>/);
  assert.match(after, /<meta property="og:title" content="Haqqımızda — 30 il \| AEEC">/);
  // image
  const up = await admin.req('POST', '/api/media', { form: fileForm({ folder: 'Sayt' }, [['file', 'yeni.png', PNG, 'image/png']]) });
  const img = d.blocks.find((b) => b.kind === 'image');
  assert.ok(img, 'About page has a picture');
  assert.equal((await admin.put('/api/pages/block', { path: d.path, block: img.id, media_id: up.data.item.id, alt: 'Yeni şəkil' })).status, 200);
  after = (await html(c, '/haqqimizda/')).text;
  assert.ok(after.includes(`src="/media/${up.data.item.url.split('/').pop()}" alt="Yeni şəkil"`), 'new picture');
  assert.ok(!after.includes(img.original_src));
  // history and restore
  const hist = (await admin.get(`/api/pages/history?path=${d.path}&block=${h1.id}`)).data.items;
  assert.equal(hist.length, 1);
  assert.equal((await admin.del(`/api/pages/block?path=${d.path}&block=${h1.id}`)).status, 200);
  assert.ok((await html(c, '/haqqimizda/')).text.includes(h1.original), 'back to the original');
  const hist2 = (await admin.get(`/api/pages/history?path=${d.path}&block=${h1.id}`)).data.items;
  assert.equal(hist2.length, 2);
  assert.equal((await admin.post(`/api/pages/history/${hist2[1].id}/restore`)).status, 200);
  assert.match((await html(c, '/haqqimizda/')).text, /<h1[^>]*>Yeni <strong>başlıq<\/strong>/);
  // other languages are separate pages
  assert.ok((await html(c, '/en/about/')).text.includes('<h1') && !(await html(c, '/en/about/')).text.includes('Yeni <strong>'));
  // safety: only site pages, never other files
  assert.equal((await admin.get('/api/pages/page?path=../server.js')).status, 404);
  assert.equal((await admin.put('/api/pages/block', { path: '../package.json', block: 'x', value: 'y' })).status, 404);
  assert.equal((await admin.put('/api/pages/block', { path: d.path, block: 't-yoxdur', value: 'y' })).status, 404);
  // the audit log has it
  const audit = (await admin.get('/api/audit?per_page=50')).data.items;
  assert.ok(audit.some((a) => a.module === 'Səhifələr'));
});

test('header and footer: menu items (text, address, hidden), added items, footer texts — per language', async () => {
  const c = new Client(T.base, '10.30.5.1');
  const list = (await admin.get('/api/pages')).data.items;
  assert.deepEqual(list.filter((p) => p.partial).map((p) => p.path), ['partials/header.az.html', 'partials/header.en.html', 'partials/header.ru.html', 'partials/footer.az.html', 'partials/footer.en.html', 'partials/footer.ru.html']);
  const H = 'partials/header.az.html', F = 'partials/footer.az.html';
  const hd = (await admin.get(`/api/pages/page?path=${H}`)).data.item;
  const proj = hd.blocks.find((b) => b.kind === 'link' && b.original.text === 'Layihələr');
  assert.ok(proj, 'menu item is a block');
  // rename + new address
  assert.equal((await admin.put('/api/pages/block', { path: H, block: proj.id, text: 'Portfel', href: '/layiheler/' })).status, 200);
  let home = (await html(c, '/')).text;
  assert.match(home, /<nav class="nav"[\s\S]*<a href="\/layiheler\/">Portfel<\/a>[\s\S]*<\/nav>/);
  assert.match((await html(c, '/layiheler/')).text, /<a href="\/layiheler\/" aria-current="page">Portfel<\/a>/, 'active menu item still marked');
  assert.ok((await html(c, '/en/')).text.includes('<a href="/en/projects/">Projects</a>'), 'other languages unchanged');
  // unsafe address refused
  assert.equal((await admin.put('/api/pages/block', { path: H, block: proj.id, text: 'X', href: 'javascript:alert(1)' })).status, 422);
  // items added at the end of the main menu
  const extra = hd.blocks.find((b) => b.kind === 'links' && b.id === 'n-0');
  assert.equal((await admin.put('/api/pages/block', { path: H, block: extra.id, items: [{ text: 'Karyera', href: '/karyera/' }, { text: 'LinkedIn', href: 'https://www.linkedin.com/company/aeec' }] })).status, 200);
  home = (await html(c, '/')).text;
  assert.match(home, /<a href="\/karyera\/">Karyera<\/a>\n {6}<a href="https:\/\/www\.linkedin\.com\/company\/aeec">LinkedIn<\/a>\n {6}<a class="btn btn-primary nav-cta"/);
  // footer: hide a menu item, change the slogan and the copyright line, add an item
  const fd = (await admin.get(`/api/pages/page?path=${F}`)).data.item;
  const sus = fd.blocks.find((b) => b.kind === 'link' && b.original.text === 'Dayanıqlılıq');
  assert.equal((await admin.put('/api/pages/block', { path: F, block: sus.id, hidden: true })).status, 200);
  const slogan = fd.blocks.find((b) => b.kind === 'text' && b.tag === 'p');
  const copy = fd.blocks.find((b) => b.kind === 'text' && b.tag === 'copy');
  assert.equal((await admin.put('/api/pages/block', { path: F, block: slogan.id, value: 'Yeni şüar' })).status, 200);
  assert.equal((await admin.put('/api/pages/block', { path: F, block: copy.id, value: '© 2027 AEEK MMC' })).status, 200);
  const fnav = fd.blocks.find((b) => b.kind === 'links' && /Şirkət/.test(b.nav));
  assert.equal((await admin.put('/api/pages/block', { path: F, block: fnav.id, items: [{ text: 'Vakansiyalar', href: '/karyera/' }] })).status, 200);
  const foot = (/<footer class="foot">[\s\S]*<\/footer>/.exec((await html(c, '/elaqe/')).text) || [])[0];
  assert.ok(!foot.includes('Dayanıqlılıq'), 'hidden in the footer');
  assert.ok((await html(c, '/elaqe/')).text.includes('<a href="/dayaniqliliq/">Dayanıqlılıq</a>'), 'still in the header');
  assert.match(foot, /<p>Yeni şüar<\/p>/);
  assert.match(foot, /<span>© 2027 AEEK MMC<\/span>/);
  assert.match(foot, /<li><a href="\/elaqe\/">Əlaqə<\/a><\/li><li><a href="\/karyera\/">Vakansiyalar<\/a><\/li><\/ul>/);
  // back to the original
  assert.equal((await admin.del(`/api/pages/block?path=${F}&block=${sus.id}`)).status, 200);
  assert.ok((/<footer class="foot">[\s\S]*<\/footer>/.exec((await html(c, '/')).text) || [])[0].includes('<li><a href="/dayaniqliliq/">Dayanıqlılıq</a></li>'));
  const hist = (await admin.get(`/api/pages/history?path=${F}&block=${sus.id}`)).data.items;
  assert.equal(hist.length, 2);
  assert.equal((await admin.post(`/api/pages/history/${hist[1].id}/restore`)).status, 200, 'restoring a hidden state');
  assert.ok(!(/<footer class="foot">[\s\S]*<\/footer>/.exec((await html(c, '/')).text) || [])[0].includes('Dayanıqlılıq'));
});

test('team on the About pages; roles: viewer may look, editor may change', async () => {
  const c = new Client(T.base, '10.30.4.1');
  assert.ok(!(await html(c, '/haqqimizda/')).text.includes('class="tgrid"'), 'no team section while the team is empty');
  assert.equal((await admin.post('/api/team', { name: 'Elçin Məmmədov', position: 'Baş mühəndis', i18n: { en: { position: 'Chief engineer' } } })).status, 201);
  const az = (await html(c, '/haqqimizda/')).text;
  assert.match(az, /<h3>Elçin Məmmədov<\/h3><p class="tpos">Baş mühəndis<\/p>/);
  assert.match((await html(c, '/en/about/')).text, /<p class="tpos">Chief engineer<\/p>/);
  const roles = Object.fromEntries((await admin.get('/api/roles')).data.roles.map((r) => [r.key, r.id]));
  const mk = async (email, rid, ip) => {
    assert.equal((await admin.post('/api/users', { name: email, email, role_id: rid, password: 'Rol-Sinaq-Parol-1!', is_active: true })).status, 201);
    const u = new Client(T.base, ip); await u.login(email, 'Rol-Sinaq-Parol-1!');
    assert.equal((await u.post('/api/auth/password', { current: 'Rol-Sinaq-Parol-1!', password: 'Rol-Sinaq-Parol-2!' })).status, 200);
    await u.login(email, 'Rol-Sinaq-Parol-2!');
    return u;
  };
  const vw = await mk('baxis@aeec.az', roles.viewer, '10.30.4.2');
  const ed = await mk('redaktor@aeec.az', roles.editor, '10.30.4.3');
  const d = (await vw.get('/api/pages/page?path=index.html')).data.item;
  const p = d.blocks.find((b) => b.kind === 'text');
  assert.equal((await vw.put('/api/pages/block', { path: 'index.html', block: p.id, value: 'Baxışçı' })).status, 403);
  assert.equal((await ed.put('/api/pages/block', { path: 'index.html', block: p.id, value: 'Redaktor mətni' })).status, 200);
  assert.ok((await html(c, '/')).text.includes('Redaktor mətni'));
  assert.equal((await new Client(T.base, '10.30.4.9').get('/api/pages')).status, 401);
});
