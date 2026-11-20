import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetDb, closeDb } from '../test/helpers/db.ts';
import { seedSubject } from '../scripts/seed-quizzes.ts';
import { findCourseBySlug, findTopic } from './catalog.model.ts';
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

test('findCourseBySlug returns an empty topics list for a course with none', async () => {
  const course = await findCourseBySlug('chassis-tire-and-rim-essentials');
  assert.ok(course);
  assert.deepEqual(course!.topics, []);
});

test('findCourseBySlug returns each topic in reading order', async () => {
  const withTopics: ParsedSubject = {
    slug: 'ged-demo',
    title: 'GED Demo',
    courses: [
      {
        position: 1,
        slug: 'ged-demo-course',
        title: 'Demo Course',
        questionCount: 0,
        moduleTitles: [],
        topics: [
          { title: 'In this lesson…', content: 'Overview text.' },
          { title: 'Words to know', content: null },
        ],
        questions: [],
      },
    ],
  };
  await seedSubject(withTopics);

  const course = await findCourseBySlug('ged-demo-course');
  assert.ok(course);
  assert.deepEqual(course!.topics, [
    { position: 1, title: 'In this lesson…' },
    { position: 2, title: 'Words to know' },
  ]);
});

test('findTopic returns one topic with its course/subject context and the next topic', async () => {
  const withTopics: ParsedSubject = {
    slug: 'ged-demo',
    title: 'GED Demo',
    courses: [
      {
        position: 1,
        slug: 'ged-demo-course',
        title: 'Demo Course',
        questionCount: 0,
        moduleTitles: [],
        topics: [
          { title: 'In this lesson…', content: 'Overview text.' },
          { title: 'Words to know', content: null },
        ],
        questions: [],
      },
    ],
  };
  await seedSubject(withTopics);

  const topic = await findTopic('ged-demo-course', 1);
  assert.deepEqual(topic, {
    position: 1,
    title: 'In this lesson…',
    content: 'Overview text.',
    videoUrl: null,
    courseSlug: 'ged-demo-course',
    courseTitle: 'Demo Course',
    subjectSlug: 'ged-demo',
    next: { position: 2, title: 'Words to know' },
    practiceQuestions: null,
  });
});

test('findTopic returns the topic\'s video url when it has one', async () => {
  await seedSubject({
    slug: 'ged-demo',
    title: 'GED Demo',
    courses: [
      {
        position: 1,
        slug: 'ged-demo-course',
        title: 'Demo Course',
        questionCount: 0,
        moduleTitles: [],
        topics: [
          {
            title: 'Video: Example',
            content: null,
            videoUrl: 'https://www.youtube.com/watch?v=abc123',
          },
        ],
        questions: [],
      },
    ],
  });

  const topic = await findTopic('ged-demo-course', 1);
  assert.equal(topic?.videoUrl, 'https://www.youtube.com/watch?v=abc123');
});

test('findTopic returns next: null on the last topic', async () => {
  await seedSubject({
    slug: 'ged-demo',
    title: 'GED Demo',
    courses: [
      {
        position: 1,
        slug: 'ged-demo-course',
        title: 'Demo Course',
        questionCount: 0,
        moduleTitles: [],
        topics: [
          { title: 'In this lesson…', content: 'Overview text.' },
          { title: 'Words to know', content: null },
        ],
        questions: [],
      },
    ],
  });

  const topic = await findTopic('ged-demo-course', 2);
  assert.equal(topic?.next, null);
});

test('findTopic returns null for an unknown position', async () => {
  assert.equal(await findTopic('chassis-tire-and-rim-essentials', 99), null);
});

test('findTopic returns practice questions when the topic matches a module', async () => {
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
        topics: [{ title: 'Final Quiz', content: null }],
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

  const topic = await findTopic('ged-demo-course', 1);
  assert.ok(topic);
  assert.equal(topic!.practiceQuestions?.length, 1);
  const [question] = topic!.practiceQuestions!;
  assert.equal(question!.prompt, 'What is 1 + 1?');
  assert.equal(question!.explanation, 'Basic addition.');
  assert.deepEqual(
    question!.options.map((o) => [o.label, o.body, o.isCorrect]),
    [
      ['A', '1', false],
      ['B', '2', true],
    ],
  );
});

test('findCourseBySlug returns null for an unknown slug', async () => {
  assert.equal(await findCourseBySlug('does-not-exist'), null);
});

test('findCourseBySlug returns null for a soft-deleted course', async () => {
  const course = await findCourseBySlug('chassis-tire-and-rim-essentials');
  await deleteCourseById(course!.id);
  assert.equal(await findCourseBySlug('chassis-tire-and-rim-essentials'), null);
});
