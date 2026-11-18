import { randomInt } from 'node:crypto';
import { and, count, eq, max } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { attempts, certificates, courses } from './schema.ts';

export type CertificateRow = {
  id: string;
  userId: string;
  verificationId: string;
  issuedAt: Date;
};

export type EligibilitySummary = {
  totalCourses: number;
  passedCourses: number;
  eligible: boolean;
};

async function countActiveCourses(): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(courses)
    .where(eq(courses.isActive, true));
  return Number(row?.total ?? 0);
}

/** Active courses where this user's best submitted score meets passScore. */
async function countPassedActiveCourses(userId: string): Promise<number> {
  const rows = await db
    .select({ passScore: courses.passScore, best: max(attempts.score) })
    .from(courses)
    .innerJoin(attempts, and(eq(attempts.courseId, courses.id), eq(attempts.userId, userId)))
    .where(eq(courses.isActive, true))
    .groupBy(courses.id, courses.passScore);

  return rows.filter((r) => r.best !== null && Number(r.best) >= r.passScore).length;
}

/**
 * Diploma eligibility: every active course passed. Zero active courses means
 * not eligible — there is no curriculum to have completed yet.
 */
export async function getEligibilitySummary(userId: string): Promise<EligibilitySummary> {
  const [totalCourses, passedCourses] = await Promise.all([
    countActiveCourses(),
    countPassedActiveCourses(userId),
  ]);
  return {
    totalCourses,
    passedCourses,
    eligible: totalCourses > 0 && passedCourses === totalCourses,
  };
}

/** `LH-XXXX-XXXX` in base36, uppercased — short enough to read off a certificate. */
function generateVerificationId(): string {
  const part = () => randomInt(0, 36 ** 4).toString(36).toUpperCase().padStart(4, '0');
  return `LH-${part()}-${part()}`;
}

export async function findCertificateByUserId(userId: string): Promise<CertificateRow | null> {
  const [row] = await db.select().from(certificates).where(eq(certificates.userId, userId)).limit(1);
  return row ?? null;
}

export async function findCertificateById(id: string): Promise<CertificateRow | null> {
  const [row] = await db.select().from(certificates).where(eq(certificates.id, id)).limit(1);
  return row ?? null;
}

export async function findCertificateByVerificationId(
  verificationId: string,
): Promise<CertificateRow | null> {
  const [row] = await db
    .select()
    .from(certificates)
    .where(eq(certificates.verificationId, verificationId))
    .limit(1);
  return row ?? null;
}

/**
 * Issues a certificate if the user is eligible and doesn't already have one.
 * Idempotent: a second call after issuance just returns the existing row.
 */
export async function checkAndIssueCertificate(userId: string): Promise<CertificateRow | null> {
  const existing = await findCertificateByUserId(userId);
  if (existing) return existing;

  const { eligible } = await getEligibilitySummary(userId);
  if (!eligible) return null;

  const [inserted] = await db
    .insert(certificates)
    .values({ userId, verificationId: generateVerificationId() })
    .onConflictDoNothing({ target: certificates.userId })
    .returning();

  if (inserted) return inserted;

  // Conflict: issued concurrently between our check and insert.
  return findCertificateByUserId(userId);
}
