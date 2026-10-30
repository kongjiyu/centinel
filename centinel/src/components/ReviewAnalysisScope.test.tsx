import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { ReviewAnalysisScope } from './ReviewAnalysisScope';
import type { ReviewAnalysisMap } from '../reviewHarness';

describe('ReviewAnalysisScope', () => {
  it('does not present diagnostic operation counts as assessed text coverage', () => {
    const map: ReviewAnalysisMap = { schemaVersion: 1, status: 'unverified', features: [],
      coverage: { sourceArtifacts: 301, parsedArtifacts: 0, assessmentMode: 'plain_text_context_fallback', syntaxFeatureCount: 1379,
        exhaustive: false, unresolvedEdgeCount: 1, limitations: [], unsupportedArtifacts: [] } };
    render(<ReviewAnalysisScope map={map} />);
    expect(screen.getByText(/original 1379 mapped operations exceed the bounded source or request-count plan/)).toHaveTextContent('coverage remain unverified');
    expect(screen.queryByText(/identified 0 possible features/)).not.toBeInTheDocument();
  });
  it('labels plain-text logic separately from mapped executable paths', () => {
    const map: ReviewAnalysisMap = { schemaVersion: 1, status: 'assessed',
      coverage: { sourceArtifacts: 1, parsedArtifacts: 0, plainTextLogicArtifactCount: 1, plainTextLogicUnitCount: 1,
        exhaustive: false, unresolvedEdgeCount: 1, limitations: [], unsupportedArtifacts: [] },
      features: [{ id: 'text', label: 'worker.py:1–3', provisional: true, analysisKind: 'plain_text_logic', sourceRange: { lineStart: 1, lineEnd: 3 },
        entryPoints: [], paths: [{ id: 'unknown', kind: 'unresolved', label: 'Parser paths unverified', status: 'unverified', evidence: [] }], assessments: [], unresolved: [] }] };
    render(<ReviewAnalysisScope map={map} />);
    expect(screen.getByText('worker.py:1–3 · text logic')).toBeInTheDocument();
    expect(screen.getByText(/1 file · 1 plain-text logic section/)).toBeInTheDocument();
    expect(screen.queryByText(/1 mapped path/)).not.toBeInTheDocument();
  });
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
