# GED Content Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the four GED subject PDFs' lesson reading content and `quiz-bank.json`'s questions into the database, and show that reading content to learners before they take each lesson's quiz.

**Architecture:** A one-time CLI script (`import-ged-content.ts`) reads `quiz-bank.json` and the four subject PDFs, builds one `ParsedSubject` per subject (reusing the existing `seedSubject`/`ParsedSubject` seeding pipeline, extended with two new optional fields: `passScore` and `content`), and writes `<subject-slug>.quiz.json` files that the existing `npm run quiz:seed` picks up unchanged. A new `GET /api/v1/courses/:slug` endpoint and `CourseContentPage` show the lesson content before the quiz.

**Tech Stack:** TypeScript, Express, Drizzle ORM, PostgreSQL, React, React Router, Vitest (frontend), `node:test` (backend), `pdftotext` (poppler).

## Global Constraints

- Full design is in `docs/superpowers/specs/2026-11-18-ged-content-import-design.md` — this plan implements it exactly; consult it for the "why" behind any step.
- `mastering-the-ged-test.pdf` and each subject's trailing quiz-less "Congratulations" lesson are out of scope — they have no quiz-bank questions and don't fit the course-equals-one-quiz model.
- Only quiz-bank entries where `typeof correctIndex === 'number'` are imported (653 of 676) — the rest are fill-in-the-blank or check-all-that-apply questions the schema can't represent.
- `courses.passScore` for GED lessons is `Math.ceil(questionCount * 0.8)`, not the column's default of 9.
- No markdown anywhere in this feature — `content` is plain paragraphs joined by `\n\n`.
- The generic admin "Import quiz content" PDF-upload feature (`quiz-parser.ts` and everything built on it) is not touched by this work.

---

## Task 1: Add `courses.content` column

**Files:**
- Modify: `backend/src/models/schema.ts`

**Interfaces:**
- Produces: `courses.content` — nullable `text` column, available to every later task via the Drizzle `courses` table object.

- [ ] **Step 1: Add the column to the schema**

In `backend/src/models/schema.ts`, find the `courses` table definition:

```ts
export const courses = pgTable(
  'courses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    /** Globally unique: "<subject>-<course-title>". */
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    passScore: integer('pass_score').notNull().default(9),
    questionCount: integer('question_count').notNull().default(10),
```

Add a `content` column right after `questionCount`:

```ts
    questionCount: integer('question_count').notNull().default(10),
    /** Lesson reading text shown before the quiz, as plain `\n\n`-separated
     *  paragraphs. Null means there is no reading material for this course. */
    content: text('content'),
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate -w backend`
Expected: a new file appears under `backend/drizzle/`, e.g. `0003_<name>.sql`, containing `ALTER TABLE "courses" ADD COLUMN "content" text;`.

- [ ] **Step 3: Apply it to the test database**

Run: `npm run db:push:test -w backend`
Expected: exits 0, reports the `content` column added (or schema already in sync).

- [ ] **Step 4: Apply it to the local dev database**

Run: `cd backend && npm run db:migrate`
Expected: exits 0, applies the new migration.

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/schema.ts backend/drizzle/
git commit -m "Add content column to courses"
```

---

## Task 2: Extend `ParsedCourse` with optional `passScore` and `content`

**Files:**
- Modify: `backend/src/lib/quiz-parser.ts`

**Interfaces:**
- Produces: `ParsedCourse.passScore?: number`, `ParsedCourse.content?: string` — read by `seedSubject` (Task 3) and written by `buildGedSubject` (Task 5).

- [ ] **Step 1: Widen the type**

In `backend/src/lib/quiz-parser.ts`, find:

```ts
export type ParsedCourse = {
  position: number;
  slug: string;
  title: string;
  moduleTitles: string[];
  questionCount: number;
  questions: ParsedQuestion[];
};
```

Replace with:

```ts
export type ParsedCourse = {
  position: number;
  slug: string;
  title: string;
  moduleTitles: string[];
  questionCount: number;
  questions: ParsedQuestion[];
  /** Defaults to the column default (9) in seedSubject when omitted. */
  passScore?: number;
  /** Lesson reading text, as plain `\n\n`-separated paragraphs. Omitted means
   *  no reading material. */
  content?: string;
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w backend`
Expected: exits 0 (both fields are optional, so every existing caller of `ParsedCourse` still compiles).

- [ ] **Step 3: Commit**

```bash
git add backend/src/lib/quiz-parser.ts
git commit -m "Add optional passScore and content to ParsedCourse"
```

---

## Task 3: Persist `passScore` and `content` in `seedSubject`

**Files:**
- Modify: `backend/src/scripts/seed-quizzes.ts`
- Modify: `backend/src/scripts/seed-quizzes.test.ts`

**Interfaces:**
- Consumes: `ParsedCourse.passScore`, `ParsedCourse.content` (Task 2).
- Produces: `courses.passScore` and `courses.content` are written on every `seedSubject` call, not just left at their defaults.

- [ ] **Step 1: Write the failing test**

Add to `backend/src/scripts/seed-quizzes.test.ts`, after the existing `'seedSubject is idempotent'` test:

```ts
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

test('seedSubject defaults passScore to 9 and content to null when omitted', async () => {
  await seedSubject(subject); // the chassis fixture, which sets neither field

  const [row] = await db
    .select({ passScore: courses.passScore, content: courses.content })
    .from(courses)
    .where(eq(courses.slug, 'chassis-tire-and-rim-essentials'));

  assert.equal(row?.passScore, 9);
  assert.equal(row?.content, null);
});
```

Add the `courses` import at the top of the file, next to the existing imports:

```ts
import { courses } from '../models/schema.ts';
```

(`db` and `eq` are already imported in this file.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w backend -- --test-name-pattern "writes passScore and content|defaults passScore"`
Expected: FAIL — both assert on `row?.passScore === 9` / `null` for the first test (since `seedSubject` doesn't write these columns yet, they keep the schema defaults, not the demo's `passScore: 1` / its content).

- [ ] **Step 3: Update `seedSubject` to write the new fields**

In `backend/src/scripts/seed-quizzes.ts`, find:

```ts
      const [courseRow] = await tx
        .insert(courses)
        .values({
          subjectId: subjectRow!.id,
          position: course.position,
          slug: course.slug,
          title: course.title,
          questionCount: course.questionCount,
        })
        .onConflictDoUpdate({
          target: courses.slug,
          set: {
            subjectId: subjectRow!.id,
            position: course.position,
            title: course.title,
            questionCount: course.questionCount,
          },
        })
        .returning({ id: courses.id });
```

Replace with:

```ts
      const [courseRow] = await tx
        .insert(courses)
        .values({
          subjectId: subjectRow!.id,
          position: course.position,
          slug: course.slug,
          title: course.title,
          questionCount: course.questionCount,
          passScore: course.passScore ?? 9,
          content: course.content ?? null,
        })
        .onConflictDoUpdate({
          target: courses.slug,
          set: {
            subjectId: subjectRow!.id,
            position: course.position,
            title: course.title,
            questionCount: course.questionCount,
            passScore: course.passScore ?? 9,
            content: course.content ?? null,
          },
        })
        .returning({ id: courses.id });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w backend -- --test-name-pattern "writes passScore and content|defaults passScore"`
Expected: PASS

- [ ] **Step 5: Run the full seed-quizzes test file to check nothing else broke**

Run: `npm test -w backend -- src/scripts/seed-quizzes.test.ts`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/scripts/seed-quizzes.ts backend/src/scripts/seed-quizzes.test.ts
git commit -m "Persist passScore and content when seeding a subject"
```

---

## Task 4: `lib/ged-content.ts` — PDF lesson-content extraction

**Files:**
- Create: `backend/src/lib/ged-content.ts`
- Create: `backend/src/lib/ged-content.test.ts`

**Interfaces:**
- Produces: `splitLessons(pdfText: string): Map<string, string>`, `stripQuizBlocks(lessonText: string, quizTitles: string[]): string`, `toParagraphs(text: string): string`, `extractLessonContent(pdfText: string, quizTitlesByLesson: Map<string, string[]>): Map<string, string>`, `assertNoLeakedQuestions(content: Map<string, string>, promptsByLesson: Map<string, string[]>): void`. Consumed by Task 6 (`import-ged-content.ts`).

- [ ] **Step 1: Write the failing tests**

Create `backend/src/lib/ged-content.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w backend -- src/lib/ged-content.test.ts`
Expected: FAIL with "Cannot find module './ged-content.ts'" (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `backend/src/lib/ged-content.ts`:

```ts
/**
 * One lesson's raw PDF text slice, keyed by its full "Lesson N: Title"
 * heading. pdftotext sometimes glues a form-feed page-break marker onto the
 * start of the very next line, which can hide a "Lesson N:" heading from a
 * line-anchored match (observed as "...— Page 102\n\fLesson 14: ..."), so
 * every form feed is turned into a newline first.
 */
export function splitLessons(pdfText: string): Map<string, string> {
  const text = pdfText.replace(/\f/g, '\n');
  const headerRe = /^Lesson \d+:.*$/gm;
  const matches = [...text.matchAll(headerRe)];

  const lessons = new Map<string, string>();
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const title = match[0].trim();
    const start = match.index! + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : text.length;
    lessons.set(title, text.slice(start, end));
  }
  return lessons;
}

/**
 * Lines that only ever appear inside an inline quiz dump, across the two
 * dump styles seen in these PDFs: math's clean "Q1. / a) ... (correct) /
 * Explanation:" style, and language-arts' noisy quiz-widget chrome dump.
 * Mirrors the FURNITURE allowlist approach in quiz-parser.ts.
 */
const FOOTER_RE = /—\s*Page\s*\d+\s*$/;

function isQuizNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (FOOTER_RE.test(t)) return true; // a page break can land mid-quiz-block
  if (/^Q\d+\./.test(t)) return true;
  if (/^Practice Question \d+/.test(t)) return true;
  if (/^[a-fA-F]\)/.test(t)) return true; // option letters go up to f) on some entries
  if (/\(correct\)/i.test(t)) return true;
  if (/^Explanation:?/i.test(t)) return true;

  const chromePhrases = [
    'Quiz Summary',
    'Questions completed',
    'Quiz is loading',
    'sign in or sign up',
    'Time limit:',
    'Correct Incorrect',
    'Earned Point',
    'Essay(s) Pending',
    'Categories Not categorized',
    'Show Question',
    'Review Answered',
    'Back to topic',
    'already completed the quiz',
  ];
  return chromePhrases.some((phrase) => t.includes(phrase));
}

/**
 * Removes the inline quiz Q&A dumps from a lesson's raw text. Each dump
 * starts at one of the lesson's own quizTitle headings — verified to appear
 * verbatim as their own line in every one of these PDFs — and everything
 * from there is treated as quiz noise until a line that doesn't look like
 * quiz noise resumes, which is kept as real lesson content.
 */
export function stripQuizBlocks(lessonText: string, quizTitles: string[]): string {
  if (quizTitles.length === 0) return lessonText;

  const lines = lessonText.split('\n');
  const isHeading = (line: string): boolean =>
    quizTitles.some((title) => line.trim() === title.trim());

  const kept: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isHeading(lines[i]!)) {
      kept.push(lines[i]!);
      i++;
      continue;
    }
    i++; // skip the heading itself
    while (i < lines.length && isQuizNoiseLine(lines[i]!)) i++;
  }
  return kept.join('\n');
}

const LESSON_META_RE = /^\s*\d+\s+topics?\s*·\s*\d+\s+quizzes?\s*$/i;
const CONTINUE_PROMPT_RE = /^Click [“"]Continue[”"].*$/i;

/** Joins wrapped lines into paragraphs and drops known page furniture. */
export function toParagraphs(text: string): string {
  const lines = text.split('\n').filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true; // blank lines mark paragraph breaks
    if (FOOTER_RE.test(trimmed)) return false;
    if (LESSON_META_RE.test(trimmed)) return false;
    if (CONTINUE_PROMPT_RE.test(trimmed)) return false;
    return true;
  });

  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current.length > 0) {
        paragraphs.push(current.join(' '));
        current = [];
      }
      continue;
    }
    current.push(trimmed);
  }
  if (current.length > 0) paragraphs.push(current.join(' '));

  return paragraphs.join('\n\n');
}

/**
 * Builds { lessonTitle -> cleaned content } for one subject's PDF text, given
 * each lesson's ordered, deduped quizTitle list (from quiz-bank.json).
 */
export function extractLessonContent(
  pdfText: string,
  quizTitlesByLesson: Map<string, string[]>,
): Map<string, string> {
  const rawLessons = splitLessons(pdfText);
  const content = new Map<string, string>();

  for (const [lessonTitle, quizTitles] of quizTitlesByLesson) {
    const raw = rawLessons.get(lessonTitle);
    if (raw === undefined) {
      throw new Error(`No "${lessonTitle}" heading found in the PDF text.`);
    }
    content.set(lessonTitle, toParagraphs(stripQuizBlocks(raw, quizTitles)));
  }

  return content;
}

/**
 * Throws if any lesson's extracted content still contains one of that
 * lesson's quiz question prompts verbatim (whitespace-normalized) — the
 * signal that a quiz block survived stripping and leaked into the reading
 * material.
 */
export function assertNoLeakedQuestions(
  content: Map<string, string>,
  promptsByLesson: Map<string, string[]>,
): void {
  const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

  for (const [lessonTitle, prompts] of promptsByLesson) {
    const normalizedContent = normalize(content.get(lessonTitle) ?? '');
    for (const prompt of prompts) {
      if (normalizedContent.includes(normalize(prompt))) {
        throw new Error(
          `"${lessonTitle}" content still contains the question ` +
            `"${prompt.slice(0, 60)}…" — a quiz block was not fully stripped.`,
        );
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w backend -- src/lib/ged-content.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/ged-content.ts backend/src/lib/ged-content.test.ts
git commit -m "Add GED lesson-content extraction from PDF text"
```

---

## Task 5: `lib/ged-quiz-bank.ts` — quiz-bank.json to `ParsedSubject`

**Files:**
- Create: `backend/src/lib/ged-quiz-bank.ts`
- Create: `backend/src/lib/ged-quiz-bank.test.ts`

**Interfaces:**
- Consumes: `slugify` from `./quiz-parser.ts`; `ParsedCourse`, `ParsedOption`, `ParsedQuestion`, `ParsedSubject` types from `./quiz-parser.ts` (Task 2).
- Produces: `GedBankEntry` type, `buildGedSubject(entries, subjectSlug, contentByLesson?): ParsedSubject`, `quizTitlesByLesson(entries, subjectSlug): Map<string, string[]>`, `promptsByLesson(entries, subjectSlug): Map<string, string[]>`. Consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/lib/ged-quiz-bank.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w backend -- src/lib/ged-quiz-bank.test.ts`
Expected: FAIL with "Cannot find module './ged-quiz-bank.ts'"

- [ ] **Step 3: Write the implementation**

Create `backend/src/lib/ged-quiz-bank.ts`:

```ts
import {
  slugify,
  type ParsedCourse,
  type ParsedOption,
  type ParsedQuestion,
  type ParsedSubject,
} from './quiz-parser.ts';

export type GedBankEntry = {
  course: string;
  courseTitle: string;
  quizTitle: string;
  lesson: string;
  questionNumber: number;
  question: string;
  options: string[];
  correctIndex: number | number[];
  explanation: string;
};

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E'] as const;
const LESSON_NUMBER_RE = /^Lesson (\d+):\s*(.+)$/;

/** Entries the schema can represent: a single correct option out of several. */
function isUsable(entry: GedBankEntry, subjectSlug: string): boolean {
  return entry.course === subjectSlug && typeof entry.correctIndex === 'number';
}

/**
 * Builds one subject's ParsedSubject from quiz-bank.json's flat entries plus
 * that subject's extracted lesson content (lessonTitle -> cleaned
 * paragraphs). Entries whose correctIndex is not a plain number are
 * excluded — see isUsable — because the schema only supports one correct
 * option per question.
 */
export function buildGedSubject(
  entries: GedBankEntry[],
  subjectSlug: string,
  contentByLesson: Map<string, string> = new Map(),
): ParsedSubject {
  const usable = entries.filter((e) => isUsable(e, subjectSlug));
  if (usable.length === 0) {
    throw new Error(`No usable quiz-bank entries found for subject "${subjectSlug}".`);
  }

  const subjectTitle = usable[0]!.courseTitle;

  const lessonOrder: string[] = [];
  const byLesson = new Map<string, GedBankEntry[]>();
  for (const entry of usable) {
    if (!byLesson.has(entry.lesson)) {
      byLesson.set(entry.lesson, []);
      lessonOrder.push(entry.lesson);
    }
    byLesson.get(entry.lesson)!.push(entry);
  }

  const courses: ParsedCourse[] = lessonOrder.map((lessonTitle) => {
    const lessonMatch = LESSON_NUMBER_RE.exec(lessonTitle);
    if (!lessonMatch) {
      throw new Error(`Lesson title "${lessonTitle}" has no leading "Lesson N:" number.`);
    }
    const position = Number(lessonMatch[1]);
    const title = lessonMatch[2]!.trim();

    const lessonEntries = byLesson.get(lessonTitle)!;

    const moduleTitles: string[] = [];
    for (const entry of lessonEntries) {
      if (!moduleTitles.includes(entry.quizTitle)) moduleTitles.push(entry.quizTitle);
    }

    const questions: ParsedQuestion[] = lessonEntries.map((entry, index) => {
      const correctIndex = entry.correctIndex as number;
      if (correctIndex < 0 || correctIndex >= entry.options.length) {
        throw new Error(
          `"${lessonTitle}" question ${entry.questionNumber} (${entry.quizTitle}): ` +
            `correctIndex ${correctIndex} is out of range for ${entry.options.length} options.`,
        );
      }
      if (entry.options.length > OPTION_LABELS.length) {
        throw new Error(
          `"${lessonTitle}" question ${entry.questionNumber} (${entry.quizTitle}): ` +
            `${entry.options.length} options exceeds the ${OPTION_LABELS.length} supported labels.`,
        );
      }

      const options: ParsedOption[] = entry.options.map((body, i) => ({
        label: OPTION_LABELS[i]!,
        body,
        isCorrect: i === correctIndex,
      }));

      return {
        position: index + 1,
        prompt: entry.question,
        moduleTitle: entry.quizTitle,
        explanation: entry.explanation,
        options,
      };
    });

    return {
      position,
      slug: `${subjectSlug}-${slugify(title)}`,
      title,
      moduleTitles,
      questionCount: questions.length,
      passScore: Math.ceil(questions.length * 0.8),
      questions,
      content: contentByLesson.get(lessonTitle),
    };
  });

  courses.sort((a, b) => a.position - b.position);

  return { slug: subjectSlug, title: subjectTitle, courses };
}

/** Each lesson's quiz titles in first-appearance order, deduped — the input `extractLessonContent` needs to find and strip each lesson's quiz blocks. */
export function quizTitlesByLesson(
  entries: GedBankEntry[],
  subjectSlug: string,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const entry of entries) {
    if (!isUsable(entry, subjectSlug)) continue;
    const list = out.get(entry.lesson) ?? [];
    if (!list.includes(entry.quizTitle)) list.push(entry.quizTitle);
    out.set(entry.lesson, list);
  }
  return out;
}

/** Each lesson's kept question prompts — the input assertNoLeakedQuestions checks for in extracted content. */
export function promptsByLesson(
  entries: GedBankEntry[],
  subjectSlug: string,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const entry of entries) {
    if (!isUsable(entry, subjectSlug)) continue;
    const list = out.get(entry.lesson) ?? [];
    list.push(entry.question);
    out.set(entry.lesson, list);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w backend -- src/lib/ged-quiz-bank.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/ged-quiz-bank.ts backend/src/lib/ged-quiz-bank.test.ts
git commit -m "Add quiz-bank.json to ParsedSubject mapping for GED content"
```

---

## Task 6: `scripts/import-ged-content.ts` and the real import run

**Files:**
- Create: `backend/src/scripts/import-ged-content.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `extractLessonContent`, `assertNoLeakedQuestions` (Task 4); `buildGedSubject`, `quizTitlesByLesson`, `promptsByLesson`, `GedBankEntry` (Task 5).
- Produces: `backend/src/data/ged-language-arts.quiz.json`, `ged-math.quiz.json`, `ged-science.quiz.json`, `ged-social-studies.quiz.json` — consumed by the existing `npm run quiz:seed` (`backend/src/scripts/seed-quizzes.ts`), unmodified.

- [ ] **Step 1: Write the script**

Create `backend/src/scripts/import-ged-content.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertNoLeakedQuestions, extractLessonContent } from '../lib/ged-content.ts';
import {
  buildGedSubject,
  promptsByLesson,
  quizTitlesByLesson,
  type GedBankEntry,
} from '../lib/ged-quiz-bank.ts';

const SUBJECTS = [
  { slug: 'ged-language-arts', pdf: 'ged-language-arts.pdf' },
  { slug: 'ged-math', pdf: 'ged-math.pdf' },
  { slug: 'ged-science', pdf: 'ged-science.pdf' },
  { slug: 'ged-social-studies', pdf: 'ged-social-studies.pdf' },
];

const dataDir = new URL('../data/', import.meta.url);
const entries: GedBankEntry[] = JSON.parse(readFileSync(new URL('quiz-bank.json', dataDir), 'utf8'));

for (const { slug, pdf } of SUBJECTS) {
  const pdfPath = fileURLToPath(new URL(pdf, dataDir));
  const pdfText = execFileSync('pdftotext', ['-layout', pdfPath, '-'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  const quizTitles = quizTitlesByLesson(entries, slug);
  const content = extractLessonContent(pdfText, quizTitles);
  assertNoLeakedQuestions(content, promptsByLesson(entries, slug));

  const subject = buildGedSubject(entries, slug, content);

  const outFile = new URL(`${slug}.quiz.json`, dataDir);
  writeFileSync(outFile, `${JSON.stringify(subject, null, 2)}\n`, 'utf8');

  const questionCount = subject.courses.reduce((n, c) => n + c.questions.length, 0);
  console.log(
    `${slug}: ${subject.courses.length} courses, ${questionCount} questions -> src/data/${slug}.quiz.json`,
  );
}
```

- [ ] **Step 2: Add the npm script**

In `backend/package.json`, add this line next to the existing `"quiz:parse"` script:

```json
    "ged:import": "tsx src/scripts/import-ged-content.ts",
```

- [ ] **Step 3: Run it for real**

Run: `npm run ged:import -w backend`

Expected output (exact counts, derived from `quiz-bank.json` as it exists today):

```
ged-language-arts: 16 courses, 127 questions -> src/data/ged-language-arts.quiz.json
ged-math: 21 courses, 212 questions -> src/data/ged-math.quiz.json
ged-science: 19 courses, 173 questions -> src/data/ged-science.quiz.json
ged-social-studies: 19 courses, 141 questions -> src/data/ged-social-studies.quiz.json
```

If `assertNoLeakedQuestions` throws instead, it names the lesson and the specific question prompt that leaked — go back to `stripQuizBlocks` in `backend/src/lib/ged-content.ts` and extend `isQuizNoiseLine` to cover whatever chrome line let it through, then re-run.

- [ ] **Step 4: Spot-check two or three lessons by eye**

Open `backend/src/data/ged-language-arts.quiz.json` (the messiest source format) and read a couple of `content` fields end to end against the matching pages of `ged-language-arts.pdf`. Confirm: no question prompts, options, or "Correct Incorrect Skip"-style widget chrome appear; paragraph breaks land in sensible places. Repeat for `ged-math.quiz.json`'s "Lesson 16: Cubes, Cube Roots, and Volume" specifically — it has a math-notation-heavy question (`{$\sqrt[3]{216}-\sqrt{64}$}`) that the leak-check's plain-text matching is weakest at catching, so it's worth a direct look rather than trusting the automated check alone.

- [ ] **Step 5: Seed the database**

Run: `npm run quiz:seed -w backend`

Expected: one line per subject reporting course/question counts matching Step 3's numbers, e.g. `Seeded ged-language-arts: 16 courses, 127 questions`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/scripts/import-ged-content.ts backend/package.json backend/src/data/*.quiz.json
git commit -m "Import GED lesson content and quizzes from source data"
```

---

## Task 7: `findCourseBySlug` in the catalog model

**Files:**
- Modify: `backend/src/models/catalog.model.ts`
- Create: `backend/src/models/catalog.model.test.ts`

**Interfaces:**
- Produces: `CourseDetail` type, `findCourseBySlug(slug: string): Promise<CourseDetail | null>`. Consumed by Task 8.

- [ ] **Step 1: Write the failing test**

Create `backend/src/models/catalog.model.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w backend -- src/models/catalog.model.test.ts`
Expected: FAIL with "findCourseBySlug is not a function" (or a TypeScript error that it doesn't exist).

- [ ] **Step 3: Implement `findCourseBySlug`**

In `backend/src/models/catalog.model.ts`, add after the `SearchResult`/`searchCatalog` section (end of file):

```ts
export type CourseDetail = {
  id: string;
  slug: string;
  title: string;
  position: number;
  passScore: number;
  questionCount: number;
  content: string | null;
  subjectSlug: string;
  subjectTitle: string;
};

/** The content page's data source. Mirrors listCoursesBySubject's isActive
 *  filter — a soft-deleted course must not be reachable here either. */
export async function findCourseBySlug(slug: string): Promise<CourseDetail | null> {
  const [row] = await db
    .select({
      id: courses.id,
      slug: courses.slug,
      title: courses.title,
      position: courses.position,
      passScore: courses.passScore,
      questionCount: courses.questionCount,
      content: courses.content,
      subjectSlug: subjects.slug,
      subjectTitle: subjects.title,
    })
    .from(courses)
    .innerJoin(subjects, eq(courses.subjectId, subjects.id))
    .where(and(eq(courses.slug, slug), eq(courses.isActive, true)))
    .limit(1);

  return row ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w backend -- src/models/catalog.model.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/catalog.model.ts backend/src/models/catalog.model.test.ts
git commit -m "Add findCourseBySlug for the course content page"
```

---

## Task 8: `GET /api/v1/courses/:slug` endpoint

**Files:**
- Modify: `backend/src/controllers/catalog.controller.ts`
- Modify: `backend/src/routes/catalog.routes.ts`
- Modify: `backend/src/controllers/catalog.controller.test.ts`

**Interfaces:**
- Consumes: `findCourseBySlug` (Task 7).
- Produces: `GET /api/v1/courses/:slug` → `{ course: CourseDetail }` on success, `404 { error: 'Course not found' }` otherwise. Consumed by the frontend in Task 9.

- [ ] **Step 1: Write the failing test**

Add to `backend/src/controllers/catalog.controller.test.ts`, after the `'GET /api/v1/courses 404s for an unknown subject'` test:

```ts
test('GET /api/v1/courses/:slug returns one course with its content', async () => {
  const res = await fetch(`${baseUrl}/api/v1/courses/chassis-tire-and-rim-essentials`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { course: Record<string, unknown> };
  assert.equal(body.course.slug, 'chassis-tire-and-rim-essentials');
  assert.equal(body.course.title, 'Tire and Rim Essentials');
  assert.equal(body.course.content, null);
  assert.equal(body.course.subjectSlug, 'chassis');
});

test('GET /api/v1/courses/:slug 404s for an unknown course', async () => {
  const res = await fetch(`${baseUrl}/api/v1/courses/does-not-exist`);
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w backend -- src/controllers/catalog.controller.test.ts`
Expected: FAIL — `GET /api/v1/courses/chassis-tire-and-rim-essentials` 404s (no route registered yet).

- [ ] **Step 3: Add the controller**

In `backend/src/controllers/catalog.controller.ts`, add the import and handler:

```ts
import {
  findCourseBySlug,
  findSubjectBySlug,
  listCoursesBySubject,
  listSubjects,
  searchCatalog,
} from '../models/catalog.model.ts';
```

```ts
export async function getCourseBySlug(req: Request, res: Response): Promise<void> {
  const course = await findCourseBySlug(req.params.slug!);
  if (!course) {
    res.status(404).json({ error: 'Course not found' });
    return;
  }
  res.json({ course });
}
```

- [ ] **Step 4: Register the route**

In `backend/src/routes/catalog.routes.ts`, add:

```ts
catalogRouter.get('/courses/:slug', catalog.getCourseBySlug);
```

right after the existing `catalogRouter.get('/courses', catalog.getCourses);` line.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w backend -- src/controllers/catalog.controller.test.ts`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/catalog.controller.ts backend/src/routes/catalog.routes.ts backend/src/controllers/catalog.controller.test.ts
git commit -m "Add GET /api/v1/courses/:slug endpoint"
```

---

## Task 9: Frontend API client — `getCourse`

**Files:**
- Modify: `frontend/src/quiz/api.ts`

**Interfaces:**
- Produces: `CourseDetail` type, `quizApi.getCourse(slug: string): Promise<{ course: CourseDetail }>`. Consumed by Task 10.

- [ ] **Step 1: Add the type and method**

In `frontend/src/quiz/api.ts`, add after the `SearchCourseResult` type:

```ts
export type CourseDetail = {
  id: string;
  slug: string;
  title: string;
  position: number;
  passScore: number;
  questionCount: number;
  content: string | null;
  subjectSlug: string;
  subjectTitle: string;
};
```

In the `quizApi` object, add after `listCourses`:

```ts
  getCourse: (slug: string) => request<{ course: CourseDetail }>(`/courses/${slug}`),
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w frontend`
Expected: exits 0

- [ ] **Step 3: Commit**

```bash
git add frontend/src/quiz/api.ts
git commit -m "Add getCourse to the quiz API client"
```

---

## Task 10: `CourseContentPage`

**Files:**
- Create: `frontend/src/pages/CourseContentPage.tsx`
- Create: `frontend/src/pages/CourseContentPage.test.tsx`
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/App.css`

**Interfaces:**
- Consumes: `quizApi.getCourse`, `CourseDetail` (Task 9).
- Produces: route `/courses/:slug` → `CourseContentPage`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/CourseContentPage.test.tsx`:

```tsx
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { CourseDetail } from '../quiz/api';
import { CourseContentPage } from './CourseContentPage';

const getCourse = vi.fn();

vi.mock('../quiz/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../quiz/api')>();
  return {
    ...actual,
    quizApi: { ...actual.quizApi, getCourse: (s: string) => getCourse(s) },
  };
});

function makeCourseDetail(overrides: Partial<CourseDetail> = {}): CourseDetail {
  return {
    id: 'course-1',
    slug: 'ged-language-arts-vocabulary-questions',
    title: 'Vocabulary Questions',
    position: 1,
    passScore: 5,
    questionCount: 6,
    content: 'First paragraph.\n\nSecond paragraph.',
    subjectSlug: 'ged-language-arts',
    subjectTitle: 'GED Language Arts',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/courses/ged-language-arts-vocabulary-questions']}>
      <Routes>
        <Route path="/courses/:slug" element={<CourseContentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getCourse.mockReset();
  getCourse.mockResolvedValue({ course: makeCourseDetail() });
});

describe('CourseContentPage', () => {
  test('shows the lesson title and content paragraphs', async () => {
    renderPage();
    expect(await screen.findByText('Vocabulary Questions')).toBeInTheDocument();
    expect(await screen.findByText('First paragraph.')).toBeInTheDocument();
    expect(await screen.findByText('Second paragraph.')).toBeInTheDocument();
  });

  test('links to the quiz', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'Take the quiz' });
    expect(link).toHaveAttribute('href', '/courses/ged-language-arts-vocabulary-questions/quiz');
  });

  test('shows just the quiz link when there is no content', async () => {
    getCourse.mockResolvedValue({ course: makeCourseDetail({ content: null }) });
    renderPage();
    const link = await screen.findByRole('link', { name: 'Take the quiz' });
    expect(link).toBeInTheDocument();
  });

  test('shows an error message when the fetch fails', async () => {
    getCourse.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w frontend -- src/pages/CourseContentPage.test.tsx`
Expected: FAIL with "Cannot find module './CourseContentPage'"

- [ ] **Step 3: Write the component**

Create `frontend/src/pages/CourseContentPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { quizApi, type CourseDetail } from '../quiz/api';

type State =
  | { kind: 'ready'; slug: string; course: CourseDetail }
  | { kind: 'error'; slug: string; message: string };

export function CourseContentPage() {
  const { slug = '' } = useParams();
  const [state, setState] = useState<State | null>(null);

  // Keyed on slug so switching courses shows loading without an explicit reset.
  const current = state?.slug === slug ? state : null;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { course } = await quizApi.getCourse(slug);
        if (!cancelled) setState({ kind: 'ready', slug, course });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: 'error',
            slug,
            message: err instanceof Error ? err.message : 'Could not load this course',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (current === null) return <div className="auth-loading">Loading…</div>;
  if (current.kind === 'error') {
    return (
      <p role="alert" className="auth-error">
        {current.message}
      </p>
    );
  }

  const { course } = current;
  const paragraphs = course.content ? course.content.split('\n\n') : [];

  return (
    <div className="course-content">
      <span className="course-position">Quiz {course.position}</span>
      <h1>{course.title}</h1>

      {paragraphs.length > 0 && (
        <div className="course-content-body">
          {paragraphs.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>
      )}

      <Link to={`/courses/${course.slug}/quiz`} className="primary">
        Take the quiz
      </Link>
    </div>
  );
}
```

- [ ] **Step 4: Wire the route**

In `frontend/src/router.tsx`, add the import:

```ts
import { CourseContentPage } from './pages/CourseContentPage';
```

Add the route right before `<Route path="/courses/:slug/quiz" element={<QuizPage />} />`:

```tsx
          <Route path="/courses/:slug" element={<CourseContentPage />} />
```

- [ ] **Step 5: Add the CSS**

In `frontend/src/App.css`, add after the existing `.course-score`/`.course-passed` rules (end of the "Quiz feature" section):

```css
.course-content {
  max-width: 44rem;
  margin: 2.5rem auto;
  padding: 0 1.25rem;
  text-align: left;
}

.course-content-body {
  margin: 1.5rem 0 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.course-content-body p { margin: 0; line-height: 1.6; }

.course-content .primary {
  display: inline-block;
  padding: 0.55rem 1rem;
  border-radius: 0.5rem;
  border: 1px solid currentColor;
  text-decoration: none;
  color: inherit;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -w frontend -- src/pages/CourseContentPage.test.tsx`
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/CourseContentPage.tsx frontend/src/pages/CourseContentPage.test.tsx frontend/src/router.tsx frontend/src/App.css
git commit -m "Add the course content page"
```

---

## Task 11: Point the course list at the content page

**Files:**
- Modify: `frontend/src/pages/SubjectCoursesPage.tsx`
- Modify: `frontend/src/pages/SubjectCoursesPage.test.tsx`

**Interfaces:**
- Consumes: `/courses/:slug` route (Task 10).

- [ ] **Step 1: Update the existing test's expectation**

In `frontend/src/pages/SubjectCoursesPage.test.tsx`, find the `'keeps the quiz link available after a pass'` test's assertion:

```ts
    const link = await screen.findByRole('link', { name: 'Tire and Rim Essentials' });
    expect(link).toHaveAttribute(
      'href',
      '/courses/chassis-tire-and-rim-essentials/quiz',
    );
```

Change the expected href:

```ts
    const link = await screen.findByRole('link', { name: 'Tire and Rim Essentials' });
    expect(link).toHaveAttribute('href', '/courses/chassis-tire-and-rim-essentials');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w frontend -- src/pages/SubjectCoursesPage.test.tsx`
Expected: FAIL — the rendered link still points at `/courses/chassis-tire-and-rim-essentials/quiz`.

- [ ] **Step 3: Update the link**

In `frontend/src/pages/SubjectCoursesPage.tsx`, find:

```tsx
              <Link to={`/courses/${c.slug}/quiz`}>{c.title}</Link>
```

Change to:

```tsx
              <Link to={`/courses/${c.slug}`}>{c.title}</Link>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w frontend -- src/pages/SubjectCoursesPage.test.tsx`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SubjectCoursesPage.tsx frontend/src/pages/SubjectCoursesPage.test.tsx
git commit -m "Link the course list to the content page instead of straight to the quiz"
```

---

## Task 12: Full test suite and manual smoke check

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `npm test -w backend`
Expected: all tests PASS

- [ ] **Step 2: Run the full frontend test suite**

Run: `npm test -w frontend`
Expected: all tests PASS

- [ ] **Step 3: Typecheck both workspaces**

Run: `npm run typecheck -w backend && npm run typecheck -w frontend`
Expected: both exit 0

- [ ] **Step 4: Manual smoke check**

Start both dev servers (`npm run dev -w backend`, `npm run dev -w frontend`), sign in, and in the browser:
- Go to `/subjects/ged-language-arts`. Confirm it lists 16 lessons as "Quiz 1".."Quiz 16".
- Click "Lesson 1" (title shown without the "Lesson 1:" prefix, e.g. "Vocabulary Questions"). Confirm the content page shows reading paragraphs, not quiz questions or answers, and a "Take the quiz" button.
- Click "Take the quiz" and confirm the quiz still works exactly as before (question count and pass score reflect that lesson's actual question count, not a fixed 10/9).
- Go to a non-GED subject (e.g. `/subjects/chassis`, if present) and confirm its course page still shows just the "Take the quiz" button with no content section.

No commit for this task — it's verification of everything already committed in Tasks 1–11.
