// src/services/documents/index.js - single entry point for every generated document.
// All documents are rendered on demand, in memory, and streamed to the client. Nothing is stored.
const { receiptPdf } = require('./receipt');
const { payslipPdf } = require('./payslip');
const { reportCardPdf, bulkReportCardsPdf } = require('./reportCard');
const { sendPdf } = require('./kit');
module.exports = { receiptPdf, payslipPdf, reportCardPdf, bulkReportCardsPdf, sendPdf };
