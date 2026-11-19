# Topic Practice Quizzes + Vocabulary Lesson Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove four empty, unbacked topic stops from the GED Language Arts "Vocabulary Questions" lesson, and give any topic whose title matches a quiz module title a real body — that module's questions shown inline as ungraded practice.

**Architecture:** Add a nullable `topics.module_id` FK, set by the seed script whenever a topic's title exactly matches one of the course's module titles (reusing the `moduleTitle → moduleId` map the seed script already builds for questions). `findTopic` returns that module's questions (with `isCorrect` and `explanation`, since this is ungraded practice, not an exam) alongside the topic. The frontend renders them as a self-contained, no-submit practice block. Separately, hand-edit the generated `ged-language-arts.quiz.json` to delete the four content-less topics from the Vocabulary Questions course.

**Tech Stack:** Node/Express backend, Drizzle ORM + PostgreSQL (Neon in prod), React frontend (Vite, react-router, vitest), `node:test` for backend tests.

## Global Constraints

- No change to the end-of-course graded quiz, `attempts`, or certificate logic — spec Non-goals.
- No change to `ged-html-content.ts` / `extractLessonTopics` / `splitLessonIntoTopics` — the moduleId matching happens only in the seed script, from data that already exists.
- `topics.module_id` cascade deletes are safe only because `seedSubject` always deletes+reinserts a course's `modules` and `topics` together in one transaction (spec: Data model).
- Whenever `backend/src/models/schema.ts` changes, a migration must be generated and committed (`migration-drift.yml` CI check fails otherwise).

---

### Task 1: Add `topics.module_id` column + migration

**Files:**
- Modify: `backend/src/models/schema.ts` (the `topics` table, currently lines 128–141)
- Create: `backend/drizzle/0006_<auto>.sql` + matching `backend/drizzle/meta/_journal.json` / snapshot (generated, not hand-written)

**Interfaces:**
- Produces: `topics.moduleId: string | null`, exposed on the Drizzle `topics` table as `topics.moduleId`, FK → `modules.id`, `onDelete: 'cascade'`. Task 2 and Task 3 both read/write this column.

- [ ] **Step 1: Edit the schema**

In `backend/src/models/schema.ts`, replace the `topics` table definition:

```ts
export const topics = pgTable('topics', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  /** Reading order within the course. Titles are not unique — e.g. "GED Exam
   *  Tip" can legitimately appear more than once in one lesson — so position
   *  (not title) is this course's per-topic identity, including in its URL. */
  position: integer('position').notNull(),
  title: text('title').notNull(),
  /** Null means this heading had no body left after stripping video/quiz
   *  noise (e.g. a bare "Practice Question 2" widget placeholder). */
  content: text('content'),
  /** Set when this topic's title matches one of the course's module titles
   *  — the topic page then shows that module's questions inline as
   *  ungraded practice. Null for ordinary reading topics. */
  moduleId: uuid('module_id').references(() => modules.id, { onDelete: 'cascade' }),
});
```

(Only the new `moduleId` field is added; everything else in the table is unchanged.)

- [ ] **Step 2: Generate the migration**

Run from the repo root:

```bash
npm run db:generate
```

Expected: a new file `backend/drizzle/00XX_<random-name>.sql` containing exactly:

```sql
ALTER TABLE "topics" ADD COLUMN "module_id" uuid;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;
```

plus an updated `backend/drizzle/meta/_journal.json` and a new snapshot file under `backend/drizzle/meta/`. If the SQL differs from the above (e.g. different column order), use what drizzle-kit actually generated — the journal/snapshot pair must come from the tool, never hand-edited.

- [ ] **Step 3: Apply the migration to your local dev database**

```bash
cd backend && npm run db:migrate
```

Expected: output lists the new migration as applied, no errors.

- [ ] **Step 4: Push the same schema to the test database**

```bash
cd backend && npm run db:push:test
```

Expected: drizzle-kit reports the `topics` table's `module_id` column added, no errors. (The test database is schema-pushed directly rather than migrated — this matches how every other test run in this repo picks up schema changes.)

- [ ] **Step 5: Confirm nothing broke**

```bash
cd backend && npm test
```

Expected: all existing tests still pass (266 passing before this change).

- [ ] **Step 6: Commit**

```bash
git add backend/src/models/schema.ts backend/drizzle
git commit -m "feat: add nullable topics.module_id column"
```

---

### Task 2: Link practice-stop topics to their module at seed time

**Files:**
- Modify: `backend/src/scripts/seed-quizzes.ts:96-107` (the topics insert block)
- Test: `backend/src/scripts/seed-quizzes.test.ts`

**Interfaces:**
- Consumes: `topics.moduleId` column from Task 1; the existing `moduleIdByTitle: Map<string, string>` already built earlier in `seedSubject` (line 65: `const moduleIdByTitle = new Map(moduleRows.map((m) => [m.title, m.id]));`).
- Produces: every seeded topic whose `title` exactly matches a key in `moduleIdByTitle` gets that module's id written to `topics.moduleId`; every other topic gets `null`. Task 3's `findTopic` reads this column.

- [ ] **Step 1: Write the failing test**

Add to `backend/src/scripts/seed-quizzes.test.ts` (after the existing `'seedSubject inserts each course\'s topics in order, with their content'` test):

```ts
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
```

This needs `modules` imported alongside `courses, topics` at the top of the file — change:

```ts
import { courses, topics } from '../models/schema.ts';
```

to:

```ts
import { courses, modules, topics } from '../models/schema.ts';
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && npm test -- --test-name-pattern "links a topic to its module"
```

Expected: FAIL — `rows` comes back as `[{ title: 'Summary', moduleId: null }, { title: 'Final Quiz', moduleId: null }]` (the second `moduleId` is `null` instead of the module's id), because `seed-quizzes.ts` doesn't set it yet.

- [ ] **Step 3: Implement**

In `backend/src/scripts/seed-quizzes.ts`, replace the topics insert block (lines 96–107):

```ts
      // Replace topics wholesale too, same reasoning as modules above.
      await tx.delete(topics).where(eq(topics.courseId, courseId));
      if (course.topics && course.topics.length > 0) {
        await tx.insert(topics).values(
          course.topics.map((topic, index) => ({
            courseId,
            position: index + 1,
            title: topic.title,
            content: topic.content,
          })),
        );
      }
```

with:

```ts
      // Replace topics wholesale too, same reasoning as modules above. A
      // topic whose title matches one of this course's modules is a
      // practice-stop: the frontend shows that module's questions inline.
      await tx.delete(topics).where(eq(topics.courseId, courseId));
      if (course.topics && course.topics.length > 0) {
        await tx.insert(topics).values(
          course.topics.map((topic, index) => ({
            courseId,
            position: index + 1,
            title: topic.title,
            content: topic.content,
            moduleId: moduleIdByTitle.get(topic.title) ?? null,
          })),
        );
      }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && npm test -- --test-name-pattern "links a topic to its module"
```

Expected: PASS.

- [ ] **Step 5: Run the full suite**

```bash
cd backend && npm test
```

Expected: all tests pass, including the pre-existing topic tests (they don't select `moduleId` so they're unaffected by the new column).

- [ ] **Step 6: Commit**

```bash
git add backend/src/scripts/seed-quizzes.ts backend/src/scripts/seed-quizzes.test.ts
git commit -m "feat: link a topic to its module when titles match at seed time"
```

---

### Task 3: Return practice questions from `findTopic`

**Files:**
- Modify: `backend/src/models/catalog.model.ts:1-3` (imports), `:195-237` (`TopicDetail` type + `findTopic`)
- Test: `backend/src/models/catalog.model.test.ts`

**Interfaces:**
- Consumes: `topics.moduleId` (Task 1), `questions.moduleId`/`questions.courseId` (existing schema), `questionOptions` (existing schema).
- Produces: `TopicDetail.practiceQuestions: PracticeQuestion[] | null`, where
  ```ts
  type PracticeOption = { id: string; label: string; body: string; isCorrect: boolean };
  type PracticeQuestion = {
    id: string;
    position: number;
    prompt: string;
    explanation: string;
    options: PracticeOption[];
  };
  ```
  Task 4 (frontend) consumes this exact shape from the `GET /courses/:slug/topics/:position` response's `topic.practiceQuestions`.

- [ ] **Step 1: Write the failing tests**

In `backend/src/models/catalog.model.test.ts`, first update the two existing exact-shape assertions so they still hold once `practiceQuestions` is added. Change:

```ts
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
    courseSlug: 'ged-demo-course',
    courseTitle: 'Demo Course',
    subjectSlug: 'ged-demo',
    next: { position: 2, title: 'Words to know' },
  });
});
```

to:

```ts
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
    courseSlug: 'ged-demo-course',
    courseTitle: 'Demo Course',
    subjectSlug: 'ged-demo',
    next: { position: 2, title: 'Words to know' },
    practiceQuestions: null,
  });
});
```

(Only the added `practiceQuestions: null` line changes.) The other exact-shape test, `'findTopic returns next: null on the last topic'`, only asserts `topic?.next` and needs no change.

Then add a new test, after the `'findTopic returns null for an unknown position'` test:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend && npm test -- --test-name-pattern "findTopic"
```

Expected: the updated exact-shape test fails (`practiceQuestions` missing from the actual object), and the new test fails (`topic!.practiceQuestions` is `undefined`).

- [ ] **Step 3: Implement**

In `backend/src/models/catalog.model.ts`, change the import on line 3:

```ts
import { attempts, courses, subjects, topics } from './schema.ts';
```

to:

```ts
import { attempts, courses, questionOptions, questions, subjects, topics } from './schema.ts';
```

Replace the `TopicDetail` type and `findTopic` function (lines 195–237):

```ts
export type PracticeOption = { id: string; label: string; body: string; isCorrect: boolean };

export type PracticeQuestion = {
  id: string;
  position: number;
  prompt: string;
  explanation: string;
  options: PracticeOption[];
};

export type TopicDetail = {
  position: number;
  title: string;
  content: string | null;
  courseSlug: string;
  courseTitle: string;
  subjectSlug: string;
  /** The next topic in this course, for a "Next" link — null on the last
   *  topic, where the content page's own quiz link takes over instead. */
  next: { position: number; title: string } | null;
  /** This topic's module's questions, shown inline as ungraded practice —
   *  null for a topic whose title doesn't match any module. */
  practiceQuestions: PracticeQuestion[] | null;
};

/** One topic's own page — its reading plus enough of its course to render a
 *  breadcrumb and link back. Mirrors findCourseBySlug's isActive filter. */
export async function findTopic(courseSlug: string, position: number): Promise<TopicDetail | null> {
  const [row] = await db
    .select({
      position: topics.position,
      title: topics.title,
      content: topics.content,
      moduleId: topics.moduleId,
      courseId: courses.id,
      courseSlug: courses.slug,
      courseTitle: courses.title,
      subjectSlug: subjects.slug,
    })
    .from(topics)
    .innerJoin(courses, eq(courses.id, topics.courseId))
    .innerJoin(subjects, eq(courses.subjectId, subjects.id))
    .where(
      and(eq(courses.slug, courseSlug), eq(topics.position, position), eq(courses.isActive, true)),
    )
    .limit(1);

  if (!row) return null;

  const [next] = await db
    .select({ position: topics.position, title: topics.title })
    .from(topics)
    .innerJoin(courses, eq(courses.id, topics.courseId))
    .where(and(eq(courses.slug, courseSlug), eq(topics.position, position + 1)))
    .limit(1);

  const { moduleId, courseId, ...rest } = row;

  return {
    ...rest,
    next: next ?? null,
    practiceQuestions: moduleId ? await findPracticeQuestions(courseId, moduleId) : null,
  };
}

/** A topic's practice questions — same join shape as findQuizByCourseSlug in
 *  quiz.model.ts, but including isCorrect: this is ungraded practice, not an
 *  exam in progress, so there's nothing to hide. */
async function findPracticeQuestions(courseId: string, moduleId: string): Promise<PracticeQuestion[]> {
  const rows = await db
    .select({
      questionId: questions.id,
      position: questions.position,
      prompt: questions.prompt,
      explanation: questions.explanation,
      optionId: questionOptions.id,
      label: questionOptions.label,
      body: questionOptions.body,
      isCorrect: questionOptions.isCorrect,
    })
    .from(questions)
    .innerJoin(questionOptions, eq(questionOptions.questionId, questions.id))
    .where(and(eq(questions.courseId, courseId), eq(questions.moduleId, moduleId)))
    .orderBy(asc(questions.position), asc(questionOptions.label));

  const byQuestion = new Map<string, PracticeQuestion>();
  for (const r of rows) {
    let q = byQuestion.get(r.questionId);
    if (!q) {
      q = { id: r.questionId, position: r.position, prompt: r.prompt, explanation: r.explanation, options: [] };
      byQuestion.set(r.questionId, q);
    }
    q.options.push({ id: r.optionId, label: r.label, body: r.body, isCorrect: r.isCorrect });
  }
  return [...byQuestion.values()];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd backend && npm test -- --test-name-pattern "findTopic"
```

Expected: PASS.

- [ ] **Step 5: Run the full suite**

```bash
cd backend && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/models/catalog.model.ts backend/src/models/catalog.model.test.ts
git commit -m "feat: return practice questions from findTopic for quiz-matched topics"
```

---

### Task 4: Render practice questions on the topic page

**Files:**
- Modify: `frontend/src/quiz/api.ts:39-47` (`TopicDetail` type)
- Create: `frontend/src/quiz/PracticeQuiz.tsx`
- Create: `frontend/src/quiz/PracticeQuiz.test.tsx`
- Modify: `frontend/src/pages/TopicPage.tsx:53-66`
- Modify: `frontend/src/pages/TopicPage.test.tsx:17-28` (`makeTopicDetail` fixture)
- Modify: `frontend/src/App.css` (append new rules near `.option` / `.result-explanation`, around line 420)

**Interfaces:**
- Consumes: `TopicDetail.practiceQuestions` from Task 3's API response.
- Produces: `PracticeQuiz({ questions: PracticeQuestion[] })` component, rendered by `TopicPage`.

- [ ] **Step 1: Add the type**

In `frontend/src/quiz/api.ts`, add after the `QuizOption`/`QuizQuestion` types (after line 57) and before `Quiz` — actually simplest is to add right next to `TopicDetail`. Replace:

```ts
export type TopicDetail = {
  position: number;
  title: string;
  content: string | null;
  courseSlug: string;
  courseTitle: string;
  subjectSlug: string;
  next: { position: number; title: string } | null;
};
```

with:

```ts
export type PracticeOption = { id: string; label: string; body: string; isCorrect: boolean };

export type PracticeQuestion = {
  id: string;
  position: number;
  prompt: string;
  explanation: string;
  options: PracticeOption[];
};

export type TopicDetail = {
  position: number;
  title: string;
  content: string | null;
  courseSlug: string;
  courseTitle: string;
  subjectSlug: string;
  next: { position: number; title: string } | null;
  practiceQuestions: PracticeQuestion[] | null;
};
```

- [ ] **Step 2: Write the failing component test**

Create `frontend/src/quiz/PracticeQuiz.test.tsx`:

```tsx
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PracticeQuestion } from './api';
import { PracticeQuiz } from './PracticeQuiz';

const questions: PracticeQuestion[] = [
  {
    id: 'q1',
    position: 1,
    prompt: 'What is 1 + 1?',
    explanation: 'Basic addition.',
    options: [
      { id: 'q1-a', label: 'A', body: '1', isCorrect: false },
      { id: 'q1-b', label: 'B', body: '2', isCorrect: true },
    ],
  },
  {
    id: 'q2',
    position: 2,
    prompt: 'What is 2 + 2?',
    explanation: 'Also basic addition.',
    options: [
      { id: 'q2-a', label: 'A', body: '4', isCorrect: true },
      { id: 'q2-b', label: 'B', body: '5', isCorrect: false },
    ],
  },
];

describe('PracticeQuiz', () => {
  test('shows every question and option up front', () => {
    render(<PracticeQuiz questions={questions} />);
    expect(screen.getByText('What is 1 + 1?')).toBeInTheDocument();
    expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument();
  });

  test('choosing the correct option reveals it as correct, with the explanation', async () => {
    render(<PracticeQuiz questions={questions} />);
    await userEvent.click(screen.getByText('2'));
    expect(screen.getByText('Basic addition.')).toBeInTheDocument();
    expect(screen.getByText('2').closest('label')).toHaveClass('correct');
  });

  test('choosing the wrong option reveals it as incorrect and shows which was right', async () => {
    render(<PracticeQuiz questions={questions} />);
    await userEvent.click(screen.getByText('1'));
    expect(screen.getByText('1').closest('label')).toHaveClass('incorrect');
    expect(screen.getByText('2').closest('label')).toHaveClass('correct');
  });

  test('answering one question does not affect another on the same page', async () => {
    render(<PracticeQuiz questions={questions} />);
    await userEvent.click(screen.getByText('1')); // wrong answer to question 1
    expect(screen.queryByText('Also basic addition.')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd frontend && npx vitest run src/quiz/PracticeQuiz.test.tsx
```

Expected: FAIL — `Cannot find module './PracticeQuiz'` (file doesn't exist yet).

- [ ] **Step 4: Implement the component**

Create `frontend/src/quiz/PracticeQuiz.tsx`:

```tsx
import { useState } from 'react';
import type { PracticeQuestion } from './api';

function PracticeQuestionCard({ question }: { question: PracticeQuestion }) {
  const [answeredOptionId, setAnsweredOptionId] = useState<string | null>(null);

  return (
    <div className="question-card practice-question">
      <p className="question-prompt">{question.prompt}</p>
      <ul className="option-list">
        {question.options.map((o) => {
          const answered = answeredOptionId !== null;
          const className = [
            'option',
            answered && o.id === answeredOptionId && o.isCorrect && 'correct',
            answered && o.id === answeredOptionId && !o.isCorrect && 'incorrect',
            answered && o.id !== answeredOptionId && o.isCorrect && 'correct',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <li key={o.id}>
              <label className={className}>
                <input
                  type="radio"
                  name={`practice-${question.id}`}
                  value={o.id}
                  checked={o.id === answeredOptionId}
                  disabled={answered}
                  onChange={() => setAnsweredOptionId(o.id)}
                />
                <span className="option-label">{o.label}</span>
                <span>{o.body}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {answeredOptionId !== null && <p className="result-explanation">{question.explanation}</p>}
    </div>
  );
}

export function PracticeQuiz({ questions }: { questions: PracticeQuestion[] }) {
  return (
    <div className="practice-quiz">
      {questions.map((q) => (
        <PracticeQuestionCard key={q.id} question={q} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd frontend && npx vitest run src/quiz/PracticeQuiz.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Add the CSS**

In `frontend/src/App.css`, after the `.option.selected` rule (around line 365), add:

```css
.option.correct { border-color: var(--success); background: var(--accent-bg); }
.option.incorrect { border-color: var(--danger); }

.practice-quiz { display: flex; flex-direction: column; gap: 1.5rem; margin: 1.5rem 0; }
.practice-question .result-explanation { margin-top: 0.75rem; }
```

- [ ] **Step 7: Update the TopicPage fixture**

In `frontend/src/pages/TopicPage.test.tsx`, change `makeTopicDetail` (lines 17–28):

```tsx
function makeTopicDetail(overrides: Partial<TopicDetail> = {}): TopicDetail {
  return {
    position: 1,
    title: 'In this lesson…',
    content: 'You will learn about vocabulary.',
    courseSlug: 'ged-language-arts-vocabulary-questions',
    courseTitle: 'Vocabulary Questions',
    subjectSlug: 'ged-language-arts',
    next: { position: 2, title: 'Words to know' },
    practiceQuestions: null,
    ...overrides,
  };
}
```

(Only the added `practiceQuestions: null` line changes.)

- [ ] **Step 8: Write the failing TopicPage test**

Add to `frontend/src/pages/TopicPage.test.tsx`, inside the `describe('TopicPage')` block, after the `'shows just the links when there is no content'` test:

```tsx
  test('shows practice questions inline when the topic has them', async () => {
    getTopic.mockResolvedValue({
      topic: makeTopicDetail({
        content: null,
        practiceQuestions: [
          {
            id: 'q1',
            position: 1,
            prompt: 'What is 1 + 1?',
            explanation: 'Basic addition.',
            options: [
              { id: 'q1-a', label: 'A', body: '1', isCorrect: false },
              { id: 'q1-b', label: 'B', body: '2', isCorrect: true },
            ],
          },
        ],
      }),
    });
    renderPage();
    expect(await screen.findByText('What is 1 + 1?')).toBeInTheDocument();
  });
```

- [ ] **Step 9: Run the test to verify it fails**

```bash
cd frontend && npx vitest run src/pages/TopicPage.test.tsx
```

Expected: FAIL — `screen.findByText('What is 1 + 1?')` times out, since `TopicPage` doesn't render `practiceQuestions` yet.

- [ ] **Step 10: Wire it into TopicPage**

In `frontend/src/pages/TopicPage.tsx`, add the import:

```tsx
import { PracticeQuiz } from '../quiz/PracticeQuiz';
```

Replace the render body (lines 55–78):

```tsx
  return (
    <div className="course-content">
      <Link to={`/courses/${topic.courseSlug}`} className="course-topic-back">
        {topic.courseTitle}
      </Link>
      <h1>{topic.title}</h1>

      {topic.content && (
        <div className="course-content-body">
          <Markdown remarkPlugins={[remarkGfm]}>{topic.content}</Markdown>
        </div>
      )}

      {topic.practiceQuestions && <PracticeQuiz questions={topic.practiceQuestions} />}

      {topic.next ? (
        <Link to={`/courses/${topic.courseSlug}/topics/${topic.next.position}`} className="primary">
          Next: {topic.next.title}
        </Link>
      ) : (
        <Link to={`/courses/${topic.courseSlug}/quiz`} className="primary">
          Take the quiz
        </Link>
      )}
    </div>
  );
```

- [ ] **Step 11: Run the test to verify it passes**

```bash
cd frontend && npx vitest run src/pages/TopicPage.test.tsx
```

Expected: PASS, all tests in the file.

- [ ] **Step 12: Run the full frontend suite**

```bash
cd frontend && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 13: Commit**

```bash
git add frontend/src/quiz/api.ts frontend/src/quiz/PracticeQuiz.tsx frontend/src/quiz/PracticeQuiz.test.tsx frontend/src/pages/TopicPage.tsx frontend/src/pages/TopicPage.test.tsx frontend/src/App.css
git commit -m "feat: render a topic's matching module as inline ungraded practice"
```

---

### Task 5: Vocabulary Questions cleanup + roll out to prod

**Files:**
- Modify: `backend/src/data/ged-language-arts.quiz.json` (the `ged-language-arts-vocabulary-questions` course's `topics` array)

**Interfaces:**
- Consumes: Task 1's migration, Task 2's seed-time linking. No code depends on this task's output — it's data only.

- [ ] **Step 1: Edit the JSON file**

In `backend/src/data/ged-language-arts.quiz.json`, find the course with `"slug": "ged-language-arts-vocabulary-questions"`. In its `"topics"` array, delete the four entries whose `"title"` is exactly one of:

- `Video: Context Clues`
- `Practice Question 1`
- `Practice Question 2`
- `Video: Finding the Meaning of a Word`

Leave every other entry (including `Quiz on Video: Finding the Meaning of a Word` and `Final Quiz: Vocabulary`) and every other course in the file untouched. Do this with a small one-off script rather than hand-editing ~1900 lines of JSON — run from `backend/src/data`:

```bash
cd backend/src/data && node -e "
const fs = require('fs');
const path = './ged-language-arts.quiz.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const drop = new Set([
  'Video: Context Clues',
  'Practice Question 1',
  'Practice Question 2',
  'Video: Finding the Meaning of a Word',
]);
const course = data.courses.find((c) => c.slug === 'ged-language-arts-vocabulary-questions');
if (!course) throw new Error('course not found');
const before = course.topics.length;
course.topics = course.topics.filter((t) => !drop.has(t.title));
console.log('topics before:', before, 'after:', course.topics.length);
fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
"
```

Expected output: `topics before: 13 after: 9`.

- [ ] **Step 2: Verify the diff is scoped to exactly those four entries**

```bash
cd /path/to/liah-ged && git diff backend/src/data/ged-language-arts.quiz.json
```

Expected: a diff touching only the `ged-language-arts-vocabulary-questions` course's `topics` array, removing exactly the four named entries and nothing else (no reordering, no other course affected).

- [ ] **Step 3: Reseed your local dev database and spot-check**

```bash
cd backend && npm run db:migrate:deploy 2>/dev/null; node --import tsx --env-file-if-exists=.env src/scripts/seed-quizzes.ts src/data/ged-language-arts.quiz.json
```

(If `db:migrate:deploy` reports it's skipping because `VERCEL_ENV` isn't `production`, that's expected locally — your dev DB already has the migration from Task 1, Step 3.)

Then confirm in your dev DB:

```bash
cd backend && node --import tsx --env-file-if-exists=.env -e "
import { db } from './src/db/index.ts';
import { topics, courses } from './src/models/schema.ts';
import { eq } from 'drizzle-orm';
const [course] = await db.select().from(courses).where(eq(courses.slug, 'ged-language-arts-vocabulary-questions'));
const rows = await db.select({ title: topics.title, moduleId: topics.moduleId }).from(topics).where(eq(topics.courseId, course.id)).orderBy(topics.position);
console.log(rows);
process.exit(0);
"
```

Expected: 9 rows, none titled `Video: Context Clues`, `Practice Question 1`, `Practice Question 2`, or `Video: Finding the Meaning of a Word`; the row titled `Quiz on Video: Finding the Meaning of a Word` and the row titled `Final Quiz: Vocabulary` both have a non-null `moduleId`.

- [ ] **Step 4: Commit the data change**

```bash
git add backend/src/data/ged-language-arts.quiz.json
git commit -m "content: remove empty video/practice placeholder topics from Vocabulary Questions"
```

- [ ] **Step 5: Roll out to prod**

This step writes to the live production database — confirm with the user before running it. Using the Neon connection string for the `liah-ged` project's `main` branch (the same one used earlier in this session):

1. Apply Task 1's migration to prod:
   ```bash
   DATABASE_URL="<prod connection string>" npx drizzle-kit migrate
   ```
2. Re-run the full seed (not just Language Arts) so every subject's existing topics get `moduleId` linked, not only Vocabulary Questions:
   ```bash
   DATABASE_URL="<prod connection string>" npm run quiz:seed
   ```
3. Verify: query prod for the Vocabulary Questions course's topic count (expect 9, down from 13) and confirm `topics.module_id` is non-null for at least one topic per subject (e.g. one of each subject's "Final Quiz" topics).

---

## Self-Review Notes

- Spec coverage: Part 1 (cleanup) → Task 5. Part 2 data model → Task 1. Seeding → Task 2. Backend API → Task 3. Frontend → Task 4. Rollout → Task 5, Step 5. Testing section's four bullets map to Task 2 Step 1 (seed test), Task 3 Step 1 (catalog test), Task 4 Steps 2 & 8 (frontend tests).
- Type consistency checked: `PracticeOption`/`PracticeQuestion` defined identically in Task 3 (backend) and Task 4 Step 1 (frontend) — `{ id, label, body, isCorrect }` and `{ id, position, prompt, explanation, options }` match in both places.
- No placeholders — every step has complete code or an exact command with expected output.
