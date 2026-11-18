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

test('assertNoLeakedQuestions throws when a prompt survives into the content', () => {
  const content = new Map([['Lesson 1: Vocabulary', 'What is the meaning of idyllic?']]);
  const prompts = new Map([['Lesson 1: Vocabulary', ['What is the meaning of idyllic?']]]);
  assert.throws(() => assertNoLeakedQuestions(content, prompts), /still contains/);
});

test('assertNoLeakedQuestions passes when prompts are absent from the content', () => {
  const content = new Map([['Lesson 1: Vocabulary', 'Unrelated reading text.']]);
  const prompts = new Map([['Lesson 1: Vocabulary', ['What is the meaning of idyllic?']]]);
  assert.doesNotThrow(() => assertNoLeakedQuestions(content, prompts));
});
