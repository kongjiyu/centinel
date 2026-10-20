import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { ReviewAnalysisScope } from './ReviewAnalysisScope';
import type { ReviewAnalysisMap } from '../reviewHarness';

describe('ReviewAnalysisScope', () => {
  it('keeps missing historical evidence explicit', () => {
    render(<ReviewAnalysisScope map={null} />);
    expect(screen.getByText('Feature and path coverage was not recorded for this review.')).toBeInTheDocument();
  });
  it('shows the four domains and opens linked findings without rendering their full detail', async () => {
    const map: ReviewAnalysisMap = { schemaVersion: 1, status: 'partial', coverage: { exhaustive: false, sourceArtifacts: 2, parsedArtifacts: 1, unresolvedEdgeCount: 1, unsupportedArtifacts: [{ artifactId: 'py', filePath: 'worker.py', reason: 'Unsupported language.' }], limitations: ['Runtime paths remain unverified.'] },
      features: [{ id: 'delete', label: 'Delete account', provisional: true, entryPoints: [], paths: [], unresolved: [{ reason: 'Undo outcome is not verified.' }], assessments: [
        { domain: 'security', status: 'unverified', outcome: 'unverified', summary: '' },
        { domain: 'business', status: 'unverified', outcome: 'unverified', summary: '' },
        { domain: 'technical', status: 'unverified', outcome: 'unverified', summary: '' },
        { domain: 'personnel', status: 'assessed', outcome: 'potential_gap', summary: 'The delete action has no recorded recovery decision.' },
      ] }] };
    const open = vi.fn();
    render(<ReviewAnalysisScope map={map} findings={[{ id: 'finding', title: 'Delete needs a recovery decision', description: 'PRIVATE FULL DETAILS', location: { sourceLocator: { analysis: { featureId: 'delete', pathId: 'path', domain: 'personnel' } } } } as any]} onOpenFinding={open} />);
    expect(screen.getByRole('status')).toHaveTextContent('Unverified coverage is not a clean result.');
    expect(screen.getByText('Human error:')).toBeInTheDocument();
    expect(screen.getByText('worker.py: Unsupported language.')).toBeInTheDocument();
    expect(screen.getByText('The delete action has no recorded recovery decision.')).toBeInTheDocument();
    expect(screen.queryByText('PRIVATE FULL DETAILS')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Delete account · 0 mapped paths'));
    await userEvent.click(screen.getByRole('button', { name: 'View finding: Delete needs a recovery decision' }));
    expect(open).toHaveBeenCalledWith('finding');
  });
});
