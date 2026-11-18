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
 *
 * A line that exactly matches a known heading or subheading is always its
 * own isolated chunk, even with no blank line around it: the source often
 * runs a heading straight into the next paragraph with no blank line in
 * between (e.g. "USAHello's GED Preparatory Course" is immediately
 * followed, same-paragraph-style, by "USAHello offers a free..."), so
 * relying on blank lines alone would glue the heading onto that paragraph's
 * text.
 */
function toChunks(lines: string[]): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) {
      chunks.push(current.join(' '));
      current = [];
    }
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === '') {
      flush();
      continue;
    }
    if (HEADINGS.has(trimmed) || SUBHEADINGS.has(trimmed)) {
      flush();
      chunks.push(trimmed);
      continue;
    }
    current.push(trimmed);
  }
  flush();
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
