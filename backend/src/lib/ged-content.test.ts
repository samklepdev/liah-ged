import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isQuizNoiseLine,
  salvageQuizWidgetQuestion,
  toParagraphs,
  stripVideoReferences,
  stripCaptionInstructions,
  assertNoLeakedQuestions,
} from './ged-content.ts';

test('isQuizNoiseLine recognizes the clean Q1./a)/Explanation: dump style', () => {
  assert.ok(isQuizNoiseLine('Q1. What is this?'));
  assert.ok(isQuizNoiseLine('b) two (correct)'));
  assert.ok(isQuizNoiseLine('Explanation: because.'));
  assert.ok(!isQuizNoiseLine('A useful tip.'));
});

test('isQuizNoiseLine recognizes the noisy widget-chrome dump style', () => {
  assert.ok(isQuizNoiseLine('Time limit: 0 Quiz Summary 0 of 1 Questions completed'));
  assert.ok(isQuizNoiseLine('You must sign in or sign up to start the quiz. Quiz is loading…'));
  assert.ok(!isQuizNoiseLine('Vocabulary review'));
});

test('salvageQuizWidgetQuestion pulls the real question out of the widget-chrome template', () => {
  const text =
    'Time limit: 0 Quiz Summary 0 of 1 Questions completed. Continue Show Question 1 Review Answered ' +
    'Correct Incorrect Question 1 / 1 Question 1 of 1 1 . Question Question 1 Read the passage. ' +
    'What does the word mean? a) One b) Two Correct Incorrect Skip';
  assert.equal(
    salvageQuizWidgetQuestion(text),
    'Read the passage. What does the word mean? a) One b) Two',
  );
});

test('salvageQuizWidgetQuestion returns null when the text does not match the widget template', () => {
  assert.equal(salvageQuizWidgetQuestion('Q1. What is this? a) one b) two (correct)'), null);
  assert.equal(salvageQuizWidgetQuestion('Just a plain sentence.'), null);
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

test('stripVideoReferences drops a standalone video lead-in paragraph', () => {
  const text = 'Real content here.\n\nVideo: Context Clues\n\nMore real content.';
  assert.equal(stripVideoReferences(text), 'Real content here.\n\nMore real content.');
});

test('stripVideoReferences drops the no-text-content placeholder', () => {
  const text = 'Real content here.\n\n(no text content — video or interactive topic)\n\nMore content.';
  assert.equal(stripVideoReferences(text), 'Real content here.\n\nMore content.');
});

test('stripVideoReferences unwraps a transcript label, keeping the transcript text', () => {
  const text = 'Video Transcript + Now, let’s take a look at a short story.';
  assert.equal(stripVideoReferences(text), 'Now, let’s take a look at a short story.');
});

test('stripVideoReferences leaves unrelated content alone', () => {
  const text = 'This paragraph never mentions a video at all.';
  assert.equal(stripVideoReferences(text), text);
});

test('stripCaptionInstructions drops a subtitle/CC instructions paragraph', () => {
  const text = [
    'Real content here.',
    '',
    'Click the "CC" (subtitles/closed captions) button at the bottom of the video. Then click on "Subtitles/CC". Then click on "Auto-translate".',
    '',
    'More real content.',
  ].join('\n');
  assert.equal(stripCaptionInstructions(text), 'Real content here.\n\nMore real content.');
});

test('stripCaptionInstructions leaves unrelated content alone', () => {
  const text = 'This paragraph never mentions subtitles at all.';
  assert.equal(stripCaptionInstructions(text), text);
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
