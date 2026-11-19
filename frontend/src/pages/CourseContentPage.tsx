import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { quizApi, type CourseDetail } from '../quiz/api';

type State =
  | { kind: 'ready'; slug: string; course: CourseDetail }
  | { kind: 'error'; slug: string; message: string };

export function CourseContentPage() {
  const { slug = '' } = useParams();
  const [state, setState] = useState<State | null>(null);

  // Keyed on slug so switching courses shows loading without an explicit reset.
  const current = state?.slug === slug ? state : null;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { course } = await quizApi.getCourse(slug);
        if (!cancelled) setState({ kind: 'ready', slug, course });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: 'error',
            slug,
            message: err instanceof Error ? err.message : 'Could not load this course',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (current === null) return <div className="auth-loading">Loading…</div>;
  if (current.kind === 'error') {
    return (
      <p role="alert" className="auth-error">
        {current.message}
      </p>
    );
  }

  const { course } = current;

  return (
    <div className="course-content">
      <span className="course-position">Quiz {course.position}</span>
      <h1>{course.title}</h1>

      {course.content && (
        <div className="course-content-body">
          <Markdown remarkPlugins={[remarkGfm]}>{course.content}</Markdown>
        </div>
      )}

      <Link to={`/courses/${course.slug}/quiz`} className="primary">
        Take the quiz
      </Link>
    </div>
  );
}
