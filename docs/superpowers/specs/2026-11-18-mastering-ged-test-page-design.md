# Mastering the GED Test: standalone content page

## Context

`backend/src/data/mastering-the-ged-test.pdf` was explicitly excluded from the GED content
import (see `docs/superpowers/specs/2026-11-18-ged-content-import-design.md`): it's a single
7-page overview of the GED test process and study tips, with 0 quiz questions, and doesn't fit
the app's "course = one quiz" model.

It can't be modeled as a `courses` row even with a nullable quiz: certificate eligibility
(`backend/src/models/certificate.model.ts`'s `getEligibilitySummary`) requires passing **every**
active course across the whole app, not per-subject. A quiz-less course would be permanently
unpassable and would make the diploma certificate unobtainable for every user. The content also
isn't about one subject — it's meta content about the test itself (registration, online-vs-
testing-center, calculator use, test-day strategy, video list) — so it doesn't belong inside the
subjects/courses model at all.

## Goal

Show this content to the learner as a standalone static page, entirely outside the
subjects/courses/quiz/certificate system. No schema change, no API endpoint, no DB seeding.

## Content structure

The source PDF has real structure — section headings, nested sub-headings (e.g. "Benefits of
Taking the GED Online:" under the "Taking the GED Test: Online or In-Person" topic), and bullet
lists — not just flat paragraphs like the lesson-content pages built for the four subject PDFs.
That structure is preserved rather than flattened.

Block shape:

```ts
type Block =
  | { type: 'heading'; text: string }      // topic-level titles (the 8 "topics" across the PDF's 2 lessons)
  | { type: 'subheading'; text: string }   // inner bolded lead-ins within a topic
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] };
```

Covers every shape present in the source: the "What you'll learn" intro bullets, each of the 8
topic sections (5 in "Lesson 1: Mastering the GED Test", 3 in "Lesson 2: Essential Tips to Ace
the GED Test" — the PDF's own "Lesson"/"topic" framing is not surfaced in the UI, it's just how
the source groups sections), and the nested Benefits/Challenges/Who-should-take-it/Testing-
rules/Learn-More/Video-list sub-sections inside the longer topics.

Mentions of videos (e.g. "Watch this video to learn more about how to register for the GED®:",
"Video 1: Eliminating Wrong Answers") stay as plain text — the source has no actual video asset
to embed, just a title. The trailing `Source: https://classroom.usahello.org/... · © USAHello (CC
BY-NC-SA 4.0)` line is kept as a small attribution block at the end of the page, since that's the
actual license this content is reused under.

## Extraction

One-off script `backend/src/scripts/extract-mastering-content.ts`, following the existing
`lib/ged-content.ts` pattern for `pdftotext -layout` + stripping stray `\f` page-break artifacts:

1. Run `pdftotext -layout` on `mastering-the-ged-test.pdf`.
2. Strip page-footer lines (`Mastering the GED Test — Page N`) and the standalone `Lesson N: ...`
   / `N topics · 0 quizzes` structural lines (not shown in the UI — see above).
3. Classify each remaining line/paragraph into a `Block`:
   - A short line matching one of the known topic titles (there are exactly 8; hard-code the
     list since this is a one-time extraction, not a general parser) → `heading`.
   - A short bolded-in-source lead-in line immediately followed by a bullet block or ending in
     `:` → `subheading`.
   - A `•`-prefixed line → accumulate into the current `bullets` block.
   - Everything else, joined until the next blank line → `paragraph`.
4. Write the resulting `Block[]` directly to `frontend/src/content/mastering-the-ged-test.json` —
   no intermediate backend artifact, since there's no seeding step consuming it.

This is a one-time load; the script is kept in the repo for inspectability/re-running, not as a
standing pipeline.

## Frontend

- New page `frontend/src/pages/MasteringGedTestPage.tsx`, route `/mastering-the-ged-test` in
  `router.tsx` (alongside the other `AppShell`-wrapped routes — same auth/forced-password-change
  gating as every other signed-in page).
- Imports `mastering-the-ged-test.json` directly as a static import (Vite supports JSON imports)
  — no fetch, no loading state, no error state.
- Renders the block stream: `heading` → `<h2>`, `subheading` → `<h3>`, `paragraph` → `<p>`,
  `bullets` → `<ul><li>`. Page `<h1>` is "Mastering the GED Test", set directly in the component
  (not part of the JSON), matching the page-title pattern on `CourseContentPage`.
- New top-level sidebar link in `SidebarNav.tsx`, placed with "All subjects" / "My Progress"
  (not inside a `SubjectGroup`, since this isn't a subject) — `NavLink` to
  `/mastering-the-ged-test`, active-state styling comes for free from the existing `itemClass`
  pattern.
- One test file `MasteringGedTestPage.test.tsx` asserting the page renders its headings and at
  least one bullet list, following the existing page-test convention (e.g.
  `CourseContentPage.test.tsx`).

## Out of scope

- Any change to `schema.ts`, `courses`/`subjects`/`certificates` models, or
  `certificate.model.ts`'s eligibility logic.
- The `quiz-bank.json`/`quizzes.json` pipeline and `seed-quizzes.ts` — untouched.
- The generic admin "Import quiz content" pipeline (`quiz-parser.ts`) — untouched.
- Any backend API endpoint or database row for this content.
- Markdown rendering (same as the existing lesson-content pages — plain text blocks only).
