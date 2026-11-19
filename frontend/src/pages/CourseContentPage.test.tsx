import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { CourseDetail } from '../quiz/api';
import { CourseContentPage } from './CourseContentPage';

const getCourse = vi.fn();

vi.mock('../quiz/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../quiz/api')>();
  return {
    ...actual,
    quizApi: { ...actual.quizApi, getCourse: (s: string) => getCourse(s) },
  };
});

function makeCourseDetail(overrides: Partial<CourseDetail> = {}): CourseDetail {
  return {
    id: 'course-1',
    slug: 'ged-language-arts-vocabulary-questions',
    title: 'Vocabulary Questions',
    position: 1,
    passScore: 5,
    questionCount: 6,
    content: 'First paragraph.\n\nSecond paragraph.',
    subjectSlug: 'ged-language-arts',
    subjectTitle: 'GED Language Arts',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/courses/ged-language-arts-vocabulary-questions']}>
      <Routes>
        <Route path="/courses/:slug" element={<CourseContentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getCourse.mockReset();
  getCourse.mockResolvedValue({ course: makeCourseDetail() });
});

describe('CourseContentPage', () => {
  test('shows the lesson title and content paragraphs', async () => {
    renderPage();
    expect(await screen.findByText('Vocabulary Questions')).toBeInTheDocument();
    expect(await screen.findByText('First paragraph.')).toBeInTheDocument();
    expect(await screen.findByText('Second paragraph.')).toBeInTheDocument();
  });

  test('renders markdown headings and lists with structure', async () => {
    getCourse.mockResolvedValue({
      course: makeCourseDetail({
        content: '## Words to Know\n\n- Vocabulary — words you know\n- Context clues — hints in the text',
      }),
    });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Words to Know', level: 2 })).toBeInTheDocument();
    const items = await screen.findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Vocabulary — words you know');
  });

  test('links to the quiz', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'Take the quiz' });
    expect(link).toHaveAttribute('href', '/courses/ged-language-arts-vocabulary-questions/quiz');
  });

  test('shows just the quiz link when there is no content', async () => {
    getCourse.mockResolvedValue({ course: makeCourseDetail({ content: null }) });
    renderPage();
    const link = await screen.findByRole('link', { name: 'Take the quiz' });
    expect(link).toBeInTheDocument();
  });

  test('shows an error message when the fetch fails', async () => {
    getCourse.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });
});
