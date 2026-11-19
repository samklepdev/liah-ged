import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { seedSubject } from './seed-quizzes.ts';
import { courses, modules } from '../models/schema.ts';
import type { ParsedSubject } from '../lib/quiz-parser.ts';

const subject: ParsedSubject = JSON.parse(
  readFileSync(new URL('../test/fixtures/chassis.quiz.json', import.meta.url), 'utf8'),
);

async function counts() {
  const r = await db.execute(sql`
    select
      (select count(*) from subjects)         as subjects,
      (select count(*) from courses)          as courses,
      (select count(*) from modules)          as modules,
      (select count(*) from questions)        as questions,
      (select count(*) from question_options) as options
  `);
  return r.rows[0] as Record<string, string>;
}

before(async () => {
  await resetDb();
});
beforeEach(async () => {
  await resetDb();
});
after(async () => {
  await closeDb();
});

test('seedSubject loads the whole pack', async () => {
  const result = await seedSubject(subject);
  assert.equal(result.courses, 11);
  assert.equal(result.questions, 110);

  const c = await counts();
  assert.equal(Number(c.subjects), 1);
  assert.equal(Number(c.courses), 11);
  assert.equal(Number(c.questions), 110);
  assert.equal(Number(c.options), 440);
});

test('seedSubject is idempotent', async () => {
  await seedSubject(subject);
  const first = await counts();
  await seedSubject(subject);
  const second = await counts();
  assert.deepEqual(second, first);
});

test('seedSubject writes passScore and content when provided', async () => {
  const withExtras: ParsedSubject = {
    slug: 'ged-demo',
    title: 'GED Demo',
    courses: [
      {
        position: 1,
        slug: 'ged-demo-lesson-1',
        title: 'Lesson 1',
        moduleTitles: ['Quiz A'],
        questionCount: 1,
        passScore: 1,
        content: 'First paragraph.\n\nSecond paragraph.',
        questions: [
          {
            position: 1,
            prompt: 'What is 1 + 1?',
            moduleTitle: 'Quiz A',
            explanation: 'Basic addition.',
            options: [
              { label: 'A', body: '1', isCorrect: false },
              { label: 'B', body: '2', isCorrect: true },
            ],
          },
        ],
      },
    ],
  };

  await seedSubject(withExtras);

  const [row] = await db
    .select({ passScore: courses.passScore, content: courses.content })
    .from(courses)
    .where(eq(courses.slug, 'ged-demo-lesson-1'));

  assert.equal(row?.passScore, 1);
  assert.equal(row?.content, 'First paragraph.\n\nSecond paragraph.');
});

test('seedSubject prefers a markdown override file over JSON content', async () => {
  const withContent: ParsedSubject = {
    slug: 'ged-demo',
    title: 'GED Demo',
    courses: [
      {
        position: 1,
        slug: 'ged-demo-course',
        title: 'Demo Course',
        questionCount: 0,
        content: 'Plain JSON content.',
        moduleTitles: ['Reading'],
        questions: [],
      },
    ],
  };

  const contentDir = new URL('../test/fixtures/content-overrides/', import.meta.url);
  await seedSubject(withContent, contentDir);

  const [row] = await db
    .select({ content: courses.content })
    .from(courses)
    .where(eq(courses.slug, 'ged-demo-course'));
  assert.equal(row!.content, '## Overridden\n\nThis came from the markdown file, not the JSON.\n');
});

test('seedSubject gives each module its position and markdown override content', async () => {
  const withContent: ParsedSubject = {
    slug: 'ged-demo',
    title: 'GED Demo',
    courses: [
      {
        position: 1,
        slug: 'ged-demo-course',
        title: 'Demo Course',
        questionCount: 0,
        moduleTitles: ['Reading', 'Vocabulary'],
        questions: [],
      },
    ],
  };

  const contentDir = new URL('../test/fixtures/content-overrides/', import.meta.url);
  await seedSubject(withContent, contentDir);

  const rows = await db
    .select({ title: modules.title, position: modules.position, content: modules.content })
    .from(modules)
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(courses.slug, 'ged-demo-course'))
    .orderBy(modules.position);

  assert.deepEqual(rows, [
    { title: 'Reading', position: 1, content: '## Reading Topic\n\nThis is the reading topic override.\n' },
    { title: 'Vocabulary', position: 2, content: null },
  ]);
});

test('seedSubject defaults passScore to 9 and content to null when omitted', async () => {
  await seedSubject(subject); // the chassis fixture, which sets neither field

  const [row] = await db
    .select({ passScore: courses.passScore, content: courses.content })
    .from(courses)
    .where(eq(courses.slug, 'chassis-tire-and-rim-essentials'));

  assert.equal(row?.passScore, 9);
  assert.equal(row?.content, null);
});
