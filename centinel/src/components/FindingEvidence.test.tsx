import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FindingEvidence } from './FindingEvidence';
import { api } from '../api/client';
import type { Finding } from '../types';

vi.mock('../api/client', () => ({ api: { getReviewArtifactContent: vi.fn() } }));

const finding = {
  id: 'f', projectId: 'p', sessionId: 'review', source: 'static', artifactId: 'a',
  filePath: 'pay.ts', lineNumber: 1, evidenceText: 'saved excerpt',
  location: { sourceVersion: 'expected-hash' },
} as Finding;
type CitationEvidenceMetadata = NonNullable<NonNullable<Finding['location']>['sourceLocator']>['citationEvidence'];

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    artifactId: 'artifact-candidate',
    sourceVersion: 'expected-hash',
    filePath: 'src/checkout.ts',
    lineNumber: 12,
    excerpt: 'return checkout();',
    score: 100,
    confidence: 'low',
    match: 'exact',
    referenceIndex: 0,
    ...overrides,
  };
}

function withCitationEvidence(metadata: unknown): Finding {
  return {
    ...finding,
    location: {
      sourceVersion: 'expected-hash',
      sourceLocator: { citationEvidence: metadata as CitationEvidenceMetadata },
    },
  } as Finding;
}

function citationEvidence(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    verification: 'verified',
    reason: 'source_match',
    candidates: [candidate()],
    unmatchedReferences: 0,
    ...overrides,
  };
}

describe('finding source version integrity', () => {
  it('shows a recorded reference only once when the same exact evidence is already ranked', () => {
    const excerpt = 'await checkout();';
    const row = { ...finding, artifactId: 'artifact-candidate', filePath: 'src/checkout.ts', lineNumber: 12, evidenceText: excerpt,
      location: { sourceVersion: 'expected-hash', sourceLocator: { citationEvidence: { version: 1, verification: 'verified', reason: 'source_match',
        unmatchedReferences: 0, candidates: [candidate({ excerpt })] } } } } as Finding;
    render(<FindingEvidence finding={row} />);
    expect(screen.getAllByText(excerpt)).toHaveLength(1);
    expect(screen.getByLabelText('Candidate excerpt from src/checkout.ts:12')).toBeInTheDocument();
    expect(screen.queryByLabelText('Saved excerpt from src/checkout.ts')).not.toBeInTheDocument();
  });
  beforeEach(() => vi.clearAllMocks());

  it('rejects a different saved version without substituting source content', async () => {
    vi.mocked(api.getReviewArtifactContent).mockResolvedValue({ versionId: 'other-version', contentHash: 'other-hash', content: btoa('wrong body'), mimeType: 'text/typescript' });
    render(<FindingEvidence finding={finding} />);
    await userEvent.click(screen.getByRole('button', { name: 'View reviewed source' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('saved reference version does not match');
    expect(screen.queryByText('wrong body')).not.toBeInTheDocument();
    expect(api.getReviewArtifactContent).toHaveBeenCalledWith('p', 'review', 'a');
  });

  it('loads matching reviewed content on demand and preserves the recorded excerpt', async () => {
    vi.mocked(api.getReviewArtifactContent).mockResolvedValue({ versionId: 'version', contentHash: 'expected-hash', content: btoa('reviewed body'), mimeType: 'text/typescript' });
    render(<FindingEvidence finding={finding} />);
    expect(api.getReviewArtifactContent).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'View reviewed source' }));
    expect(await screen.findByLabelText('Reviewed source pay.ts')).toHaveTextContent('reviewed body');
    expect(screen.getByLabelText('Saved excerpt from pay.ts')).toHaveTextContent('saved excerpt');
  });

  it('highlights the strongest candidate and discloses the others with score-derived confidence', async () => {
    const user = userEvent.setup();
    const reviewed = withCitationEvidence(citationEvidence({ candidates: [
      candidate({ confidence: 'low' }),
      candidate({ artifactId: 'alternate', filePath: 'src/legacy.ts', lineNumber: 35, excerpt: 'checkout();', score: 59, confidence: 'high', match: 'approximate' }),
    ] }));
    render(<FindingEvidence finding={reviewed} />);

    expect(screen.getByText('Best source match')).toBeInTheDocument();
    expect(screen.getByText('High match strength')).toBeInTheDocument();
    expect(screen.getByText('100% match')).toBeInTheDocument();
    const alternatives = screen.getByText('Other candidates (1)').closest('details');
    expect(alternatives).not.toHaveAttribute('open');

    await user.click(screen.getByText('Other candidates (1)'));
    expect(alternatives).toHaveAttribute('open');
    expect(await screen.findByText('src/legacy.ts:35')).toBeInTheDocument();
    expect(screen.getByText('Low match strength')).toBeInTheDocument();
    expect(screen.getByText('59% match')).toBeInTheDocument();
  });

  it('keeps semantic support review distinct from a strong literal match', () => {
    render(<FindingEvidence finding={withCitationEvidence(citationEvidence({
      verification: 'needs_verification',
      reason: 'support_unverified',
    }))} />);

    expect(screen.getByText('High match strength')).toBeInTheDocument();
    expect(screen.getByText('Support for the finding needs verification')).toBeInTheDocument();
    expect(screen.getByText(/does not measure whether the finding is correct/)).toBeInTheDocument();
  });

  it.each([
    ['out-of-range scores', citationEvidence({ candidates: [candidate({ score: 101 })] })],
    ['too many candidates for one reference', citationEvidence({ candidates: Array.from({ length: 4 }, (_, index) => candidate({ lineNumber: 12 + index })) })],
    ['oversized excerpts', citationEvidence({ candidates: [candidate({ excerpt: 'x'.repeat(2_001) })] })],
  ])('ignores malformed persisted match metadata (%s) and keeps legacy evidence without scores', (_label, metadata) => {
    render(<FindingEvidence finding={withCitationEvidence(metadata)} />);

    expect(screen.queryByText(/match strength/)).not.toBeInTheDocument();
    expect(screen.queryByText('Best source match')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Saved excerpt from pay.ts')).toHaveTextContent('saved excerpt');
  });

  it('applies the saved version guard to candidate previews', async () => {
    vi.mocked(api.getReviewArtifactContent).mockResolvedValue({ versionId: 'other-version', contentHash: 'other-hash', content: btoa('wrong body'), mimeType: 'text/typescript' });
    render(<FindingEvidence finding={withCitationEvidence(citationEvidence({
      candidates: [candidate({ sourceVersion: 'candidate-hash' })],
    }))} />);

    await userEvent.click(screen.getByRole('button', { name: 'View reviewed source src/checkout.ts:12' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('saved reference version does not match');
    expect(screen.queryByText('wrong body')).not.toBeInTheDocument();
    expect(api.getReviewArtifactContent).toHaveBeenCalledWith('p', 'review', 'artifact-candidate');
  });
});
