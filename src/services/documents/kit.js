// src/services/documents/kit.js
// ONE shared design kit for every generated document (receipt, payslip, report card ...).
// Documents are built in memory and streamed to the client - nothing is stored in DB / Cloudinary / Blob.
const PDFDocument = require('pdfkit');
const { queryOne, sql } = require('../../config/db');

const W = 595.28, H = 841.89, M = 34, CW = W - M * 2;       // A4 portrait, content margin inside the page frame
const HALF_H = 420.94;                                     // half of A4 (receipt / payslip)
const INK = '#111827', MUTED = '#4b5563', FAINT = '#6b7280', LINE = '#cfd4dc';

// ── colour helpers ──────────────────────────────────────────────
// School brand colour (setup module -> schools.brand_color). Accepts #RGB / #RRGGBB, falls back to the app default.
const DEFAULT_BRAND = '#E8600A';
const hex = (c, f = DEFAULT_BRAND) => {
  let v = String(c || '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(v)) v = v.split('').map((x) => x + x).join('');
  return /^[0-9a-fA-F]{6}$/.test(v) ? `#${v.toLowerCase()}` : f;
};
const lum = (h) => { // WCAG relative luminance
  const n = parseInt(h.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const mix = (h, t) => { // blend colour with white: t=0 original ... t=1 white
  const n = parseInt(h.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - t) + 255 * t));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
};
const darkenTo = (h, maxLum) => { let c = h, i = 0; while (lum(c) > maxLum && i++ < 12) { const n = parseInt(c.slice(1), 16); c = '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * 0.88).toString(16).padStart(2, '0')).join(''); } return c; };
const darken = (h, t) => {
  const n = parseInt(h.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - t)));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
};

// ── formatting ──────────────────────────────────────────────────
const money = (rs) => `Rs. ${(Number(rs) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const moneyShort = (rs) => `Rs. ${(Number(rs) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const fmtDate = (d, long = false) => {
  if (!d) return '-';
  const x = new Date(d); if (isNaN(x)) return String(d);
  return x.toLocaleDateString('en-IN', { day: '2-digit', month: long ? 'long' : 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
};
const nowIst = () => new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).replace(' am', ' AM').replace(' pm', ' PM');
const safeName = (s) => String(s || 'document').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(0, 80);

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''));
const three = (n) => (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n));
const amountInWords = (amount) => { // Indian numbering
  const v = Math.round((Number(amount) || 0) * 100) / 100;
  const r = Math.floor(v), p = Math.round((v - r) * 100);
  if (r === 0 && p === 0) return 'Zero Rupees Only';
  const parts = [];
  const cr = Math.floor(r / 1e7), la = Math.floor((r % 1e7) / 1e5), th = Math.floor((r % 1e5) / 1e3), rest = r % 1000;
  if (cr) parts.push(three(cr) + ' Crore');
  if (la) parts.push(two(la) + ' Lakh');
  if (th) parts.push(two(th) + ' Thousand');
  if (rest) parts.push(three(rest));
  let out = r ? `Rupees ${parts.join(' ')}` : '';
  if (p) out += `${r ? ' and ' : ''}${two(p)} Paise`;
  return `${out} Only`;
};

// ── data: school branding + images ──────────────────────────────
const imgCache = new Map(); // school images only (logo / watermark), 10 min
async function fetchImage(url, { cache = false } = {}) {
  if (!url) return null;
  const hit = imgCache.get(url);
  if (cache && hit && Date.now() - hit.at < 600000) return hit.buf;
  let u = url; // pdfkit only reads JPEG/PNG -> ask Cloudinary for PNG
  if (/res\.cloudinary\.com/.test(u) && /\/image\/upload\//.test(u) && !/\/upload\/[^/]*f_/.test(u)) u = u.replace('/image/upload/', '/image/upload/f_png/');
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (cache) { if (imgCache.size > 40) imgCache.clear(); imgCache.set(url, { buf, at: Date.now() }); }
    return buf;
  } catch { return null; }
}

async function getBrand(schoolId) {
  const s = await queryOne(
    `SELECT name, tagline, logo_url, watermark_url, brand_color, address_line1, address_line2, city, state, pincode,
            phone, email, website, affiliation_board, affiliation_no
     FROM schools WHERE id=@sid`,
    { sid: { type: sql.UniqueIdentifier, value: schoolId } }
  );
  if (!s) throw httpError(404, 'School not found');
  const color = hex(s.brand_color);
  const [logo, watermark] = await Promise.all([
    fetchImage(s.logo_url, { cache: true }),
    fetchImage(s.watermark_url || s.logo_url, { cache: true }),
  ]);
  return {
    ...s, color, soft: mix(color, 0.9), softer: mix(color, 0.95), deep: darkenTo(darken(color, 0.35), 0.1), logo, watermark,
    on: lum(color) > 0.5 ? '#0f172a' : '#ffffff',   // readable text colour on top of the brand colour
    text: darkenTo(color, 0.22),                      // brand colour that stays readable as text on white
    address: [s.address_line1, s.address_line2, s.city, s.state, s.pincode].filter(Boolean).join(', '),
    contact: [s.phone && `Ph: ${s.phone}`, s.email && `Email: ${s.email}`, s.website && `Web: ${s.website}`].filter(Boolean).join('   |   '),
    affiliation: [s.affiliation_board && `Affiliated to ${s.affiliation_board}`, s.affiliation_no && `Affiliation No. ${s.affiliation_no}`].filter(Boolean).join('   -   '),
  };
}

function httpError(status, message) { return Object.assign(new Error(message), { status, statusCode: status }); }

// ── document lifecycle ──────────────────────────────────────────
// half=true -> half of A4 (receipt / payslip). Every page gets the school-colour page frame + watermark.
function createDoc(brand, { title, half = false } = {}) {
  const doc = new PDFDocument({ size: half ? [W, HALF_H] : 'A4', margins: { top: M, left: M, right: M, bottom: half ? 8 : M }, bufferPages: true, info: { Title: title || 'Document', Author: brand.name || 'School Office', Creator: 'School Office' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc._done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  doc._compact = !!half;
  const paint = () => { drawWatermark(doc, brand); drawFrame(doc, brand); };
  paint();
  doc.on('pageAdded', paint);
  return doc;
}
const finish = (doc) => { doc.end(); return doc._done; };
const contentLimit = (doc) => doc.page.height - (doc._compact ? 54 : 70); // content must end above the footer

function drawFrame(doc, brand) {
  const { width: w, height: h } = doc.page;
  doc.save();
  doc.lineWidth(1.6).strokeColor(brand.color).rect(14, 14, w - 28, h - 28).stroke();
  doc.lineWidth(0.4).strokeColor(brand.color).rect(18.5, 18.5, w - 37, h - 37).stroke();
  [[14, 14], [w - 14, 14], [14, h - 14], [w - 14, h - 14]].forEach(([x, y]) => doc.rect(x - 3.5, y - 3.5, 7, 7).fill(brand.color));
  doc.restore();
}

function drawWatermark(doc, brand) {
  const { width: w, height: h } = doc.page; const size = doc._compact ? 210 : 310;
  doc.save();
  doc.opacity(0.045);
  if (brand.watermark) {
    try { doc.image(brand.watermark, (w - size) / 2, (h - size) / 2, { fit: [size, size], align: 'center', valign: 'center' }); } catch { /* unreadable image */ }
  } else {
    const t = (brand.name || '').toUpperCase(); let fs = 54; doc.font('Helvetica-Bold');
    while (doc.fontSize(fs).widthOfString(t) > 640 && fs > 14) fs -= 2;
    doc.rotate(-32, { origin: [w / 2, h / 2] }).fillColor(brand.color).fontSize(fs)
      .text(t, (w - 640) / 2, h / 2 - fs / 2, { width: 640, align: 'center', lineBreak: false });
  }
  doc.restore();
}

// ── official header: logo left, school text centred, double rule ─
function drawHeader(doc, brand) {
  const { width: w } = doc.page; const c = !!doc._compact;
  const top = c ? 28 : 34, box = c ? 46 : 62;
  if (brand.logo) {
    try { doc.image(brand.logo, M, top, { fit: [box, box], align: 'center', valign: 'center' }); } catch { /* skip */ }
  } else {
    doc.circle(M + box / 2, top + box / 2, box / 2).fill(brand.soft);
    doc.fillColor(brand.text).font('Times-Bold').fontSize(box * 0.5).text((brand.name || 'S')[0].toUpperCase(), M, top + box / 2 - box * 0.3, { width: box, align: 'center', lineBreak: false });
  }
  const tx = M + box + 12, tw = w - tx * 2;
  const name = (brand.name || 'School').toUpperCase();
  let fs = c ? 16 : 20; doc.font('Times-Bold');
  while (doc.fontSize(fs).widthOfString(name) > tw - 6 && fs > 9) fs -= 0.5;
  doc.fillColor(brand.text).fontSize(fs).text(name, tx, top, { width: tw, align: 'center', lineBreak: false });
  let y = top + fs + 3;
  if (brand.tagline) { doc.font('Times-Italic').fontSize(c ? 8 : 9.5).fillColor(MUTED).text(brand.tagline, tx, y, { width: tw, align: 'center', lineBreak: false }); y += c ? 10 : 13; }
  if (brand.address) { doc.font('Helvetica').fontSize(7.6).fillColor(INK).text(brand.address, tx, y, { width: tw, align: 'center' }); y = doc.y + 1.5; }
  if (c && (brand.affiliation || brand.contact)) {
    doc.font('Helvetica').fontSize(6.8).fillColor(MUTED).text([brand.affiliation, brand.contact].filter(Boolean).join('   |   '), tx, y, { width: tw, align: 'center', lineBreak: false, ellipsis: true }); y += 9;
  } else {
  if (brand.affiliation) { doc.font('Helvetica-Bold').fontSize(7).fillColor(brand.text).text(brand.affiliation, tx, y, { width: tw, align: 'center', lineBreak: false }); y += 9.5; }
  if (brand.contact) { doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(brand.contact, tx, y, { width: tw, align: 'center', lineBreak: false }); y += 9; }
  }
  const bottom = Math.max(y, top + box) + 4;
  doc.moveTo(M, bottom).lineTo(w - M, bottom).lineWidth(2.2).strokeColor(brand.color).stroke();
  doc.moveTo(M, bottom + 3.4).lineTo(w - M, bottom + 3.4).lineWidth(0.5).strokeColor(brand.color).stroke();
  return bottom + (c ? 9 : 14);
}

// document title band in the school colour
function titleBand(doc, brand, y, title, sub) {
  const { width: w } = doc.page;
  if (doc._compact && sub) { title = `${title}  -  ${sub}`; sub = null; }
  const h = sub ? 32 : (doc._compact ? 20 : 22);
  doc.roundedRect(M, y, w - M * 2, h, 4).fill(brand.color);
  doc.font('Times-Bold').fontSize(13).fillColor(brand.on).text(title.toUpperCase(), M, y + (doc._compact ? 4.5 : 5), { width: w - M * 2, align: 'center', characterSpacing: 2.2, lineBreak: false });
  if (sub) doc.font('Helvetica-Bold').fontSize(8.5).text(String(sub).toUpperCase(), M, y + 20, { width: w - M * 2, align: 'center', characterSpacing: 0.8, lineBreak: false });
  return y + h + (doc._compact ? 7 : 12);
}

// ── footer: complete school text on every page (call before finish) ──
function drawFooters(doc, brand, { ref = '', pageNumbers = false, note = 'This is a computer-generated document and does not require a physical signature.' } = {}) {
  const r = doc.bufferedPageRange(); const c = !!doc._compact;
  for (let i = 0; i < r.count; i++) {
    doc.switchToPage(r.start + i);
    doc.page.margins.bottom = 0; // otherwise text below the bottom margin spawns a new page
    const { width: w, height: h } = doc.page;
    const fy = h - (c ? 50 : 62);
    doc.moveTo(M, fy).lineTo(w - M, fy).lineWidth(0.5).strokeColor(brand.color).stroke();
    doc.moveTo(M, fy + 2.4).lineTo(w - M, fy + 2.4).lineWidth(1.6).strokeColor(brand.color).stroke();
    let y = fy + 7;
    doc.font('Times-Bold').fontSize(c ? 8.5 : 9.5).fillColor(brand.text).text((brand.name || '').toUpperCase(), M, y, { width: w - M * 2, align: 'center', lineBreak: false });
    y += c ? 9.5 : 12;
    const addr = [brand.address, brand.contact && brand.contact.replace(/\s{3}\|\s{3}/g, '  |  ')].filter(Boolean).join('   -   ');
    doc.font('Helvetica').fontSize(6.8).fillColor(MUTED).text(addr, M + 6, y, { width: w - M * 2 - 12, align: 'center', lineBreak: false, ellipsis: true });
    y += c ? 8.5 : 9;
    doc.font('Helvetica').fontSize(6.2).fillColor(FAINT).text(`${note}   Generated on ${nowIst()} IST${ref ? '   -   Ref: ' + ref : ''}${pageNumbers ? `   -   Page ${i + 1} of ${r.count}` : ''}`, M + 6, y, { width: w - M * 2 - 12, align: 'center', lineBreak: false, ellipsis: true });
  }
}

// ── building blocks ─────────────────────────────────────────────
function sectionTitle(doc, brand, text, x, y, w) {
  doc.font('Helvetica-Bold').fontSize(7.8).fillColor(brand.text).text(text.toUpperCase(), x, y, { width: w, characterSpacing: 1, lineBreak: false });
  const tw = doc.widthOfString(text.toUpperCase(), { characterSpacing: 1 });
  doc.moveTo(x + tw + 8, y + 4.5).lineTo(x + w, y + 4.5).lineWidth(0.6).strokeColor(brand.color).stroke();
  return y + 15;
}

function card(doc, x, y, w, h, { fill = '#ffffff', stroke = LINE, radius = 6 } = {}) {
  doc.roundedRect(x, y, w, h, radius).fillAndStroke(fill, stroke);
}

// formal bordered info grid. rows: [[{label,value,span?} | [label,value]]]
function infoGrid(doc, brand, { x = M, y, w = CW, rows, rowH = 24 }) {
  const cols = Math.max(...rows.map((r) => r.reduce((n, c) => n + ((Array.isArray(c) ? 1 : c.span) || 1), 0)));
  const cw = w / cols;
  rows.forEach((row, ri) => {
    let cx = x;
    row.forEach((cell) => {
      const [label, value, span] = Array.isArray(cell) ? [cell[0], cell[1], 1] : [cell.label, cell.value, cell.span || 1];
      const cellW = cw * span, cy = y + ri * rowH;
      doc.rect(cx, cy, cellW, rowH).fillAndStroke(ri % 2 === 0 ? brand.softer : '#ffffff', LINE);
      const lo = rowH < 23 ? 3.2 : 4.5, vo = rowH < 23 ? 11 : 13.5;
      doc.font('Helvetica').fontSize(6.3).fillColor(FAINT).text(String(label).toUpperCase(), cx + 6, cy + lo, { width: cellW - 12, characterSpacing: 0.5, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(8.8).fillColor(INK).text(value === null || value === undefined || value === '' ? '-' : String(value), cx + 6, cy + vo, { width: cellW - 12, lineBreak: false, ellipsis: true });
      cx += cellW;
    });
  });
  doc.rect(x, y, w, rows.length * rowH).lineWidth(0.9).strokeColor(brand.color).stroke();
  return y + rows.length * rowH;
}

function kv(doc, label, value, x, y, w, { bold = true, color = INK, size = 9 } = {}) {
  doc.font('Helvetica').fontSize(6.6).fillColor(FAINT).text(String(label).toUpperCase(), x, y, { width: w, characterSpacing: 0.5, lineBreak: false });
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color)
    .text(value === null || value === undefined || value === '' ? '-' : String(value), x, y + 9, { width: w, lineBreak: false, ellipsis: true });
  return y + 25;
}

function avatar(doc, brand, buf, name, x, y, w, h) {
  doc.rect(x, y, w, h).fill(brand.soft);
  let ok = false;
  if (buf) {
    try { doc.save(); doc.rect(x, y, w, h).clip(); doc.image(buf, x, y, { cover: [w, h], align: 'center', valign: 'center' }); doc.restore(); ok = true; } catch { doc.restore(); }
  }
  if (!ok) doc.fillColor(brand.text).font('Times-Bold').fontSize(Math.min(w, h) * 0.42).text((name || '?')[0].toUpperCase(), x, y + h / 2 - Math.min(w, h) * 0.27, { width: w, align: 'center', lineBreak: false });
  doc.rect(x, y, w, h).lineWidth(1).strokeColor(brand.color).stroke();
}

// cols: [{ label, w, align }]; rows: [[cell]] (cell = string | {text,bold,color,sub,subColor}); foot = same shape (tinted total row)
function table(doc, brand, { x = M, y, cols, rows, foot, rowH = 19, headH = 20, onPage }) {
  const w = cols.reduce((n, c) => n + c.w, 0);
  const grid = (yy, h) => { let cx = x; cols.forEach((c, i) => { cx += c.w; if (i < cols.length - 1) doc.moveTo(cx, yy).lineTo(cx, yy + h).lineWidth(0.4).strokeColor(LINE).stroke(); }); doc.moveTo(x, yy + h).lineTo(x + w, yy + h).lineWidth(0.4).strokeColor(LINE).stroke(); };
  const head = (yy) => {
    doc.rect(x, yy, w, headH).fill(brand.color);
    let cx = x; doc.font('Helvetica-Bold').fontSize(7.4).fillColor(brand.on);
    cols.forEach((c) => { doc.text(c.label.toUpperCase(), cx + 6, yy + 6.5, { width: c.w - 12, align: c.align || 'left', characterSpacing: 0.6, lineBreak: false }); cx += c.w; });
    return yy + headH;
  };
  const drawRow = (row, yy, h, { fill, bold } = {}) => {
    if (fill) doc.rect(x, yy, w, h).fill(fill);
    let cx = x;
    row.forEach((cell, ci) => {
      const c = typeof cell === 'object' && cell !== null ? cell : { text: cell };
      const col = cols[ci]; const sub = !!c.sub;
      doc.font(c.bold || bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.4).fillColor(c.color || INK)
        .text(String(c.text ?? '-'), cx + 6, yy + (sub ? 3.5 : (h - 8.4) / 2 + 0.5), { width: col.w - 12, align: col.align || 'left', lineBreak: false, ellipsis: true });
      if (sub) doc.font('Helvetica').fontSize(6.6).fillColor(c.subColor || MUTED).text(c.sub, cx + 6, yy + 13.5, { width: col.w - 12, align: col.align || 'left', lineBreak: false });
      cx += col.w;
    });
    grid(yy, h);
  };
  y = head(y);
  rows.forEach((row) => {
    const h = row.some((c) => c && c.sub) ? rowH + 7 : rowH;
    if (y + h > contentLimit(doc)) { doc.addPage(); y = onPage ? onPage() : 50; y = head(y); }
    drawRow(row, y, h); y += h;
  });
  if (foot) { const h = rowH + 3; if (y + h > contentLimit(doc)) { doc.addPage(); y = onPage ? onPage() : 50; } drawRow(foot, y, h, { fill: brand.soft, bold: true }); y += h; }
  doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.9).strokeColor(brand.color).stroke();
  return y;
}

function signatureLine(doc, label, x, y, w) {
  doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.7).strokeColor('#6b7280').stroke();
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text(label, x, y + 4, { width: w, align: 'center', lineBreak: false });
}

function stamp(doc, text, color = '#dc2626') {
  const { width: w, height: h } = doc.page;
  doc.save();
  doc.rotate(-28, { origin: [w / 2, h / 2] }).opacity(0.14).fillColor(color).font('Helvetica-Bold').fontSize(doc._compact ? 80 : 110)
    .text(text, 0, h / 2 - (doc._compact ? 45 : 65), { width: w, align: 'center', lineBreak: false });
  doc.restore();
}

function sendPdf(res, buffer, filename) {
  res.status(200);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${safeName(filename)}.pdf"`);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.end(buffer);
}

module.exports = {
  W, H, HALF_H, M, CW, INK, MUTED, FAINT, LINE,
  hex, lum, mix, darken, darkenTo, DEFAULT_BRAND, money, moneyShort, fmtDate, nowIst, safeName, amountInWords, httpError,
  fetchImage, getBrand, createDoc, finish, contentLimit, drawHeader, titleBand, drawFooters,
  sectionTitle, card, infoGrid, kv, avatar, table, signatureLine, stamp, sendPdf,
};
