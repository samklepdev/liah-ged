import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { db } from '../db/index.ts';
import { attempts, courses, subjects } from './schema.ts';
import { createUser } from './user.model.ts';
import {
  checkAndIssueCertificate,
  findCertificateByUserId,
  getEligibilitySummary,
} from './certificate.model.ts';

before(async () => {
  await resetDb();
});

after(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDb();
});

async function makeSubjectWithCourse(passScore = 8) {
  const [subject] = await db
    .insert(subjects)
    .values({ slug: `subject-${Date.now()}-${Math.random()}`, title: 'Test Subject' })
    .returning();
  const [course] = await db
    .insert(courses)
    .values({
      subjectId: subject!.id,
      position: 1,
      slug: `course-${Date.now()}-${Math.random()}`,
      title: 'Test Course',
      passScore,
      questionCount: 10,
    })
    .returning();
  return course!;
}

async function submitScore(userId: string, courseId: string, score: number) {
  await db.insert(attempts).values({ userId, courseId, score, submittedAt: new Date() });
}

test('getEligibilitySummary: not eligible with zero active courses', async () => {
  const user = await createUser('No', 'Courses', 'hash', 'user', false);
  const summary = await getEligibilitySummary(user.id);
  assert.deepEqual(summary, { totalCourses: 0, passedCourses: 0, eligible: false });
});

test('getEligibilitySummary: not eligible until every course is passed', async () => {
  const user = await createUser('Partial', 'Progress', 'hash', 'user', false);
  const courseA = await makeSubjectWithCourse(8);
  await makeSubjectWithCourse(8); // courseB — never attempted
  await submitScore(user.id, courseA.id, 9);

  const summary = await getEligibilitySummary(user.id);
  assert.equal(summary.totalCourses, 2);
  assert.equal(summary.passedCourses, 1);
  assert.equal(summary.eligible, false);
});

test('getEligibilitySummary: eligible once every active course meets its passScore', async () => {
  const user = await createUser('All', 'Passed', 'hash', 'user', false);
  const courseA = await makeSubjectWithCourse(8);
  const courseB = await makeSubjectWithCourse(8);
  await submitScore(user.id, courseA.id, 9);
  await submitScore(user.id, courseB.id, 8);

  const summary = await getEligibilitySummary(user.id);
  assert.deepEqual(summary, { totalCourses: 2, passedCourses: 2, eligible: true });
});

test('checkAndIssueCertificate: issues nothing when not yet eligible', async () => {
  const user = await createUser('Not', 'Eligible', 'hash', 'user', false);
  await makeSubjectWithCourse(8);

  const result = await checkAndIssueCertificate(user.id);
  assert.equal(result, null);
});

test('checkAndIssueCertificate: issues a certificate once eligible, and is idempotent', async () => {
  const user = await createUser('Graduate', 'Student', 'hash', 'user', false);
  const course = await makeSubjectWithCourse(8);
  await submitScore(user.id, course.id, 9);

  const first = await checkAndIssueCertificate(user.id);
  assert.ok(first);
  assert.match(first!.verificationId, /^LH-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  const second = await checkAndIssueCertificate(user.id);
  assert.equal(second!.id, first!.id);

  const stored = await findCertificateByUserId(user.id);
  assert.equal(stored!.id, first!.id);
});
