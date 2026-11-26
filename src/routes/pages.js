'use strict';
// "Səhifələr": texts, images and SEO of the website pages (src/site-content.js).
//   GET    /api/pages                        list of the site pages (AZ/EN/RU)
//   GET    /api/pages/page?path=…            the blocks of one page (original and current value)
//   PUT    /api/pages/block                  { path, block, value }   save a text / SEO value
//                                            { path, block, media_id, alt }   replace an image
//   DELETE /api/pages/block?path=…&block=…   back to the original (what the HTML file says)
//   GET    /api/pages/history?path=…&block=…  saved versions of one block
//   POST   /api/pages/history/:id/restore    put an earlier version back
// Every change is written to the audit log and is visible on the website at the next request.
const { get } = require('../db');
const { err } = require('../http');
const { can } = require('../auth');
const { audit } = require('../audit');
const content = require('../site-content');

const short = (s) => { const t = String(s ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); return t.length > 160 ? t.slice(0, 157) + '…' : t; };

module.exports = (app) => {
  app.get('/api/pages', can('pages.view'), (ctx) => ctx.json({ items: content.listPages() }));

  app.get('/api/pages/page', can('pages.view'), (ctx) => {
    const d = content.pageDetail(ctx.query.path);
    if (!d) throw err(404, 'Səhifə tapılmadı');
    ctx.json({ item: d });
  });

  app.put('/api/pages/block', can('pages.edit'), async (ctx) => {
    const body = await ctx.readJson();
    const rel = String(body.path || ''), id = String(body.block || '');
    const b = content.blockOf(rel, id);
    if (!b) throw err(404, 'Bu mətn və ya şəkil səhifədə tapılmadı');
    let value;
    if (b.kind === 'image') {
      const mid = Number(body.media_id);
      if (!Number.isInteger(mid) || mid < 1 || !get("SELECT id FROM media WHERE id = ? AND is_private = 0 AND kind = 'image'", mid)) throw err(422, 'Media kitabxanasından şəkil seçin', { fields: { media_id: 'Şəkil seçin' } });
      value = { media_id: mid, alt: String(body.alt ?? '').slice(0, 300) };
    } else if (b.kind === 'link') {
      value = { text: body.text, href: body.href, hidden: !!body.hidden };
    } else if (b.kind === 'links') {
      if (!Array.isArray(body.items) || body.items.length > 12) throw err(422, 'Ən çox 12 əlavə bənd');
      value = body.items;
    } else {
      value = String(body.value ?? '');
      if (!value.replace(/<[^>]+>/g, '').trim()) throw err(422, 'Mətn boş ola bilməz. Əvvəlki mətnə qayıtmaq üçün «Orijinala qaytar» düyməsini istifadə edin.', { fields: { value: 'Mətn boşdur' } });
      if (value.length > 20000) throw err(422, 'Mətn çox uzundur', { fields: { value: 'Ən çox 20 000 simvol' } });
    }
    let r;
    try { r = content.saveBlock(rel, id, value, ctx.user); } catch (e) { if (e.field) throw err(422, e.message, { fields: { [e.field]: e.message } }); throw e; }
    audit(ctx, { action: 'Redaktə', module: 'Səhifələr', recordId: `${rel}#${id}`,
      summary: `${ctx.user.name} saytın ${content.isPartial(rel) ? rel.replace(/^partials\/|\.html$/g, '') : 'səhifəsini: /' + rel.replace(/index\.html$/, '')} dəyişdi — ${b.kind === 'image' ? 'şəkil' : short(r.stored || 'bərpa')}`,
      prev: { value: b.kind === 'image' ? b.src : short(b.inner || b.original) }, next: { value: b.kind === 'image' ? `media #${value.media_id}` : short(r.stored) } });
    ctx.json({ item: content.pageDetail(rel) });
  });

  app.delete('/api/pages/block', can('pages.edit'), (ctx) => {
    const rel = ctx.query.path || '', id = ctx.query.block || '';
    const b = content.blockOf(rel, id);
    if (!b) throw err(404, 'Bu mətn və ya şəkil səhifədə tapılmadı');
    content.saveBlock(rel, id, null, ctx.user);
    audit(ctx, { action: 'Bərpa', module: 'Səhifələr', recordId: `${rel}#${id}`, summary: `${ctx.user.name} orijinal mətnə qaytardı: /${rel.replace(/index\.html$/, '')}` });
    ctx.json({ item: content.pageDetail(rel) });
  });

  app.get('/api/pages/history', can('pages.view'), (ctx) => {
    const rel = ctx.query.path || '', id = ctx.query.block || '';
    if (!content.blockOf(rel, id)) throw err(404, 'Tapılmadı');
    ctx.json({ items: content.history(rel, id) });
  });

  app.post('/api/pages/history/:id/restore', can('pages.edit'), (ctx) => {
    const h = get('SELECT * FROM page_block_history WHERE id = ?', Number(ctx.params.id));
    if (!h) throw err(404, 'Versiya tapılmadı');
    if (!content.blockOf(h.page, h.block)) throw err(409, 'Bu mətn səhifədə artıq yoxdur');
    let value = h.value;
    if (value !== null && h.kind !== 'text') { try { value = JSON.parse(value); } catch { value = null; } }
    content.saveBlock(h.page, h.block, value, ctx.user);
    audit(ctx, { action: 'Bərpa', module: 'Səhifələr', recordId: `${h.page}#${h.block}`, summary: `${ctx.user.name} əvvəlki versiyanı bərpa etdi (${h.created_at.slice(0, 10)}): /${h.page.replace(/index\.html$/, '')}` });
    ctx.json({ item: content.pageDetail(h.page) });
  });
};
