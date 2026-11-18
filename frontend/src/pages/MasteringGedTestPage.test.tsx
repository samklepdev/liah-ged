import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MasteringGedTestPage } from './MasteringGedTestPage';

vi.mock('../content/mastering-the-ged-test', () => ({
  masteringGedContent: [
    { type: 'heading', text: 'Section One' },
    { type: 'paragraph', text: 'Some paragraph text.' },
    { type: 'subheading', text: 'A sub-section' },
    { type: 'bullets', items: ['First item', 'Second item'] },
  ],
}));

describe('MasteringGedTestPage', () => {
  test('renders the page title and each block type', () => {
    render(<MasteringGedTestPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Mastering the GED Test' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Section One' })).toBeInTheDocument();
    expect(screen.getByText('Some paragraph text.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'A sub-section' })).toBeInTheDocument();
    expect(screen.getByText('First item')).toBeInTheDocument();
    expect(screen.getByText('Second item')).toBeInTheDocument();
  });
});
