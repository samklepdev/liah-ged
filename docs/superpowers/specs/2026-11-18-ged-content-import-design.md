# GED content import: lesson content + quizzes from source data

## Context

`backend/src/data/` holds five source PDFs (`ged-language-arts.pdf`, `ged-math.pdf`,
`ged-science.pdf`, `ged-social-studies.pdf`, `mastering-the-ged-test.pdf`) plus two JSON
files (`quiz-bank.json`, `quizzes.json`) scraped from the USAHello GED classroom. The four
subject PDFs are full exports of that classroom's lesson pages: each page mixes lesson
reading text (vocabulary, explanations, exam tips) with embedded quiz-widget chrome and the
quiz questions themselves. `quiz-bank.json` / `quizzes.json` already hold those same quiz
questions in clean, structured form.

The app's current schema (`backend/src/models/schema.ts`) is: `subjects` → `courses` →
`modules` → `questions` → `questionOptions`. A `course` is one quiz-taking unit (what the
learner does at `/courses/:slug/quiz`); a `module` is just a label tag shown above each
question (`QuestionCard.tsx`). There is no field anywhere for lesson reading content —
`modules` only have a `title`.

There is an existing PDF-import pipeline (`lib/quiz-parser.ts`,
`scripts/parse-quiz-pdf.ts`, `scripts/seed-quizzes.ts`, the admin "Import quiz content"
modal), but it targets a completely different PDF dialect — automotive "Pop Quiz" packs
with cover pages, module-count banners, and a letter answer-key section. It does not apply
to the GED classroom export format and is not touched by this work.

## Goal

Load the four subject PDFs' lesson content, and quiz-bank.json's questions, into the
database as GED subjects/courses/modules/questions, and show the lesson content to the
learner before they take each lesson's quiz.

`mastering-the-ged-test.pdf` is explicitly out of scope: it has 0 matching quiz questions
(it's a single 7-page intro lesson) and doesn't fit the "course = one quiz" model used
everywhere else in the app. Revisit separately if a quiz-less content page is ever wanted.

## Data mapping

quiz-bank.json is a flat array of entries shaped like:

```json
{
  "course": "ged-language-arts",
  "courseTitle": "GED® Language Arts: Prepare for the exam",
  "quizTitle": "Quiz on Video: Finding the Meaning of a Word",
  "lesson": "Lesson 1: Vocabulary Questions",
  "questionNumber": 1,
  "question": "...",
  "options": ["...", "...", "...", "..."],
  "correctIndex": 1,
  "explanation": "..."
}
```

Mapped onto the schema:

| quiz-bank field         | schema target                                      |
|--------------------------|-----------------------------------------------------|
| `course` / `courseTitle` | `subjects.slug` / `subjects.title`                   |
| `lesson`                 | `courses` row (one quiz-taking unit); leading number in the title (`Lesson N: ...`) is `courses.position` |
| `quizTitle`              | `modules.title`                                      |
| `questionNumber`, `question`, `options`, `correctIndex`, `explanation` | `questions` / `questionOptions` |

`courses.passScore` is computed per lesson as `ceil(questionCount * 0.8)` rather than using
the fixed default of 9 — lessons range from ~2 to ~15 questions, so a fixed "9 of 10" bar
doesn't make sense across them.

### Question filtering

Not every quiz-bank entry is a valid single-select multiple choice question, which is all
the schema supports (`attemptAnswers` stores exactly one `optionId` per question):

- 15 entries are "fill in the blank" questions with a single placeholder option
  (`options: ["Fill in the blank 1 of N"]`) and `correctIndex: []`.
- 8 entries are "check all that apply" questions with multiple correct answers
  (`correctIndex` is an array, e.g. `[0, 2, 3, 5]`).

Both cases are identified by the same rule — `typeof entry.correctIndex !== 'number'` — and
are excluded from the import. That's 23 of 676 entries excluded, 653 imported. Option counts
among the remaining 653 range from 2 to 5 (not always 4), which is fine — `questionOptions`
has no fixed-count constraint.

### Position numbering

`questionNumber` is scoped to a single quiz (`quizTitle`) within a lesson, not to the
lesson as a whole — most lessons contain multiple quizzes, so raw `questionNumber` values
collide across quizzes within the same lesson and violate
`questions_course_position_unique` (`courseId`, `position`). The importer renumbers
sequentially (1..N) within each lesson, ordered by first appearance of `quizTitle` in
quiz-bank.json, then by the original `questionNumber` within that quiz.

Similarly, `modules` has a `(courseId, title)` unique constraint — the importer dedupes
`quizTitle` values per lesson before inserting module rows (one module per distinct
`quizTitle`, not one per question).

### Lessons with no quiz data

Each subject's PDF ends with a final "Congratulations" (or similarly-named) outro lesson
that has zero matching quiz-bank entries — the same situation as
`mastering-the-ged-test.pdf`. These are skipped for the same reason: no questions means no
course can be built under the "course = one quiz" model.

## Schema change

Add one nullable column: `courses.content` (`text`). Holds the lesson's cleaned reading
text as plain paragraphs (`\n\n`-separated). No markdown — nothing in the frontend parses
markdown today, and the source text has no structure worth preserving beyond paragraph
breaks. A Drizzle migration adds the column; every existing (non-GED) course gets
`content = null`, which the content page treats as "no reading material" (see UI section).

## Content extraction

New library `backend/src/lib/ged-content.ts` + CLI `backend/src/scripts/extract-ged-content.ts`:

1. Run `pdftotext -layout` on each of the four subject PDFs (reusing `lib/pdf-text.ts`'s
   approach).
2. Before splitting into lines, strip stray `\f` (form-feed) page-break characters that
   `pdftotext` sometimes glues onto the start of the following line — observed gluing onto
   a `Lesson N:` header itself (e.g. `...— Page 102\n\fLesson 14: Using Transition...`),
   which would otherwise make that header invisible to a `^Lesson` line match.
3. Split on `^Lesson N: <title>$` headers into one raw text block per lesson. Match each
   block to quiz-bank.json's `lesson` field by that same title string (verified to match
   1:1 per subject once the `\f` artifact above is handled, aside from each subject's final
   "Congratulations" lesson — see below).
4. Within each block, strip:
   - Page footers (`"<Subject title> — Page N"`).
   - Nav/widget chrome (`Click "Continue"…`, `Explore further: …`, and the quiz-widget
     boilerplate lines seen in the language-arts export — "Time limit: 0 Quiz Summary…",
     "Correct Incorrect Skip", etc.)
   - The inline quiz Q&A blocks themselves. Each block starts at one of that lesson's known
     `quizTitle` strings (from quiz-bank.json) and runs up to the start of the *next* known
     `quizTitle` heading (or the end of the lesson's text if it's the last one). Bounding
     both ends on known headings — rather than "next recognised heading" in general — is
     what keeps this reliable across the two different inline quiz formats seen (the
     language-arts widget-dump style and math's `Q1. / a) ... (correct) / Explanation:`
     style). These blocks are already captured as structured quiz data — keeping them in
     `content` would duplicate the questions and leak answers into the reading material.
5. Join what's left into paragraphs and write an intermediate, inspectable file per subject:
   `backend/src/data/<subject-slug>.content.json`, shaped as
   `{ lessonTitle: string; content: string }[]` — mirroring the existing convention in
   `parse-quiz-pdf.ts` of writing a reviewable artifact before anything touches the DB.

## Seeding

Extend `seedSubject` (`scripts/seed-quizzes.ts`) — or add a sibling import path — to:

- Build `ParsedSubject`-shaped data from `quiz-bank.json` directly (grouping by
  `course` → `lesson` → `quizTitle`), rather than from `quiz-parser.ts`'s PDF-dialect
  parser, which does not apply here.
- Join in the matching `<subject-slug>.content.json` by lesson title, writing to
  `courses.content`.

One run seeds both quizzes and content together per subject.

## API

New endpoint `GET /api/courses/:slug` returning one course's detail — title, `content`,
`passScore`, `questionCount`, `position`, `subjectSlug` — for the new content page.
`listCoursesBySubject` and `searchCatalog` (`models/catalog.model.ts`) are left as they are:
they back the subject's course list and search results, which only ever render a title and
a score, so there's no reason to ship every lesson's full reading text on those payloads.

## Frontend

- New route `/courses/:slug` → `CourseContentPage`: fetches the new course-detail endpoint,
  shows the lesson title, the `content` paragraphs, and a "Take the quiz" button linking to
  `/courses/:slug/quiz`. When `content` is `null` (every non-GED course, today), the page
  just shows the button — so this change is backward-compatible with every subject already
  in the app.
- `SubjectCoursesPage`'s course links change from `/courses/:slug/quiz` to `/courses/:slug`.

## Validation

This is a one-time data load, not a recurring pipeline, so there's no case for building a
standing content-quality check. But the one failure mode worth a mechanical guard —
content-extraction accidentally keeping part of a quiz block, leaking a prompt or answer
into the reading text — is cheap to catch exactly: after extraction, assert that no
lesson's `content` contains any of that lesson's quiz-bank question prompts as a verbatim
(whitespace-normalized) substring. Run this over all 653 kept questions as part of
`extract-ged-content.ts`, failing the script if it trips. Beyond that, spot-check a handful
of extracted lessons per subject against the source PDF by eye.

## Out of scope

- `mastering-the-ged-test.pdf`.
- The generic admin "Import quiz content" PDF-upload feature (`quiz-parser.ts` and
  everything built on it) — untouched, targets a different content domain.
- Markdown rendering.
