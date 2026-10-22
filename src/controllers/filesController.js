// src/controllers/filesController.js
// Authenticated PDF streaming for the in-app PDF viewer (Admin + Student apps).
// Why: the viewer needs the real PDF BYTES. Cloudinary / Azure Blob links are not fetchable from a browser or the
// Android WebView (no CORS on Blob, Cloudinary may block PDF delivery, SAS links expire). So the API fetches the file
// itself (server-side, with our credentials) and streams it back over our own CORS-enabled, token-protected endpoint.
//
//   GET /api/files/pdf?url=<encoded cloudinary-or-blob url>            (staff token)
//   GET /api/student/files/pdf?url=<encoded cloudinary-or-blob url>    (student token)
//
// Safety: only OUR Cloudinary cloud and OUR Azure storage account/containers are allowed (no open proxy / SSRF),
// size capped, and the bytes must really be a PDF (%PDF- magic) before they are sent.
const cloudinary = require('cloudinary').v2;
const { resolveBlobUrl, downloadBlobBuffer } = require('../services/uploadService');

const MAX_BYTES = 30 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 25000;

const httpErr = (status, message) => Object.assign(new Error(message), { status });

// https://res.cloudinary.com/<cloud>/(raw|image)/(upload|authenticated|private)/[s--sig--/][transforms/][v123/]<public_id>
function parseCloudinaryUrl(u) {
  const m = u.pathname.match(/^\/([^/]+)\/(raw|image)\/(upload|authenticated|private)\/(?:s--[^/]+--\/)?(.+)$/);
  if (!m) return null;
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloud || m[1] !== cloud) return null; // only our own cloud
  const rest = m[4];
  const v = rest.match(/(?:^|\/)v\d+\/(.+)$/);
  let publicId;
  try { publicId = decodeURIComponent(v ? v[1] : rest); } catch { return null; }
  let format = '';
  if (m[2] === 'image') { // images keep the extension out of public_id
    const dot = publicId.lastIndexOf('.');
    if (dot > 0) { format = publicId.slice(dot + 1).toLowerCase(); publicId = publicId.slice(0, dot); }
  }
  return { resourceType: m[2], type: m[3], publicId, format };
}

async function fetchBuffer(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw Object.assign(new Error(`upstream ${res.status}`), { upstream: res.status });
  if ((Number(res.headers.get('content-length')) || 0) > MAX_BYTES) throw httpErr(413, 'File is too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw httpErr(413, 'File is too large');
  return buf;
}

// 1) normal delivery URL  2) if Cloudinary refuses (PDF delivery blocked / authenticated type): signed API download
async function getCloudinaryBuffer(u, info) {
  try {
    return await fetchBuffer(u.toString());
  } catch (e) {
    if (e.status) throw e; // our own 413 etc.
  }
  const signed = cloudinary.utils.private_download_url(info.publicId, info.format, {
    resource_type: info.resourceType, type: info.type, attachment: false, expires_at: Math.floor(Date.now() / 1000) + 300,
  });
  return fetchBuffer(signed);
}

const isPdf = (buf) => buf.length > 5 && buf.subarray(0, 1024).includes('%PDF-');

exports.streamPdf = async (req, res) => {
  try {
    const raw = String(req.query.url || '');
    if (!raw || raw.length > 2500) throw httpErr(400, 'url is required');
    let u;
    try { u = new URL(raw); } catch { throw httpErr(400, 'Invalid url'); }
    if (u.protocol !== 'https:') throw httpErr(400, 'Invalid url');

    let buf;
    const blob = resolveBlobUrl(u);
    const cl = !blob && u.hostname.toLowerCase() === 'res.cloudinary.com' ? parseCloudinaryUrl(u) : null;
    if (blob) buf = await downloadBlobBuffer(blob.container, blob.blobPath, MAX_BYTES);
    else if (cl) buf = await getCloudinaryBuffer(u, cl);
    else throw httpErr(400, 'This file location is not allowed');

    if (!isPdf(buf)) throw httpErr(415, 'The file is not a valid PDF');

    let name = 'document.pdf';
    try { name = decodeURIComponent(u.pathname.split('/').pop() || name).replace(/[^\w.\- ()]+/g, '_').slice(-80) || name; } catch { /* keep default */ }
    if (!/\.pdf$/i.test(name)) name += '.pdf';

    res.status(200).set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(buf.length),
      'Content-Disposition': `inline; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Disposition',
    });
    return res.end(buf);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ success: false, message: e.message });
    if (e.upstream === 404) return res.status(404).json({ success: false, message: 'Document not found' });
    console.error('[files] pdf stream failed:', e.message);
    return res.status(502).json({ success: false, message: 'Could not fetch the document. Please try again.' });
  }
};
