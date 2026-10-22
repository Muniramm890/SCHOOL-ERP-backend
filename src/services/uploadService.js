//src/services/uploadService.js
const cloudinary = require('cloudinary').v2;
const { BlobServiceClient } = require('@azure/storage-blob');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const safeName = (name) =>
  (name || 'unnamed')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase();

// buffer -> upload -> returns secure_url
function uploadImageBuffer(buffer, { schoolName, subfolder, fileName }) {
  return new Promise((resolve, reject) => {
    const folderPath = `${safeName(schoolName)}/${subfolder}`;
    const publicId = safeName(fileName) + '_' + Date.now(); // timestamp avoids overwrite collisions
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'image', folder: folderPath, public_id: publicId, overwrite: true },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

function uploadRawBuffer(buffer, { schoolName, subfolder, fileName, ext }) {
  return new Promise((resolve, reject) => {
    const folderPath = `${safeName(schoolName)}/${subfolder}`;
    const publicId = `${safeName(fileName)}.${ext}`;
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'raw', folder: folderPath, public_id: publicId, overwrite: true },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

const { generateBlobSASQueryParameters, BlobSASPermissions, StorageSharedKeyCredential } = require('@azure/storage-blob');

const connectionString = process.env.uploadhomework_string;
const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
// signed URLs need the account key: env var if set, otherwise the one inside the connection string
const CONNECTION_ACCOUNT_KEY = (String(connectionString || '').match(/AccountKey=([^;]+)/) || [])[1];

// ── Container registry — one BlobServiceClient, multiple logical containers ──
const CONTAINERS = {
  homework: 'homeworksschooloffice',
  payslips: 'payslipsschooloffice', 
  commAttachments: 'commattachmentsschooloffice',
  chatMedia: 'chatmediaschooloffice', // private: chat photos / videos / documents (always read through short-lived signed URLs)
};
const getContainerClient = (containerKey) => blobServiceClient.getContainerClient(CONTAINERS[containerKey]);

// Backward-compatible: existing homework code keeps working unchanged
const containerClient = getContainerClient('homework');
const containerName = CONTAINERS.homework;

const uploadBufferToAzure = async (buffer, originalname, ext) => {
  try {
    const folderPath = `homework/${Date.now()}_${safeName(originalname)}${ext}`;
    const blockBlobClient = containerClient.getBlockBlobClient(folderPath);
    await blockBlobClient.upload(buffer, buffer.length);
    return { secure_url: blockBlobClient.url, public_id: folderPath };
  } catch (error) {
    throw new Error(`Azure Upload Failed: ${error.message}`);
  }
};

// 🔴 NEW: SaaS-organized payslip PDF upload — payslips/{schoolId}/{monthYear}/{staffId}_{timestamp}.pdf
const uploadPayslipPdf = async (buffer, { schoolId, monthYear, staffId }) => {
  try {
    const client = getContainerClient('payslips');
    const blobPath = `payslips/${schoolId}/${monthYear}/${staffId}_${Date.now()}.pdf`;
    const blockBlobClient = client.getBlockBlobClient(blobPath);
    await blockBlobClient.upload(buffer, buffer.length, {
      blobHTTPHeaders: { blobContentType: 'application/pdf', blobContentDisposition: 'inline' },
    });
    return { secure_url: blockBlobClient.url, public_id: blobPath };
  } catch (error) {
    throw new Error(`Azure Payslip Upload Failed: ${error.message}`);
  }
};

// Delete a blob from any container when a document is removed/regenerated
const deleteBlobFromAzure = async (blobPath, containerKey = 'homework') => {
  try {
    const client = getContainerClient(containerKey);
    const blockBlobClient = client.getBlockBlobClient(blobPath);
    await blockBlobClient.deleteIfExists();
  } catch (error) {
    console.error('Azure Delete Failed:', error.message);
  }
};

// Generate a short-lived signed URL — now works across containers
const getSignedDownloadUrl = (blobPath, expiryMinutes = 60, containerKey = 'homework') => {
  try {
    const targetContainerName = CONTAINERS[containerKey];
    const client = getContainerClient(containerKey);
    const accountName = blobServiceClient.accountName;
    const accountKey = process.env.AZURE_STORAGE_KEY || CONNECTION_ACCOUNT_KEY;
    if (!accountKey) return client.getBlockBlobClient(blobPath).url;

    const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
    const sasToken = generateBlobSASQueryParameters({
      containerName: targetContainerName,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse('r'),
      expiresOn: new Date(Date.now() + expiryMinutes * 60 * 1000),
    }, sharedKeyCredential).toString();

    return `${client.getBlockBlobClient(blobPath).url}?${sasToken}`;
  } catch (error) {
    console.error('SAS Generation Failed:', error.message);
    return getContainerClient(containerKey).getBlockBlobClient(blobPath).url;
  }
};

// 🔴 Communication Hub attachments — school-wise organized: commAttachments/{schoolId}/{messageFolder}/{filename}
const uploadCommAttachment = async (buffer, { schoolId, fileName, ext }) => {
  try {
    const client = getContainerClient('commAttachments');
    const blobPath = `comm/${schoolId}/${Date.now()}_${safeName(fileName)}${ext}`;
    const blockBlobClient = client.getBlockBlobClient(blobPath);
    await blockBlobClient.upload(buffer, buffer.length);
    return { secure_url: blockBlobClient.url, public_id: blobPath };
  } catch (error) {
    throw new Error(`Azure Comm Attachment Upload Failed: ${error.message}`);
  }
};

// 🔴 Chat media (photo / video / document) — chat/{schoolId}/{recipientId}/{timestamp}_{random}.{ext}
const _ensured = {};
const ensureContainer = async (key) => {
  if (_ensured[key]) return;
  await getContainerClient(key).createIfNotExists(); // private by default
  _ensured[key] = true;
};
const uploadChatMedia = async (buffer, { schoolId, recipientId, ext, mime }) => {
  try {
    await ensureContainer('chatMedia');
    const blobPath = `chat/${schoolId}/${recipientId}/${Date.now()}_${require('crypto').randomBytes(6).toString('hex')}${ext}`;
    const blockBlobClient = getContainerClient('chatMedia').getBlockBlobClient(blobPath);
    await blockBlobClient.upload(buffer, buffer.length, { blobHTTPHeaders: { blobContentType: mime } });
    return { blobPath };
  } catch (error) {
    throw new Error(`Chat media upload failed: ${error.message}`);
  }
};

// ── Read a blob that belongs to OUR storage account, given its URL (SAS or plain). Used by filesController (PDF viewer). ──
const resolveBlobUrl = (u) => {
  try {
    if (String(u.hostname).toLowerCase() !== `${blobServiceClient.accountName}.blob.core.windows.net`.toLowerCase()) return null;
    const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean); // [container, ...blobPath]
    const container = parts.shift();
    if (!Object.values(CONTAINERS).includes(container) || !parts.length) return null;
    return { container, blobPath: parts.join('/') };
  } catch { return null; }
};

const downloadBlobBuffer = async (container, blobPath, maxBytes = 30 * 1024 * 1024) => {
  try {
    const dl = await blobServiceClient.getContainerClient(container).getBlobClient(blobPath).download();
    const chunks = []; let size = 0;
    for await (const c of dl.readableStreamBody) {
      size += c.length;
      if (size > maxBytes) throw Object.assign(new Error('File is too large'), { status: 413 });
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  } catch (e) {
    if (e && (e.statusCode === 404 || e.code === 'BlobNotFound')) throw Object.assign(new Error('Document not found'), { status: 404 });
    throw e;
  }
};

module.exports = { uploadImageBuffer, uploadBufferToAzure, uploadRawBuffer, uploadPayslipPdf, uploadCommAttachment, uploadChatMedia, safeName, deleteBlobFromAzure, getSignedDownloadUrl, resolveBlobUrl, downloadBlobBuffer };