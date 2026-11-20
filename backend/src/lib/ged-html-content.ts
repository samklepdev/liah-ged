import {
  assertNoLeakedQuestions,
  isQuizNoiseLine,
  stripCaptionInstructions,
  stripVideoReferences,
  toParagraphs,
} from './ged-content.ts';
import type { ParsedTopic } from './quiz-parser.ts';

/** The one line pdftohtml -i -s -stdout emits per visual line of text,
 *  in document (reading) order across every page. */
const PARAGRAPH_RE = /<p[^>]*>([\s\S]*?)<\/p>/g;

/** A heading is a paragraph whose *entire* content is wrapped in <i><b>…</b></i>
 *  — e.g. "In this lesson…", "Words to know", "Quiz on Video: X". A term
 *  definition like "<b>Passage</b>&#160;— section of text…" only bolds its
 *  first word and is never italic, so it never matches this. */
const HEADING_RE = /^<i><b>([\s\S]*)<\/b><\/i>$/;

/** "Lesson 7: Evidence and Explanation" — bold, never italic. Splits the PDF
 *  into lessons, same as the lesson-title line matched elsewhere. */
const LESSON_RE = /^<b>Lesson (\d+): ([\s\S]*)<\/b>$/;

/** "11 topics · 2 quizzes" — also italic+bold, so it would otherwise match
 *  HEADING_RE; it is dropped rather than treated as a topic. */
const META_RE = /^\d+\s+topics?\s*·\s*\d+\s+quizzes?$/i;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  '#160': ' ',
  nbsp: ' ',
  '#8216': '‘',
  '#8217': '’',
  '#8220': '“',
  '#8221': '”',
  '#8211': '–',
  '#8212': '—',
  '#8230': '…',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#?\w+);/g, (full, name) => ENTITIES[name] ?? full);
}

/** Strips a paragraph's tags down to plain text, decoding entities. Used to
 *  classify/filter a paragraph; htmlToMarkdown is used once it's kept. */
function plainText(innerHtml: string): string {
  return decodeEntities(innerHtml.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).trim();
}

/** Converts a kept paragraph's inner HTML to Markdown-ish text: <br/> becomes
 *  a line break, bold/italic tags become markdown emphasis, everything else
 *  is dropped. */
function htmlToMarkdown(innerHtml: string): string {
  const withBreaks = innerHtml.replace(/<br\s*\/?>/gi, '\n');
  const withBold = withBreaks.replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**');
  const withItalic = withBold.replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*');
  return decodeEntities(withItalic.replace(/<[^>]+>/g, '')).trim();
}

type RawParagraph = { html: string; heading: string | null; lessonTitle: string | null };

function parseParagraphs(html: string): RawParagraph[] {
  return [...html.matchAll(PARAGRAPH_RE)].map(([, inner]) => {
    const raw = inner!.trim();
    const lessonMatch = LESSON_RE.exec(raw);
    if (lessonMatch) {
      return { html: raw, heading: null, lessonTitle: decodeEntities(lessonMatch[2]!).trim() };
    }
    const headingMatch = HEADING_RE.exec(raw);
    if (headingMatch) {
      const text = plainText(headingMatch[1]!);
      if (META_RE.test(text)) return { html: raw, heading: null, lessonTitle: null };
      return { html: raw, heading: text, lessonTitle: null };
    }
    return { html: raw, heading: null, lessonTitle: null };
  });
}

/** A whole paragraph counts as quiz noise if *any* of its wrapped lines
 *  (pdftohtml joins wrapped display lines with <br/> within one paragraph)
 *  looks like quiz dump noise, reusing the plain-text pipeline's line-level
 *  check. The quiz dump and real teaching content are always separate <p>
 *  elements in this source, so one noisy line means the whole paragraph is
 *  noise — e.g. an "Explanation: …" paragraph that wraps onto a second
 *  display line has no noise marker on that continuation line, so filtering
 *  line-by-line would leak it; dropping the whole paragraph does not. */
function cleanParagraph(innerHtml: string): string | null {
  const rawLines = innerHtml.split(/<br\s*\/?>/gi);
  if (rawLines.some((rawLine) => isQuizNoiseLine(plainText(rawLine)))) return null;
  const text = htmlToMarkdown(innerHtml);
  return text.length > 0 ? text : null;
}

/** Matches the "■ Watch video" anchor paragraph pdftohtml emits right after
 *  a video topic's heading, e.g.
 *  `■&#160;<a href="https://www.youtube.com/watch?v=ID"><b>Watch video</b>...`.
 *  Captures the href so the player can embed it — the whole paragraph,
 *  including the duplicated plain-text URL that follows the link, is pure
 *  scraper chrome once a real player renders it, so it's excluded from
 *  content entirely rather than kept as text. */
const VIDEO_LINK_RE = /<a href="([^"]+)">\s*<b>\s*Watch video\s*<\/b>/i;

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
