import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Generated at creation time from first/last name; see buildBaseUsername() in lib/username.ts. */
  username: text('username').notNull().unique(),
  /** Required at every creation path; left nullable so the profile edit form can still blank it later. */
  firstName: text('first_name'),
  lastName: text('last_name'),
  passwordHash: text('password_hash').notNull(),
  /** 'user' or 'admin'. Promoted via the admin users page; the first admin is
   *  set directly in the database. */
  role: text('role').$type<'user' | 'admin'>().notNull().default('user'),
  /** Set true when an admin creates the account with the shared initial
   *  password; cleared the first time the user successfully changes it. */
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** Soft-delete flag. false blocks login, kills existing sessions, and hides
   *  the user from every admin listing. See deletedAt. */
  isActive: boolean('is_active').notNull().default(true),
  /** Set together with isActive — non-null exactly when isActive is false. */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const sessions = pgTable(
  'sessions',
  {
    /**
     * SHA-256 of the token held in the cookie — never the token itself, so a
     * leaked database dump can't be replayed as a live session.
     */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

/** One pending "forgot password" request per user. userId is unique so a
 *  repeat request updates requestedAt instead of creating a second row. */
export const passwordResetRequests = pgTable('password_reset_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type PasswordResetRequestRow = typeof passwordResetRequests.$inferSelect;

export const subjects = pgTable('subjects', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
});

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    /** Globally unique: "<subject>-<course-title>". */
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    passScore: integer('pass_score').notNull().default(9),
    questionCount: integer('question_count').notNull().default(10),
    /** Lesson reading text shown before the quiz, as plain `\n\n`-separated
     *  paragraphs. Null means there is no reading material for this course. */
    content: text('content'),
    /** Soft-delete flag. false hides the course from the active catalog
     *  (listSubjects/listCoursesBySubject); a learner's own attempt history
     *  is unaffected. See deletedAt. */
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [unique('courses_subject_position_unique').on(t.subjectId, t.position)],
);

export const modules = pgTable(
  'modules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** True excludes this module's questions from the course's graded
     *  end-of-course quiz (findQuizByCourseSlug, findGradedAttempt) — they're
     *  only ever reached as a topic's inline ungraded practice. */
    isPractice: boolean('is_practice').notNull().default(false),
  },
  (t) => [unique('modules_course_title_unique').on(t.courseId, t.title)],
);

export const topics = pgTable('topics', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  /** Reading order within the course. Titles are not unique — e.g. "GED Exam
   *  Tip" can legitimately appear more than once in one lesson — so position
   *  (not title) is this course's per-topic identity, including in its URL. */
  position: integer('position').notNull(),
  title: text('title').notNull(),
  /** Null means this heading had no body left after stripping video/quiz
   *  noise (e.g. a bare "Practice Question 2" widget placeholder). */
  content: text('content'),
  /** Set when this topic's title matches one of the course's module titles
   *  — the topic page then shows that module's questions inline as
   *  ungraded practice. Null for ordinary reading topics. */
  moduleId: uuid('module_id').references(() => modules.id, { onDelete: 'cascade' }),
});

export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => modules.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    prompt: text('prompt').notNull(),
    explanation: text('explanation').notNull(),
  },
  (t) => [unique('questions_course_position_unique').on(t.courseId, t.position)],
);

export const questionOptions = pgTable(
  'question_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    body: text('body').notNull(),
    isCorrect: boolean('is_correct').notNull(),
  },
  (t) => [unique('question_options_question_label_unique').on(t.questionId, t.label)],
);

export const attempts = pgTable(
  'attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    /** Written once at submission; never recomputed on read. */
    score: integer('score'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
  },
  (t) => [
    index('attempts_user_course_idx').on(t.userId, t.courseId),
    // At most one unfinished attempt per user per course, so "start" and
    // "resume" can be the same call.
    uniqueIndex('attempts_one_open_per_user_course')
      .on(t.userId, t.courseId)
      .where(sql`${t.submittedAt} is null`),
  ],
);

export const attemptAnswers = pgTable(
  'attempt_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    optionId: uuid('option_id')
      .notNull()
      .references(() => questionOptions.id, { onDelete: 'cascade' }),
    /** Denormalised at save time so later content edits cannot rewrite history. */
    isCorrect: boolean('is_correct').notNull(),
  },
  (t) => [unique('attempt_answers_attempt_question_unique').on(t.attemptId, t.questionId)],
);

export type Subject = typeof subjects.$inferSelect;
export type Course = typeof courses.$inferSelect;
export type Module = typeof modules.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type QuestionOption = typeof questionOptions.$inferSelect;
export type Attempt = typeof attempts.$inferSelect;
export type AttemptAnswer = typeof attemptAnswers.$inferSelect;

export const certificates = pgTable('certificates', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Short public code printed on the PDF and checked by the public verify endpoint. */
  verificationId: text('verification_id').notNull().unique(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Certificate = typeof certificates.$inferSelect;
