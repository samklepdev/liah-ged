import {
  slugify,
  type ParsedCourse,
  type ParsedOption,
  type ParsedQuestion,
  type ParsedSubject,
  type ParsedTopic,
} from './quiz-parser.ts';

export type GedBankEntry = {
  course: string;
  courseTitle: string;
  quizTitle: string;
  lesson: string;
  questionNumber: number;
  question: string;
  options: string[];
  correctIndex: number | number[];
  explanation: string;
};

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
const LESSON_NUMBER_RE = /^Lesson (\d+):\s*(.+)$/;

/** A module named "Practice Question N" is an ungraded inline practice
 *  stop, not a real assessed quiz — matches the PDF's own naming for these
 *  (never "Practice Question" bare, which is a distinct, already-graded
 *  quizTitle elsewhere). */
const PRACTICE_QUESTION_RE = /^Practice Question \d+$/;

/** Entries the schema can represent: a single correct option out of several. */
function isUsable(entry: GedBankEntry, subjectSlug: string): boolean {
  return entry.course === subjectSlug && typeof entry.correctIndex === 'number';
}

/**
 * Builds one subject's ParsedSubject from quiz-bank.json's flat entries plus
 * that subject's extracted lesson content (lessonTitle -> cleaned
 * paragraphs). Entries whose correctIndex is not a plain number are
 * excluded — see isUsable — because the schema only supports one correct
 * option per question.
 */
export function buildGedSubject(
  entries: GedBankEntry[],
  subjectSlug: string,
  contentByLesson: Map<string, string> = new Map(),
  topicsByLesson: Map<string, ParsedTopic[]> = new Map(),
): ParsedSubject {
  const usable = entries.filter((e) => isUsable(e, subjectSlug));
  if (usable.length === 0) {
    throw new Error(`No usable quiz-bank entries found for subject "${subjectSlug}".`);
  }

  const subjectTitle = usable[0]!.courseTitle;

  const lessonOrder: string[] = [];
  const byLesson = new Map<string, GedBankEntry[]>();
  for (const entry of usable) {
    if (!byLesson.has(entry.lesson)) {
      byLesson.set(entry.lesson, []);
      lessonOrder.push(entry.lesson);
    }
    byLesson.get(entry.lesson)!.push(entry);
  }

  const courses: ParsedCourse[] = lessonOrder.map((lessonTitle) => {
    const lessonMatch = LESSON_NUMBER_RE.exec(lessonTitle);
    if (!lessonMatch) {
      throw new Error(`Lesson title "${lessonTitle}" has no leading "Lesson N:" number.`);
    }
    const position = Number(lessonMatch[1]);
    const title = lessonMatch[2]!.trim();

    const lessonEntries = byLesson.get(lessonTitle)!;

    const moduleTitles: string[] = [];
    for (const entry of lessonEntries) {
      if (!moduleTitles.includes(entry.quizTitle)) moduleTitles.push(entry.quizTitle);
    }

    const practiceModuleTitles = moduleTitles.filter((title) => PRACTICE_QUESTION_RE.test(title));

    const questions: ParsedQuestion[] = lessonEntries.map((entry, index) => {
      const correctIndex = entry.correctIndex as number;
      if (correctIndex < 0 || correctIndex >= entry.options.length) {
        throw new Error(
          `"${lessonTitle}" question ${entry.questionNumber} (${entry.quizTitle}): ` +
            `correctIndex ${correctIndex} is out of range for ${entry.options.length} options.`,
        );
      }
      if (entry.options.length > OPTION_LABELS.length) {
        throw new Error(
          `"${lessonTitle}" question ${entry.questionNumber} (${entry.quizTitle}): ` +
            `${entry.options.length} options exceeds the ${OPTION_LABELS.length} supported labels.`,
        );
      }

      const options: ParsedOption[] = entry.options.map((body, i) => ({
        label: OPTION_LABELS[i]!,
        body,
        isCorrect: i === correctIndex,
      }));

      return {
        position: index + 1,
        prompt: entry.question,
        moduleTitle: entry.quizTitle,
        explanation: entry.explanation,
        options,
      };
    });

    const gradedQuestionCount = questions.filter(
      (q) => !practiceModuleTitles.includes(q.moduleTitle),
    ).length;

    return {
      position,
      slug: `${subjectSlug}-${slugify(title)}`,
      title,
      moduleTitles,
      practiceModuleTitles,
      questionCount: gradedQuestionCount,
      passScore: Math.ceil(gradedQuestionCount * 0.8),
      questions,
      content: contentByLesson.get(lessonTitle),
      topics: topicsByLesson.get(lessonTitle),
    };
  });

  courses.sort((a, b) => a.position - b.position);

  return { slug: subjectSlug, title: subjectTitle, courses };
}

/** Each lesson's quiz titles in first-appearance order, deduped — the input `extractLessonContent` needs to find and strip each lesson's quiz blocks. */
export function quizTitlesByLesson(
  entries: GedBankEntry[],
  subjectSlug: string,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const entry of entries) {
    if (!isUsable(entry, subjectSlug)) continue;
    const list = out.get(entry.lesson) ?? [];
    if (!list.includes(entry.quizTitle)) list.push(entry.quizTitle);
    out.set(entry.lesson, list);
  }
  return out;
}

export type LeakCheckQuestion = { prompt: string; options: string[] };

/**
 * Each lesson's kept questions (prompt + option bodies) — what
 * assertNoLeakedQuestions checks for in extracted content. Carrying the
 * options alongside the prompt lets that check tell a genuine leaked quiz
 * block apart from a lesson's own intro coincidentally restating one of its
 * quiz questions verbatim (observed in practice: "What is a hypothesis?" is
 * both a "you will learn" preview line and, separately, a real quiz prompt).
 */
export function questionsByLesson(
  entries: GedBankEntry[],
  subjectSlug: string,
): Map<string, LeakCheckQuestion[]> {
  const out = new Map<string, LeakCheckQuestion[]>();
  for (const entry of entries) {
    if (!isUsable(entry, subjectSlug)) continue;
    const list = out.get(entry.lesson) ?? [];
    list.push({ prompt: entry.question, options: entry.options });
    out.set(entry.lesson, list);
  }
  return out;
}
