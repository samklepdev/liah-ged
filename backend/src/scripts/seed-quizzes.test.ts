import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { seedSubject } from './seed-quizzes.ts';
import { courses, modules, topics } from '../models/schema.ts';
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

test('seedSubject inserts each course\'s topics in order, with their content', async () => {
  const withTopics: ParsedSubject = {
    slug: 'ged-demo',
    title: 'GED Demo',
    courses: [
      {
        position: 1,
        slug: 'ged-demo-course',
        title: 'Demo Course',
        questionCount: 0,
        moduleTitles: ['Reading'],
        topics: [
          { title: 'In this lesson…', content: 'You will learn things.' },
          { title: 'Practice Question 1', content: null },
        ],
        questions: [],
      },
    ],
  };

  await seedSubject(withTopics);

  const rows = await db
    .select({ position: topics.position, title: topics.title, content: topics.content })
    .from(topics)
    .innerJoin(courses, eq(courses.id, topics.courseId))
    .where(eq(courses.slug, 'ged-demo-course'))
    .orderBy(topics.position);

  assert.deepEqual(rows, [
    { position: 1, title: 'In this lesson…', content: 'You will learn things.' },
    { position: 2, title: 'Practice Question 1', content: null },
  ]);
});

test('seedSubject links a topic to its module when the titles match', async () => {
  const withQuizTopic: ParsedSubject = {
    slug: 'ged-demo',
    title: 'GED Demo',
    courses: [
      {
        position: 1,
        slug: 'ged-demo-course',
        title: 'Demo Course',
        questionCount: 1,
        moduleTitles: ['Final Quiz'],
        topics: [
          { title: 'Summary', content: 'Wrap-up text.' },
          { title: 'Final Quiz', content: null },
        ],
        questions: [
          {
            position: 1,
            prompt: 'What is 1 + 1?',
            moduleTitle: 'Final Quiz',
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

  await seedSubject(withQuizTopic);

  const [course] = await db.select().from(courses).where(eq(courses.slug, 'ged-demo-course'));
  const [module] = await db.select().from(modules).where(eq(modules.courseId, course!.id));

  const rows = await db
    .select({ title: topics.title, moduleId: topics.moduleId })
    .from(topics)
    .where(eq(topics.courseId, course!.id))
    .orderBy(topics.position);

  assert.deepEqual(rows, [
    { title: 'Summary', moduleId: null },
    { title: 'Final Quiz', moduleId: module!.id },
  ]);
});

test('seedSubject marks a course\'s practice module titles as isPractice', async () => {
  const withPractice: ParsedSubject = {
    slug: 'ged-demo',
    title: 'GED Demo',
    courses: [
      {
        position: 1,
        slug: 'ged-demo-course',
        title: 'Demo Course',
        questionCount: 1,
        moduleTitles: ['Final Quiz', 'Practice Question 1'],
        practiceModuleTitles: ['Practice Question 1'],
        questions: [],
      },
    ],
  };

  await seedSubject(withPractice);

  const [course] = await db.select().from(courses).where(eq(courses.slug, 'ged-demo-course'));
  const rows = await db
    .select({ title: modules.title, isPractice: modules.isPractice })
    .from(modules)
    .where(eq(modules.courseId, course!.id))
    .orderBy(modules.title);

  assert.deepEqual(rows, [
    { title: 'Final Quiz', isPractice: false },
    { title: 'Practice Question 1', isPractice: true },
  ]);
});

test('seedSubject re-seeding replaces topics wholesale rather than merging', async () => {
  const v1: ParsedSubject = {
    slug: 'ged-demo',
    title: 'GED Demo',
    courses: [
      {
        position: 1,
        slug: 'ged-demo-course',
        title: 'Demo Course',
        questionCount: 0,
        moduleTitles: ['Reading'],
        topics: [{ title: 'Old Topic', content: 'Old.' }],
        questions: [],
      },
    ],
  };
  const v2: ParsedSubject = {
    ...v1,
    courses: [{ ...v1.courses[0]!, topics: [{ title: 'New Topic', content: 'New.' }] }],
  };

  await seedSubject(v1);
  await seedSubject(v2);

  const rows = await db
    .select({ title: topics.title })
    .from(topics)
    .innerJoin(courses, eq(courses.id, topics.courseId))
    .where(eq(courses.slug, 'ged-demo-course'));

  assert.deepEqual(rows, [{ title: 'New Topic' }]);
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
