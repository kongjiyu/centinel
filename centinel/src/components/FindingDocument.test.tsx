import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { FindingDocument } from './FindingDocument';
import { groupFindings } from '../findingGroups';
import { api } from '../api/client';
import type { Finding } from '../types';

vi.mock('../api/client', () => ({ api: { getReviewArtifactContent: vi.fn() } }));

const make = (id: string, recommendation: string, description = 'Two requests read before either writes, allowing duplicate inserts.'): Finding => ({
  id, projectId: 'p', sessionId: 'review', source: 'static', severity: 'high', status: 'new', title: 'Race condition in request handling',
  description, category: 'technical', filePath: `src/${id}.ts`, lineNumber: 5, artifactId: `artifact-${id}`, artifactVersionId: 'saved-hash',
  evidenceText: 'await insert();', recommendation, confidence: 'high', fromRemarks: false, createdAt: '2026-10-22',
  location: { issueType: 'race_condition', domain: 'technical', logicFlow: ['Request A reads an absent payment.', 'Request B reads the same absent payment.', 'Both insert a record.'] },
});

describe('finding detail', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());

  function StatefulFindingDocument({ group, initialId = 'a' }: { group: ReturnType<typeof groupFindings>[number]; initialId?: string }) {
    const [id, setId] = useState(initialId);
    return <FindingDocument group={group} selectedId={id} onSelect={setId} onBack={vi.fn()} actions={() => null} />;
  }

  it('keeps the shared action visible and renders only one selected occurrence', () => {
    const group = groupFindings([make('a', 'Enforce atomic uniqueness.'), make('b', 'Enforce atomic uniqueness.')])[0];
    render(<StatefulFindingDocument group={group} />);

    expect(screen.getByRole('heading', { name: 'Race Condition Risk' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What to do' })).toBeInTheDocument();
    expect(screen.getByText('Enforce atomic uniqueness.')).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /Selected occurrence/ })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'src/a.ts:5' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'src/b.ts:5' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Location' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'How to verify resolution' })).toHaveTextContent('No verification steps or completion criteria were recorded');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('keeps distinct remedies attached to the selected occurrence', async () => {
    const user = userEvent.setup();
    const group = groupFindings([make('a', 'Use an atomic claim.'), make('b', 'Deduplicate the callback key.')])[0];
    render(<StatefulFindingDocument group={group} />);

    expect(screen.getByText('Use an atomic claim.')).toBeInTheDocument();
    expect(screen.queryByText('Deduplicate the callback key.')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Location' }), 'b');
    expect(screen.getByText('Deduplicate the callback key.')).toBeInTheDocument();
    expect(screen.queryByText('Use an atomic claim.')).not.toBeInTheDocument();
  });

  it('opens the selected saved version in the in-detail reader and returns to the same occurrence', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getReviewArtifactContent).mockResolvedValue({
      versionId: 'saved-version', contentHash: 'saved-hash', content: btoa('line one\nline two\nline three\nline four\nawait insert();\nline six'), mimeType: 'text/typescript',
    });
    const group = groupFindings([make('a', 'Use an atomic claim.'), make('b', 'Deduplicate the callback key.')])[0];
    render(<StatefulFindingDocument group={group} initialId="b" />);

    await user.click(screen.getByRole('button', { name: 'Preview reviewed source src/b.ts:5' }));
    expect(await screen.findByRole('dialog', { name: /Reviewed source preview src\/b.ts/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open full reviewed source' }));
    expect(screen.getByRole('article', { name: 'Reviewed source reader' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'src/b.ts' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Reviewed source src/b.ts' })).toHaveTextContent('await insert();');
    expect(api.getReviewArtifactContent).toHaveBeenCalledWith('p', 'review', 'artifact-b');

    await user.click(screen.getByRole('button', { name: 'Back to finding' }));
    await waitFor(() => expect(screen.getByRole('article', { name: 'Finding details' })).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'src/b.ts:5' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: /Selected occurrence/ })).getByText('Deduplicate the callback key.')).toBeInTheDocument();
  });

  it('carries candidate uncertainty into the full reviewed-source reader', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getReviewArtifactContent).mockResolvedValue({ versionId: 'saved-version', contentHash: 'saved-hash', content: btoa('line one\nline two\nline three\nline four\nawait insert();\nline six'), mimeType: 'text/typescript' });
    const candidateFinding = {
      ...make('b', 'Deduplicate the callback key.'),
      location: {
        ...make('b', 'Deduplicate the callback key.').location,
        sourceLocator: {
          artifactId: 'artifact-b', filePath: 'src/b.ts', lineStart: 5, excerpt: 'await insert();',
          citationEvidence: { version: 1 as const, verification: 'needs_verification' as const, reason: 'source_match' as const, unmatchedReferences: 0,
            candidates: [{ artifactId: 'artifact-b', sourceVersion: 'saved-hash', filePath: 'src/b.ts', lineNumber: 5, excerpt: 'await insert();', score: 59, confidence: 'low' as const, match: 'approximate' as const, referenceIndex: 0 }] },
        },
      },
    };
    const group = groupFindings([candidateFinding])[0];
    render(<StatefulFindingDocument group={group} initialId="b" />);

    await user.click(screen.getByRole('button', { name: 'Preview reviewed source src/b.ts:5' }));
    const preview = await screen.findByRole('dialog', { name: /Reviewed source preview src\/b.ts/ });
    expect(within(preview).getByText('Candidate location · needs verification')).toBeInTheDocument();
    await user.click(within(preview).getByRole('button', { name: 'Open full reviewed source' }));
    expect(screen.getByText('This is a candidate source location and needs verification.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Reviewed source src/b.ts' }).querySelector('[data-line="5"]')).toHaveClass('is-uncertain');
  });
});
