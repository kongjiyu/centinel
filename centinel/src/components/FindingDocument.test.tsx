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

  it('previews the frozen file and highlights the recorded lines from grouped occurrences', async () => {
    const first = make('a', 'Use an atomic claim.');
    const repeated = { ...first, id: 'repeat', lineNumber: 2, evidenceText: 'second observation' };
    vi.mocked(api.getReviewArtifactContent).mockResolvedValue({
      versionId: 'saved-version', contentHash: 'saved-hash',
      content: btoa('line one\nsecond observation\nline three\nline four\nawait insert();'), mimeType: 'text/typescript',
    });
    render(<StatefulFindingDocument group={groupFindings([first, repeated])[0]} />);
    await userEvent.hover(screen.getByRole('button', { name: 'src/a.ts' }));
    const preview = await screen.findByRole('region', { name: 'Reviewed source preview src/a.ts' });
    expect(preview.querySelector('[data-line="2"]')).toHaveClass('is-highlighted');
    expect(preview.querySelector('[data-line="5"]')).toHaveClass('is-highlighted');
    expect(api.getReviewArtifactContent).toHaveBeenCalledWith('p', 'review', 'artifact-a');
  });

  it('keeps the shared action visible and renders only one selected occurrence', () => {
    const group = groupFindings([make('a', 'Enforce atomic uniqueness.'), make('b', 'Enforce atomic uniqueness.')])[0];
    render(<StatefulFindingDocument group={group} />);

    expect(screen.getByRole('heading', { name: 'Race Condition Risk' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recommended changes' })).toBeInTheDocument();
    expect(screen.getByText('Enforce atomic uniqueness.')).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /Selected occurrence/ })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'src/a.ts:5' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'src/b.ts:5' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Location' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'How to verify resolution' })).toHaveTextContent('No verification steps or completion criteria were recorded');
    expect(screen.getByRole('table', { name: 'Evidence without a recorded feature' })).toBeInTheDocument();
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

  it('ranks recorded features by unique highlighted lines and opens the selected file', async () => {
    const user = userEvent.setup();
    const evidence = (id: string, featureId: string, excerpt: string) => ({
      ...make(id, 'Use an atomic claim.'),
      evidenceText: excerpt,
      location: { ...make(id, '').location, sourceLocator: { analysis: { featureId, pathId: 'path', domain: 'technical' } } },
    });
    const high = evidence('a', 'feature-large', 'line one\nline two\nline three');
    const group = groupFindings([high, { ...high, id: 'a-repeat' }, evidence('b', 'feature-other', 'line one'),
      evidence('c', 'feature-third', 'line one'), evidence('d', 'feature-fourth', 'line one')])[0];
    render(<StatefulFindingDocument group={group} />);
    const ranked = screen.getByLabelText('Ranked evidence');
    expect(within(ranked).getAllByRole('heading')).toHaveLength(3);
    expect(within(ranked).getAllByRole('heading')[0].parentElement).toHaveTextContent('1 affected file');
    expect(within(ranked).getByText('3 lines highlighted')).toBeInTheDocument();
    await user.click(within(ranked).getByRole('button', { name: 'Show all evidence' }));
    expect(within(ranked).getAllByRole('heading')).toHaveLength(4);
    await user.click(within(ranked).getByRole('button', { name: 'src/b.ts' }));
    expect(screen.getByLabelText('Saved excerpt from src/b.ts')).toHaveTextContent('line one');
    expect(screen.getByRole('button', { name: 'Preview reviewed source src/b.ts:5' })).toBeInTheDocument();
  });

  it('expands each feature independently and shows the number of hidden files', async () => {
    const user = userEvent.setup();
    const group = groupFindings(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((id, index) => {
      const finding = make(id, 'Use an atomic claim.');
      return { ...finding, location: { ...finding.location, sourceLocator: {
        analysis: { featureId: index < 5 ? 'feature-one' : 'feature-two', pathId: 'path', domain: 'technical' as const },
      } } };
    }))[0];
    render(<StatefulFindingDocument group={group} />);
    const ranked = within(screen.getByLabelText('Ranked evidence'));
    expect(ranked.getByText('5 affected files')).toBeInTheDocument();
    expect(ranked.queryByRole('button', { name: 'src/d.ts' })).not.toBeInTheDocument();
    expect(ranked.queryByRole('button', { name: 'src/i.ts' })).not.toBeInTheDocument();
    await user.click(ranked.getByRole('button', { name: 'Show 2 more files' }));
    expect(ranked.getByRole('button', { name: 'src/d.ts' })).toBeInTheDocument();
    expect(ranked.queryByRole('button', { name: 'src/i.ts' })).not.toBeInTheDocument();
    await user.click(ranked.getByRole('button', { name: 'Show fewer files' }));
    expect(ranked.queryByRole('button', { name: 'src/d.ts' })).not.toBeInTheDocument();
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
    expect(within(screen.getByRole('region', { name: 'Recommended Action' })).getByText('Deduplicate the callback key.')).toBeInTheDocument();
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

  it('copies a fix prompt for the selected occurrence and confirms it', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const group = groupFindings([make('a', 'Use an atomic claim.')])[0];
    render(<StatefulFindingDocument group={group} />);

    const fix = screen.getByRole('region', { name: 'Fix this issue' });
    await user.click(within(fix).getByRole('button', { name: 'Copy fix prompt' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const prompt = writeText.mock.calls[0][0] as string;
    expect(prompt).toContain('Issue: Race condition in request handling');
    expect(prompt).toContain('Location: src/a.ts:5');
    expect(prompt).toContain('await insert();');
    expect(prompt).toContain('What to do:\nUse an atomic claim.');
    expect(prompt).not.toContain('artifact-a');
    expect(within(fix).getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Fix prompt copied to the clipboard.');
  });

  it('shows the prompt for manual copying when the clipboard is unavailable', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    Object.defineProperty(document, 'execCommand', { value: vi.fn().mockReturnValue(false), configurable: true });
    render(<StatefulFindingDocument group={groupFindings([make('a', 'Use an atomic claim.')])[0]} />);
    await user.click(screen.getByRole('button', { name: 'Copy fix prompt' }));
    expect(screen.getByRole('alert')).toHaveTextContent('clipboard is unavailable');
    expect((screen.getByLabelText('Fix prompt') as HTMLTextAreaElement).value).toContain('Location: src/a.ts:5');
  });

  it('starts the host re-check and reports a failure beside the action', async () => {
    const user = userEvent.setup();
    const run = vi.fn().mockRejectedValueOnce(new Error('The retry request could not be created.')).mockResolvedValueOnce(undefined);
    const recheckFor = vi.fn(() => ({ hint: 'Creates a linked attempt with the current sources.', run }));
    const group = groupFindings([make('a', 'Use an atomic claim.')])[0];
    render(<FindingDocument group={group} selectedId="a" onSelect={vi.fn()} onBack={vi.fn()} actions={() => null} recheckFor={recheckFor} />);

    const verification = screen.getByRole('region', { name: 'How to verify resolution' });
    expect(verification).toHaveTextContent('Creates a linked attempt with the current sources.');
    await user.click(within(verification).getByRole('button', { name: 'Re-check' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The retry request could not be created.');
    await user.click(within(verification).getByRole('button', { name: 'Re-check' }));
    expect(run).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(recheckFor).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('lets the person close a finding a newer Review did not find again', async () => {
    const user = userEvent.setup();
    const markResolved = vi.fn().mockResolvedValue(undefined);
    const recheckFor = () => ({ hint: 'Prepares a comparison Review.', run: vi.fn(), latestResult: 'Not found in “Re-check” (6 Nov).', markResolved });
    render(<FindingDocument group={groupFindings([make('a', 'x')])[0]} selectedId="a" onSelect={vi.fn()} onBack={vi.fn()} actions={() => null} recheckFor={recheckFor} />);
    expect(screen.getByText('Not found in “Re-check” (6 Nov).')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I fixed it — mark as resolved' }));
    expect(markResolved).toHaveBeenCalledTimes(1);
  });

  it('hides re-check when the host offers none', () => {
    render(<FindingDocument group={groupFindings([make('a', 'x')])[0]} selectedId="a" onSelect={vi.fn()} onBack={vi.fn()} actions={() => null} recheckFor={() => null} />);
    expect(screen.queryByRole('button', { name: 'Re-check' })).not.toBeInTheDocument();
  });

  it('collapses repeated detections at one location while keeping each occurrence selectable', async () => {
    const user = userEvent.setup();
    const repeat = (id: string, line: number, createdAt: string) => ({ ...make(id, 'Use an atomic claim.'), filePath: 'src/pay.ts', lineNumber: line, createdAt });
    const group = groupFindings([repeat('a', 5, '2026-11-03'), repeat('b', 7, '2026-11-01'), make('c', 'Use an atomic claim.')])[0];
    render(<StatefulFindingDocument group={group} />);

    expect(screen.getByText('2 affected locations · 3 occurrences across Reviews')).toBeInTheDocument();
    expect(screen.getByText('Found 2 times at this location across Reviews.')).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: 'Location' });
    const optgroup = select.querySelector('optgroup');
    expect(optgroup).toHaveAttribute('label', 'src/pay.ts:5 · 2 occurrences');
    expect(within(optgroup as HTMLElement).getAllByRole('option')).toHaveLength(2);
    await user.selectOptions(select, 'b');
    expect(screen.getByRole('heading', { name: 'src/pay.ts:7' })).toBeInTheDocument();
    await user.selectOptions(select, 'c');
    expect(screen.queryByText(/Found \d times at this location/)).not.toBeInTheDocument();
  });
  it('explains a rule-only check, says no AI issue covers it and does not invent a requirement link', () => {
    const secret: Finding = { ...make('secret', 'Load it from the environment.'), title: '[secrets-api-key] Possible hardcoded credential in "secret".',
      verifier: 'deterministic', category: 'secrets', filePath: 'backend/app.ts', lineNumber: 60, location: { ruleId: 'secrets-api-key' } };
    render(<StatefulFindingDocument group={groupFindings([secret])[0]} initialId="secret" />);
    const section = screen.getByRole('region', { name: 'About this rule check' });
    expect(section).toHaveTextContent('written directly in the source code');
    expect(section).toHaveTextContent('The AI review did not report an issue at this location');
    expect(section).toHaveTextContent('No requirement is linked to this finding');
  });

  it('shows a recorded requirement link on a rule-only check', () => {
    const secret: Finding = { ...make('secret', 'Load it from the environment.'), title: '[secrets-api-key] Possible hardcoded credential in "secret".',
      verifier: 'deterministic', category: 'secrets', requirementId: 'REQ-7', location: { ruleId: 'secrets-api-key' } };
    render(<StatefulFindingDocument group={groupFindings([secret])[0]} initialId="secret" />);
    expect(screen.getByRole('region', { name: 'About this rule check' })).toHaveTextContent('Linked requirement: REQ-7');
  });

  it('does not show the rule-only note when an AI-reported issue covers the same place', () => {
    const model = make('a', 'Use an atomic claim.');
    const rule: Finding = { ...make('rule', 'Check it.'), title: '[cq-console-log] console.log', verifier: 'deterministic', filePath: 'src/a.ts', lineNumber: 5, location: { ruleId: 'cq-console-log' } };
    const groups = groupFindings([model, rule]);
    expect(groups).toHaveLength(1);
    render(<StatefulFindingDocument group={groups[0]} initialId="rule" />);
    expect(screen.queryByRole('region', { name: 'About this rule check' })).not.toBeInTheDocument();
  });

  it('lists repeats of the issue that the Review kept as evidence on the finding', () => {
    const finding = make('a', 'Use an atomic claim.');
    finding.location = { ...finding.location, sourceLocator: { mergedObservationTotal: 2, mergedObservations: [
      { version: 1, reason: 'uncertain_copy_of_verified', source: 'model', title: 'Duplicate payment insert', description: 'Both requests insert.', severity: 'high', confidence: 'medium',
        category: 'technical', issueType: 'race_condition', filePath: 'src/a.ts', lineNumber: 6, evidence: 'await insert(payment);', requirementId: null, fingerprint: 'f1', verification: 'needs_verification' },
      { version: 1, reason: 'same_location_and_type', source: 'model', title: 'Concurrent write race', description: 'Concurrent write race', severity: 'high', confidence: 'high',
        category: 'technical', issueType: 'race_condition', filePath: 'src/a.ts', lineNumber: 5, evidence: 'await insert();', requirementId: null, fingerprint: 'f2', verification: 'verified' },
    ] } };
    render(<StatefulFindingDocument group={groupFindings([finding])[0]} />);
    const section = screen.getByRole('region', { name: 'Also reported in this Review' });
    expect(section).toHaveTextContent('2 more times');
    expect(section).toHaveTextContent('Duplicate payment insert · src/a.ts:6 · Needs verification');
    expect(section).toHaveTextContent('Concurrent write race · src/a.ts:5 · Citation verified');
    expect(within(section).getByText('await insert(payment);')).toBeInTheDocument();
  });
});
