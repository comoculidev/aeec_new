'use strict';
// Export helpers: a minimal XLSX (Office Open XML) writer and a CSV writer.
// - XLSX cells are written as numbers or inline strings, never as formulas.
// - CSV cells that could be interpreted as formulas are neutralised with a leading apostrophe.
const zlib = require('node:zlib');

const xmlEsc = (s) => String(s)
  // eslint-disable-next-line no-control-regex
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 6 });
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(0, 12); cen.writeUInt16LE(0x21, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += local.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

const colName = (i) => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

function xlsx(headers, rows, sheetName = 'Məlumat') {
  const cell = (val, r, c, style) => {
    const ref = colName(c) + r;
    if (typeof val === 'number' && Number.isFinite(val)) return `<c r="${ref}"${style}><v>${val}</v></c>`;
    if (val === null || val === undefined || val === '') return '';
    return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEsc(String(val).slice(0, 32000))}</t></is></c>`;
  };
  const widths = headers.map((h, i) => Math.min(60, Math.max(10, String(h).length + 2, ...rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))));
  let sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols><sheetData>';
  sheet += '<row r="1">' + headers.map((h, c) => cell(String(h), 1, c, ' s="1"')).join('') + '</row>';
  rows.forEach((row, i) => { sheet += `<row r="${i + 2}">` + row.map((val, c) => cell(val, i + 2, c, '')).join('') + '</row>'; });
  sheet += '</sheetData></worksheet>';
  const name = xmlEsc(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7F0FC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
}

function csv(headers, rows) {
  const cell = (val) => {
    if (val === null || val === undefined) return '';
    let s = String(val);
    if (typeof val !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // formula-injection guard
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return Buffer.from(String.fromCharCode(0xFEFF) + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n', 'utf8');
}

// Readable names of the exported lists (titles of the PDF version).
const TITLES = {
  news: 'Xəbərlər', projects: 'Layihələr', services: 'Xidmətlər', team: 'Komanda', 'layihe-sorgulari': 'Layihə sorğuları', 'elaqe-sorgulari': 'Əlaqə sorğuları',
  'audit-jurnali': 'Audit jurnalı', 'sened-reyestri': 'Sənəd reyestri', kontragentler: 'Kontragentlər', 'gelir-xerc': 'Gəlir və xərc jurnalı', kadrlar: 'Kadrlar', 'emek-haqqi': 'Əmək haqqı cədvəli',
  'analitika-daily': 'Analitika — günlər üzrə', 'analitika-pages': 'Analitika — səhifələr', 'analitika-sessions': 'Analitika — sessiyalar',
};
const QUERY_LABEL = { q: 'axtarış', from: 'başlanğıc', to: 'son', status: 'status', category: 'kateqoriya', kind: 'növ', doc_type: 'sənəd növü', period: 'ay', response: 'cavab', pay: 'ödəniş', method: 'üsul', year: 'il' };
// Filters of the list in words, for the subtitle of the PDF ("axtarış: «P-004», başlanğıc: 01.10.2026").
function filterText(q) {
  const out = [];
  for (const [k, v] of Object.entries(q || {})) {
    if (!v || ['format', 'inline', 'sort', 'page', 'per_page'].includes(k)) continue;
    const val = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v.slice(8, 10)}.${v.slice(5, 7)}.${v.slice(0, 4)}` : `«${String(v).slice(0, 60)}»`;
    out.push(`${QUERY_LABEL[k] || k}: ${val}`);
  }
  return out.join(', ');
}

// columns: [{ label, get(row) }]; format: xlsx | csv | pdf. title: heading of the PDF (defaults to TITLES[name]).
// pdfColumns: labels of the columns printed in the PDF when a list has more columns than an A4
// page can show legibly (Excel and CSV always contain all columns).
function sendExport(ctx, { name, columns, rows, format, title, pdfColumns }) {
  if (format === 'pdf' && pdfColumns) columns = pdfColumns.map((l) => columns.find((c) => c.label === l)).filter(Boolean);
  const headers = columns.map((c) => c.label);
  const data = rows.map((r) => columns.map((c) => { const x = c.get(r); return x === undefined || x === null ? '' : x; }));
  const stamp = new Date().toISOString().slice(0, 10);
  const file = `aeec-${name.replace(/[^a-z0-9-]/gi, '')}-${stamp}`;
  if (format === 'pdf') {
    const { tablePdf, sendPdf } = require('./pdf');
    const f = filterText(ctx.query);
    const heading = title || TITLES[name] || name;
    return sendPdf(ctx, tablePdf({ title: heading, subtitle: `${data.length} qeyd${f ? ' · ' + f : ''}`, headers, rows: data }), `${file}.pdf`);
  }
  const isX = format === 'xlsx';
  const buf = isX ? xlsx(headers, data, name) : csv(headers, data);
  ctx.res.setHeader('Content-Disposition', `attachment; filename="${file}.${isX ? 'xlsx' : 'csv'}"`);
  ctx.send(200, buf, isX ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8');
}
module.exports = { xlsx, csv, zip, sendExport };
