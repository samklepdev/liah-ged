import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { seedSubject } from '../scripts/seed-quizzes.ts';
import { findCourseBySlug } from './catalog.model.ts';
import { deleteCourseById } from './admin-course.model.ts';
import type { ParsedSubject } from '../lib/quiz-parser.ts';

const subject: ParsedSubject = JSON.parse(
  readFileSync(new URL('../test/fixtures/chassis.quiz.json', import.meta.url), 'utf8'),
);

before(async () => {
  await resetDb();
});
beforeEach(async () => {
  await resetDb();
  await seedSubject(subject);
});
after(async () => {
  await closeDb();
});

test('findCourseBySlug returns course detail including content', async () => {
  const course = await findCourseBySlug('chassis-tire-and-rim-essentials');
  assert.ok(course);
  assert.equal(course?.title, 'Tire and Rim Essentials');
  assert.equal(course?.position, 1);
  assert.equal(course?.passScore, 9);
  assert.equal(course?.questionCount, 10);
  assert.equal(course?.content, null);
  assert.equal(course?.subjectSlug, 'chassis');
  assert.equal(course?.subjectTitle, 'Chassis');
});

test('findCourseBySlug returns null for an unknown slug', async () => {
  assert.equal(await findCourseBySlug('does-not-exist'), null);
});

test('findCourseBySlug returns null for a soft-deleted course', async () => {
  const course = await findCourseBySlug('chassis-tire-and-rim-essentials');
  await deleteCourseById(course!.id);
  assert.equal(await findCourseBySlug('chassis-tire-and-rim-essentials'), null);
});
