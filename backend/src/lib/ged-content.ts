const FOOTER_RE = /—\s*Page\s*\d+\s*$/;

/**
 * Lines that only ever appear inside an inline quiz dump, across the two
 * dump styles seen in these PDFs: math's clean "Q1. / a) ... (correct) /
 * Explanation:" style, and language-arts' noisy quiz-widget chrome dump.
 * Mirrors the FURNITURE allowlist approach in quiz-parser.ts.
 */
export function isQuizNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (FOOTER_RE.test(t)) return true; // a page break can land mid-quiz-block
  if (/^Q\d+\./.test(t)) return true;
  if (/^Practice Question \d+/.test(t)) return true;
  if (/^[a-fA-F]\)/.test(t)) return true; // option letters go up to f) on some entries
  if (/\(correct\)/i.test(t)) return true;
  if (/^Explanation:?/i.test(t)) return true;
  // A literal "Question:" label marks an embedded practice-quiz stem — real
  // teaching prose describes a question, it never labels itself this way.
  if (/\bQuestion:/.test(t)) return true;

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
 * Drops "Video: <title>" lead-in paragraphs and "(no text content —
 * video or interactive topic)" placeholders entirely — pure scraper
 * artifacts — and unwraps a "Video Transcript(s) + <text>" label down to
 * just <text>, keeping the transcript itself since it's real lesson
 * content.
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
 *  at the video player's own UI chrome — not lesson content. */
export function stripCaptionInstructions(text: string): string {
  const noise = /subtitles?\/cc|auto-translate|closed captions?|settings gear icon/i;
  return text
    .split('\n\n')
    .filter((paragraph) => !noise.test(paragraph))
    .join('\n\n');
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
