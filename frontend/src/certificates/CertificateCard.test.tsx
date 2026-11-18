import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { CertificateCard } from './CertificateCard';

describe('CertificateCard', () => {
  test('shows remaining course count when locked', () => {
    render(<CertificateCard status={{ status: 'locked', remainingCourses: 2, totalCourses: 6 }} />);
    expect(screen.getByText(/2 subjects? remaining/i)).toBeInTheDocument();
  });

  test('shows a download link when issued', () => {
    render(
      <CertificateCard
        status={{
          status: 'issued',
          certificate: { id: 'abc123', verificationId: 'LH-ABCD-1234', issuedAt: '2026-11-18T00:00:00.000Z' },
        }}
      />,
    );
    expect(screen.getByText('LH-ABCD-1234')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /download/i });
    expect(link).toHaveAttribute('href', '/api/v1/certificates/abc123/download');
  });
});
