'use strict';
// Minimal XLSX reader (no external library): enough to read the values of a worksheet as Excel
// last saved them. Formulas are not evaluated - their cached result is used, exactly what Excel
// shows. Used by the document-register import (src/routes/office.js).
//
// Limits (protection against hostile files): at most 200 zip entries, 20 MB uncompressed per
// entry, 5000 rows x 60 columns read.
const zlib = require('node:zlib');

const MAX_ENTRY = 20 * 1024 * 1024;

// Reads the central directory of a zip archive -> Map(name -> Buffer) for the requested names.
function unzip(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Fayl Excel (xlsx) formatında deyil');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > 200) throw new Error('Excel faylında həddən çox hissə var');
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Excel faylı zədələnib');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (!wanted(name)) continue;
    if (usize > MAX_ENTRY) throw new Error('Excel faylı çox böyükdür');
    if (off + 30 > buf.length || buf.readUInt32LE(off) !== 0x04034b50) throw new Error('Excel faylı zədələnib');
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = buf.subarray(start, start + csize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY }));
    else throw new Error('Excel faylının sıxılma üsulu dəstəklənmir');
  }
  return out;
}

const decode = (s) => s.replace(/&(lt|gt|quot|apos|amp|#(\d+)|#x([0-9a-f]+));/gi, (m, e, d, x) => (d ? String.fromCodePoint(+d) : x ? String.fromCodePoint(parseInt(x, 16)) : { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[e.toLowerCase()]));
const textOf = (xml) => decode([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

// Returns { sheets: [names], rows(name) -> array of arrays }. Date cells come back as numbers
// (Excel serial days); the caller converts the columns it knows to be dates (excelDate()).
function readXlsx(buf) {
  const files = unzip(buf, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const wb = files.get('xl/workbook.xml');
  if (!wb) throw new Error('Fayl Excel (xlsx) formatında deyil');
  const rels = new Map([...String(files.get('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [(/Id="([^"]+)"/.exec(m[0]) || [])[1], (/Target="([^"]+)"/.exec(m[0]) || [])[1]]));
  const sheets = [...wb.toString('utf8').matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: decode((/name="([^"]*)"/.exec(m[0]) || [])[1] || ''), rid: (/r:id="([^"]+)"/.exec(m[0]) || [])[1] }));
  const shared = [...String(files.get('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  function rows(name) {
    const sh = sheets.find((s) => s.name === name);
    if (!sh) return null;
    const target = String(rels.get(sh.rid) || '').replace(/^\/?(xl\/)?/, 'xl/');
    const xml = files.get(target);
    if (!xml) return null;
    const out = [];
    for (const rm of xml.toString('utf8').matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      if (out.length >= 5000) break;
      const r = (/\br="(\d+)"/.exec(rm[0]) || [])[1];
      const row = [];
      for (const cm of (rm[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1], inner = cm[2] || '';
        const ref = (/\br="([A-Z]+\d+)"/.exec(attrs) || [])[1];
        const ci = ref ? colIndex(ref) : row.length;
        if (ci >= 60) continue;
        const t = (/\bt="(\w+)"/.exec(attrs) || [])[1];
        const vv = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
        let val = null;
        if (t === 's') val = vv !== undefined ? shared[+vv] ?? null : null;
        else if (t === 'inlineStr') val = textOf(inner);
        else if (t === 'str' || t === 'e') val = vv !== undefined ? decode(vv) : null;
        else if (t === 'b') val = vv === '1';
        else if (vv !== undefined && vv !== '') val = Number(vv);
        row[ci] = val;
      }
      out[r ? +r - 1 : out.length] = row;
    }
    return Array.from(out, (x) => x || []);
  }
  return { sheets: sheets.map((s) => s.name), rows };
}

// Excel serial day (1900 system) -> 'YYYY-MM-DD'. Text dates like 24.09.2026 or 2026-09-24 also work.
function excelDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

module.exports = { readXlsx, excelDate };
