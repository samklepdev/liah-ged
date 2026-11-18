import type { Request, Response } from 'express';
import { param } from '../lib/http.ts';
import { buildCertificatePdf } from '../lib/certificate-pdf.ts';
import {
  checkAndIssueCertificate,
  findCertificateById,
  findCertificateByVerificationId,
  getEligibilitySummary,
} from '../models/certificate.model.ts';
import { findUserById } from '../models/user.model.ts';

function recipientName(user: {
  firstName: string | null;
  lastName: string | null;
  username: string;
}): string {
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return name || user.username;
}

export async function getMine(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const issued = await checkAndIssueCertificate(userId);
  if (issued) {
    res.json({
      status: 'issued',
      certificate: {
        id: issued.id,
        verificationId: issued.verificationId,
        issuedAt: issued.issuedAt,
      },
    });
    return;
  }

  const { totalCourses, passedCourses } = await getEligibilitySummary(userId);
  res.json({ status: 'locked', remainingCourses: totalCourses - passedCourses, totalCourses });
}

export async function download(req: Request, res: Response): Promise<void> {
  const certificate = await findCertificateById(param(req, 'id'));
  if (!certificate) {
    res.status(404).json({ error: 'Certificate not found' });
    return;
  }
  if (certificate.userId !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Not your certificate' });
    return;
  }

  const user = await findUserById(certificate.userId);
  if (!user) {
    res.status(404).json({ error: 'Certificate not found' });
    return;
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="liah-ged-certificate-${certificate.verificationId}.pdf"`,
  );

  const doc = buildCertificatePdf({
    recipientName: recipientName(user),
    verificationId: certificate.verificationId,
    issuedAt: certificate.issuedAt,
  });
  doc.pipe(res);
  doc.end();
}

export async function verify(req: Request, res: Response): Promise<void> {
  const certificate = await findCertificateByVerificationId(param(req, 'verificationId'));
  if (!certificate) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const user = await findUserById(certificate.userId);
  if (!user) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  res.json({
    valid: true,
    recipientName: recipientName(user),
    program: 'LIAH High School Diploma Program',
    issuedAt: certificate.issuedAt,
  });
}
