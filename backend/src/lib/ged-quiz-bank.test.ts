import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGedSubject, promptsByLesson, quizTitlesByLesson, type GedBankEntry } from './ged-quiz-bank.ts';

function entry(overrides: Partial<GedBankEntry> = {}): GedBankEntry {
  return {
    course: 'ged-demo',
    courseTitle: 'GED Demo',
    quizTitle: 'Quiz on Video: Example',
    lesson: 'Lesson 1: Vocabulary',
    questionNumber: 1,
    question: 'What is a word?',
    options: ['One', 'Two', 'Three', 'Four'],
    correctIndex: 1,
    explanation: 'Because.',
    ...overrides,
  };
}

test('buildGedSubject maps lesson/quizTitle/question onto course/module/question', () => {
  const entries: GedBankEntry[] = [
    entry({ questionNumber: 1, question: 'Q1?', correctIndex: 0 }),
    entry({ questionNumber: 2, question: 'Q2?', correctIndex: 2 }),
  ];

  const subject = buildGedSubject(entries, 'ged-demo');

  assert.equal(subject.slug, 'ged-demo');
  assert.equal(subject.title, 'GED Demo');
  assert.equal(subject.courses.length, 1);

  const course = subject.courses[0]!;
  assert.equal(course.position, 1);
  assert.equal(course.title, 'Vocabulary');
  assert.equal(course.slug, 'ged-demo-vocabulary');
  assert.deepEqual(course.moduleTitles, ['Quiz on Video: Example']);
  assert.equal(course.questionCount, 2);
  assert.equal(course.passScore, 2); // ceil(2 * 0.8) = 2
  assert.equal(course.content, undefined);

  assert.equal(course.questions[0]!.position, 1);
  assert.equal(course.questions[0]!.prompt, 'Q1?');
  assert.equal(course.questions[0]!.options[0]!.isCorrect, true);
  assert.equal(course.questions[1]!.position, 2);
  assert.equal(course.questions[1]!.options[2]!.isCorrect, true);
});

test('buildGedSubject excludes fill-in-the-blank and check-all-that-apply entries', () => {
  const entries: GedBankEntry[] = [
    entry({ questionNumber: 1, correctIndex: 1 }),
    entry({ questionNumber: 2, options: ['Fill in the blank 1 of 1'], correctIndex: [] as unknown as number }),
    entry({ questionNumber: 3, options: ['A', 'B', 'C'], correctIndex: [0, 2] as unknown as number }),
  ];

  const subject = buildGedSubject(entries, 'ged-demo');
  assert.equal(subject.courses[0]!.questionCount, 1);
});

test('buildGedSubject renumbers positions sequentially across quizzes within a lesson', () => {
  const entries: GedBankEntry[] = [
    entry({ quizTitle: 'Quiz A', questionNumber: 1 }),
    entry({ quizTitle: 'Quiz A', questionNumber: 2 }),
    entry({ quizTitle: 'Quiz B', questionNumber: 1 }), // would collide with Quiz A's #1
  ];

  const subject = buildGedSubject(entries, 'ged-demo');
  const positions = subject.courses[0]!.questions.map((q) => q.position);
  assert.deepEqual(positions, [1, 2, 3]);
  assert.deepEqual(subject.courses[0]!.moduleTitles, ['Quiz A', 'Quiz B']);
});

test('buildGedSubject attaches matching lesson content', () => {
  const entries: GedBankEntry[] = [entry()];
  const subject = buildGedSubject(
    entries,
    'ged-demo',
    new Map([['Lesson 1: Vocabulary', 'Some reading text.']]),
  );
  assert.equal(subject.courses[0]!.content, 'Some reading text.');
});

test('buildGedSubject throws for a lesson title with no leading number', () => {
  const entries: GedBankEntry[] = [entry({ lesson: 'Vocabulary (no number)' })];
  assert.throws(() => buildGedSubject(entries, 'ged-demo'), /no leading "Lesson N:" number/);
});

test('buildGedSubject throws when correctIndex is out of range', () => {
  const entries: GedBankEntry[] = [entry({ correctIndex: 9 })];
  assert.throws(() => buildGedSubject(entries, 'ged-demo'), /out of range/);
});

test('quizTitlesByLesson lists quiz titles in first-appearance order, deduped', () => {
  const entries: GedBankEntry[] = [
    entry({ quizTitle: 'Quiz A', questionNumber: 1 }),
    entry({ quizTitle: 'Quiz A', questionNumber: 2 }),
    entry({ quizTitle: 'Quiz B', questionNumber: 1 }),
  ];
  assert.deepEqual(quizTitlesByLesson(entries, 'ged-demo'), new Map([['Lesson 1: Vocabulary', ['Quiz A', 'Quiz B']]]));
});

test('promptsByLesson lists every kept question prompt for a lesson', () => {
  const entries: GedBankEntry[] = [
    entry({ question: 'Q1?', correctIndex: 0 }),
    entry({ question: 'Q2?', options: ['Fill in the blank 1 of 1'], correctIndex: [] as unknown as number }),
  ];
  assert.deepEqual(promptsByLesson(entries, 'ged-demo'), new Map([['Lesson 1: Vocabulary', ['Q1?']]]));
});
