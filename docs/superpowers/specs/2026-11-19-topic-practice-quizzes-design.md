# Topic practice quizzes + Vocabulary lesson cleanup

## Context

Prod's `topics` table (one row per reading stop in a course's Lesson > Topic >
Quiz flow) was recently populated by automatic PDF extraction
(`extractLessonTopics` / `splitLessonIntoTopics` in `ged-html-content.ts`).
That extraction produces a topic per heading in the source PDF, including
headings that don't carry real reading content:

- Headings for embedded videos or interactive widgets the PDF export
  couldn't capture (e.g. "Video: Context Clues", "Practice Question 1") end
  up as topics with `content: null` — an empty stop with nothing but a title
  and a Next link.
- Headings that happen to share a title with one of the course's quiz
  modules (e.g. "Final Quiz: Vocabulary") also end up as empty topics,
  because the real question data lives in `modules`/`questions`, not
  `topics`. The reader hits an empty page where they'd expect a quiz.

Reviewing GED Language Arts > Vocabulary Questions surfaced both problems:

```
In this lesson… / Words to know / What is Vocabulary? /
[Video: Context Clues] / [Practice Question 1] / [Practice Question 2] /
GED Exam Tip / [Video: Finding the Meaning of a Word] / GED Exam Tip /
Vocabulary review / Summary /
[Quiz on Video: Finding the Meaning of a Word] / [Final Quiz: Vocabulary]
```

The bracketed six are the ones under review. The first four have no
content and nothing to back them — straightforward deletions. The last two
*do* have real questions behind them (2 and 4 respectively, in
`modules`/`questions`), just not surfaced at that point in the reading flow
— the only place those questions currently appear is lumped into the
course's single end-of-course graded quiz (`GET /courses/:slug/quiz`,
one `attempts` row per course, scored against `courses.passScore`).

Prod currently has 0 rows in `attempts`, so no learner has graded history
riding on today's one-attempt-per-course model — safe to extend the schema
without a migration/backfill concern for existing users.

## Goals

1. Remove the four empty, unbacked topic stops from the Vocabulary
   Questions lesson.
2. Give topics that share a title with a quiz module a real body: show
   that module's questions inline as **ungraded practice** (pick an
   answer, see correct/incorrect + explanation immediately, nothing
   persisted, no attempt created). This is a property of the content
   pipeline, not a one-lesson special case — any course where a topic
   title matches a module title gets this automatically.

## Non-goals

- Changing the end-of-course graded quiz, its scoring, attempts, or
  certificate logic. The single graded attempt per course, covering every
  question in the course (including ones also shown as inline practice),
  is unchanged.
- Re-running PDF extraction or regenerating `*.quiz.json` wholesale. Only
  the Vocabulary Questions course's `topics` array is hand-edited for
  Part 1; Part 2 needs no JSON changes.
- Any UI distinction in the sidebar/topic list between plain reading
  topics and practice-stop topics beyond what the topic page itself shows.

## Part 1 — Vocabulary Questions lesson cleanup

Edit `backend/src/data/ged-language-arts.quiz.json`: in the course with
slug `ged-language-arts-vocabulary-questions`, remove these four entries
from `topics` (leaving relative order of the rest unchanged — `position` is
reassigned by index at seed time, so no renumbering step is needed):

- `Video: Context Clues`
- `Practice Question 1`
- `Practice Question 2`
- `Video: Finding the Meaning of a Word`

This is a manual, hand-curated edit — it diverges from what a future
`ged:import` re-run would regenerate from the source PDF. That's accepted;
this file is now also a place for editorial correction, not purely a build
artifact.

After editing, re-run `quiz:seed` for `ged-language-arts.quiz.json` against
prod. `seedSubject` deletes and reinserts `modules`/`questions`/`topics` per
course by `courseId`, so this only touches the Vocabulary Questions course;
every other course in the file reseeds identically to before.

## Part 2 — Practice-stop topics

### Data model

Add a nullable `topics.module_id` column, FK → `modules.id`,
`onDelete: 'cascade'`. In practice this cascade never fires outside of a
reseed: `seedSubject` always deletes and reinserts a course's `modules`
and `topics` together in the same transaction, so a module referenced by
`topics.module_id` is never deleted independently of the topic that points
to it.

Drizzle migration: `ALTER TABLE topics ADD COLUMN module_id uuid REFERENCES modules(id) ON DELETE CASCADE;`

### Seeding (`seed-quizzes.ts`)

`seedSubject` already builds `moduleIdByTitle` (title → id) when linking
questions to their module. After modules are inserted and before topics are
inserted, resolve each topic's `moduleId` by looking up its `title` in that
same map:

```ts
await tx.insert(topics).values(
  course.topics.map((topic, index) => ({
    courseId,
    position: index + 1,
    title: topic.title,
    content: topic.content,
    moduleId: moduleIdByTitle.get(topic.title) ?? null,
  })),
);
```

No change to `ged-html-content.ts` / `extractLessonTopics` /
`splitLessonIntoTopics` — they already produce a topic per heading,
including ones whose title happens to match a module title. The matching
that creates the practice-stop behavior happens entirely at seed time, from
data that already exists.

### Backend API

`TopicDetail` (`catalog.model.ts`) gains:

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
  // ...existing fields...
  practiceQuestions: PracticeQuestion[] | null;
};
```

`findTopic`: when the fetched topic row has a non-null `moduleId`, run a
second query joining `questions` → `questionOptions` filtered by that
`moduleId` (and the topic's `courseId`, for defense in depth), ordered by
`questions.position`, `questionOptions.label` — same join shape as
`findQuizByCourseSlug` in `quiz.model.ts`, but including `isCorrect` since
this is ungraded practice, not an exam in progress. When `moduleId` is
null, `practiceQuestions` is `null`.

No new routes. No new tables. No attempt rows created or touched.

### Frontend

New component `PracticeQuiz` (in `frontend/src/quiz/`), rendered by
`TopicPage` when `topic.practiceQuestions` is non-null, in place of the
empty body:

- One block per question: prompt + option list (same markup family as
  `QuestionCard`'s `option-list`).
- Clicking an option locks in that question's answer (no separate "check"
  button) and immediately reveals correct/incorrect styling + the
  question's `explanation`, independently per question — answering one
  question doesn't affect the others, and there's no page-level submit
  step.
- Once answered, the locked-in state persists for the remainder of the
  page view (no re-answering, no API call — everything needed is already
  in the loaded `practiceQuestions` payload).
- The existing `Next topic` / `Take the quiz` link at the bottom of
  `TopicPage` is unconditional — it doesn't require the practice questions
  to be answered first.

### Testing

- `seed-quizzes.test.ts`: a topic titled exactly like one of the course's
  modules gets `moduleId` set to that module's id after seeding; a topic
  with no matching module title gets `moduleId: null`.
- `catalog.model.test.ts`: `findTopic` returns `practiceQuestions` with
  full `isCorrect`/`explanation` data when the topic's `moduleId` is set,
  and `null` when it isn't.
- Frontend: a `TopicPage`/`PracticeQuiz` test asserting that selecting an
  option reveals correct/incorrect and the explanation, and that a second
  question on the same page is unaffected by answering the first.

## Rollout

1. Drizzle migration for `topics.module_id`.
2. Update `seed-quizzes.ts` to set `moduleId`; add its unit test.
3. Update `catalog.model.ts` (`TopicDetail`, `findTopic`) + test.
4. Add `PracticeQuiz` frontend component + wire into `TopicPage` + test.
5. Hand-edit `ged-language-arts.quiz.json` per Part 1.
6. Run migration against prod, then re-run `quiz:seed` for
   `ged-language-arts.quiz.json` (Part 1's deletions land; Part 2's
   `moduleId` linking lands for every subject the same seed pass touches —
   worth re-running `quiz:seed` with no args to pick up `moduleId` linking
   across all four subjects' already-seeded data, not just Language Arts).
