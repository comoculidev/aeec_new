'use strict';
// PDF reports without external libraries.
//
// - A4 (portrait or landscape), margins in millimetres, page header (company + report title) and
//   footer ("Səhifə 2 / 5", date of printing) on every page.
// - Text in Liberation Sans (assets/fonts, SIL OFL), embedded as a subset: only the glyphs used
//   are kept, so a report is small, prints identically everywhere and Azerbaijani letters
//   (ə, ğ, ı, İ, ş, ç, ö, ü) are real text - searchable and copyable (ToUnicode map).
// - Tables wrap long cell text, never run off the page, continue on the next page and repeat
//   their header row there.
// - JPEG pictures (employee photo) are embedded as they are.
//
// Usage:
//   const doc = new PdfDoc({ title: 'Sənəd reyestri', landscape: true });
//   doc.h1('Sənəd reyestri'); doc.meta([['Dövr', '2026']]); doc.table(cols, rows); doc.signatures(['Direktor']);
//   const buf = doc.toBuffer();
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const MM = 72 / 25.4;

/* =================================================================== TrueType font */
class TtfFont {
  constructor(buf) {
    this.buf = buf;
    this.tables = {};
    const n = buf.readUInt16BE(4);
    for (let i = 0; i < n; i++) {
      const o = 12 + i * 16;
      this.tables[buf.toString('latin1', o, o + 4)] = { offset: buf.readUInt32BE(o + 8), length: buf.readUInt32BE(o + 12) };
    }
    const t = (name) => { if (!this.tables[name]) throw new Error(`font table missing: ${name}`); return this.tables[name].offset; };
    const head = t('head'), hhea = t('hhea'), maxp = t('maxp');
    this.unitsPerEm = buf.readUInt16BE(head + 18);
    this.bbox = [buf.readInt16BE(head + 36), buf.readInt16BE(head + 38), buf.readInt16BE(head + 40), buf.readInt16BE(head + 42)];
    this.longLoca = buf.readInt16BE(head + 50) === 1;
    this.ascent = buf.readInt16BE(hhea + 4);
    this.descent = buf.readInt16BE(hhea + 6);
    const nh = buf.readUInt16BE(hhea + 34);
    this.numGlyphs = buf.readUInt16BE(maxp + 4);
    const hmtx = t('hmtx');
    this.advance = new Array(this.numGlyphs);
    for (let g = 0; g < this.numGlyphs; g++) this.advance[g] = buf.readUInt16BE(hmtx + Math.min(g, nh - 1) * 4);
    this.cmap = this.readCmap(t('cmap'));
    const os2 = this.tables['OS/2'];
    this.capHeight = os2 && os2.length > 90 ? buf.readInt16BE(os2.offset + 88) : Math.round(this.ascent * 0.7);
  }
  // Unicode -> glyph id, from the Windows Unicode subtable (format 12 preferred, else format 4).
  readCmap(off) {
    const b = this.buf, n = b.readUInt16BE(off + 2), map = new Map();
    let f4 = null, f12 = null;
    for (let i = 0; i < n; i++) {
      const pid = b.readUInt16BE(off + 4 + i * 8), eid = b.readUInt16BE(off + 6 + i * 8), so = off + b.readUInt32BE(off + 8 + i * 8);
      const fmt = b.readUInt16BE(so);
      if (pid === 3 && eid === 10 && fmt === 12) f12 = so;
      if (pid === 3 && eid === 1 && fmt === 4) f4 = so;
    }
    if (f12 !== null) {
      const groups = b.readUInt32BE(f12 + 12);
      for (let i = 0; i < groups; i++) {
        const g = f12 + 16 + i * 12, start = b.readUInt32BE(g), end = b.readUInt32BE(g + 4), gid = b.readUInt32BE(g + 8);
        for (let c = start; c <= end && c - start < 70000; c++) map.set(c, gid + c - start);
      }
    } else if (f4 !== null) {
      const segX2 = b.readUInt16BE(f4 + 6), ends = f4 + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = b.readUInt16BE(ends + s * 2), start = b.readUInt16BE(starts + s * 2), delta = b.readInt16BE(deltas + s * 2), ro = b.readUInt16BE(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let gid;
          if (ro === 0) gid = (c + delta) & 0xffff;
          else { const p = ranges + s * 2 + ro + (c - start) * 2; gid = b.readUInt16BE(p); if (gid) gid = (gid + delta) & 0xffff; }
          if (gid) map.set(c, gid);
        }
      }
    }
    return map;
  }
  gid(cp) { return this.cmap.get(cp) || this.cmap.get(0xfffd) || this.cmap.get(0x3f) || 0; }
  width(text, size) { let w = 0; for (const ch of text) w += this.advance[this.gid(ch.codePointAt(0))] || 0; return (w * size) / this.unitsPerEm; }

  // Subset: the font keeps its glyph numbering, but the outlines of unused glyphs are dropped.
  // Composite glyphs pull in their components.
  subset(used) {
    const b = this.buf, glyf = this.tables.glyf.offset, loca = this.tables.loca.offset;
    const at = (g) => (this.longLoca ? b.readUInt32BE(loca + g * 4) : b.readUInt16BE(loca + g * 2) * 2);
    const keep = new Set([0, ...used]);
    const stack = [...keep];
    while (stack.length) {
      const g = stack.pop(), s = at(g), e = at(g + 1);
      if (e <= s || b.readInt16BE(glyf + s) >= 0) continue;
      let p = glyf + s + 10, flags;
      do {
        flags = b.readUInt16BE(p); const comp = b.readUInt16BE(p + 2);
        if (!keep.has(comp)) { keep.add(comp); stack.push(comp); }
        p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
      } while (flags & 0x20);
    }
    const parts = [], newLoca = Buffer.alloc((this.numGlyphs + 1) * 4);
    let off = 0;
    for (let g = 0; g < this.numGlyphs; g++) {
      newLoca.writeUInt32BE(off, g * 4);
      if (keep.has(g)) { const s = at(g), e = at(g + 1); if (e > s) { let d = b.subarray(glyf + s, glyf + e); if (d.length % 4) d = Buffer.concat([d, Buffer.alloc(4 - (d.length % 4))]); parts.push(d); off += d.length; } }
    }
    newLoca.writeUInt32BE(off, this.numGlyphs * 4);
    const out = { glyf: Buffer.concat(parts), loca: newLoca };
    for (const name of ['head', 'hhea', 'maxp', 'hmtx', 'cvt ', 'fpgm', 'prep']) if (this.tables[name]) { const t = this.tables[name]; out[name] = Buffer.from(b.subarray(t.offset, t.offset + t.length)); }
    out.head.writeInt16BE(1, 50); // long loca
    out.head.writeUInt32BE(0, 8); // checkSumAdjustment not needed inside a PDF
    const names = Object.keys(out).sort();
    const dir = Buffer.alloc(12 + names.length * 16);
    dir.writeUInt32BE(0x00010000, 0); dir.writeUInt16BE(names.length, 4);
    let pow = 1, lg = 0; while (pow * 2 <= names.length) { pow *= 2; lg++; }
    dir.writeUInt16BE(pow * 16, 6); dir.writeUInt16BE(lg, 8); dir.writeUInt16BE(names.length * 16 - pow * 16, 10);
    let pos = dir.length; const bodies = [];
    names.forEach((name, i) => {
      let d = out[name]; const len = d.length; if (d.length % 4) d = Buffer.concat([d, Buffer.alloc(4 - (d.length % 4))]);
      let sum = 0; for (let k = 0; k < d.length; k += 4) sum = (sum + d.readUInt32BE(k)) >>> 0;
      const o = 12 + i * 16; dir.write(name, o, 'latin1'); dir.writeUInt32BE(sum, o + 4); dir.writeUInt32BE(pos, o + 8); dir.writeUInt32BE(len, o + 12);
      bodies.push(d); pos += d.length;
    });
    return Buffer.concat([dir, ...bodies]);
  }
}
const fonts = {};
const loadFont = (name) => (fonts[name] || (fonts[name] = new TtfFont(fs.readFileSync(path.join(FONT_DIR, name)))));

/* =================================================================== document */
const num = (n) => (Math.round(n * 100) / 100).toString();
const pdfStr = (s) => '(' + String(s).replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '?') + ')';
function jpegInfo(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG');
  let p = 2;
  while (p < buf.length) {
    if (buf[p] !== 0xff) { p++; continue; }
    const m = buf[p + 1], len = buf.readUInt16BE(p + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(p + 5), w: buf.readUInt16BE(p + 7), comps: buf[p + 9] };
    p += 2 + len;
  }
  throw new Error('JPEG size not found');
}

class PdfDoc {
  // opts: { title, subtitle, company, landscape, margins: [top, right, bottom, left] in mm, printed: 'DD.MM.YYYY HH:MM' }
  constructor(opts = {}) {
    this.o = { company: 'Azərbaycan Enerji Encinirinq ənd Konsaltinq MMC', margins: [18, 15, 18, 15], ...opts };
    this.W = (opts.landscape ? 841.89 : 595.28); this.H = (opts.landscape ? 595.28 : 841.89);
    const [t, r, b, l] = this.o.margins.map((x) => x * MM);
    this.m = { t, r, b, l }; this.cw = this.W - l - r;
    this.f = { R: loadFont('LiberationSans-Regular.ttf'), B: loadFont('LiberationSans-Bold.ttf') };
    this.used = { R: new Map(), B: new Map() }; // gid -> unicode string (ToUnicode)
    this.pages = []; this.images = [];
    this.newPage();
  }
  /* ---- low level */
  newPage() { this.ops = []; this.pages.push(this.ops); this.y = this.m.t + 22; }
  get bottom() { return this.H - this.m.b - 14; }
  ensure(h) { if (this.y + h > this.bottom) { this.newPage(); return true; } return false; }
  enc(font, text) {
    let hex = '';
    for (const ch of String(text)) {
      const g = this.f[font].gid(ch.codePointAt(0));
      if (!this.used[font].has(g)) this.used[font].set(g, ch);
      hex += g.toString(16).padStart(4, '0');
    }
    return hex;
  }
  // Draws one line of text; x, y = left and baseline (y from the top of the page).
  textAt(text, x, y, { size = 9.5, bold = false, color = '0.1 0.13 0.2', align = 'left', width = 0 } = {}) {
    const font = bold ? 'B' : 'R';
    let xx = x;
    if (align !== 'left' && width) { const w = this.f[font].width(String(text), size); xx = align === 'right' ? x + width - w : x + (width - w) / 2; }
    this.ops.push(`BT ${color} rg /F${font} ${num(size)} Tf ${num(xx)} ${num(this.H - y)} Td <${this.enc(font, text)}> Tj ET`);
  }
  rect(x, y, w, h, { fill = null, stroke = null, lw = 0.5 } = {}) {
    if (fill) this.ops.push(`${fill} rg ${num(x)} ${num(this.H - y - h)} ${num(w)} ${num(h)} re f`);
    if (stroke) this.ops.push(`${lw} w ${stroke} RG ${num(x)} ${num(this.H - y - h)} ${num(w)} ${num(h)} re S`);
  }
  line(x1, y1, x2, y2, { color = '0.75 0.78 0.84', lw = 0.5 } = {}) { this.ops.push(`${lw} w ${color} RG ${num(x1)} ${num(this.H - y1)} m ${num(x2)} ${num(this.H - y2)} l S`); }
  // Splits text into lines that fit `width` (words, then characters for very long words).
  wrap(text, width, size, bold) {
    const f = this.f[bold ? 'B' : 'R'], out = [];
    for (const para of String(text ?? '').split('\n')) {
      let cur = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const cand = cur ? cur + ' ' + word : word;
        if (f.width(cand, size) <= width) { cur = cand; continue; }
        if (cur) out.push(cur);
        if (f.width(word, size) <= width) { cur = word; continue; }
        let piece = '';
        for (const ch of word) { if (f.width(piece + ch, size) > width && piece) { out.push(piece); piece = ch; } else piece += ch; }
        cur = piece;
      }
      out.push(cur);
    }
    return out.length ? out : [''];
  }
  /* ---- blocks */
  h1(text, sub) {
    this.ensure(40);
    for (const l of this.wrap(text, this.cw, 15, true)) { this.textAt(l, this.m.l, this.y + 14, { size: 15, bold: true, color: '0.055 0.13 0.28' }); this.y += 19; }
    if (sub) { for (const l of this.wrap(sub, this.cw, 9.5)) { this.textAt(l, this.m.l, this.y + 9, { size: 9.5, color: '0.35 0.4 0.48' }); this.y += 13; } }
    this.y += 8;
  }
  h2(text) { this.ensure(34); this.y += 6; this.textAt(text, this.m.l, this.y + 11, { size: 11.5, bold: true, color: '0.055 0.13 0.28' }); this.y += 17; this.line(this.m.l, this.y, this.m.l + this.cw, this.y, { color: '0.06 0.42 0.82', lw: 0.8 }); this.y += 7; }
  para(text, { size = 9.5, bold = false, color } = {}) { for (const l of this.wrap(text, this.cw, size, bold)) { this.ensure(size * 1.4); this.textAt(l, this.m.l, this.y + size, { size, bold, color }); this.y += size * 1.4; } this.y += 4; }
  // Label / value pairs in one or two columns.
  meta(pairs, { cols = 2, labelW = 0.38 } = {}) {
    const gap = 14, colW = (this.cw - gap * (cols - 1)) / cols, lw = colW * labelW, size = 9.5, lh = size * 1.35;
    const rows = []; for (let i = 0; i < pairs.length; i += cols) rows.push(pairs.slice(i, i + cols));
    for (const row of rows) {
      const cells = row.map(([k, v]) => ({ k: this.wrap(k, lw - 6, size), v: this.wrap(v === null || v === undefined || v === '' ? '—' : v, colW - lw, size, false) }));
      const h = Math.max(...cells.map((c) => Math.max(c.k.length, c.v.length))) * lh + 5;
      this.ensure(h);
      cells.forEach((c, i) => {
        const x = this.m.l + i * (colW + gap);
        c.k.forEach((l, j) => this.textAt(l, x, this.y + size + j * lh, { size, color: '0.38 0.43 0.52' }));
        c.v.forEach((l, j) => this.textAt(l, x + lw, this.y + size + j * lh, { size }));
      });
      this.y += h;
      this.line(this.m.l, this.y - 2, this.m.l + this.cw, this.y - 2, { color: '0.9 0.92 0.95' });
    }
    this.y += 6;
  }
  // columns: [{ label, w (relative), align: 'left'|'right'|'center' }]; rows: arrays of strings;
  // opts.totals: one more row drawn bold; opts.size: font size.
  table(columns, rows, { size = 8.5, totals = null, zebra = true } = {}) {
    const pad = 3.5, lh = size * 1.3;
    const total = columns.reduce((s, c) => s + (c.w || 1), 0);
    const widths = columns.map((c) => (this.cw * (c.w || 1)) / total);
    const cellLines = (row, bold) => row.map((v, i) => this.wrap(v === null || v === undefined ? '' : String(v), widths[i] - pad * 2, size, bold));
    const header = () => {
      const lines = cellLines(columns.map((c) => c.label), true);
      const h = Math.max(...lines.map((l) => l.length)) * lh + pad * 2;
      this.rect(this.m.l, this.y, this.cw, h, { fill: '0.9 0.94 0.99' });
      let x = this.m.l;
      lines.forEach((ls, i) => { ls.forEach((l, j) => this.textAt(l, x + pad, this.y + pad + size + j * lh - 1, { size, bold: true, align: columns[i].align || 'left', width: widths[i] - pad * 2 })); x += widths[i]; });
      this.line(this.m.l, this.y + h, this.m.l + this.cw, this.y + h, { color: '0.55 0.6 0.7', lw: 0.7 });
      this.y += h;
    };
    this.ensure(lh * 3 + pad * 4);
    header();
    const all = totals ? [...rows, totals] : rows;
    all.forEach((row, ri) => {
      const isTotal = totals && ri === rows.length;
      const lines = cellLines(row, isTotal);
      const h = Math.max(...lines.map((l) => l.length)) * lh + pad * 2;
      if (this.ensure(h)) header();
      if (isTotal) this.rect(this.m.l, this.y, this.cw, h, { fill: '0.94 0.95 0.97' });
      else if (zebra && ri % 2) this.rect(this.m.l, this.y, this.cw, h, { fill: '0.975 0.98 0.99' });
      let x = this.m.l;
      lines.forEach((ls, i) => { ls.forEach((l, j) => this.textAt(l, x + pad, this.y + pad + size + j * lh - 1, { size, bold: isTotal, align: columns[i].align || 'left', width: widths[i] - pad * 2 })); x += widths[i]; });
      this.y += h;
      this.line(this.m.l, this.y, this.m.l + this.cw, this.y, { color: isTotal ? '0.55 0.6 0.7' : '0.88 0.9 0.93' });
    });
    if (!rows.length) { this.ensure(lh + pad * 2); this.textAt('Məlumat yoxdur', this.m.l + pad, this.y + pad + size, { size, color: '0.45 0.5 0.58' }); this.y += lh + pad * 2; }
    this.y += 10;
  }
  // Signature lines: [label, label, …] side by side, with "Ad, soyad / İmza / Tarix".
  signatures(labels) {
    this.ensure(70);
    this.y += 18;
    const gap = 24, w = (this.cw - gap * (labels.length - 1)) / labels.length;
    labels.forEach((label, i) => {
      const x = this.m.l + i * (w + gap);
      this.textAt(label, x, this.y + 9, { size: 9.5, bold: true });
      this.line(x, this.y + 38, x + w, this.y + 38, { color: '0.3 0.33 0.4' });
      this.textAt('ad, soyad / imza', x, this.y + 48, { size: 7.5, color: '0.45 0.5 0.58' });
      this.textAt('Tarix: ____.____.20____', x + w - this.f.R.width('Tarix: ____.____.20____', 7.5), this.y + 48, { size: 7.5, color: '0.45 0.5 0.58' });
    });
    this.y += 60;
  }
  // JPEG image at x (mm from the left margin) with a width in points; returns its height.
  image(jpeg, x, y, w) {
    const info = jpegInfo(jpeg);
    const id = this.images.push({ data: jpeg, ...info });
    const h = (w * info.h) / info.w;
    this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.H - y - h)} cm /Im${id} Do Q`);
    return h;
  }
  /* ---- output */
  decorate() {
    const n = this.pages.length;
    this.pages.forEach((ops, i) => {
      this.ops = ops;
      const top = this.m.t;
      this.textAt(this.o.company, this.m.l, top + 2, { size: 7.5, bold: true, color: '0.055 0.13 0.28' });
      if (this.o.title) this.textAt(this.o.title, this.m.l, top + 2, { size: 7.5, color: '0.4 0.45 0.52', align: 'right', width: this.cw });
      this.line(this.m.l, top + 7, this.m.l + this.cw, top + 7, { color: '0.06 0.42 0.82', lw: 0.8 });
      const fy = this.H - this.m.b + 2;
      this.line(this.m.l, fy - 9, this.m.l + this.cw, fy - 9);
      this.textAt(`Çap tarixi: ${this.o.printed || ''}  ·  aeec.az`, this.m.l, fy, { size: 7.5, color: '0.45 0.5 0.58' });
      this.textAt(`Səhifə ${i + 1} / ${n}`, this.m.l, fy, { size: 7.5, color: '0.45 0.5 0.58', align: 'right', width: this.cw });
    });
  }
  toBuffer() {
    this.decorate();
    const objs = [];
    const add = (body) => { objs.push(body); return objs.length; };
    const stream = (dict, data, compress = true) => { const d = compress ? zlib.deflateSync(data) : data; return Buffer.concat([Buffer.from(`<< ${dict}${compress ? ' /Filter /FlateDecode' : ''} /Length ${d.length} >>\nstream\n`, 'latin1'), d, Buffer.from('\nendstream', 'latin1')]); };
    const catalog = add(null), pagesId = add(null);
    const fontRefs = {};
    for (const key of ['R', 'B']) {
      const f = this.f[key], used = this.used[key];
      if (!used.size) continue;
      const scale = 1000 / f.unitsPerEm;
      const file = add(stream(`/Length1 ${0}`, f.subset([...used.keys()])));
      const name = key === 'B' ? 'AEEC+LiberationSans-Bold' : 'AEEC+LiberationSans';
      const desc = add(`<< /Type /FontDescriptor /FontName /${name} /Flags 32 /FontBBox [${f.bbox.map((v) => Math.round(v * scale)).join(' ')}] /ItalicAngle 0 /Ascent ${Math.round(f.ascent * scale)} /Descent ${Math.round(f.descent * scale)} /CapHeight ${Math.round(f.capHeight * scale)} /StemV ${key === 'B' ? 120 : 80} /FontFile2 ${file} 0 R >>`);
      const gids = [...used.keys()].sort((a, b) => a - b);
      const w = gids.map((g) => `${g} [${Math.round((f.advance[g] || 0) * scale)}]`).join(' ');
      const cid = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /W [${w}] /CIDToGIDMap /Identity >>`);
      const hex = (s) => [...s].map((c) => { const cp = c.codePointAt(0); if (cp < 0x10000) return cp.toString(16).padStart(4, '0'); const v = cp - 0x10000; return ((0xd800 + (v >> 10)).toString(16) + (0xdc00 + (v & 0x3ff)).toString(16)); }).join('');
      const chunks = [];
      for (let i = 0; i < gids.length; i += 100) chunks.push(`${Math.min(100, gids.length - i)} beginbfchar\n${gids.slice(i, i + 100).map((g) => `<${g.toString(16).padStart(4, '0')}> <${hex(used.get(g))}>`).join('\n')}\nendbfchar`);
      const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${chunks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
      const tu = add(stream('', Buffer.from(cmap, 'latin1')));
      fontRefs[key] = add(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tu} 0 R >>`);
    }
    const imgRefs = this.images.map((im) => add(stream(`/Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /${im.comps === 1 ? 'DeviceGray' : im.comps === 4 ? 'DeviceCMYK' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode`, im.data, false)));
    const fontRes = Object.entries(fontRefs).map(([k, id]) => `/F${k} ${id} 0 R`).join(' ');
    const imgRes = imgRefs.length ? `/XObject << ${imgRefs.map((id, i) => `/Im${i + 1} ${id} 0 R`).join(' ')} >>` : '';
    const pageIds = this.pages.map((ops) => {
      const content = add(stream('', Buffer.from(ops.join('\n'), 'latin1')));
      return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(this.W)} ${num(this.H)}] /Resources << /Font << ${fontRes} >> ${imgRes} >> /Contents ${content} 0 R >>`);
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R /ViewerPreferences << /DisplayDocTitle true >> >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    // Title and author as UTF-16 so Azerbaijani letters are kept.
    const u16 = (s) => '<FEFF' + Buffer.from(String(s), 'utf16le').swap16().toString('hex').toUpperCase() + '>';
    const d = new Date();
    const info = add(`<< /Title ${u16(this.o.title || 'AEEC')} /Author ${u16(this.o.company)} /Producer ${pdfStr('AEEC panel')} /CreationDate ${pdfStr(`D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`)} >>`);
    const parts = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    const offsets = [];
    let pos = parts[0].length;
    objs.forEach((body, i) => {
      const b = Buffer.isBuffer(body) ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]) : Buffer.from(`${i + 1} 0 obj\n${body}\nendobj\n`, 'latin1');
      offsets.push(pos); parts.push(b); pos += b.length;
    });
    const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
    parts.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(parts);
  }
}

// Sends a generated PDF. ?inline=1 opens it in the browser's viewer (preview, print, save);
// otherwise it is downloaded. The PDF is our own output, so it needs no sandbox.
function sendPdf(ctx, buf, filename) {
  const name = String(filename).replace(/[\r\n"\\/]/g, '_');
  const ascii = name.replace(/[^\x20-\x7e]/g, '_');
  ctx.res.setHeader('Content-Disposition', `${ctx.query.inline === '1' ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  ctx.res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'");
  ctx.res.setHeader('Cache-Control', 'private, no-store');
  ctx.send(200, buf, 'application/pdf');
}

// Local (Baku) date and time of printing: "20.10.2026 14:05".
function printedNow(tzOffsetMin = 240) {
  const d = new Date(Date.now() + tzOffsetMin * 60000).toISOString();
  return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)} ${d.slice(11, 16)}`;
}
// '2026-10-20' -> '20.10.2026'; '2026-10-20 14:05[:33]' or ISO 'T…' -> '20.10.2026 14:05' (the time is kept).
const dmy = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(String(s || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}${m[4] ? ' ' + m[4] : ''}` : s;
};

// Any list as a PDF table (used by every "PDF" export button, see src/xlsx.js sendExport).
// - columns that are empty in every row are left out;
// - every column gets at least the width of its longest word (no word is split in the middle)
//   and the rest of the line is shared by how much text the columns typically hold;
// - wide lists are printed in landscape and, if needed, in a smaller font (down to 6.5 pt);
// - numeric columns are right-aligned.
function tablePdf({ title, subtitle = '', headers, rows, tzOffsetMin }) {
  const fmt = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',')) : dmy(v ?? ''));
  const keep = headers.map((h, i) => !rows.length || rows.some((r) => String(r[i] ?? '').trim() !== '' && r[i] !== 0));
  const H = headers.filter((_, i) => keep[i]);
  const R = rows.map((r) => r.filter((_, i) => keep[i]).map(fmt));
  const sample = R.slice(0, 400);
  const numeric = H.map((h, i) => sample.length > 0 && sample.every((r) => r[i] === '' || (/^-?[\d\s.,]+( AZN| USD| EUR)?$/.test(r[i]) && !/\d\.\d+\./.test(r[i]))));
  const typical = H.map((h, i) => { const v = sample.map((r) => r[i].length).sort((a, b) => a - b); return Math.min(60, Math.max(4, v.length ? v[Math.floor(v.length * 0.8)] : 0)); });
  const landscape = H.length > 6 || typical.reduce((a, b) => a + b, 0) > 90;
  const doc = new PdfDoc({ title, landscape, printed: printedNow(tzOffsetMin) });
  doc.h1(title, subtitle);
  const pad = 7;
  const longestWord = (texts, font, size) => Math.max(0, ...texts.flatMap((t) => String(t).split(/\s+/)).map((w) => font.width(w, size)));
  let size = H.length > 12 ? 7.5 : 8.5, mins;
  for (;;) {
    mins = H.map((h, i) => Math.max(longestWord([h], doc.f.B, size), longestWord(sample.map((r) => r[i]), doc.f.R, size)) + pad + 1);
    if (mins.reduce((a, b) => a + b, 0) <= doc.cw || size <= 6.5) break;
    size -= 0.5;
  }
  const minSum = mins.reduce((a, b) => a + b, 0);
  let widths;
  if (minSum >= doc.cw) widths = mins.map((m) => (m * doc.cw) / minSum); // very wide: shrink proportionally (long words may break)
  else { const free = doc.cw - minSum, tw = typical.reduce((a, b) => a + b, 0) || 1; widths = mins.map((m, i) => m + (free * typical[i]) / tw); }
  doc.table(H.map((h, i) => ({ label: h, w: widths[i], align: numeric[i] ? 'right' : 'left' })), R, { size });
  if (!R.length) doc.para('Seçilmiş şərtlərə uyğun qeyd yoxdur.');
  return doc.toBuffer();
}

module.exports = { PdfDoc, TtfFont, sendPdf, loadFont, tablePdf, printedNow, dmy };
