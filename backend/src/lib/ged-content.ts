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
    'Quiz question',
    'Questions completed',
    'Quiz is loading',
    'sign in or sign up',
    'sign up to start the quiz',
    'Time limit:',
    'Correct Incorrect',
    'Earned Point',
    'Essay(s) Pending',
    'Categories Not categorized',
    'Show Question',
    'Review Answered',
    'Back to topic',
    'already completed the quiz',
    'Results Quiz complete',
    'Results are being recorded',
    'Questions answered correctly',
    'Time has elapsed',
    'point(s)',
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

  // A blank line alone never (re-)starts a skip run — real paragraphs have
  // blank lines between them too, and those must survive so toParagraphs can
  // still find the paragraph breaks. But a quiz can interleave genuine lesson
  // content *between* two of its own questions (observed in the language-arts
  // export), so anything else that looks like quiz noise re-arms the skip even
  // outside the lines immediately following a heading.
  const isSkipTrigger = (line: string): boolean => line.trim() !== '' && isQuizNoiseLine(line);

  const kept: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isHeading(line)) {
      i++; // skip the heading itself
      while (i < lines.length && isQuizNoiseLine(lines[i]!)) i++;
      continue;
    }
    if (isSkipTrigger(line)) {
      while (i < lines.length && isQuizNoiseLine(lines[i]!)) i++;
      continue;
    }
    kept.push(line);
    i++;
  }
  return kept.join('\n');
}

/**
 * Splits a lesson's raw text into one chunk per quizTitle (i.e. per module/
 * topic), walking the same heading/noise-skip logic as stripQuizBlocks but
 * routing kept lines into "buckets" instead of one combined list. Content
 * before a topic's own quiz heading is that topic's reading; content after a
 * quiz's own noise block (and before the next quiz heading) belongs to the
 * *next* topic — that's simply where it reads next, and trailing content
 * after the last quiz falls into the last topic rather than being dropped.
 * Returns one string per quizTitle, same order, each still needing
 * toParagraphs/stripVideoPrompts/etc. applied.
 */
export function splitLessonIntoTopics(lessonText: string, quizTitles: string[]): string[] {
  if (quizTitles.length === 0) return [];

  const lines = lessonText.split('\n');
  const headingIndex = (line: string): number =>
    quizTitles.findIndex((title) => line.trim() === title.trim());
  const isSkipTrigger = (line: string): boolean => line.trim() !== '' && isQuizNoiseLine(line);

  const buckets: string[][] = quizTitles.map(() => []);
  let current = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const matchedHeading = headingIndex(line);
    if (matchedHeading !== -1) {
      i++; // skip the heading itself
      while (i < lines.length && isQuizNoiseLine(lines[i]!)) i++;
      current = Math.min(matchedHeading + 1, quizTitles.length - 1);
      continue;
    }
    if (isSkipTrigger(line)) {
      while (i < lines.length && isQuizNoiseLine(lines[i]!)) i++;
      continue;
    }
    buckets[current]!.push(line);
    i++;
  }

  return buckets.map((lines) => lines.join('\n'));
}

/**
 * Drops "Video: <title>" lead-in paragraphs and "(no text content — video or
 * interactive topic)" placeholders entirely — pure scraper artifacts, since
 * the content page never embeds a video — and unwraps a "Video
 * Transcript(s) + <text>" label down to just <text>, keeping the transcript
 * itself since it's real lesson content.
 */
export function stripVideoReferences(text: string): string {
  return text
    .split('\n\n')
    .map((paragraph) => {
      const trimmed = paragraph.trim();
      const transcriptMatch = /^video transcripts?\s*\+\s*([\s\S]*)$/i.exec(trimmed);
      if (transcriptMatch) return transcriptMatch[1]!.trim();
      if (/^video:\s*.+$/i.test(trimmed)) return '';
      if (/^\(no text content[^)]*\)$/i.test(trimmed)) return '';
      return paragraph;
    })
    .filter((paragraph) => paragraph.trim().length > 0)
    .join('\n\n');
}

/** Drops paragraphs of closed-captions/subtitle-toggling instructions aimed
 *  at a video player the content page never embeds. */
export function stripCaptionInstructions(text: string): string {
  const noise = /subtitles?\/cc|auto-translate|closed captions?|settings gear icon/i;
  return text
    .split('\n\n')
    .filter((paragraph) => !noise.test(paragraph))
    .join('\n\n');
}

/**
 * Builds { lessonTitle -> each topic's cleaned content, aligned with that
 * lesson's quizTitles order } for one subject's PDF text.
 */
export function extractTopicContent(
  pdfText: string,
  quizTitlesByLesson: Map<string, string[]>,
): Map<string, string[]> {
  const rawLessons = splitLessons(pdfText);
  const content = new Map<string, string[]>();

  for (const [lessonTitle, quizTitles] of quizTitlesByLesson) {
    const raw = rawLessons.get(lessonTitle);
    if (raw === undefined) {
      throw new Error(`No "${lessonTitle}" heading found in the PDF text.`);
    }
    const topics = splitLessonIntoTopics(raw, quizTitles).map((topic) => {
      const paragraphs = toParagraphs(topic);
      return stripCaptionInstructions(stripVideoReferences(stripVideoPrompts(paragraphs)));
    });
    content.set(lessonTitle, topics);
  }

  return content;
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
 * Removes sentences that tell the reader to watch a video — e.g. "Watch the
 * video, then take the optional quiz.", "Watch this video to learn more
 * about genetics research", "Click here to watch the video" — since no
 * video is ever shown on the content page and none of these source PDFs
 * carry an actual video URL to link to. The source always attaches these
 * directly after a short lead-in ("Video: Context Clues Watch the video and
 * then answer the practice questions."), so only the prompt sentence itself
 * is stripped, never the lead-in or anything in a different paragraph.
 *
 * A paragraph that was *only* a video prompt (a common case — many videos
 * get their own one-line paragraph) ends up empty and is dropped entirely so
 * no stray blank paragraph is left behind.
 */
export function stripVideoPrompts(text: string): string {
  const withoutPrompts = text
    .replace(/\b(?:you can also )?click here to watch[^.\n]*\.?/gi, '')
    .replace(/\bwatch (?:the|this) video\b[^.\n]*\./gi, '')
    .replace(/\bwatch (?:the|this) video\b[^.\n]*$/gim, '');

  return withoutPrompts
    .split('\n\n')
    .map((paragraph) => paragraph.replace(/\s{2,}/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0)
    .join('\n\n');
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
    const paragraphs = toParagraphs(stripQuizBlocks(raw, quizTitles));
    content.set(lessonTitle, stripVideoPrompts(paragraphs));
  }

  return content;
}

/** How far past a matched prompt to look for one of its own options, when
 *  deciding whether a prompt match is a genuine leaked quiz block. */
const LEAK_OPTION_WINDOW = 500;

/**
 * Throws if any lesson's extracted content still contains one of that
 * lesson's quiz questions — its prompt *and* at least one of its own
 * options, within a short distance of each other, both whitespace- and
 * case-normalized. Requiring an option too (not just the prompt) is what
 * tells a genuine leaked quiz block apart from a lesson's own intro
 * coincidentally restating one of its quiz questions verbatim as a learning
 * objective — e.g. a lesson's "In this lesson... you will learn... what is a
 * hypothesis?" preview line matches that lesson's "What is a hypothesis?"
 * quiz prompt exactly, with no quiz content anywhere nearby.
 */
export function assertNoLeakedQuestions(
  content: Map<string, string>,
  questionsByLesson: Map<string, Array<{ prompt: string; options: string[] }>>,
): void {
  const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

  for (const [lessonTitle, questions] of questionsByLesson) {
    const normalizedContent = normalize(content.get(lessonTitle) ?? '');

    for (const { prompt, options } of questions) {
      const normalizedPrompt = normalize(prompt);
      let searchFrom = 0;
      for (;;) {
        const matchIndex = normalizedContent.indexOf(normalizedPrompt, searchFrom);
        if (matchIndex === -1) break;

        const window = normalizedContent.slice(
          matchIndex,
          matchIndex + normalizedPrompt.length + LEAK_OPTION_WINDOW,
        );
        const hasNearbyOption = options.some((option) => window.includes(normalize(option)));
        if (hasNearbyOption) {
          throw new Error(
            `"${lessonTitle}" content still contains the question ` +
              `"${prompt.slice(0, 60)}…" and one of its options — a quiz block was not fully stripped.`,
          );
        }

        searchFrom = matchIndex + normalizedPrompt.length;
      }
    }
  }
}
