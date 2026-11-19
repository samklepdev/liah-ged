import { useState } from 'react';
import type { PracticeQuestion } from './api';

function PracticeQuestionCard({ question }: { question: PracticeQuestion }) {
  const [answeredOptionId, setAnsweredOptionId] = useState<string | null>(null);

  return (
    <div className="question-card practice-question">
      <p className="question-prompt">{question.prompt}</p>
      <ul className="option-list">
        {question.options.map((o) => {
          const answered = answeredOptionId !== null;
          const className = [
            'option',
            answered && o.id === answeredOptionId && o.isCorrect && 'correct',
            answered && o.id === answeredOptionId && !o.isCorrect && 'incorrect',
            answered && o.id !== answeredOptionId && o.isCorrect && 'correct',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <li key={o.id}>
              <label className={className}>
                <input
                  type="radio"
                  name={`practice-${question.id}`}
                  value={o.id}
                  checked={o.id === answeredOptionId}
                  disabled={answered}
                  onChange={() => setAnsweredOptionId(o.id)}
                />
                <span className="option-label">{o.label}</span>
                <span>{o.body}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {answeredOptionId !== null && <p className="result-explanation">{question.explanation}</p>}
    </div>
  );
}

export function PracticeQuiz({ questions }: { questions: PracticeQuestion[] }) {
  return (
    <div className="practice-quiz">
      {questions.map((q) => (
        <PracticeQuestionCard key={q.id} question={q} />
      ))}
    </div>
  );
}
