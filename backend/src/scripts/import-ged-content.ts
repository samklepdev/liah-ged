import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertNoLeakedQuestions, extractLessonTopics } from '../lib/ged-html-content.ts';
import {
  buildGedSubject,
  questionsByLesson,
  quizTitlesByLesson,
  type GedBankEntry,
} from '../lib/ged-quiz-bank.ts';

const SUBJECTS = [
  { slug: 'ged-language-arts', pdf: 'ged-language-arts.pdf' },
  { slug: 'ged-math', pdf: 'ged-math.pdf' },
  { slug: 'ged-science', pdf: 'ged-science.pdf' },
  { slug: 'ged-social-studies', pdf: 'ged-social-studies.pdf' },
];

const dataDir = new URL('../data/', import.meta.url);
const entries: GedBankEntry[] = JSON.parse(readFileSync(new URL('quiz-bank.json', dataDir), 'utf8'));

for (const { slug, pdf } of SUBJECTS) {
  const pdfPath = fileURLToPath(new URL(pdf, dataDir));
  const html = execFileSync('pdftohtml', ['-i', '-s', '-stdout', pdfPath], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  const quizTitles = quizTitlesByLesson(entries, slug);
  const topicsByLesson = extractLessonTopics(html, quizTitles);

  const joinedByLesson = new Map(
    [...topicsByLesson].map(([lessonTitle, lessonTopics]) => [
      lessonTitle,
      lessonTopics.map((t) => t.content ?? '').join('\n\n'),
    ]),
  );
  assertNoLeakedQuestions(joinedByLesson, questionsByLesson(entries, slug));

  const subject = buildGedSubject(entries, slug, new Map(), topicsByLesson);

  const outFile = new URL(`${slug}.quiz.json`, dataDir);
  writeFileSync(outFile, `${JSON.stringify(subject, null, 2)}\n`, 'utf8');

  const questionCount = subject.courses.reduce((n, c) => n + c.questions.length, 0);
  const topicCount = subject.courses.reduce((n, c) => n + (c.topics?.length ?? 0), 0);
  console.log(
    `${slug}: ${subject.courses.length} courses, ${questionCount} questions, ${topicCount} topics -> src/data/${slug}.quiz.json`,
  );
}
