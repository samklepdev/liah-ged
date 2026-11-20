import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLessonTopics } from './ged-html-content.ts';

function page(...paragraphs: string[]): string {
  return paragraphs.map((p) => `<p style="position:absolute">${p}</p>`).join('\n');
}

test('extractLessonTopics splits a lesson into one topic per bold+italic heading', () => {
  const html = page(
    '<b>Lesson 1: Vocabulary Questions</b>',
    '<i><b>2 topics · 1 quizzes</b></i>',
    '<i><b>In this lesson…</b></i>',
    'You will learn about vocabulary.',
    '<i><b>Words to know</b></i>',
    '<b>Passage</b>&#160;— a section of text.',
  );

  const lessons = extractLessonTopics(html);
  assert.equal(lessons.size, 1);
  const topics = lessons.get('Lesson 1: Vocabulary Questions')!;
  assert.deepEqual(topics.map((t) => t.title), ['In this lesson…', 'Words to know']);
  assert.equal(topics[0]!.content, 'You will learn about vocabulary.');
  assert.equal(topics[1]!.content, '**Passage** — a section of text.');
});

test('extractLessonTopics keeps two topics with the same heading title as separate entries', () => {
  const html = page(
    '<b>Lesson 1: Vocabulary Questions</b>',
    '<i><b>2 topics · 2 quizzes</b></i>',
    '<i><b>GED Exam Tip</b></i>',
    'First tip.',
    '<i><b>GED Exam Tip</b></i>',
    'Second tip.',
  );

  const lessons = extractLessonTopics(html);
  const topics = lessons.get('Lesson 1: Vocabulary Questions')!;
  assert.deepEqual(topics.map((t) => t.title), ['GED Exam Tip', 'GED Exam Tip']);
  assert.equal(topics[0]!.content, 'First tip.');
  assert.equal(topics[1]!.content, 'Second tip.');
});

test('extractLessonTopics strips quiz-widget noise from a topic, leaving null if nothing survives', () => {
  const html = page(
    '<b>Lesson 1: Vocabulary Questions</b>',
    '<i><b>1 topics · 1 quizzes</b></i>',
    '<i><b>Practice Question 1</b></i>',
    'Quiz question',
    'Time limit: 0 Quiz Summary 0 of 1 Questions completed. You must sign in or sign up to start the quiz.',
  );

  const lessons = extractLessonTopics(html);
  const [topic] = lessons.get('Lesson 1: Vocabulary Questions')!;
  assert.equal(topic!.title, 'Practice Question 1');
  assert.equal(topic!.content, null);
});

test('extractLessonTopics strips the clean Q1./option/Explanation quiz dump from a topic', () => {
  const html = page(
    '<b>Lesson 1: Vocabulary Questions</b>',
    '<i><b>1 topics · 1 quizzes</b></i>',
    '<i><b>Quiz on Video: Example</b></i>',
    '<b>Q1.</b>&#160;What is this?',
    'a) one',
    '<b>b) two</b>&#160;<b>(correct)</b>',
    '<i>Explanation:</i>&#160;Because.',
  );

  const lessons = extractLessonTopics(html);
  const [topic] = lessons.get('Lesson 1: Vocabulary Questions')!;
  assert.equal(topic!.content, null);
});

test('extractLessonTopics keeps "watch the video" prompts but still strips caption instructions', () => {
  const html = page(
    '<b>Lesson 1: Vocabulary Questions</b>',
    '<i><b>1 topics · 1 quizzes</b></i>',
    '<i><b>Video: Context Clues</b></i>',
    'Watch the video and then answer the practice questions.',
    'Real teaching content survives.',
    'Click the "CC" (subtitles/closed captions) button at the bottom of the video.',
  );

  const lessons = extractLessonTopics(html);
  const [topic] = lessons.get('Lesson 1: Vocabulary Questions')!;
  assert.equal(
    topic!.content,
    'Watch the video and then answer the practice questions.\n\nReal teaching content survives.',
  );
});

test('extractLessonTopics splits multiple lessons independently', () => {
  const html = page(
    '<b>Lesson 1: Vocabulary Questions</b>',
    '<i><b>1 topics · 0 quizzes</b></i>',
    '<i><b>In this lesson…</b></i>',
    'Lesson one content.',
    '<b>Lesson 2: Analyzing Text</b>',
    '<i><b>1 topics · 0 quizzes</b></i>',
    '<i><b>In this lesson…</b></i>',
    'Lesson two content.',
  );

  const lessons = extractLessonTopics(html);
  assert.equal(lessons.size, 2);
  assert.equal(lessons.get('Lesson 1: Vocabulary Questions')![0]!.content, 'Lesson one content.');
  assert.equal(lessons.get('Lesson 2: Analyzing Text')![0]!.content, 'Lesson two content.');
});

test('extractLessonTopics captures a video link as videoUrl and excludes it from content', () => {
  const html = page(
    '<b>Lesson 1: Vocabulary Questions</b>',
    '<i><b>1 topics · 1 quizzes</b></i>',
    '<i><b>Video: Sequence of Events</b></i>',
    '■&#160;<a href="https://www.youtube.com/watch?v=WTZh-xKpEEE"><b>Watch video</b>&#160;&#160;</a>https://www.youtube.com/watch?v=WTZh-xKpEEE',
    'Watch this video to learn more about the sequence of events.',
  );

  const lessons = extractLessonTopics(html);
  const [topic] = lessons.get('Lesson 1: Vocabulary Questions')!;
  assert.equal(topic!.videoUrl, 'https://www.youtube.com/watch?v=WTZh-xKpEEE');
  assert.equal(topic!.content, 'Watch this video to learn more about the sequence of events.');
});

test('extractLessonTopics attaches a trailing video link by position, not by heading title', () => {
  const html = page(
    '<b>Lesson 1: Civil Rights</b>',
    '<i><b>1 topics · 1 quizzes</b></i>',
    '<i><b>I Have A Dream</b></i>',
    '■&#160;<a href="https://www.youtube.com/watch?v=g3idXXAqK8w"><b>Watch video</b>&#160;&#160;</a>https://www.youtube.com/watch?v=g3idXXAqK8w',
  );

  const lessons = extractLessonTopics(html);
  const [topic] = lessons.get('Lesson 1: Civil Rights')!;
  assert.equal(topic!.title, 'I Have A Dream');
  assert.equal(topic!.videoUrl, 'https://www.youtube.com/watch?v=g3idXXAqK8w');
});

test('extractLessonTopics leaves videoUrl null for a topic with no video link', () => {
  const html = page(
    '<b>Lesson 1: Vocabulary Questions</b>',
    '<i><b>1 topics · 1 quizzes</b></i>',
    '<i><b>In this lesson…</b></i>',
    'You will learn about vocabulary.',
  );

  const lessons = extractLessonTopics(html);
  const [topic] = lessons.get('Lesson 1: Vocabulary Questions')!;
  assert.equal(topic!.videoUrl, null);
});
