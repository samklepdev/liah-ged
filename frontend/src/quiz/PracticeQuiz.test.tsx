import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PracticeQuestion } from './api';
import { PracticeQuiz } from './PracticeQuiz';

const questions: PracticeQuestion[] = [
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
  {
    id: 'q2',
    position: 2,
    prompt: 'What is 2 + 2?',
    explanation: 'Also basic addition.',
    options: [
      { id: 'q2-a', label: 'A', body: '4', isCorrect: true },
      { id: 'q2-b', label: 'B', body: '5', isCorrect: false },
    ],
  },
];

describe('PracticeQuiz', () => {
  test('shows every question and option up front', () => {
    render(<PracticeQuiz questions={questions} />);
    expect(screen.getByText('What is 1 + 1?')).toBeInTheDocument();
    expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument();
  });

  test('choosing the correct option reveals it as correct, with the explanation', async () => {
    render(<PracticeQuiz questions={questions} />);
    await userEvent.click(screen.getByText('2'));
    expect(screen.getByText('Basic addition.')).toBeInTheDocument();
    expect(screen.getByText('2').closest('label')).toHaveClass('correct');
  });

  test('choosing the wrong option reveals it as incorrect and shows which was right', async () => {
    render(<PracticeQuiz questions={questions} />);
    await userEvent.click(screen.getByText('1'));
    expect(screen.getByText('1').closest('label')).toHaveClass('incorrect');
    expect(screen.getByText('2').closest('label')).toHaveClass('correct');
  });

  test('answering one question does not affect another on the same page', async () => {
    render(<PracticeQuiz questions={questions} />);
    await userEvent.click(screen.getByText('1')); // wrong answer to question 1
    expect(screen.queryByText('Also basic addition.')).not.toBeInTheDocument();
  });
});
