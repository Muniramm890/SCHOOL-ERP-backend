// src/services/documents/kit.js
// ONE shared design kit for every generated document (receipt, payslip, report card ...).
// Documents are built in memory and streamed to the client - nothing is stored in DB / Cloudinary / Blob.
const PDFDocument = require('pdfkit');
const { queryOne, sql } = require('../../config/db');

const W = 595.28, H = 841.89, M = 36, CW = W - M * 2;
const INK = '#0f172a', MUTED = '#64748b', FAINT = '#94a3b8', LINE = '#e2e8f0';

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
    contact: [s.phone && `Ph: ${s.phone}`, s.email, s.website].filter(Boolean).join('   |   '),
  };
}

function httpError(status, message) { return Object.assign(new Error(message), { status, statusCode: status }); }

// ── document lifecycle ──────────────────────────────────────────
function createDoc(brand, { title, margin = M } = {}) {
  const doc = new PDFDocument({ size: 'A4', margin, bufferPages: true, info: { Title: title || 'Document', Author: brand.name || 'School Office', Creator: 'School Office' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc._done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  const paintWatermark = () => drawWatermark(doc, brand);
  paintWatermark();
  doc.on('pageAdded', paintWatermark);
  return doc;
}
const finish = (doc) => { doc.end(); return doc._done; };

function drawWatermark(doc, brand) {
  doc.save();
  doc.opacity(0.04);
  if (brand.watermark) {
    try { doc.image(brand.watermark, (W - 300) / 2, (H - 300) / 2, { fit: [300, 300], align: 'center', valign: 'center' }); } catch { /* unreadable image */ }
  } else {
    const t = (brand.name || '').toUpperCase(); let fs = 54; doc.font('Helvetica-Bold');
    while (doc.fontSize(fs).widthOfString(t) > 640 && fs > 14) fs -= 2;
    doc.rotate(-32, { origin: [W / 2, H / 2] }).fillColor(brand.color).fontSize(fs)
      .text(t, (W - 640) / 2, H / 2 - fs / 2, { width: 640, align: 'center', lineBreak: false });
  }
  doc.restore();
}

// ── header ──────────────────────────────────────────────────────
// badge: document type (e.g. "FEE RECEIPT"); meta: array of up to 2 short lines shown under the badge
function drawHeader(doc, brand, { badge, meta = [] }) {
  doc.rect(0, 0, W, 6).fill(brand.color);
  doc.rect(0, 6, W, 1.5).fill(brand.soft);

  const top = 24, box = 50;
  doc.roundedRect(M, top, box, box, 10).fillAndStroke('#ffffff', LINE);
  if (brand.logo) {
    try { doc.image(brand.logo, M + 5, top + 5, { fit: [box - 10, box - 10], align: 'center', valign: 'center' }); } catch { /* skip */ }
  } else {
    doc.roundedRect(M, top, box, box, 10).fill(brand.soft);
    doc.fillColor(brand.text).font('Helvetica-Bold').fontSize(22).text((brand.name || 'S')[0].toUpperCase(), M, top + 14, { width: box, align: 'center', lineBreak: false });
  }

  const tx = M + box + 12, tw = 268;
  const name = (brand.name || 'School').toUpperCase();
  let fs = 15; doc.font('Helvetica-Bold');
  while (doc.fontSize(fs).widthOfString(name) > tw - 6 && fs > 8) fs -= 0.5;
  doc.fillColor(INK).fontSize(fs).text(name, tx, top + 1, { width: tw, lineBreak: false });
  let y = top + fs + 5;
  if (brand.tagline) { doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(brand.text).text(brand.tagline, tx, y, { width: tw, lineBreak: false }); y += 10; }
  if (brand.address) { doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(brand.address, tx, y, { width: tw }); y = doc.y + 1.5; }
  if (brand.contact) { doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(brand.contact, tx, y, { width: tw, lineBreak: false }); y += 9; }
  if (brand.affiliation_board || brand.affiliation_no) {
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor(FAINT).text([brand.affiliation_board, brand.affiliation_no].filter(Boolean).join('  -  '), tx, y, { width: tw, lineBreak: false });
  }

  // right: badge pill + meta lines
  doc.font('Helvetica-Bold').fontSize(8.5);
  const label = (badge || '').toUpperCase();
  const pw = Math.min(190, doc.widthOfString(label, { characterSpacing: 1 }) + 28);
  doc.roundedRect(W - M - pw, top + 2, pw, 20, 10).fill(brand.color);
  doc.fillColor(brand.on).text(label, W - M - pw, top + 8, { width: pw, align: 'center', characterSpacing: 1, lineBreak: false });
  let my = top + 30;
  meta.slice(0, 3).forEach((m, i) => {
    doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(i === 0 ? 9 : 7.5).fillColor(i === 0 ? INK : MUTED)
      .text(m, W - M - 200, my, { width: 200, align: 'right', lineBreak: false });
    my += i === 0 ? 12 : 10;
  });

  const bottom = 92;
  doc.moveTo(M, bottom).lineTo(W - M, bottom).lineWidth(0.6).strokeColor(LINE).stroke();
  doc.moveTo(M, bottom).lineTo(M + 64, bottom).lineWidth(2).strokeColor(brand.color).stroke();
  return bottom + 14;
}

// ── footer (all pages, call before finish) ──────────────────────
function drawFooters(doc, brand, { ref = '', pageNumbers = true, note = 'This is a computer-generated document and does not require a physical signature.' } = {}) {
  const r = doc.bufferedPageRange();
  for (let i = 0; i < r.count; i++) {
    doc.switchToPage(r.start + i);
    doc.page.margins.bottom = 0; // otherwise text below the bottom margin spawns a new page
    const y = H - 46;
    doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.6).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(6.8).fillColor(FAINT)
      .text(`Generated on ${nowIst()} IST`, M, y + 6, { width: 200, lineBreak: false });
    doc.text(note, M + 120, y + 6, { width: CW - 240, align: 'center', lineBreak: false });
    const right = [ref, pageNumbers ? `Page ${i + 1} of ${r.count}` : ''].filter(Boolean).join('   -   ');
    doc.text(right, W - M - 200, y + 6, { width: 200, align: 'right', lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(7).fillColor(brand.text)
      .text(`${brand.name || ''}${brand.website ? '  -  ' + brand.website : ''}`, M, y + 18, { width: CW, align: 'center', lineBreak: false });
    doc.rect(0, H - 5, W, 5).fill(brand.color);
  }
}

// ── building blocks ─────────────────────────────────────────────
function sectionTitle(doc, brand, text, x, y, w) {
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(brand.text).text(text.toUpperCase(), x, y, { width: w, characterSpacing: 0.9, lineBreak: false });
  const tw = doc.widthOfString(text.toUpperCase(), { characterSpacing: 0.9 });
  doc.moveTo(x + tw + 8, y + 4).lineTo(x + w, y + 4).lineWidth(0.6).strokeColor(LINE).stroke();
  return y + 15;
}

function card(doc, x, y, w, h, { fill = '#ffffff', stroke = LINE, radius = 8 } = {}) {
  doc.roundedRect(x, y, w, h, radius).fillAndStroke(fill, stroke);
}

function kv(doc, label, value, x, y, w, { bold = true, color = INK, size = 9 } = {}) {
  doc.font('Helvetica').fontSize(6.6).fillColor(FAINT).text(String(label).toUpperCase(), x, y, { width: w, characterSpacing: 0.5, lineBreak: false });
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color)
    .text(value === null || value === undefined || value === '' ? '-' : String(value), x, y + 9, { width: w, lineBreak: false, ellipsis: true });
  return y + 25;
}

function avatar(doc, brand, buf, name, x, y, w, h) {
  doc.roundedRect(x, y, w, h, 8).fill(brand.soft);
  let ok = false;
  if (buf) {
    try {
      doc.save(); doc.roundedRect(x, y, w, h, 8).clip();
      doc.image(buf, x, y, { cover: [w, h], align: 'center', valign: 'center' });
      doc.restore(); ok = true;
    } catch { doc.restore(); }
  }
  if (!ok) doc.fillColor(brand.text).font('Helvetica-Bold').fontSize(Math.min(w, h) * 0.42).text((name || '?')[0].toUpperCase(), x, y + h / 2 - Math.min(w, h) * 0.27, { width: w, align: 'center', lineBreak: false });
  doc.roundedRect(x, y, w, h, 8).lineWidth(1).strokeColor(brand.color).stroke();
}

// cols: [{ label, w, align }]; rows: [[cell...]] where cell = string | { text, bold, color, sub, subColor }
function table(doc, brand, { x = M, y, cols, rows, rowH = 19, headH = 20, onPage }) {
  const w = cols.reduce((n, c) => n + c.w, 0);
  const head = (yy) => {
    doc.roundedRect(x, yy, w, headH, 5).fill(brand.color);
    let cx = x;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(brand.on);
    cols.forEach((c) => { doc.text(c.label.toUpperCase(), cx + 8, yy + 6.5, { width: c.w - 16, align: c.align || 'left', characterSpacing: 0.6, lineBreak: false }); cx += c.w; });
    return yy + headH;
  };
  y = head(y);
  rows.forEach((row, ri) => {
    const hasSub = row.some((c) => c && c.sub);
    const h = hasSub ? rowH + 8 : rowH;
    if (y + h > H - 70) { doc.addPage(); y = onPage ? onPage() : 50; y = head(y); }
    if (ri % 2 === 0) doc.rect(x, y, w, h).fill(brand.softer);
    let cx = x;
    row.forEach((cell, ci) => {
      const c = typeof cell === 'object' && cell !== null ? cell : { text: cell };
      const col = cols[ci];
      doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(c.color || INK)
        .text(String(c.text ?? '-'), cx + 8, y + (hasSub ? 4 : 5.5), { width: col.w - 16, align: col.align || 'left', lineBreak: false, ellipsis: true });
      if (c.sub) doc.font('Helvetica').fontSize(6.8).fillColor(c.subColor || MUTED).text(c.sub, cx + 8, y + 15, { width: col.w - 16, align: col.align || 'left', lineBreak: false });
      cx += col.w;
    });
    y += h;
  });
  doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.8).strokeColor(brand.color).stroke();
  return y;
}

function signatureLine(doc, label, x, y, w) {
  doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.7).strokeColor('#94a3b8').stroke();
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text(label, x, y + 4, { width: w, align: 'center', lineBreak: false });
}

function stamp(doc, text, color = '#dc2626') {
  doc.save();
  doc.rotate(-28, { origin: [W / 2, H / 2 - 40] }).opacity(0.14).fillColor(color).font('Helvetica-Bold').fontSize(110)
    .text(text, 0, H / 2 - 100, { width: W, align: 'center', lineBreak: false });
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
  W, H, M, CW, INK, MUTED, FAINT, LINE,
  hex, lum, mix, darken, darkenTo, DEFAULT_BRAND, money, moneyShort, fmtDate, nowIst, safeName, amountInWords, httpError,
  fetchImage, getBrand, createDoc, finish, drawHeader, drawFooters,
  sectionTitle, card, kv, avatar, table, signatureLine, stamp, sendPdf,
};
