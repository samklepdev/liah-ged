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

const FOOTER_RE = /—\s*Page\s*\d+\s*$/;

/**
 * Lines that only ever appear inside an inline quiz dump, across the two
 * dump styles seen in these PDFs: math's clean "Q1. / a) ... (correct) /
 * Explanation:" style, and language-arts' noisy quiz-widget chrome dump.
 * Mirrors the FURNITURE allowlist approach in quiz-parser.ts.
 */
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
