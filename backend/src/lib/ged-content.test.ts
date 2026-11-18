import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitLessons,
  stripQuizBlocks,
  toParagraphs,
  extractLessonContent,
  assertNoLeakedQuestions,
} from './ged-content.ts';

test('splitLessons slices text between consecutive Lesson headers', () => {
  const text = [
    'Lesson 1: Vocabulary',
    '1 topics · 1 quizzes',
    'Some lesson one content.',
    'Lesson 2: Grammar',
    'Some lesson two content.',
  ].join('\n');

  const lessons = splitLessons(text);
  assert.equal(lessons.size, 2);
  assert.match(lessons.get('Lesson 1: Vocabulary')!, /Some lesson one content\./);
  assert.doesNotMatch(lessons.get('Lesson 1: Vocabulary')!, /Lesson 2/);
  assert.match(lessons.get('Lesson 2: Grammar')!, /Some lesson two content\./);
});

test('splitLessons recovers a header hidden behind a glued form-feed', () => {
  const text = 'Lesson 1: Vocabulary\nIntro text.\n— Page 1\n\fLesson 2: Grammar\nMore text.';
  const lessons = splitLessons(text);
  assert.equal(lessons.size, 2);
  assert.ok(lessons.has('Lesson 2: Grammar'));
});

test('stripQuizBlocks preserves lesson content that follows a quiz block', () => {
  const text = [
    'Intro paragraph.',
    'Quiz on Video: Example',
    'Q1. What is this?',
    'a) one',
    'b) two (correct)',
    'Explanation: because.',
    'GED Exam Tip',
    'A useful tip.',
  ].join('\n');

  const stripped = stripQuizBlocks(text, ['Quiz on Video: Example']);
  assert.match(stripped, /Intro paragraph\./);
  assert.match(stripped, /A useful tip\./);
  assert.doesNotMatch(stripped, /What is this\?/);
});

test('stripQuizBlocks preserves content between two quiz headings', () => {
  const text = [
    'Intro paragraph.',
    'Quiz on Video: One',
    'Q1. drop one.',
    'GED Exam Tip',
    'A useful tip.',
    'Quiz on Video: Two',
    'Q1. drop two.',
  ].join('\n');

  const stripped = stripQuizBlocks(text, ['Quiz on Video: One', 'Quiz on Video: Two']);
  assert.match(stripped, /Intro paragraph\./);
  assert.match(stripped, /A useful tip\./);
  assert.doesNotMatch(stripped, /drop one/);
  assert.doesNotMatch(stripped, /drop two/);
});

test('stripQuizBlocks leaves nothing extra when the quiz is the last thing in the lesson', () => {
  const text = ['Keep this.', 'Quiz on Video: Example', 'Q1. drop this.'].join('\n');
  const stripped = stripQuizBlocks(text, ['Quiz on Video: Example']);
  assert.match(stripped, /Keep this\./);
  assert.doesNotMatch(stripped, /drop this/);
});

test('stripQuizBlocks keeps skipping a quiz block across a page-footer line', () => {
  const text = [
    'Intro paragraph.',
    'Quiz on Video: Example',
    'Q1. drop one.',
    'b) To the left (correct)',
    '',
    '                 GED® Math: Prepare for the exam — Page 4',
    'Explanation: drop two.',
    'GED Exam Tip',
    'A useful tip.',
  ].join('\n');

  const stripped = stripQuizBlocks(text, ['Quiz on Video: Example']);
  assert.match(stripped, /Intro paragraph\./);
  assert.match(stripped, /A useful tip\./);
  assert.doesNotMatch(stripped, /drop one/);
  assert.doesNotMatch(stripped, /drop two/);
});

test('stripQuizBlocks re-arms the skip for a second question interleaved with real content', () => {
  const text = [
    'Intro paragraph.',
    'Quiz on Video: Example',
    'Q1. drop one.',
    'a) one',
    'b) two (correct)',
    'Explanation: because.',
    '',
    'Explore further: Root Words',
    'Some real content about root words.',
    '',
    'Q2. drop two.',
    'a) three',
    'b) four (correct)',
    'Explanation: because again.',
    'GED Exam Tip',
    'A useful tip.',
  ].join('\n');

  const stripped = stripQuizBlocks(text, ['Quiz on Video: Example']);
  assert.match(stripped, /Intro paragraph\./);
  assert.match(stripped, /Some real content about root words\./);
  assert.match(stripped, /A useful tip\./);
  assert.doesNotMatch(stripped, /drop one/);
  assert.doesNotMatch(stripped, /drop two/);
});

test('stripQuizBlocks strips the widget-dump chrome used by the language-arts export', () => {
  const text = [
    'Intro paragraph.',
    'Quiz on Video: Example',
    'Time limit: 0 Quiz Summary 0 of 1 Questions completed Questions: Information Back to topic',
    'You must sign in or sign up to start the quiz. Quiz is loading…',
    'Question 1 of 1 1 . Question Question 1 Read the following passage. a) one b) two Correct Incorrect Skip',
    'Vocabulary review',
    'Passage — a definition.',
  ].join('\n');

  const stripped = stripQuizBlocks(text, ['Quiz on Video: Example']);
  assert.match(stripped, /Intro paragraph\./);
  assert.match(stripped, /Vocabulary review/);
  assert.doesNotMatch(stripped, /Quiz Summary/);
  assert.doesNotMatch(stripped, /Correct Incorrect Skip/);
});

test('toParagraphs joins wrapped lines and drops page footers', () => {
  const text = [
    'This sentence',
    'wraps across lines.',
    '',
    'GED® Math: Prepare for the exam — Page 4',
    '',
    'Second paragraph.',
  ].join('\n');

  assert.equal(toParagraphs(text), 'This sentence wraps across lines.\n\nSecond paragraph.');
});

test('extractLessonContent matches lessons by title and strips their quizzes', () => {
  const pdfText = [
    'Lesson 1: Vocabulary',
    'Intro text.',
    'Quiz on Video: Example',
    'Q1. What? a) one b) two (correct) Explanation: because.',
  ].join('\n');

  const content = extractLessonContent(
    pdfText,
    new Map([['Lesson 1: Vocabulary', ['Quiz on Video: Example']]]),
  );

  assert.equal(content.size, 1);
  assert.match(content.get('Lesson 1: Vocabulary')!, /Intro text\./);
  assert.doesNotMatch(content.get('Lesson 1: Vocabulary')!, /Q1\./);
});

test('extractLessonContent throws when a lesson has no matching PDF heading', () => {
  assert.throws(
    () => extractLessonContent('Lesson 1: Vocabulary\ntext', new Map([['Lesson 2: Missing', []]])),
    /No "Lesson 2: Missing" heading/,
  );
});

test('assertNoLeakedQuestions throws when a prompt and one of its options both survive', () => {
  const content = new Map([
    ['Lesson 1: Vocabulary', 'What is the meaning of idyllic? a) perfect b) terrible'],
  ]);
  const questions = new Map([
    ['Lesson 1: Vocabulary', [{ prompt: 'What is the meaning of idyllic?', options: ['perfect', 'terrible'] }]],
  ]);
  assert.throws(() => assertNoLeakedQuestions(content, questions), /still contains/);
});

test('assertNoLeakedQuestions passes when prompts are absent from the content', () => {
  const content = new Map([['Lesson 1: Vocabulary', 'Unrelated reading text.']]);
  const questions = new Map([
    ['Lesson 1: Vocabulary', [{ prompt: 'What is the meaning of idyllic?', options: ['perfect', 'terrible'] }]],
  ]);
  assert.doesNotThrow(() => assertNoLeakedQuestions(content, questions));
});

test('assertNoLeakedQuestions passes when the prompt alone restates a learning objective', () => {
  // A lesson's own "In this lesson... you will learn..." preview can
  // legitimately restate a quiz question verbatim, with none of that
  // question's options anywhere nearby.
  const content = new Map([
    ['Lesson 1: The Scientific Method', 'In this lesson you will learn what is a hypothesis?'],
  ]);
  const questions = new Map([
    [
      'Lesson 1: The Scientific Method',
      [{ prompt: 'What is a hypothesis?', options: ['An educated guess', 'A random guess'] }],
    ],
  ]);
  assert.doesNotThrow(() => assertNoLeakedQuestions(content, questions));
});
