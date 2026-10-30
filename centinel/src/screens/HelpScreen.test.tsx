import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HelpScreen } from './HelpScreen';

describe('HelpScreen', () => {
  it('explains the Review workflow and source updates in task-focused sections', () => {
    render(<HelpScreen />);

    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Start a Review' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Follow Activity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Read the result' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Inspect evidence' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Update project sources' })).toBeInTheDocument();
    expect(screen.getByText(/does not browse or inspect repository files/i)).toBeInTheDocument();
    expect(screen.getByText(/Source updates and model-backed indexing or assessment are separate/i)).toBeInTheDocument();
  });
});

