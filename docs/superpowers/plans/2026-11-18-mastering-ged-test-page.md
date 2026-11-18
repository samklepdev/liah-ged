# Mastering the GED Test Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show `backend/src/data/mastering-the-ged-test.pdf`'s content to the learner as a standalone page, outside the subjects/courses/quiz/certificate system.

**Architecture:** A one-time backend extraction script parses the PDF into a structured `Block[]` (heading/subheading/paragraph/bullets) and writes it as a generated TypeScript data file into the frontend. A new frontend page statically imports that file and renders it — no fetch, no API endpoint, no DB. A new top-level sidebar link and route make it reachable.

**Tech Stack:** Node (`node:test` + `node:assert/strict`) for the backend lib/tests, `tsx` to run the one-off script, `pdftotext -layout` (already a dependency of the existing GED import pipeline) for PDF extraction, React + Vitest + Testing Library for the frontend page/test, React Router for the route.

## Global Constraints

- No change to `backend/src/models/schema.ts`, `courses`/`subjects`/`certificates` tables, or `certificate.model.ts`'s eligibility logic.
- No backend API endpoint or database row for this content — the generated file is the only backend-to-frontend handoff, produced once and committed.
- No change to the `quiz-bank.json`/`quizzes.json` pipeline, `seed-quizzes.ts`, or the admin "Import quiz content" pipeline (`quiz-parser.ts`).
- Plain text blocks only — no markdown rendering, matching the existing lesson-content pages.
- The trailing `Source: ... © USAHello (CC BY-NC-SA 4.0)` attribution line and the `Source: vecteezee.com` image-credit line are dropped entirely, not rendered anywhere.

---

### Task 1: Parsing library — `mastering-the-ged-content.ts`

**Files:**
- Create: `backend/src/lib/mastering-ged-content.ts`
- Test: `backend/src/lib/mastering-ged-content.test.ts`

**Interfaces:**
- Produces: `export type Block = { type: 'heading'; text: string } | { type: 'subheading'; text: string } | { type: 'paragraph'; text: string } | { type: 'bullets'; items: string[] }`, `export function parseMasteringGedContent(pdfText: string): Block[]`, `export function assertExpectedStructure(blocks: Block[]): void` (throws if the block list doesn't contain exactly the expected number of headings/subheadings). Task 2 consumes all three.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/lib/mastering-ged-content.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --import tsx --test src/lib/mastering-ged-content.test.ts`
Expected: FAIL — `Cannot find module './mastering-ged-content.ts'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `backend/src/lib/mastering-ged-content.ts`:

```ts
export type Block =
  | { type: 'heading'; text: string }
  | { type: 'subheading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] };

const FOOTER_RE = /—\s*Page\s*\d+\s*$/;
const LESSON_HEADER_RE = /^Lesson \d+:.*$/;
const LESSON_META_RE = /^\s*\d+\s+topics?\s*·\s*\d+\s+quizzes?\s*$/i;
const SOURCE_RE = /^Source:/i;
const TITLE_LINE = 'Mastering the GED Test';

/**
 * The document's 9 topic-level section titles (the intro "What you'll
 * learn" bullets, plus the 5 topics under "Lesson 1" and 3 under "Lesson
 * 2" — the PDF's own Lesson/topic framing isn't surfaced in the UI, these
 * are just the real section breaks). Hard-coded rather than pattern-
 * matched: this is a one-time extraction of one fixed document, and
 * exact-matching known titles is far more reliable than guessing from
 * formatting.
 */
const HEADINGS = new Set<string>([
  "What you'll learn",
  'USAHello’s GED Preparatory Course',
  'GED Exam: From Signing Up to Receiving the Results',
  'An Overview of the GED Subjects',
  'Taking the GED Test: Online or In-Person',
  'Using the TI Calculator on the GED Math Test',
  'On the day of the test',
  'Test Skills',
  'Video resources',
]);

/** Bolded lead-in lines inside a topic, one level below HEADINGS. */
const SUBHEADINGS = new Set<string>([
  'Registering for the GED Test',
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
  'Tips to Stay Focused and Organized on GED Test Day',
  'Thinking Skills',
  'Math Skills',
  'Science Test Preparation',
  'Examples :',
  'Want to enable Spanish sub-titles?',
]);

/**
 * Drops page furniture: footers, the standalone "Lesson N: ..." / "N
 * topics · N quizzes" structural lines (not shown in the UI), image/
 * content attribution lines ("Source: ..."), and the document's own title
 * line (redundant with the page's own <h1>). pdftotext sometimes glues a
 * form-feed page-break marker onto the next line, so every form feed is
 * turned into a newline first — same fix as lib/ged-content.ts.
 */
function dropFurniture(pdfText: string): string[] {
  return pdfText
    .replace(/\f/g, '\n')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed === '') return true;
      if (trimmed === TITLE_LINE) return false;
      if (FOOTER_RE.test(trimmed)) return false;
      if (LESSON_HEADER_RE.test(trimmed)) return false;
      if (LESSON_META_RE.test(trimmed)) return false;
      if (SOURCE_RE.test(trimmed)) return false;
      return true;
    });
}

/**
 * Joins wrapped lines into one chunk per blank-line-separated run — the
 * same grouping toParagraphs() uses in ged-content.ts — kept as a list of
 * chunk strings rather than immediately joined, so each chunk can still be
 * classified individually below.
 */
function toChunks(lines: string[]): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === '') {
      if (current.length > 0) {
        chunks.push(current.join(' '));
        current = [];
      }
      continue;
    }
    current.push(trimmed);
  }
  if (current.length > 0) chunks.push(current.join(' '));
  return chunks;
}

/**
 * Classifies each chunk as a heading, subheading, bullet item, or
 * paragraph. Consecutive bullet chunks merge into one `bullets` block even
 * across the blank lines the source puts between them — only a heading,
 * subheading, or non-bullet paragraph closes an open bullets block.
 */
export function parseMasteringGedContent(pdfText: string): Block[] {
  const chunks = toChunks(dropFurniture(pdfText));
  const blocks: Block[] = [];
  let openBullets: { type: 'bullets'; items: string[] } | null = null;

  for (const chunk of chunks) {
    if (HEADINGS.has(chunk)) {
      openBullets = null;
      blocks.push({ type: 'heading', text: chunk });
    } else if (SUBHEADINGS.has(chunk)) {
      openBullets = null;
      blocks.push({ type: 'subheading', text: chunk });
    } else if (chunk.startsWith('•')) {
      const item = chunk.replace(/^•\s*/, '');
      if (openBullets) {
        openBullets.items.push(item);
      } else {
        openBullets = { type: 'bullets', items: [item] };
        blocks.push(openBullets);
      }
    } else {
      openBullets = null;
      blocks.push({ type: 'paragraph', text: chunk });
    }
  }

  return blocks;
}

/**
 * Throws if the parsed block list doesn't have exactly the expected number
 * of headings/subheadings. A real mismatch here means pdftotext rendered a
 * known title differently than expected (e.g. a quote character changed)
 * and it silently fell through to a `paragraph` block instead — this check
 * turns that into a loud failure instead of quietly losing a section
 * break.
 */
export function assertExpectedStructure(blocks: Block[]): void {
  const headings = blocks.filter((b) => b.type === 'heading').length;
  const subheadings = blocks.filter((b) => b.type === 'subheading').length;
  if (headings !== HEADINGS.size) {
    throw new Error(`Expected ${HEADINGS.size} heading blocks, found ${headings}.`);
  }
  if (subheadings !== SUBHEADINGS.size) {
    throw new Error(`Expected ${SUBHEADINGS.size} subheading blocks, found ${subheadings}.`);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --import tsx --test src/lib/mastering-ged-content.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/mastering-ged-content.ts backend/src/lib/mastering-ged-content.test.ts
git commit -m "Add mastering-the-ged-test PDF block parser"
```

---

### Task 2: Extraction script — generate the frontend content file

**Files:**
- Create: `backend/src/scripts/extract-mastering-content.ts`
- Modify: `backend/package.json` (add an npm script)

**Interfaces:**
- Consumes: `parseMasteringGedContent`, `assertExpectedStructure`, `type Block` from `../lib/mastering-ged-content.ts` (Task 1).
- Produces: `frontend/src/content/mastering-the-ged-test.ts`, exporting `export type MasteringGedBlock = ...` (structurally identical to `Block`) and `export const masteringGedContent: MasteringGedBlock[]`. Task 3 imports both names from this exact path.

- [ ] **Step 1: Write the script**

Create `backend/src/scripts/extract-mastering-content.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertExpectedStructure, parseMasteringGedContent } from '../lib/mastering-ged-content.ts';

const pdfPath = fileURLToPath(new URL('../data/mastering-the-ged-test.pdf', import.meta.url));
const pdfText = execFileSync('pdftotext', ['-layout', pdfPath, '-'], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});

const blocks = parseMasteringGedContent(pdfText);
assertExpectedStructure(blocks);

const outDir = fileURLToPath(new URL('../../../frontend/src/content/', import.meta.url));
mkdirSync(outDir, { recursive: true });
const outFile = `${outDir}mastering-the-ged-test.ts`;

const body = `// Generated by backend/src/scripts/extract-mastering-content.ts — do not hand-edit.
export type MasteringGedBlock =
  | { type: 'heading'; text: string }
  | { type: 'subheading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] };

export const masteringGedContent: MasteringGedBlock[] = ${JSON.stringify(blocks, null, 2)};
`;
writeFileSync(outFile, body, 'utf8');

console.log(
  `mastering-the-ged-test: ${blocks.length} blocks ` +
    `(${blocks.filter((b) => b.type === 'heading').length} headings, ` +
    `${blocks.filter((b) => b.type === 'subheading').length} subheadings, ` +
    `${blocks.filter((b) => b.type === 'bullets').length} bullet lists) ` +
    `-> frontend/src/content/mastering-the-ged-test.ts`,
);
```

- [ ] **Step 2: Add the npm script**

In `backend/package.json`, add this line to `"scripts"` (next to the existing `"ged:import"` line):

```json
"ged:extract-mastering": "tsx src/scripts/extract-mastering-content.ts",
```

- [ ] **Step 3: Run it and verify the generated file**

Run: `cd backend && npm run ged:extract-mastering`
Expected: prints a line like `mastering-the-ged-test: 73 blocks (9 headings, 18 subheadings, 14 bullet lists) -> frontend/src/content/mastering-the-ged-test.ts` — the exact total/bullet-list count can differ slightly from this example, but **9 headings** and **18 subheadings** must appear exactly (that's what `assertExpectedStructure` already guarantees — if the script exits with a thrown error instead of this line, a known title didn't match verbatim against the real pdftotext output; compare the thrown count against the 9/18 lists in `mastering-ged-content.ts` and fix any character that differs, most likely a quote/dash variant).

Then spot-check the output file directly:

```bash
grep -c "\"type\": \"heading\"" frontend/src/content/mastering-the-ged-test.ts
grep -c "\"type\": \"subheading\"" frontend/src/content/mastering-the-ged-test.ts
grep -A1 "An Overview of the GED Subjects" frontend/src/content/mastering-the-ged-test.ts | head -5
```

Confirm the heading/subheading counts are 9 and 18, and that the "An Overview of the GED Subjects" heading is immediately followed by real sentence content (not leftover page-footer or "Lesson" text).

- [ ] **Step 4: Commit**

```bash
git add backend/src/scripts/extract-mastering-content.ts backend/package.json frontend/src/content/mastering-the-ged-test.ts
git commit -m "Extract mastering-the-ged-test.pdf into a generated frontend content file"
```

---

### Task 3: Frontend page — `MasteringGedTestPage`

**Files:**
- Create: `frontend/src/pages/MasteringGedTestPage.tsx`
- Test: `frontend/src/pages/MasteringGedTestPage.test.tsx`
- Modify: `frontend/src/App.css`

**Interfaces:**
- Consumes: `masteringGedContent`, `type MasteringGedBlock` from `../content/mastering-the-ged-test` (Task 2's generated file).
- Produces: `export function MasteringGedTestPage()` (no props). Task 4 wires this into the router.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/MasteringGedTestPage.test.tsx`:

```tsx
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MasteringGedTestPage } from './MasteringGedTestPage';

vi.mock('../content/mastering-the-ged-test', () => ({
  masteringGedContent: [
    { type: 'heading', text: 'Section One' },
    { type: 'paragraph', text: 'Some paragraph text.' },
    { type: 'subheading', text: 'A sub-section' },
    { type: 'bullets', items: ['First item', 'Second item'] },
  ],
}));

describe('MasteringGedTestPage', () => {
  test('renders the page title and each block type', () => {
    render(<MasteringGedTestPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Mastering the GED Test' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Section One' })).toBeInTheDocument();
    expect(screen.getByText('Some paragraph text.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'A sub-section' })).toBeInTheDocument();
    expect(screen.getByText('First item')).toBeInTheDocument();
    expect(screen.getByText('Second item')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/MasteringGedTestPage.test.tsx`
Expected: FAIL — `Failed to resolve import "./MasteringGedTestPage"`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/pages/MasteringGedTestPage.tsx`:

```tsx
import { masteringGedContent, type MasteringGedBlock } from '../content/mastering-the-ged-test';

function Block({ block }: { block: MasteringGedBlock }) {
  switch (block.type) {
    case 'heading':
      return <h2>{block.text}</h2>;
    case 'subheading':
      return <h3>{block.text}</h3>;
    case 'paragraph':
      return <p>{block.text}</p>;
    case 'bullets':
      return (
        <ul>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
  }
}

export function MasteringGedTestPage() {
  return (
    <div className="course-content mastering-ged-page">
      <h1>Mastering the GED Test</h1>
      <div className="course-content-body mastering-ged-body">
        {masteringGedContent.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>
    </div>
  );
}
```

Then append to `frontend/src/App.css`, directly after the existing `.course-content .primary { ... }` rule:

```css
.mastering-ged-body h2 { margin: 1.75rem 0 0.5rem; }
.mastering-ged-body h2:first-child { margin-top: 0; }
.mastering-ged-body h3 { margin: 1.25rem 0 0.5rem; font-size: 1rem; }
.mastering-ged-body ul {
  margin: 0;
  padding-left: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.mastering-ged-body li { line-height: 1.6; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/MasteringGedTestPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/MasteringGedTestPage.tsx frontend/src/pages/MasteringGedTestPage.test.tsx frontend/src/App.css
git commit -m "Add the Mastering the GED Test content page"
```

---

### Task 4: Wire the route and sidebar link

**Files:**
- Modify: `frontend/src/router.tsx`
- Modify: `frontend/src/shell/SidebarNav.tsx`
- Modify: `frontend/src/shell/AppShell.test.tsx`

**Interfaces:**
- Consumes: `MasteringGedTestPage` from `./pages/MasteringGedTestPage` (Task 3); `ClipboardIcon` from `./icons` (already defined — reused rather than adding a new icon).

- [ ] **Step 1: Write the failing test**

In `frontend/src/shell/AppShell.test.tsx`, add this `describe` block after the existing `describe('AppShell — top navbar', ...)` block:

```tsx
describe('AppShell — sidebar', () => {
  test('links to the Mastering the GED Test page', async () => {
    renderAt();
    const sidebar = await nav();
    expect(within(sidebar).getByRole('link', { name: 'Mastering the GED Test' })).toHaveAttribute(
      'href',
      '/mastering-the-ged-test',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/shell/AppShell.test.tsx`
Expected: FAIL — no element found with the role/name `link, "Mastering the GED Test"`.

- [ ] **Step 3: Add the route**

In `frontend/src/router.tsx`, add the import next to the other page imports:

```tsx
import { MasteringGedTestPage } from './pages/MasteringGedTestPage';
```

Add the route inside the `AppShell`-wrapped route group, next to `/subjects`:

```tsx
<Route path="/subjects" element={<SubjectsIndexPage />} />
<Route path="/mastering-the-ged-test" element={<MasteringGedTestPage />} />
```

- [ ] **Step 4: Add the sidebar link**

In `frontend/src/shell/SidebarNav.tsx`, add `ClipboardIcon` to the existing icons import:

```tsx
import { BookIcon, ChartIcon, ChevronRightIcon, ClipboardIcon, SubjectIcon } from './icons';
```

Add a new `<li>` right after the "My Progress" `<li>` and before the `nav.error`/subjects block:

```tsx
<li>
  <NavLink to="/progress" onClick={onNavigate} className={itemClass}>
    <ChartIcon className="nav-icon" />
    <span className="nav-label">My Progress</span>
  </NavLink>
</li>

<li>
  <NavLink to="/mastering-the-ged-test" onClick={onNavigate} className={itemClass}>
    <ClipboardIcon className="nav-icon" />
    <span className="nav-label">Mastering the GED Test</span>
  </NavLink>
</li>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/shell/AppShell.test.tsx`
Expected: PASS — all tests in the file green, including the new one.

- [ ] **Step 6: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: PASS — no regressions in `router.test.tsx` or elsewhere.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/router.tsx frontend/src/shell/SidebarNav.tsx frontend/src/shell/AppShell.test.tsx
git commit -m "Link the Mastering the GED Test page from the sidebar"
```
