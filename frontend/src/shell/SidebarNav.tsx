import { useEffect, useId, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { BookIcon, ChartIcon, ChevronRightIcon, ClipboardIcon, SubjectIcon } from './icons';
import { hasPassed } from '../quiz/passed';
import { quizApi, type CourseSummary, type CourseTopicSummary } from '../quiz/api';
import type { SubjectNavState } from './useSubjectNav';

/**
 * One course within a subject's panel: a link to the course itself, plus its
 * own disclosure toggle for its topics. Topics are fetched lazily, the first
 * time this group opens — same reasoning as subjects fetching their courses
 * lazily in useSubjectNav.
 */
function CourseGroup({
  course,
  isCurrent,
  onNavigate,
}: {
  course: CourseSummary;
  isCurrent: boolean;
  onNavigate?: () => void;
}) {
  const panelId = useId();
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? isCurrent;
  const [topics, setTopics] = useState<CourseTopicSummary[] | undefined>(undefined);

  useEffect(() => {
    if (!open || topics !== undefined) return;
    let cancelled = false;
    void quizApi
      .getCourse(course.slug)
      .then((res) => {
        if (!cancelled) setTopics(res.course.topics);
      })
      .catch(() => {
        if (!cancelled) setTopics([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, topics, course.slug]);

  return (
    <li>
      <div className="nav-sublink-row">
        <NavLink
          to={`/courses/${course.slug}`}
          onClick={onNavigate}
          className={({ isActive }: { isActive: boolean }) =>
            isActive ? 'nav-sublink active' : 'nav-sublink'
          }
        >
          <span className="nav-sublink-pos">{course.position}</span>
          <span>{course.title}</span>
          {hasPassed(course.bestScore, course.passScore) && (
            <span className="nav-sublink-pass" role="img" aria-label="Passed">
              ✓
            </span>
          )}
        </NavLink>
        <button
          type="button"
          className="nav-sublink-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${open ? 'Collapse' : 'Expand'} topics for ${course.title}`}
          onClick={() => setOverride(!open)}
        >
          <ChevronRightIcon className={open ? 'nav-chevron open' : 'nav-chevron'} />
        </button>
      </div>

      <ul id={panelId} className="nav-panel nav-panel-topics" hidden={!open}>
        {topics === undefined && <li className="nav-panel-note">Loading…</li>}
        {topics?.length === 0 && <li className="nav-panel-note">No topics yet</li>}
        {topics?.map((t) => (
          <li key={t.position}>
            <NavLink
              to={`/courses/${course.slug}/topics/${t.position}`}
              onClick={onNavigate}
              className={({ isActive }: { isActive: boolean }) =>
                isActive ? 'nav-topic-link active' : 'nav-topic-link'
              }
            >
              {t.title}
            </NavLink>
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * One subject: a disclosure button whose panel lists that subject's quizzes.
 * Hand-rolled rather than a component library — a real <button> already gives
 * Enter/Space activation and focus handling, so what's left is aria-expanded
 * and aria-controls pointing at the panel.
 */
function SubjectGroup({
  slug,
  title,
  courseCount,
  nav,
  isCurrent,
  onNavigate,
}: {
  slug: string;
  title: string;
  courseCount: number;
  nav: SubjectNavState;
  isCurrent: boolean;
  onNavigate?: () => void;
}) {
  const panelId = useId();
  const { pathname } = useLocation();
  const open = nav.isOpen(slug);
  const quizzes = nav.courses[slug];

  return (
    <li className="nav-group">
      <button
        type="button"
        className={isCurrent ? 'nav-item current' : 'nav-item'}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => nav.toggle(slug)}
      >
        <SubjectIcon slug={slug} className="nav-icon" />
        <span className="nav-label">{title}</span>
        <span className="nav-count">{courseCount}</span>
        <ChevronRightIcon className={open ? 'nav-chevron open' : 'nav-chevron'} />
      </button>

      <ul id={panelId} className="nav-panel" hidden={!open}>
        {quizzes === undefined && <li className="nav-panel-note">Loading…</li>}

        {quizzes?.length === 0 && <li className="nav-panel-note">No quizzes yet</li>}

        {quizzes?.map((c) => (
          <CourseGroup
            key={c.id}
            course={c}
            isCurrent={pathname.startsWith(`/courses/${c.slug}`)}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </li>
  );
}

export function SidebarNav({
  nav,
  username,
  onNavigate,
}: {
  nav: SubjectNavState;
  username?: string;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();

  const itemClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'nav-item current' : 'nav-item';

  return (
    <nav className="sidebar-nav" aria-label="Subjects">
      <ul className="nav-list">
        <li>
          <NavLink to="/subjects" onClick={onNavigate} end className={itemClass}>
            <BookIcon className="nav-icon" />
            <span className="nav-label">All subjects</span>
          </NavLink>
        </li>

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

        {nav.error && (
          <li role="alert" className="nav-panel-note">
            {nav.error}
          </li>
        )}

        {!nav.error && !nav.loading && nav.subjects.length === 0 && (
          <li className="nav-panel-note">No subjects imported yet</li>
        )}

        {nav.subjects.map((s) => (
          <SubjectGroup
            key={s.id}
            slug={s.slug}
            title={s.title}
            courseCount={s.courseCount}
            nav={nav}
            isCurrent={pathname.startsWith(`/subjects/${s.slug}`)}
            onNavigate={onNavigate}
          />
        ))}
      </ul>

      {username && (
        <div className="sidebar-footer">
          <span className="sidebar-avatar" aria-hidden="true">
            {username.charAt(0).toUpperCase()}
          </span>
          <span className="sidebar-footer-email">{username}</span>
        </div>
      )}
    </nav>
  );
}
