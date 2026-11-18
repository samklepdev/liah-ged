import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { startTestServer, registerTestUser } from '../test/helpers/server.ts';
import { db } from '../db/index.ts';
import { modules, questionOptions, questions, courses, subjects } from '../models/schema.ts';

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

/** One course with exactly one question whose single option is correct, so
 *  answering it and submitting always scores 1/1. Kept in its own file,
 *  isolated from the shared chassis fixture used elsewhere, because
 *  certificate eligibility checks *every* active course — a shared fixture
 *  with many untouched courses would never reach "all passed." */
async function makeSingleQuestionCourse(passScore = 1) {
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
      questionCount: 1,
    })
    .returning();
  const [module] = await db
    .insert(modules)
    .values({ courseId: course!.id, title: 'Module 1' })
    .returning();
  const [question] = await db
    .insert(questions)
    .values({ courseId: course!.id, moduleId: module!.id, position: 1, prompt: 'Q1', explanation: 'E1' })
    .returning();
  const [option] = await db
    .insert(questionOptions)
    .values({ questionId: question!.id, label: 'A', body: 'Correct', isCorrect: true })
    .returning();
  return { course: course!, question: question!, option: option! };
}

test('submitting an attempt that completes the last course issues a certificate', async () => {
  const { cookie } = await registerTestUser(server.baseUrl, 'SubmitGraduate');
  const { course, question, option } = await makeSingleQuestionCourse(1);

  const startRes = await fetch(`${server.baseUrl}/api/v1/courses/${course.slug}/attempts`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  const { attempt } = (await startRes.json()) as { attempt: { id: string } };

  await fetch(`${server.baseUrl}/api/v1/attempts/${attempt.id}/answers/${question.id}`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ optionId: option.id }),
  });

  const submitRes = await fetch(`${server.baseUrl}/api/v1/attempts/${attempt.id}/submit`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  assert.equal(submitRes.status, 200);

  const certRes = await fetch(`${server.baseUrl}/api/v1/certificates/me`, {
    headers: { Cookie: cookie },
  });
  const certBody = (await certRes.json()) as { status: string };
  assert.equal(certBody.status, 'issued');
});

test('submitting an attempt that does not complete every course leaves the certificate locked', async () => {
  const { cookie } = await registerTestUser(server.baseUrl, 'SubmitPartial');
  const { course: courseA, question: questionA, option: optionA } = await makeSingleQuestionCourse(1);
  await makeSingleQuestionCourse(1); // courseB — never attempted

  const startRes = await fetch(`${server.baseUrl}/api/v1/courses/${courseA.slug}/attempts`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  const { attempt } = (await startRes.json()) as { attempt: { id: string } };

  await fetch(`${server.baseUrl}/api/v1/attempts/${attempt.id}/answers/${questionA.id}`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ optionId: optionA.id }),
  });
  await fetch(`${server.baseUrl}/api/v1/attempts/${attempt.id}/submit`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });

  const certRes = await fetch(`${server.baseUrl}/api/v1/certificates/me`, {
    headers: { Cookie: cookie },
  });
  const certBody = (await certRes.json()) as { status: string; remainingCourses: number };
  assert.equal(certBody.status, 'locked');
  assert.equal(certBody.remainingCourses, 1);
});
