import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMasteringGedContent, assertExpectedStructure, type Block } from './mastering-ged-content.ts';

test('parses a heading followed by a paragraph', () => {
  const text = ["What you'll learn", '', 'Some intro paragraph.'].join('\n');
  const blocks = parseMasteringGedContent(text);
  assert.deepEqual(blocks, [
    { type: 'heading', text: "What you'll learn" },
    { type: 'paragraph', text: 'Some intro paragraph.' },
  ]);
});

test('merges wrapped bullet lines and consecutive bullets separated by blank lines into one block', () => {
  const text = [
    'Benefits of Taking the GED Online:',
    '',
    '   • No Travel Needed: Save time and money by taking the test from home.',
    '',
    '   • Flexible Scheduling: You can pick a date and time that works best',
    '   for you.',
    '',
    '   • Comfort of Home: Many people find testing in their home environment more relaxing.',
  ].join('\n');

  const blocks = parseMasteringGedContent(text);
  assert.deepEqual(blocks, [
    { type: 'subheading', text: 'Benefits of Taking the GED Online:' },
    {
      type: 'bullets',
      items: [
        'No Travel Needed: Save time and money by taking the test from home.',
        'Flexible Scheduling: You can pick a date and time that works best for you.',
        'Comfort of Home: Many people find testing in their home environment more relaxing.',
      ],
    },
  ]);
});

test('a heading with no blank line before the following paragraph is still its own block', () => {
  const text = [
    'USAHello’s GED Preparatory Course',
    'USAHello offers a free, self-paced online GED preparatory course designed to help you succeed on the GED',
    'exam.',
  ].join('\n');

  const blocks = parseMasteringGedContent(text);
  assert.deepEqual(blocks, [
    { type: 'heading', text: 'USAHello’s GED Preparatory Course' },
    {
      type: 'paragraph',
      text: 'USAHello offers a free, self-paced online GED preparatory course designed to help you succeed on the GED exam.',
    },
  ]);
});

test('drops page footers, Lesson headers, lesson-meta lines, Source lines, and the title line', () => {
  const text = [
    'Mastering the GED Test',
    'Lesson 1: Mastering the GED Test',
    '5 topics · 0 quizzes',
    'USAHello’s GED Preparatory Course',
    '',
    'Real content line.',
    '',
    '                                         Mastering the GED Test — Page 1',
    '',
    'Source: vecteezee.com',
  ].join('\n');

  const blocks = parseMasteringGedContent(text);
  assert.deepEqual(blocks, [
    { type: 'heading', text: 'USAHello’s GED Preparatory Course' },
    { type: 'paragraph', text: 'Real content line.' },
  ]);
});

test('a non-bullet, non-heading line closes an open bullets block', () => {
  const text = [
    'Important Notes:',
    '',
    '   • The Online GED Test is only available in the U.S. and U.S. territories.',
    '',
    'Consider these factors carefully to choose the option that best fits your needs.',
  ].join('\n');

  const blocks = parseMasteringGedContent(text);
  assert.deepEqual(blocks, [
    { type: 'subheading', text: 'Important Notes:' },
    {
      type: 'bullets',
      items: ['The Online GED Test is only available in the U.S. and U.S. territories.'],
    },
    {
      type: 'paragraph',
      text: 'Consider these factors carefully to choose the option that best fits your needs.',
    },
  ]);
});

test('assertExpectedStructure passes when every known heading and subheading is present', () => {
  const text = [
    "What you'll learn",
    'USAHello’s GED Preparatory Course',
    'GED Exam: From Signing Up to Receiving the Results',
    'Registering for the GED Test',
    'An Overview of the GED Subjects',
    'Taking the GED Test: Online or In-Person',
    'Taking the GED Test: Online vs. Testing Center',
    'Benefits of Taking the GED Online:',
    'Challenges of Taking the GED Online:',
    'Benefits of Taking the GED at a Testing Center:',
    'Challenges of Testing Centers:',
    'Online GED Requirements:',
    'Who Should Take the GED Online?',
    'Who Should Take the GED at a Testing Center?',
    'Online GED Testing Rules:',
    'Important Notes:',
    'Learn More:',
    'Using the TI Calculator on the GED Math Test',
    'On the day of the test',
    'Tips to Stay Focused and Organized on GED Test Day',
    'Test Skills',
    'Thinking Skills',
    'Math Skills',
    'Science Test Preparation',
    'Examples :',
    'Video resources',
    'Want to enable Spanish sub-titles?',
  ].join('\n\n');

  const blocks = parseMasteringGedContent(text);
  assert.doesNotThrow(() => assertExpectedStructure(blocks));
});

test('assertExpectedStructure throws when headings are missing', () => {
  const blocks: Block[] = [{ type: 'paragraph', text: 'nothing matched' }];
  assert.throws(() => assertExpectedStructure(blocks), /Expected 9 heading blocks, found 0/);
});
