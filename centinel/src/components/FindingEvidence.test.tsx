import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FindingEvidence, SourceCode } from './FindingEvidence';
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
  afterEach(() => vi.restoreAllMocks());

  it('rejects a different saved version without substituting source content', async () => {
    vi.mocked(api.getReviewArtifactContent).mockResolvedValue({ versionId: 'other-version', contentHash: 'other-hash', content: btoa('wrong body'), mimeType: 'text/typescript' });
    render(<FindingEvidence finding={finding} />);
    await userEvent.click(screen.getByRole('button', { name: 'Preview reviewed source pay.ts:1' }));
    expect(await screen.findByRole('dialog', { name: /Reviewed source preview pay\.ts/ })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('saved reference version does not match');
    expect(screen.queryByText('wrong body')).not.toBeInTheDocument();
    expect(api.getReviewArtifactContent).toHaveBeenCalledWith('p', 'review', 'a');
  });

  it('loads matching reviewed content on demand and preserves the recorded excerpt', async () => {
    vi.mocked(api.getReviewArtifactContent).mockResolvedValue({ versionId: 'version', contentHash: 'expected-hash', content: btoa('reviewed body'), mimeType: 'text/typescript' });
    render(<FindingEvidence finding={finding} />);
    expect(api.getReviewArtifactContent).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Preview reviewed source pay.ts:1' }));
    expect(await screen.findByRole('region', { name: 'Reviewed source preview pay.ts' })).toHaveTextContent('reviewed body');
    expect(screen.getByLabelText('Saved excerpt from pay.ts')).toHaveTextContent('saved excerpt');
  });

  it('opens the reader only on a deliberate preview click, not while selecting or scrolling source text', async () => {
    const onOpenSource = vi.fn();
    vi.mocked(api.getReviewArtifactContent).mockResolvedValue({ versionId: 'version', contentHash: 'expected-hash', content: btoa('first line\nsaved excerpt\nthird line'), mimeType: 'text/typescript' });
    render(<FindingEvidence finding={finding} onOpenSource={onOpenSource} />);
    await userEvent.click(screen.getByRole('button', { name: 'Preview reviewed source pay.ts:1' }));
    const source = await screen.findByRole('region', { name: 'Reviewed source preview pay.ts' });
    expect(source.querySelector('[data-line="1"]')).toHaveAttribute('data-preview-location', 'true');
    expect(source.querySelector('[data-line="1"]')).toHaveClass('is-highlighted');

    const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'first line' } as Selection);
    fireEvent.click(source, { clientX: 12 });
    expect(onOpenSource).not.toHaveBeenCalled();
    getSelection.mockReturnValue({ toString: () => '' } as Selection);
    fireEvent.mouseDown(source, { clientX: 20, clientY: 30 });
    fireEvent.mouseMove(source, { clientX: 20, clientY: 80 });
    fireEvent.mouseUp(source, { clientX: 20, clientY: 80 });
    fireEvent.click(source, { clientX: 20, clientY: 80 });
    expect(onOpenSource).not.toHaveBeenCalled();
    await new Promise(resolve => window.setTimeout(resolve, 0));
    await userEvent.click(source);
    expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ filePath: 'pay.ts', lineNumber: 1 }), 'first line\nsaved excerpt\nthird line', false);
    onOpenSource.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Open full reviewed source' }));
    expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ filePath: 'pay.ts', lineNumber: 1 }), 'first line\nsaved excerpt\nthird line', false);
    getSelection.mockRestore();
  });

  it('closes a preview on Escape without reopening when focus returns to its source indicator', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getReviewArtifactContent).mockResolvedValue({ versionId: 'version', contentHash: 'expected-hash', content: btoa('reviewed source'), mimeType: 'text/typescript' });
    const { container } = render(<FindingEvidence finding={finding} />);
    const trigger = screen.getByRole('button', { name: 'Preview reviewed source pay.ts:1' });
    await user.click(trigger);
    const source = await screen.findByRole('region', { name: 'Reviewed source preview pay.ts' });
    source.focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /Reviewed source preview pay\.ts/ })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await new Promise(resolve => window.setTimeout(resolve, 1));
    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument();
  });

  it('scrolls a long full-source reader to the recorded line', async () => {
    const view = render(<SourceCode text="first" sourceRef={{ filePath: 'large.ts', lineNumber: 1, relation: 'code' }} />);
    const source = screen.getByRole('region', { name: 'Reviewed source large.ts' });
    Object.defineProperty(source, 'clientHeight', { configurable: true, value: 200 });
    const originalGetRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: HTMLElement) {
      if (this === source) return { top: 0, bottom: 200, left: 0, right: 600, width: 600, height: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      const line = this.getAttribute('data-line');
      if (line) {
        const top = Number(line) * 10;
        return { top, bottom: top + 10, left: 0, right: 600, width: 600, height: 10, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
      }
      return originalGetRect.call(this);
    });
    const lines = Array.from({ length: 450 }, (_, index) => `line ${index + 1}`);
    view.rerender(<SourceCode text={lines.join('\n')} sourceRef={{ filePath: 'large.ts', lineNumber: 400, relation: 'code' }} />);

    expect(await screen.findByText('line 400')).toBeInTheDocument();
    expect(source.querySelector('[data-line="400"]')).toHaveClass('is-highlighted');
    await waitFor(() => expect(source.scrollTop).toBeGreaterThan(0));
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

  it('keeps an approximate candidate uncertain after a failed load and retry', async () => {
    const user = userEvent.setup();
    const onOpenSource = vi.fn();
    const excerpt = 'return checkout();';
    const candidateLines = Array.from({ length: 13 }, (_, index) => `line ${index + 1}`);
    candidateLines[11] = excerpt;
    vi.mocked(api.getReviewArtifactContent).mockRejectedValueOnce(new Error('Temporary read failure')).mockResolvedValue({ versionId: 'version', contentHash: 'expected-hash', content: btoa(candidateLines.join('\n')), mimeType: 'text/typescript' });
    const reviewed = withCitationEvidence(citationEvidence({
      verification: 'needs_verification',
      candidates: [candidate({ lineNumber: 12, excerpt, score: 59, confidence: 'low', match: 'approximate' })],
    }));
    render(<FindingEvidence finding={reviewed} onOpenSource={onOpenSource} />);

    await user.hover(screen.getByRole('button', { name: 'Preview reviewed source src/checkout.ts:12' }));
    const preview = await screen.findByRole('dialog', { name: /Reviewed source preview src\/checkout.ts/ });
    await user.click(await within(preview).findByRole('button', { name: 'Retry' }));
    await within(preview).findByText(excerpt);
    expect(within(preview).getByText('Candidate location · needs verification')).toBeInTheDocument();
    expect(within(preview).getByText(excerpt).closest('.finding-source-line')).toHaveClass('is-uncertain');
    await user.click(within(preview).getByRole('button', { name: 'Open full reviewed source' }));
    expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ filePath: 'src/checkout.ts', lineNumber: 12 }), candidateLines.join('\n'), true);
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

    await userEvent.click(screen.getByRole('button', { name: 'Preview reviewed source src/checkout.ts:12' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('saved reference version does not match');
    expect(screen.queryByText('wrong body')).not.toBeInTheDocument();
    expect(api.getReviewArtifactContent).toHaveBeenCalledWith('p', 'review', 'artifact-candidate');
  });
});
