import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { quizApi, type TopicDetail } from '../quiz/api';
import { PracticeQuiz } from '../quiz/PracticeQuiz';

type Key = { slug: string; position: string };

type State =
  | { kind: 'ready'; key: Key; topic: TopicDetail }
  | { kind: 'error'; key: Key; message: string };

export function TopicPage() {
  const { slug = '', position = '' } = useParams();
  const [state, setState] = useState<State | null>(null);

  const key: Key = { slug, position };
  const current = state && state.key.slug === slug && state.key.position === position ? state : null;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { topic } = await quizApi.getTopic(slug, Number(position));
        if (!cancelled) setState({ kind: 'ready', key, topic });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: 'error',
            key,
            message: err instanceof Error ? err.message : 'Could not load this topic',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, position]);

  if (current === null) return <div className="auth-loading">Loading…</div>;
  if (current.kind === 'error') {
    return (
      <p role="alert" className="auth-error">
        {current.message}
      </p>
    );
  }

  const { topic } = current;

  return (
    <div className="course-content">
      <Link to={`/courses/${topic.courseSlug}`} className="course-topic-back">
        {topic.courseTitle}
      </Link>
      <h1>{topic.title}</h1>

      {topic.content && (
        <div className="course-content-body">
          <Markdown remarkPlugins={[remarkGfm]}>{topic.content}</Markdown>
        </div>
      )}

      {topic.practiceQuestions && <PracticeQuiz questions={topic.practiceQuestions} />}

      {topic.next ? (
        <Link to={`/courses/${topic.courseSlug}/topics/${topic.next.position}`} className="primary">
          Next: {topic.next.title}
        </Link>
      ) : (
        <Link to={`/courses/${topic.courseSlug}/quiz`} className="primary">
          Take the quiz
        </Link>
      )}
    </div>
  );
}
