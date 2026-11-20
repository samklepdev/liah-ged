import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { TopicDetail } from '../quiz/api';
import { TopicPage } from './TopicPage';

const getTopic = vi.fn();

vi.mock('../quiz/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../quiz/api')>();
  return {
    ...actual,
    quizApi: { ...actual.quizApi, getTopic: (s: string, p: number) => getTopic(s, p) },
  };
});

function makeTopicDetail(overrides: Partial<TopicDetail> = {}): TopicDetail {
  return {
    position: 1,
    title: 'In this lesson…',
    content: 'You will learn about vocabulary.',
    videoUrl: null,
    courseSlug: 'ged-language-arts-vocabulary-questions',
    courseTitle: 'Vocabulary Questions',
    subjectSlug: 'ged-language-arts',
    next: { position: 2, title: 'Words to know' },
    practiceQuestions: null,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/courses/ged-language-arts-vocabulary-questions/topics/1']}>
      <Routes>
        <Route path="/courses/:slug/topics/:position" element={<TopicPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getTopic.mockReset();
  getTopic.mockResolvedValue({ topic: makeTopicDetail() });
});

describe('TopicPage', () => {
  test('fetches the topic at this course slug and position', async () => {
    renderPage();
    await screen.findByText('In this lesson…');
    expect(getTopic).toHaveBeenCalledWith('ged-language-arts-vocabulary-questions', 1);
  });

  test('shows the topic title and content', async () => {
    renderPage();
    expect(await screen.findByText('In this lesson…')).toBeInTheDocument();
    expect(await screen.findByText('You will learn about vocabulary.')).toBeInTheDocument();
  });

  test('shows a video embed above the content when the topic has a video url', async () => {
    getTopic.mockResolvedValue({
      topic: makeTopicDetail({
        content: 'Watch this video to learn more.',
        videoUrl: 'https://www.youtube.com/watch?v=WTZh-xKpEEE',
      }),
    });
    renderPage();

    const iframe = await screen.findByTitle('In this lesson…');
    expect(iframe).toHaveAttribute('src', 'https://www.youtube.com/embed/WTZh-xKpEEE');

    const content = await screen.findByText('Watch this video to learn more.');
    // eslint-disable-next-line no-bitwise
    expect(iframe.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('derives the embed id from a youtu.be short link', async () => {
    getTopic.mockResolvedValue({
      topic: makeTopicDetail({ videoUrl: 'https://youtu.be/WTZh-xKpEEE' }),
    });
    renderPage();
    const iframe = await screen.findByTitle('In this lesson…');
    expect(iframe).toHaveAttribute('src', 'https://www.youtube.com/embed/WTZh-xKpEEE');
  });

  test('shows no video embed when the topic has no video url', async () => {
    renderPage();
    await screen.findByText('In this lesson…');
    expect(screen.queryByTitle('In this lesson…')).not.toBeInTheDocument();
  });

  test('links back to the course', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'Vocabulary Questions' });
    expect(link).toHaveAttribute('href', '/courses/ged-language-arts-vocabulary-questions');
  });

  test('links to the next topic when there is one', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'Next: Words to know' });
    expect(link).toHaveAttribute(
      'href',
      '/courses/ged-language-arts-vocabulary-questions/topics/2',
    );
  });

  test('links to the quiz instead, on the last topic', async () => {
    getTopic.mockResolvedValue({ topic: makeTopicDetail({ next: null }) });
    renderPage();
    const link = await screen.findByRole('link', { name: 'Take the quiz' });
    expect(link).toHaveAttribute('href', '/courses/ged-language-arts-vocabulary-questions/quiz');
  });

  test('shows just the links when there is no content', async () => {
    getTopic.mockResolvedValue({ topic: makeTopicDetail({ content: null, next: null }) });
    renderPage();
    const link = await screen.findByRole('link', { name: 'Take the quiz' });
    expect(link).toBeInTheDocument();
  });

  test('shows practice questions inline when the topic has them', async () => {
    getTopic.mockResolvedValue({
      topic: makeTopicDetail({
        content: null,
        practiceQuestions: [
          {
            id: 'q1',
            position: 1,
            prompt: 'What is 1 + 1?',
            explanation: 'Basic addition.',
            options: [
              { id: 'q1-a', label: 'A', body: '1', isCorrect: false },
              { id: 'q1-b', label: 'B', body: '2', isCorrect: true },
            ],
          },
        ],
      }),
    });
    renderPage();
    expect(await screen.findByText('What is 1 + 1?')).toBeInTheDocument();
  });

  test('shows an error message when the fetch fails', async () => {
    getTopic.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });
});
