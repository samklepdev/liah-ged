# Topic video embeds — design

## Context

The GED content pipeline (PDF → `pdftohtml` → `extractLessonTopics` →
`ged-*.quiz.json` → `quiz:seed` → Postgres → API → frontend) has always
treated video references as scraper noise: `ged-content.ts`'s
`stripVideoReferences`/`stripVideoPrompts` drop "Video: X" lead-ins and
"watch the video" sentences outright, on the premise that "the content page
never embeds a video."

The source PDFs just changed: `ged-language-arts.pdf`, `ged-math.pdf`,
`ged-science.pdf`, and `ged-social-studies.pdf` now contain real YouTube
links (confirmed via `pdftohtml -i -s -stdout`), each rendered as its own
paragraph immediately after a video's heading:

```html
<p ...><i><b>Video: Sequence of Events</b></i></p>
<p ...>■&#160;<a href="https://www.youtube.com/watch?v=WTZh-xKpEEE"><b>Watch video</b>&#160;&#160;</a>https://www.youtube.com/watch?v=WTZh-xKpEEE</p>
<p ...>Watch this video to learn more about the sequence of events when reading a story.</p>
```

This pattern repeats 26–36 times per subject PDF (confirmed across all
four). Not every video-link paragraph follows a heading literally titled
"Video: X" — e.g. social studies has "I Have A Dream" and "The Progressives
– Video" — so attachment must be positional (whatever topic is currently
open when the link paragraph is seen), not title-matched. Link counts and
heading counts are close but not identical across subjects, confirming video
headings aren't a fixed naming scheme.

No evidence of more than one video link per topic in any subject.

This generalizes a one-off trial already shipped: a single hardcoded
`TOPIC_VIDEOS` map in `frontend/src/pages/TopicPage.tsx` renders one
specific topic's embed. That hack is replaced by a real field end-to-end.

## Decisions

1. **Keep "watch the video" instructional sentences in lesson text.** The
   premise that justified stripping them ("no video is ever shown") is now
   false — they're accurate instructions once a player sits above them.
   `stripVideoPrompts` stops removing them; its doc comment is corrected.
   `stripVideoReferences` keeps dropping the bare "Video: X" lead-in
   paragraph and unwrapping "Video Transcript + …" — those jobs are
   unrelated to the premise change.
2. **Player renders above the topic's text content**, matching source
   reading order (link paragraph precedes the caption paragraph in the
   PDF).
3. **One nullable `videoUrl` field per topic**, not an array — matches the
   observed 1-link-per-topic reality and the existing one-field-per-concern
   shape of `ParsedTopic`/the `topics` table.
4. Store the **raw YouTube URL** (not a bare video ID) in data/DB; the
   frontend derives the embed ID at render time. Keeps the stored value
   human-readable and provider-agnostic if a non-YouTube link ever shows up.

## Changes

### Parser (`backend/src/lib/ged-html-content.ts`, `ged-content.ts`)

- In `extractLessonTopics`, recognize the `■ Watch video` anchor paragraph
  by its raw HTML (before `cleanParagraph`/`htmlToMarkdown` strips tags):
  `<a href="(https://www\.youtube\.com/watch\?v=...|https://youtu\.be/...)">`.
  When matched: set `currentTopic.videoUrl` to the href, and do **not** push
  that paragraph into `currentTopic.paragraphs` (the link text and the
  duplicated plain-text URL after it are pure chrome once a player exists).
- `flushTopic` carries `videoUrl` onto the pushed `ParsedTopic`.
- `stripVideoPrompts` (`ged-content.ts`): remove the three regexes that
  delete "watch the video…"/"click here to watch…" sentences. Fix its doc
  comment (currently claims no video is ever shown).
- `stripVideoReferences`: unchanged behavior, comment adjusted to not assert
  the now-false premise.

### Data model & plumbing

- `ParsedTopic` (`backend/src/lib/quiz-parser.ts`): add
  `videoUrl: string | null`.
- `topics` table (`backend/src/models/schema.ts`): add nullable
  `videoUrl: text('video_url')` column. New migration via `db:generate`.
- `seed-quizzes.ts`: topic insert gets `videoUrl: topic.videoUrl ?? null`.
- `findTopic` / `TopicDetail` (`backend/src/models/catalog.model.ts`):
  select and expose `videoUrl`.
- `TopicDetail` (`frontend/src/quiz/api.ts`): add `videoUrl: string | null`.

### Frontend (`frontend/src/pages/TopicPage.tsx`, `App.css`)

- Delete the hardcoded `TOPIC_VIDEOS` map and its lookup.
- Add a small helper to extract a YouTube video ID from
  `watch?v=` and `youtu.be/` URL forms.
- When `topic.videoUrl` is present, render the existing
  `.course-video-embed` iframe block (unchanged CSS) **before**
  `topic.content`, instead of after it.

### Regeneration & seeding

1. `npm run db:generate -w backend` then `npm run db:push -w backend` (or
   equivalent) to apply the new column locally.
2. `npm run ged:import -w backend` to regenerate all four
   `ged-*.quiz.json` files from the updated PDFs + `quiz-bank.json`.
3. `npm run quiz:seed` to reseed Postgres with the regenerated JSON.

### Testing

- `ged-html-content.test.ts`: video link is captured as `videoUrl` and
  excluded from content; a non-"Video:"-titled heading still captures its
  trailing link; a topic with no video link gets `videoUrl: null`.
- `TopicPage.test.tsx`: renders the iframe above content when `videoUrl` is
  set; renders nothing when it's null. Drop any coverage that existed only
  for the removed hardcoded map.
- Manual spot-check of a couple of real topics per subject after reseeding.

## Out of scope

- `quiz-bank.json`/`quizzes.json` (the separate "Pop Quiz" PDF pipeline via
  `quiz:parse`) — confirmed no YouTube links in that data; untouched.
- Multiple videos per topic, non-YouTube providers, inline video placement
  within markdown — no evidence any of these exist in the current source
  data.
