# Topic Video Embeds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract real YouTube links from the GED subject PDFs during parsing, store them per-topic, and render an embedded player above each topic's text content on the topic page.

**Architecture:** The existing PDF → HTML → `ParsedTopic[]` → JSON → Postgres → API → React pipeline gains one new nullable field (`videoUrl`) carried end-to-end. The parser detects a specific anchor-paragraph pattern pdftohtml emits (`■ Watch video` linking to a YouTube URL) and pulls it out of the paragraph stream into that field instead of into the topic's text content.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres), Express, React 19 + Vite, Node's built-in `node:test` (backend), Vitest + Testing Library (frontend).

## Global Constraints

- Scope is the 4 `ged-*.pdf` → topics pipeline only (`ged-language-arts`, `ged-math`, `ged-science`, `ged-social-studies`). `mastering-the-ged-test.pdf`'s separate block-based static-page pipeline is explicitly out of scope (follow-up later).
- "Watch the video"/"click here to watch" instructional sentences stay in lesson text — do not strip them.
- Player renders above the topic's text content, not below.
- One nullable `videoUrl: string | null` per topic (not an array) — store the raw URL, not a bare video ID.
- No changes to `quiz-bank.json`/`quizzes.json` or their pipeline (`quiz:parse`) — confirmed no YouTube links there.

---

### Task 1: Parser — extract video links, stop stripping "watch video" prompts

**Files:**
- Modify: `backend/src/lib/ged-content.ts`
- Modify: `backend/src/lib/ged-html-content.ts`
- Modify: `backend/src/lib/ged-content.test.ts`
- Modify: `backend/src/lib/ged-html-content.test.ts`
- Modify: `backend/src/lib/quiz-parser.ts:630`

**Interfaces:**
- Produces: `ParsedTopic = { title: string; content: string | null; videoUrl?: string | null }` (optional field, so every other existing construction site of `ParsedTopic` literals keeps compiling unchanged).
- Produces: `extractLessonTopics(html, quizTitlesByLesson?)` now returns topics whose `videoUrl` is set when a `■ Watch video` anchor paragraph was found between that topic's heading and the next one.

- [ ] **Step 1: Widen the `ParsedTopic` type**

Edit `backend/src/lib/quiz-parser.ts:630`:

```ts
export type ParsedTopic = { title: string; content: string | null; videoUrl?: string | null };
```

- [ ] **Step 2: Write the failing parser tests**

Replace the test `'extractLessonTopics strips video prompts and caption instructions from a topic body'` in `backend/src/lib/ged-html-content.test.ts` (currently lines 75-88) with:

```ts
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
```

Then add three new tests at the end of the same file, before the final closing of the file (after the `'extractLessonTopics splits multiple lessons independently'` test):

```ts
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
```

In `backend/src/lib/ged-content.test.ts`, delete these five tests entirely (lines 38-62): `'stripVideoPrompts removes a prompt attached after a lead-in, keeping the lead-in'`, `'stripVideoPrompts drops a paragraph that is only a video prompt'`, `'stripVideoPrompts handles a prompt with no trailing period, up to the paragraph end'`, `'stripVideoPrompts removes a "click here to watch" prompt'`, `'stripVideoPrompts leaves unrelated content alone'`. Remove `stripVideoPrompts` from the import list at the top of the file (line 6).

- [ ] **Step 2b: Run the tests to verify they fail**

Run (from `backend/`): `node --import tsx --test --test-name-pattern="extractLessonTopics" src/lib/ged-html-content.test.ts`
Expected: FAIL — `videoUrl` is `undefined` (not yet produced), and the rewritten "keeps watch the video prompts" test still sees the prompt stripped by the old `stripVideoPrompts` call.

- [ ] **Step 3: Implement the extraction in `ged-html-content.ts`**

In `backend/src/lib/ged-html-content.ts`, remove `stripVideoPrompts` from the import on line 1-8:

```ts
import {
  assertNoLeakedQuestions,
  isQuizNoiseLine,
  stripCaptionInstructions,
  stripVideoReferences,
  toParagraphs,
} from './ged-content.ts';
import type { ParsedTopic } from './quiz-parser.ts';
```

Add this constant after `cleanParagraph` (after line 98, before the `extractLessonTopics` doc comment):

```ts
/** Matches the "■ Watch video" anchor paragraph pdftohtml emits right after
 *  a video topic's heading, e.g.
 *  `■&#160;<a href="https://www.youtube.com/watch?v=ID"><b>Watch video</b>...`.
 *  Captures the href so the player can embed it — the whole paragraph,
 *  including the duplicated plain-text URL that follows the link, is pure
 *  scraper chrome once a real player renders it, so it's excluded from
 *  content entirely rather than kept as text. */
const VIDEO_LINK_RE = /<a href="([^"]+)">\s*<b>\s*Watch video\s*<\/b>/i;
```

Replace the `extractLessonTopics` doc comment (lines 100-114) with:

```ts
/**
 * Splits a subject's pdftohtml output into one lesson per "Lesson N:"
 * heading, each broken further into one topic per bold+italic heading in
 * reading order — "In this lesson…", "Words to know", "Video: X",
 * "Quiz on Video: X", everything. A topic's content is every paragraph
 * between it and the next heading, cleaned of quiz-widget noise and
 * caption-instruction references; null if nothing survives that cleaning.
 * A "■ Watch video" link paragraph is captured into the topic's videoUrl
 * instead of its content — see VIDEO_LINK_RE — and attaches to whichever
 * topic is currently open, regardless of that topic's title.
 *
 * quizTitlesByLesson (from quiz-bank.json) forces content to null for a
 * topic whose title is one of that lesson's own quiz headings — those
 * bodies are Q&A dumps of a quiz already modeled properly elsewhere as real
 * questions, and a quiz's explanation text can continue across a page break
 * into a paragraph with no noise marker of its own, which the line-level
 * noise check alone cannot catch.
 */
```

Replace the function body (from `export function extractLessonTopics` to its closing brace, lines 115-162) with:

```ts
export function extractLessonTopics(
  html: string,
  quizTitlesByLesson: Map<string, string[]> = new Map(),
): Map<string, ParsedTopic[]> {
  const paragraphs = parseParagraphs(html);
  const lessons = new Map<string, ParsedTopic[]>();

  let currentLessonTitle: string | null = null;
  let currentTopic: { title: string; paragraphs: string[]; videoUrl: string | null } | null = null;

  const flushTopic = () => {
    if (!currentTopic || currentLessonTitle === null) return;
    const isQuizTopic = (quizTitlesByLesson.get(currentLessonTitle) ?? []).includes(
      currentTopic.title,
    );
    const raw = currentTopic.paragraphs.join('\n\n');
    const cleaned = isQuizTopic ? '' : stripCaptionInstructions(stripVideoReferences(toParagraphs(raw)));
    const topics = lessons.get(currentLessonTitle)!;
    topics.push({
      title: currentTopic.title,
      content: cleaned.length > 0 ? cleaned : null,
      videoUrl: currentTopic.videoUrl,
    });
  };

  for (const p of paragraphs) {
    if (p.lessonTitle !== null) {
      flushTopic();
      currentLessonTitle = `Lesson ${LESSON_RE.exec(p.html)![1]}: ${p.lessonTitle}`;
      lessons.set(currentLessonTitle, []);
      currentTopic = null;
      continue;
    }
    if (currentLessonTitle === null) continue; // content before the first lesson heading

    if (p.heading !== null) {
      flushTopic();
      currentTopic = { title: p.heading, paragraphs: [], videoUrl: null };
      continue;
    }

    if (currentTopic === null) continue; // stray content before this lesson's first heading

    const videoMatch = VIDEO_LINK_RE.exec(p.html);
    if (videoMatch) {
      currentTopic.videoUrl = videoMatch[1]!;
      continue;
    }

    const cleaned = cleanParagraph(p.html);
    if (cleaned !== null) currentTopic.paragraphs.push(cleaned);
  }
  flushTopic();

  return lessons;
}

export { assertNoLeakedQuestions };
```

- [ ] **Step 4: Update `ged-content.ts`**

In `backend/src/lib/ged-content.ts`, delete the entire `stripVideoPrompts` function (currently lines 111-136, from its doc comment through its closing brace).

Replace the `stripVideoReferences` doc comment (lines 47-53) with:

```ts
/**
 * Drops "Video: <title>" lead-in paragraphs and "(no text content —
 * video or interactive topic)" placeholders entirely — pure scraper
 * artifacts — and unwraps a "Video Transcript(s) + <text>" label down to
 * just <text>, keeping the transcript itself since it's real lesson
 * content.
 */
```

Replace the `stripCaptionInstructions` doc comment (lines 69-70) with:

```ts
/** Drops paragraphs of closed-captions/subtitle-toggling instructions aimed
 *  at the video player's own UI chrome — not lesson content. */
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `backend/`): `node --import tsx --test src/lib/ged-content.test.ts src/lib/ged-html-content.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/ged-content.ts backend/src/lib/ged-content.test.ts backend/src/lib/ged-html-content.ts backend/src/lib/ged-html-content.test.ts backend/src/lib/quiz-parser.ts
git commit -m "Extract video links from GED PDFs into topic videoUrl"
```

---

### Task 2: Persist `videoUrl` — schema, migration, seed

**Files:**
- Modify: `backend/src/models/schema.ts:115-132` (the `topics` table)
- Modify: `backend/src/scripts/seed-quizzes.ts:107-117`
- Modify: `backend/src/scripts/seed-quizzes.test.ts`
- Create: a new Drizzle migration under `backend/drizzle/` (filename generated by `drizzle-kit`)

**Interfaces:**
- Consumes: `ParsedTopic.videoUrl` from Task 1.
- Produces: `topics.videoUrl` column (nullable `text`), used by `findTopic` in Task 3.

- [ ] **Step 1: Write the failing seed test**

Replace the test `'seedSubject inserts each course\'s topics in order, with their content'` in `backend/src/scripts/seed-quizzes.test.ts` (currently lines 97-130) with:

```ts
test('seedSubject inserts each course\'s topics in order, with their content and video url', async () => {
  const withTopics: ParsedSubject = {
    slug: 'ged-demo',
    title: 'GED Demo',
    courses: [
      {
        position: 1,
        slug: 'ged-demo-course',
        title: 'Demo Course',
        questionCount: 0,
        moduleTitles: ['Reading'],
        topics: [
          { title: 'In this lesson…', content: 'You will learn things.' },
          {
            title: 'Video: Example',
            content: null,
            videoUrl: 'https://www.youtube.com/watch?v=abc123',
          },
        ],
        questions: [],
      },
    ],
  };

  await seedSubject(withTopics);

  const rows = await db
    .select({
      position: topics.position,
      title: topics.title,
      content: topics.content,
      videoUrl: topics.videoUrl,
    })
    .from(topics)
    .innerJoin(courses, eq(courses.id, topics.courseId))
    .where(eq(courses.slug, 'ged-demo-course'))
    .orderBy(topics.position);

  assert.deepEqual(rows, [
    { position: 1, title: 'In this lesson…', content: 'You will learn things.', videoUrl: null },
    {
      position: 2,
      title: 'Video: Example',
      content: null,
      videoUrl: 'https://www.youtube.com/watch?v=abc123',
    },
  ]);
});
```

- [ ] **Step 2: Add the schema column**

In `backend/src/models/schema.ts`, in the `topics` table definition, add a line after `content: text('content'),` (currently line 127):

```ts
  content: text('content'),
  /** The lesson's video link (e.g. a YouTube watch URL), extracted from the
   *  source PDF. Null for topics with no video. */
  videoUrl: text('video_url'),
```

- [ ] **Step 3: Generate and apply the migration**

Run: `npm run db:generate -w backend`
Expected: a new file appears under `backend/drizzle/` (e.g. `000X_<name>.sql`) containing `ALTER TABLE "topics" ADD COLUMN "video_url" text;`, plus an updated `backend/drizzle/meta/_journal.json`.

Run: `npm run db:push -w backend` to apply it to the local dev database.
Run: `npm run db:push:test -w backend` to apply it to the test database, since `seed-quizzes.test.ts` runs against it.

- [ ] **Step 4: Update the seed insert**

In `backend/src/scripts/seed-quizzes.ts`, in the `topics.map(...)` call inside `seedSubject` (currently lines 108-116):

```ts
        await tx.insert(topics).values(
          course.topics.map((topic, index) => ({
            courseId,
            position: index + 1,
            title: topic.title,
            content: topic.content,
            videoUrl: topic.videoUrl ?? null,
            moduleId: moduleIdByTitle.get(topic.title) ?? null,
          })),
        );
```

- [ ] **Step 5: Run the test to verify it passes**

Run (from `backend/`): `node --import tsx --env-file=.env.test --test src/scripts/seed-quizzes.test.ts`
Expected: PASS, all tests green (including the rewritten topics test).

- [ ] **Step 6: Commit**

```bash
git add backend/src/models/schema.ts backend/src/scripts/seed-quizzes.ts backend/src/scripts/seed-quizzes.test.ts backend/drizzle/
git commit -m "Add nullable video_url column to topics and seed it"
```

---

### Task 3: Expose `videoUrl` from the catalog API

**Files:**
- Modify: `backend/src/models/catalog.model.ts:205-258`
- Modify: `backend/src/models/catalog.model.test.ts`

**Interfaces:**
- Consumes: `topics.videoUrl` column from Task 2.
- Produces: `TopicDetail.videoUrl: string | null`, consumed by the frontend in Task 4.

- [ ] **Step 1: Write the failing tests**

In `backend/src/models/catalog.model.test.ts`, update the `assert.deepEqual` expected object in `'findTopic returns one topic with its course/subject context and the next topic'` (currently lines 94-103) to add `videoUrl: null,` after `content: 'Overview text.',`:

```ts
  assert.deepEqual(topic, {
    position: 1,
    title: 'In this lesson…',
    content: 'Overview text.',
    videoUrl: null,
    courseSlug: 'ged-demo-course',
    courseTitle: 'Demo Course',
    subjectSlug: 'ged-demo',
    next: { position: 2, title: 'Words to know' },
    practiceQuestions: null,
  });
```

Add a new test right after it (after that test's closing `});`):

```ts
test('findTopic returns the topic\'s video url when it has one', async () => {
  await seedSubject({
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
          {
            title: 'Video: Example',
            content: null,
            videoUrl: 'https://www.youtube.com/watch?v=abc123',
          },
        ],
        questions: [],
      },
    ],
  });

  const topic = await findTopic('ged-demo-course', 1);
  assert.equal(topic?.videoUrl, 'https://www.youtube.com/watch?v=abc123');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `backend/`): `node --import tsx --env-file=.env.test --test --test-name-pattern="findTopic" src/models/catalog.model.test.ts`
Expected: FAIL — `videoUrl` is `undefined` on the returned object (not yet selected).

- [ ] **Step 3: Implement**

In `backend/src/models/catalog.model.ts`, add `videoUrl: string | null;` to the `TopicDetail` type (currently lines 205-218), after `content: string | null;`:

```ts
export type TopicDetail = {
  position: number;
  title: string;
  content: string | null;
  videoUrl: string | null;
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
```

In `findTopic`'s select (currently lines 224-233), add `videoUrl: topics.videoUrl,` after `content: topics.content,`:

```ts
  const [row] = await db
    .select({
      position: topics.position,
      title: topics.title,
      content: topics.content,
      videoUrl: topics.videoUrl,
      moduleId: topics.moduleId,
      courseId: courses.id,
      courseSlug: courses.slug,
      courseTitle: courses.title,
      subjectSlug: subjects.slug,
    })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `backend/`): `node --import tsx --env-file=.env.test --test src/models/catalog.model.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/catalog.model.ts backend/src/models/catalog.model.test.ts
git commit -m "Expose topic videoUrl from findTopic"
```

---

### Task 4: Render the player on the topic page

**Files:**
- Modify: `frontend/src/quiz/api.ts:49-58`
- Modify: `frontend/src/pages/TopicPage.tsx`
- Modify: `frontend/src/pages/TopicPage.test.tsx`

**Interfaces:**
- Consumes: `TopicDetail.videoUrl: string | null` from the API (Task 3).
- Produces: nothing consumed elsewhere — this is the leaf of the pipeline.

- [ ] **Step 1: Add `videoUrl` to the frontend type**

In `frontend/src/quiz/api.ts`, add `videoUrl: string | null;` to `TopicDetail` (currently lines 49-58), after `content: string | null;`:

```ts
export type TopicDetail = {
  position: number;
  title: string;
  content: string | null;
  videoUrl: string | null;
  courseSlug: string;
  courseTitle: string;
  subjectSlug: string;
  next: { position: number; title: string } | null;
  practiceQuestions: PracticeQuestion[] | null;
};
```

- [ ] **Step 2: Write the failing frontend tests**

In `frontend/src/pages/TopicPage.test.tsx`, add `videoUrl: null,` to the `makeTopicDetail` default object (currently lines 17-29), after `content: 'You will learn about vocabulary.',`:

```ts
function makeTopicDetail(overrides: Partial<TopicDetail> = {}): TopicDetail {
  return {
    position: 1,
    title: 'In this lesson…',
    content: 'You will learn about vocabulary.',
    videoUrl: null,
    courseSlug: 'ged-language-arts-vocabulary-questions',
    courseTitle: 'Vocabulary Questions',
    subjectSlug: 'ged-language-arts',
    next: { position: 2, title: 'Words to know' },
    practiceQuestions: null,
    ...overrides,
  };
}
```

Add these three tests inside the `describe('TopicPage', ...)` block, after the existing `'shows the topic title and content'` test:

```ts
  test('shows a video embed above the content when the topic has a video url', async () => {
    getTopic.mockResolvedValue({
      topic: makeTopicDetail({
        content: 'Watch this video to learn more.',
        videoUrl: 'https://www.youtube.com/watch?v=WTZh-xKpEEE',
      }),
    });
    renderPage();

    const iframe = await screen.findByTitle('In this lesson…');
    expect(iframe).toHaveAttribute('src', 'https://www.youtube.com/embed/WTZh-xKpEEE');

    const content = await screen.findByText('Watch this video to learn more.');
    // eslint-disable-next-line no-bitwise
    expect(iframe.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('derives the embed id from a youtu.be short link', async () => {
    getTopic.mockResolvedValue({
      topic: makeTopicDetail({ videoUrl: 'https://youtu.be/WTZh-xKpEEE' }),
    });
    renderPage();
    const iframe = await screen.findByTitle('In this lesson…');
    expect(iframe).toHaveAttribute('src', 'https://www.youtube.com/embed/WTZh-xKpEEE');
  });

  test('shows no video embed when the topic has no video url', async () => {
    renderPage();
    await screen.findByText('In this lesson…');
    expect(screen.queryByTitle('In this lesson…')).not.toBeInTheDocument();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test:web -- TopicPage`
Expected: FAIL — no iframe is rendered (the old `TOPIC_VIDEOS` map doesn't match `'ged-language-arts-vocabulary-questions:1'`, and there's no `videoUrl`-driven rendering yet).

- [ ] **Step 4: Implement**

Replace the full contents of `frontend/src/pages/TopicPage.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { quizApi, type TopicDetail } from '../quiz/api';
import { PracticeQuiz } from '../quiz/PracticeQuiz';

type Key = { slug: string; position: string };

type State =
  | { kind: 'ready'; key: Key; topic: TopicDetail }
  | { kind: 'error'; key: Key; message: string };

/** Pulls the video ID out of a YouTube watch or short link, e.g.
 *  "https://www.youtube.com/watch?v=ID" or "https://youtu.be/ID". */
function youTubeEmbedId(url: string): string | null {
  const match = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/.exec(url);
  return match?.[1] ?? null;
}

export function TopicPage() {
  const { slug = '', position = '' } = useParams();
  const [state, setState] = useState<State | null>(null);

  const key: Key = { slug, position };
  const current = state && state.key.slug === slug && state.key.position === position ? state : null;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { topic } = await quizApi.getTopic(slug, Number(position));
        if (!cancelled) setState({ kind: 'ready', key, topic });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: 'error',
            key,
            message: err instanceof Error ? err.message : 'Could not load this topic',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, position]);

  if (current === null) return <div className="auth-loading">Loading…</div>;
  if (current.kind === 'error') {
    return (
      <p role="alert" className="auth-error">
        {current.message}
      </p>
    );
  }

  const { topic } = current;
  const videoId = topic.videoUrl ? youTubeEmbedId(topic.videoUrl) : null;

  return (
    <div className="course-content">
      <Link to={`/courses/${topic.courseSlug}`} className="course-topic-back">
        {topic.courseTitle}
      </Link>
      <h1>{topic.title}</h1>

      {videoId && (
        <div className="course-video-embed">
          <iframe
            src={`https://www.youtube.com/embed/${videoId}`}
            title={topic.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

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
}
```

(`App.css`'s existing `.course-video-embed` rule, added during the earlier one-off trial, needs no changes — it already gives a centered, responsive 16:9 box.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:web -- TopicPage`
Expected: PASS, all tests green.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/quiz/api.ts frontend/src/pages/TopicPage.tsx frontend/src/pages/TopicPage.test.tsx
git commit -m "Render topic video embeds from the real videoUrl field"
```

---

### Task 5: Regenerate content from the new PDFs and reseed

**Files:**
- Regenerates: `backend/src/data/ged-language-arts.quiz.json`, `ged-math.quiz.json`, `ged-science.quiz.json`, `ged-social-studies.quiz.json`

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: the live local database state used for manual verification.

- [ ] **Step 1: Regenerate the JSON from the new PDFs**

Run: `npm run ged:import -w backend`
Expected output: a line per subject like
`ged-language-arts: N courses, M questions, K topics -> src/data/ged-language-arts.quiz.json`
for all four subjects, with no thrown `assertNoLeakedQuestions` error.

- [ ] **Step 2: Spot-check the regenerated JSON**

Run: `grep -c '"videoUrl"' backend/src/data/ged-language-arts.quiz.json`
Expected: a count greater than 0 (video URLs are present).

Run: `grep -A2 '"title": "Video: Sequence of Events"' backend/src/data/ged-language-arts.quiz.json`
Expected: the topic's JSON shows `"videoUrl": "https://www.youtube.com/watch?v=WTZh-xKpEEE"` and `"content"` holding only the caption sentence (no "■ Watch video" text or bare duplicated URL).

- [ ] **Step 3: Reseed the database**

Run: `npm run quiz:seed`
Expected output: a success line per subject with course/question counts, no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm run test`
Expected: PASS, all backend and frontend tests green.

- [ ] **Step 5: Manual verification**

Start the app: `npm run dev`
Visit `http://localhost:5173/courses/ged-language-arts-sequence-and-cause-and-effect/topics/5` (the "Video: Sequence of Events" topic used in the earlier one-off trial).
Expected: the YouTube player renders above the caption text, centered, 16:9.

Visit `http://localhost:5173/courses/ged-language-arts-vocabulary-questions/topics/1` (a topic with no video, e.g. "In this lesson…").
Expected: no embed box renders, only text.

- [ ] **Step 6: Commit the regenerated data**

```bash
git add backend/src/data/ged-language-arts.quiz.json backend/src/data/ged-math.quiz.json backend/src/data/ged-science.quiz.json backend/src/data/ged-social-studies.quiz.json backend/src/data/ged-language-arts.pdf backend/src/data/ged-math.pdf backend/src/data/ged-science.pdf backend/src/data/ged-social-studies.pdf backend/src/data/mastering-the-ged-test.pdf backend/src/data/quiz-bank.json backend/src/data/quizzes.json
git commit -m "Regenerate GED content with video links from updated source PDFs"
```
