import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingSkeleton } from './LoadingSkeleton';

describe('LoadingSkeleton', () => {
  it('announces a busy state and keeps decorative bars out of the accessibility tree', () => {
    const { container } = render(<LoadingSkeleton variant="rows" rows={4} label="Loading collaborators" />);
    const status = screen.getByRole('status', { name: 'Loading collaborators' });

    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('.loading-skeleton-row')).toHaveLength(4);
    expect(container.querySelector('.loading-skeleton-visual')).toHaveAttribute('aria-hidden', 'true');
  });
});
