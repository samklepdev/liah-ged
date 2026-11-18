import PDFDocument from 'pdfkit';

export type CertificatePdfData = {
  recipientName: string;
  verificationId: string;
  issuedAt: Date;
};

const NAVY = '#152542';
const GOLD = '#9c7a2e';
const SUBTEXT = '#5a6378';

/**
 * Draws the certificate onto a new landscape A4 document and returns it
 * unended. The caller pipes it to a destination and calls `.end()` — kept
 * separate so the same document can be streamed to an HTTP response.
 */
export function buildCertificatePdf({
  recipientName,
  verificationId,
  issuedAt,
}: CertificatePdfData): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
  const { width, height } = doc.page;
  const margin = 36;

  doc
    .rect(margin, margin, width - margin * 2, height - margin * 2)
    .lineWidth(3)
    .stroke(NAVY);
  doc
    .rect(margin + 14, margin + 14, width - (margin + 14) * 2, height - (margin + 14) * 2)
    .lineWidth(1)
    .stroke(GOLD);

  doc.circle(width / 2, margin + 70, 28).lineWidth(2).stroke(GOLD);
  doc
    .fillColor(GOLD)
    .font('Times-Bold')
    .fontSize(20)
    .text('LH', width / 2 - 28, margin + 60, { width: 56, align: 'center' });

  doc
    .fillColor(NAVY)
    .font('Times-Roman')
    .fontSize(12)
    .text('CERTIFICATE OF COMPLETION', 0, margin + 125, { align: 'center' });

  doc
    .fillColor(NAVY)
    .font('Times-Roman')
    .fontSize(14)
    .text('This certifies that', 0, margin + 155, { align: 'center' });

  doc
    .fillColor(NAVY)
    .font('Times-Bold')
    .fontSize(30)
    .text(recipientName, 0, margin + 180, { align: 'center' });

  doc
    .fillColor(NAVY)
    .font('Times-Roman')
    .fontSize(14)
    .text('has fulfilled all requirements of the', 0, margin + 228, { align: 'center' });

  doc
    .fillColor(NAVY)
    .font('Times-Bold')
    .fontSize(14)
    .text('LIAH High School Diploma Program', 0, margin + 248, { align: 'center' });

  doc
    .fillColor(SUBTEXT)
    .font('Times-Roman')
    .fontSize(10)
    .text(
      `Issued ${issuedAt.toISOString().slice(0, 10)}  ·  Verification ID: ${verificationId}`,
      0,
      height - margin - 40,
      { align: 'center' },
    );

  return doc;
}
