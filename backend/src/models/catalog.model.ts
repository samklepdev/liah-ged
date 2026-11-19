import { and, asc, count, eq, ilike, isNotNull, max, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { attempts, courses, subjects, topics } from './schema.ts';

export type SubjectSummary = {
  id: string;
  slug: string;
  title: string;
  courseCount: number;
};

export async function listSubjects(): Promise<SubjectSummary[]> {
  const rows = await db
    .select({
      id: subjects.id,
      slug: subjects.slug,
      title: subjects.title,
      courseCount: count(courses.id),
    })
    .from(subjects)
    .leftJoin(courses, and(eq(courses.subjectId, subjects.id), eq(courses.isActive, true)))
    .groupBy(subjects.id, subjects.slug, subjects.title)
    .orderBy(asc(subjects.title));

  return rows.map((r) => ({ ...r, courseCount: Number(r.courseCount) }));
}

export type CourseSummary = {
  id: string;
  slug: string;
  title: string;
  position: number;
  passScore: number;
  questionCount: number;
  bestScore: number | null;
  attemptCount: number;
};

export async function findSubjectBySlug(slug: string) {
  const [row] = await db.select().from(subjects).where(eq(subjects.slug, slug)).limit(1);
  return row ?? null;
}

/**
 * Courses in a subject. When userId is null the per-user columns are zeroed
 * rather than omitted, so the response shape never changes.
 */
export async function listCoursesBySubject(
  subjectSlug: string,
  userId: string | null,
): Promise<CourseSummary[]> {
  const subject = await findSubjectBySlug(subjectSlug);
  if (!subject) return [];

  const rows = await db
    .select({
      id: courses.id,
      slug: courses.slug,
      title: courses.title,
      position: courses.position,
      passScore: courses.passScore,
      questionCount: courses.questionCount,
      bestScore: max(attempts.score),
      attemptCount: count(attempts.id),
    })
    .from(courses)
    .leftJoin(
      attempts,
      userId
        ? and(
            eq(attempts.courseId, courses.id),
            eq(attempts.userId, userId),
            isNotNull(attempts.submittedAt),
          )
        : sql`false`,
    )
    .where(and(eq(courses.subjectId, subject.id), eq(courses.isActive, true)))
    .groupBy(
      courses.id,
      courses.slug,
      courses.title,
      courses.position,
      courses.passScore,
      courses.questionCount,
    )
    .orderBy(asc(courses.position));

  return rows.map((r) => ({
    ...r,
    bestScore: r.bestScore === null ? null : Number(r.bestScore),
    attemptCount: Number(r.attemptCount),
  }));
}

export type SearchCourseResult = CourseSummary & { subjectSlug: string; subjectTitle: string };

export type SearchResult = {
  subjects: SubjectSummary[];
  courses: SearchCourseResult[];
};

/** Escapes ILIKE wildcard characters so user input can't widen the match. */
function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Title-only search across subjects and active courses, for the top-nav
 * search bar. Mirrors listSubjects/listCoursesBySubject's isActive filter —
 * a soft-deleted course must not be findable here either.
 */
export async function searchCatalog(q: string): Promise<SearchResult> {
  const pattern = `%${escapeLike(q)}%`;

  const subjectRows = await db
    .select({ id: subjects.id, slug: subjects.slug, title: subjects.title })
    .from(subjects)
    .where(ilike(subjects.title, pattern))
    .orderBy(asc(subjects.title))
    .limit(8);

  const courseRows = await db
    .select({
      id: courses.id,
      slug: courses.slug,
      title: courses.title,
      position: courses.position,
      passScore: courses.passScore,
      questionCount: courses.questionCount,
      subjectSlug: subjects.slug,
      subjectTitle: subjects.title,
    })
    .from(courses)
    .innerJoin(subjects, eq(courses.subjectId, subjects.id))
    .where(and(ilike(courses.title, pattern), eq(courses.isActive, true)))
    .orderBy(asc(courses.title))
    .limit(8);

  return {
    subjects: subjectRows.map((r) => ({ ...r, courseCount: 0 })),
    courses: courseRows.map((r) => ({ ...r, bestScore: null, attemptCount: 0 })),
  };
}

export type CourseTopicSummary = { position: number; title: string };

export type CourseDetail = {
  id: string;
  slug: string;
  title: string;
  position: number;
  passScore: number;
  questionCount: number;
  content: string | null;
  subjectSlug: string;
  subjectTitle: string;
  /** This lesson's content sections, in reading order — for the sidebar and
   *  the lesson page's topic list. Titles only; see findTopic for a body. */
  topics: CourseTopicSummary[];
};

async function findCourseTopics(courseId: string): Promise<CourseTopicSummary[]> {
  return db
    .select({ position: topics.position, title: topics.title })
    .from(topics)
    .where(eq(topics.courseId, courseId))
    .orderBy(asc(topics.position));
}

/** The content page's data source. Mirrors listCoursesBySubject's isActive
 *  filter — a soft-deleted course must not be reachable here either. */
export async function findCourseBySlug(slug: string): Promise<CourseDetail | null> {
  const [row] = await db
    .select({
      id: courses.id,
      slug: courses.slug,
      title: courses.title,
      position: courses.position,
      passScore: courses.passScore,
      questionCount: courses.questionCount,
      content: courses.content,
      subjectSlug: subjects.slug,
      subjectTitle: subjects.title,
    })
    .from(courses)
    .innerJoin(subjects, eq(courses.subjectId, subjects.id))
    .where(and(eq(courses.slug, slug), eq(courses.isActive, true)))
    .limit(1);

  if (!row) return null;

  return { ...row, topics: await findCourseTopics(row.id) };
}

export type TopicDetail = {
  position: number;
  title: string;
  content: string | null;
  courseSlug: string;
  courseTitle: string;
  subjectSlug: string;
  /** The next topic in this course, for a "Next" link — null on the last
   *  topic, where the content page's own quiz link takes over instead. */
  next: { position: number; title: string } | null;
};

/** One topic's own page — its reading plus enough of its course to render a
 *  breadcrumb and link back. Mirrors findCourseBySlug's isActive filter. */
export async function findTopic(courseSlug: string, position: number): Promise<TopicDetail | null> {
  const [row] = await db
    .select({
      position: topics.position,
      title: topics.title,
      content: topics.content,
      courseSlug: courses.slug,
      courseTitle: courses.title,
      subjectSlug: subjects.slug,
    })
    .from(topics)
    .innerJoin(courses, eq(courses.id, topics.courseId))
    .innerJoin(subjects, eq(courses.subjectId, subjects.id))
    .where(
      and(eq(courses.slug, courseSlug), eq(topics.position, position), eq(courses.isActive, true)),
    )
    .limit(1);

  if (!row) return null;

  const [next] = await db
    .select({ position: topics.position, title: topics.title })
    .from(topics)
    .innerJoin(courses, eq(courses.id, topics.courseId))
    .where(and(eq(courses.slug, courseSlug), eq(topics.position, position + 1)))
    .limit(1);

  return { ...row, next: next ?? null };
}
