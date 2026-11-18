import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { db } from '../db/index.ts';
import { attempts, courses, subjects } from '../models/schema.ts';

let server: { baseUrl: string; close: () => Promise<void> };

before(async () => {
  await resetDb();
  server = await startTestServer();
});

after(async () => {
  await server.close();
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

test('GET /certificates/me reports locked status before completion', async () => {
  const { cookie } = await registerTestUser(server.baseUrl, 'CertLocked');
  await makeSubjectWithCourse(8);

  const res = await fetch(`${server.baseUrl}/api/v1/certificates/me`, {
    headers: { Cookie: cookie },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { status: string; remainingCourses: number };
  assert.equal(body.status, 'locked');
  assert.equal(body.remainingCourses, 1);
});

test('GET /certificates/me issues and GET /certificates/:id/download streams a PDF once eligible', async () => {
  const { cookie, userId } = await registerTestUser(server.baseUrl, 'CertEligible');
  const course = await makeSubjectWithCourse(8);
  await db.insert(attempts).values({ userId, courseId: course.id, score: 9, submittedAt: new Date() });

  const meRes = await fetch(`${server.baseUrl}/api/v1/certificates/me`, {
    headers: { Cookie: cookie },
  });
  assert.equal(meRes.status, 200);
  const meBody = (await meRes.json()) as {
    status: string;
    certificate: { id: string; verificationId: string };
  };
  assert.equal(meBody.status, 'issued');

  const downloadRes = await fetch(
    `${server.baseUrl}/api/v1/certificates/${meBody.certificate.id}/download`,
    { headers: { Cookie: cookie } },
  );
  assert.equal(downloadRes.status, 200);
  assert.equal(downloadRes.headers.get('content-type'), 'application/pdf');
  const bytes = await downloadRes.arrayBuffer();
  assert.ok(bytes.byteLength > 0);
});

test('GET /certificates/:id/download rejects someone else’s certificate', async () => {
  const owner = await registerTestUser(server.baseUrl, 'CertOwner');
  const course = await makeSubjectWithCourse(8);
  await db
    .insert(attempts)
    .values({ userId: owner.userId, courseId: course.id, score: 9, submittedAt: new Date() });
  const meRes = await fetch(`${server.baseUrl}/api/v1/certificates/me`, {
    headers: { Cookie: owner.cookie },
  });
  const meBody = (await meRes.json()) as { certificate: { id: string } };

  const stranger = await registerTestUser(server.baseUrl, 'CertStranger');
  const res = await fetch(`${server.baseUrl}/api/v1/certificates/${meBody.certificate.id}/download`, {
    headers: { Cookie: stranger.cookie },
  });
  assert.equal(res.status, 403);
});

test('GET /certificates/verify/:verificationId is public and 404s on an unknown code', async () => {
  const res = await fetch(`${server.baseUrl}/api/v1/certificates/verify/LH-0000-0000`);
  assert.equal(res.status, 404);
});

test('GET /certificates/verify/:verificationId confirms a real certificate without auth', async () => {
  const { cookie, userId } = await registerTestUser(server.baseUrl, 'CertVerify');
  const course = await makeSubjectWithCourse(8);
  await db.insert(attempts).values({ userId, courseId: course.id, score: 9, submittedAt: new Date() });
  const meRes = await fetch(`${server.baseUrl}/api/v1/certificates/me`, {
    headers: { Cookie: cookie },
  });
  const meBody = (await meRes.json()) as { certificate: { verificationId: string } };

  const res = await fetch(
    `${server.baseUrl}/api/v1/certificates/verify/${meBody.certificate.verificationId}`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { valid: boolean; program: string };
  assert.equal(body.valid, true);
  assert.equal(body.program, 'LIAH High School Diploma Program');
});
