# Markdown Course Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let course lesson content be authored as real Markdown (with nested headings/subheadings and lists) and rendered with that structure, instead of today's flat `\n\n`-separated plain-text paragraphs.

**Architecture:** `courses.content` stays a single nullable `text` column — no schema or migration needed, since Markdown is still just a string. Two independent changes land this:
1. The frontend (`CourseContentPage.tsx`) renders `course.content` through a real Markdown renderer (`react-markdown` + `remark-gfm`) instead of `content.split('\n\n').map(p => <p>)`.
2. The backend seed step (`seed-quizzes.ts`) gains a content-override: if `backend/src/data/content/<course-slug>.md` exists, its contents replace whatever `content` string is in the course's `*.quiz.json` entry. This decouples hand-authored Markdown from the PDF auto-extraction pipeline (`import-ged-content.ts`), so re-running that pipeline never clobbers a hand-written lesson.

A hand-written Markdown file for `ged-language-arts-vocabulary-questions` is authored as the pilot migration, proving the override mechanism and the new heading hierarchy end-to-end.

**Tech Stack:** React 19 + Vite + vitest/@testing-library/react (frontend); Node test runner (`node:test`) + Drizzle + Postgres (backend); new deps `react-markdown@^10.1.0` and `remark-gfm@^4.0.1` (frontend only).

## Global Constraints

- No database migration — `courses.content` remains `text`, nullable, unchanged (`backend/src/models/schema.ts:89`).
- Existing plain-text content (no Markdown syntax) must keep rendering exactly as before: a blank-line-separated run of text is still one paragraph under CommonMark, so this is a safe superset, not a breaking change.
- The content override is additive and optional — courses without a `.md` override file behave exactly as today (JSON `content` field, rendered as Markdown now instead of raw paragraphs, with no visible difference for plain text).
- Follow existing test conventions: frontend tests use `vitest` + `@testing-library/react` (see `frontend/src/pages/CourseContentPage.test.tsx`); backend tests use `node:test` + `node:assert/strict` against a real test DB via `resetDb()`/`closeDb()` (see `backend/src/scripts/seed-quizzes.test.ts`).

---

### Task 1: Render course content as Markdown in the frontend

**Files:**
- Modify: `frontend/package.json` (add `react-markdown`, `remark-gfm`)
- Modify: `frontend/src/pages/CourseContentPage.tsx`
- Modify: `frontend/src/pages/CourseContentPage.test.tsx`
- Modify: `frontend/src/App.css:255-262` (`.course-content-body` rules)

**Interfaces:**
- Consumes: `CourseDetail.content: string | null` (unchanged, from `frontend/src/quiz/api.ts:31`).
- Produces: no new exports — `CourseContentPage` keeps its existing default usage from the router.

- [ ] **Step 1: Add the Markdown renderer dependencies**

Run:
```bash
cd frontend && npm install react-markdown@^10.1.0 remark-gfm@^4.0.1
```
Expected: `frontend/package.json` dependencies gain both entries; `frontend/package-lock.json` (or root lockfile) updates.

- [ ] **Step 2: Write the failing test for heading rendering**

Replace the body of `frontend/src/pages/CourseContentPage.test.tsx` test block with a new test added after the existing "shows the lesson title and content paragraphs" test:

```tsx
test('renders markdown headings and lists with structure', async () => {
  getCourse.mockResolvedValue({
    course: makeCourseDetail({
      content: '## Words to Know\n\n- Vocabulary — words you know\n- Context clues — hints in the text',
    }),
  });
  renderPage();
  expect(await screen.findByRole('heading', { name: 'Words to Know', level: 2 })).toBeInTheDocument();
  expect(await screen.findByRole('listitem')).toHaveTextContent('Vocabulary — words you know');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && npm test -- CourseContentPage`
Expected: FAIL — `findByRole('heading', { name: 'Words to Know', level: 2 })` finds nothing, because `content.split('\n\n')` currently dumps the raw `## Words to Know` text into a `<p>`.

- [ ] **Step 4: Implement Markdown rendering**

Replace `frontend/src/pages/CourseContentPage.tsx` lines 1-3 and 48-62 as follows.

Imports (top of file):
```tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { quizApi, type CourseDetail } from '../quiz/api';
```

Render body (replace the `paragraphs` variable and the `course-content-body` block):
```tsx
  const { course } = current;

  return (
    <div className="course-content">
      <span className="course-position">Quiz {course.position}</span>
      <h1>{course.title}</h1>

      {course.content && (
        <div className="course-content-body">
          <Markdown remarkPlugins={[remarkGfm]}>{course.content}</Markdown>
        </div>
      )}

      <Link to={`/courses/${course.slug}/quiz`} className="primary">
        Take the quiz
      </Link>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npm test -- CourseContentPage`
Expected: PASS — all tests in `CourseContentPage.test.tsx` pass, including the new heading/list test and the pre-existing plain-paragraph test (CommonMark renders `'First paragraph.\n\nSecond paragraph.'` as two `<p>` tags, same as before).

- [ ] **Step 6: Restyle nested headings/lists inside course content**

In `frontend/src/App.css`, replace lines 255-262:
```css
.course-content-body {
  margin: 1.5rem 0 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.course-content-body p { margin: 0; line-height: 1.6; }
```
with:
```css
.course-content-body {
  margin: 1.5rem 0 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.course-content-body p { margin: 0; line-height: 1.6; }

.course-content-body h2 { font-size: 1.3rem; margin: 1rem 0 0; }
.course-content-body h3 { font-size: 1.1rem; margin: 0.75rem 0 0; }
.course-content-body ul,
.course-content-body ol { margin: 0; padding-left: 1.5rem; line-height: 1.6; }
.course-content-body li { margin: 0.25rem 0; }
```

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/pages/CourseContentPage.tsx frontend/src/pages/CourseContentPage.test.tsx frontend/src/App.css
git commit -m "feat: render course content as markdown"
```

---

### Task 2: Let a Markdown file override a course's seeded content

**Files:**
- Create: `backend/src/data/content/` (new directory for hand-authored overrides)
- Modify: `backend/src/scripts/seed-quizzes.ts`
- Modify: `backend/src/scripts/seed-quizzes.test.ts`

**Interfaces:**
- Consumes: `ParsedSubject`/`ParsedCourse` from `backend/src/lib/quiz-parser.ts:607-621` (unchanged).
- Produces: `seedSubject(subject: ParsedSubject, contentDir?: URL): Promise<{ courses: number; questions: number }>` — adds an optional second parameter so tests can point it at a fixture directory instead of the real `backend/src/data/content/`.

- [ ] **Step 1: Write the failing test for the override**

Add to `backend/src/scripts/seed-quizzes.test.ts`, after the existing `'seedSubject writes passScore and content when provided'` test:

```ts
test('seedSubject prefers a markdown override file over JSON content', async () => {
  const withContent: ParsedSubject = {
    slug: 'ged-demo',
    title: 'GED Demo',
    courses: [
      {
        position: 1,
        slug: 'ged-demo-course',
        title: 'Demo Course',
        questionCount: 0,
        content: 'Plain JSON content.',
        moduleTitles: [],
        questions: [],
      },
    ],
  };

  const contentDir = new URL('../test/fixtures/content-overrides/', import.meta.url);
  await seedSubject(withContent, contentDir);

  const [row] = await db.select({ content: courses.content }).from(courses).where(eq(courses.slug, 'ged-demo-course'));
  assert.equal(row!.content, '## Overridden\n\nThis came from the markdown file, not the JSON.\n');
});
```

Create the fixture file the test reads, `backend/src/test/fixtures/content-overrides/ged-demo-course.md`:
```markdown
## Overridden

This came from the markdown file, not the JSON.
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx tsx --test src/scripts/seed-quizzes.test.ts`
Expected: FAIL — `row!.content` is `'Plain JSON content.'`, not the fixture's text, because `seedSubject` doesn't look at `contentDir` yet (and doesn't accept the parameter).

- [ ] **Step 3: Implement the override in `seedSubject`**

In `backend/src/scripts/seed-quizzes.ts`, update the imports and function signature:

```ts
import { readFileSync, readdirSync, existsSync } from 'node:fs';
```

Replace the function signature and the two `content:` lines inside the `for (const course of subject.courses)` loop:

```ts
export async function seedSubject(
  subject: ParsedSubject,
  contentDir: URL = new URL('../data/content/', import.meta.url),
): Promise<{ courses: number; questions: number }> {
  return db.transaction(async (tx) => {
    const [subjectRow] = await tx
      .insert(subjects)
      .values({ slug: subject.slug, title: subject.title })
      .onConflictDoUpdate({ target: subjects.slug, set: { title: subject.title } })
      .returning({ id: subjects.id });

    let questionTotal = 0;

    for (const course of subject.courses) {
      const overridePath = new URL(`${course.slug}.md`, contentDir);
      const content = existsSync(overridePath)
        ? readFileSync(overridePath, 'utf8')
        : course.content ?? null;

      const [courseRow] = await tx
        .insert(courses)
        .values({
          subjectId: subjectRow!.id,
          position: course.position,
          slug: course.slug,
          title: course.title,
          questionCount: course.questionCount,
          passScore: course.passScore ?? 9,
          content,
        })
        .onConflictDoUpdate({
          target: courses.slug,
          set: {
            subjectId: subjectRow!.id,
            position: course.position,
            title: course.title,
            questionCount: course.questionCount,
            passScore: course.passScore ?? 9,
            content,
          },
        })
        .returning({ id: courses.id });
```

(The rest of the function — modules, questions, options — is unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx tsx --test src/scripts/seed-quizzes.test.ts`
Expected: PASS — the new override test passes, and all pre-existing tests (`loads the whole pack`, `is idempotent`, `writes passScore and content when provided`, `defaults passScore to 9 and content to null when omitted`) still pass unchanged, since none of their course slugs have a matching file in `../data/content/`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/scripts/seed-quizzes.ts backend/src/scripts/seed-quizzes.test.ts backend/src/test/fixtures/content-overrides/ged-demo-course.md
git commit -m "feat: let a markdown file override a course's seeded content"
```

---

### Task 3: Migrate Vocabulary Questions to a hand-authored Markdown override

**Files:**
- Create: `backend/src/data/content/ged-language-arts-vocabulary-questions.md`

**Interfaces:**
- Consumes: the override mechanism from Task 2 (`seedSubject` reads `backend/src/data/content/<slug>.md` automatically — no code change needed here).
- Produces: nothing consumed by later tasks — this is the end of the plan.

This is the pilot: restructure the existing flat lesson text (currently one `content` string with no heading structure, pulled from `backend/src/data/ged-language-arts.quiz.json`'s `ged-language-arts-vocabulary-questions` course entry) into real Markdown headings/subheadings. The PDF-extracted source text has some leaked quiz-question fragments mixed into the lesson prose (e.g. stray "Question 1 Read the following passage…" blocks) — this pass also drops those, since they're parser artifacts, not lesson content, and the quiz itself already covers that material as real questions.

- [ ] **Step 1: Write the Markdown file**

Create `backend/src/data/content/ged-language-arts-vocabulary-questions.md`:

```markdown
## In This Lesson

You will learn:

- What is vocabulary?
- How can you figure out the meaning of a word?
- What are the steps to answering a vocabulary question?

## Words to Know

- **Passage** — section of text or quote from a book or other written material
- **Text** — writing on a page or a digital screen
- **Vocabulary** — set of words you know or use
- **Context clues** — hints that can help you understand new words when you read a sentence or paragraph
- **Root word** — a basic word to which affixes (prefixes and suffixes) are added
- **Prefix** — word added to the beginning of a word
- **Suffix** — a word added to the end of a word

## What Is Vocabulary?

The language arts test will have many questions about pieces of text. One type of question is about the meaning of words — we call these vocabulary questions. Vocabulary means the words in a language; your vocabulary is all the words you know.

The test may ask you to figure out the meaning of a word from the way it is used. It may be a word you already know, used in a different way, or a word you have not seen before. Either way, you can use context clues — the words and sentences around it — to find its meaning.

For example: *"It was an idyllic day; sunny, warm and perfect for a walk in the park."* Looking at the words around "idyllic" — sunny, warm, perfect — we can see that idyllic means perfect or just right.

## The Six Steps to Answering a Vocabulary Question

1. **Read the first sentence or two.** This gives you an idea of the topic or theme. If it's a short text, read the whole thing quickly.
2. **Read the directions and the question, but not the answers yet.** Know exactly what word's meaning you're looking for.
3. **Read the whole text and the answer choices.** This helps you understand which parts of the text matter most for figuring out the answer.
4. **Find the key information in the text.** Locate the word in question and re-read the sentence (and surrounding sentences) that use it.
5. **Try to predict the best answer** before looking closely at the choices.
6. **Choose the answer that is the best match for your predicted answer**, checking each option against the text to rule out the others.

### Worked Example

*"Mark Twain's book "The Prince and the Pauper" is about two boys who look identical. One is a prince and one is a pauper. After they meet, they switch places with each other."*

Question: in this passage, the word **identical** means which of the following — different, the same, brothers, or like a prince and a pauper?

- "Different" isn't supported — nothing suggests they look different, and it would be hard to switch places if they did.
- "The same" fits — the boys look alike and are able to switch places.
- "Brothers" doesn't fit — a prince and a pauper are not typically brothers.
- "Like a prince and a pauper" is true but doesn't describe what *identical* means.

**The best answer is "the same."**

## Exam Tip

It is not necessary to understand every word in a text. What matters most is understanding what the question is asking. If you don't know a word, keep reading — it might not matter for answering the question. Many GED/HiSET questions test comprehension: how well you understand what's being asked, not every word on the page.

## Explore Further: Root Words

Root words are the basic part of a word that gives it its main meaning. Prefixes (beginnings) and suffixes (endings) can be added to root words to create new words.

- **Root word "act"** (to do) → *action* (the process of doing something), *actor* (a person who performs in plays or movies)
- **Root word "graph"** (to write or draw) → *autograph* (a person's own signature), *photograph* (a picture made using a camera)
- **Root word "tele"** (far) → *telephone* (a device to talk to someone far away), *television* (a device to watch shows broadcast from far away)
- **Root word "bio"** (life) → *biology* (the study of living things), *biography* (the story of a person's life)

Understanding root words can help you figure out the meaning of new words when you see them.

## Vocabulary Review

- **Passage** — section of text or quote from a book or other written material
- **Text** — writing on a page
- **Vocabulary** — set of words you know or use
- **Context clues** — hints that can help you understand new words when you read a sentence or paragraph
- **Root word** — a basic word to which affixes (prefixes and suffixes) are added
- **Prefix** — word added to the beginning of a word
- **Suffix** — a word added to the end of a word
```

- [ ] **Step 2: Re-seed the language arts subject**

Run:
```bash
cd backend && npx tsx src/scripts/seed-quizzes.ts src/data/ged-language-arts.quiz.json
```
Expected: `Seeded ged-language-arts: 11 courses, 110 questions` (same counts as before — only the `content` column for `ged-language-arts-vocabulary-questions` changes).

- [ ] **Step 3: Verify in the running app**

Run the frontend dev server (`cd frontend && npm run dev`) and the backend, navigate to `/courses/ged-language-arts-vocabulary-questions`, and confirm:
- "In This Lesson", "Words to Know", "What Is Vocabulary?", etc. render as distinct headings (not inline text).
- The numbered six-step list renders as an `<ol>`.
- "Worked Example" and "Exam Tip" render as `<h3>`/`<h2>` respectively, nested correctly under their parent sections.

- [ ] **Step 4: Commit**

```bash
git add backend/src/data/content/ged-language-arts-vocabulary-questions.md
git commit -m "content: restructure vocabulary questions lesson as markdown with headings"
```

Note: re-seeding is a deploy-time/ops step, not something this commit does automatically — whoever deploys this change needs to run the Task 3 Step 2 command against the target database (same as any other `*.quiz.json` content change today).
