import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FindingsPanel, findingPresentationStatus } from './FindingsPanel';
import { api } from '../api/client';
import type { Finding } from '../types';

vi.mock('../api/client', () => ({
  api: {
    listFindings: vi.fn(),
    listStaticFindings: vi.fn(),
    getReviewArtifactContent: vi.fn(),
    updateFinding: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

const baseFinding: Finding = {
  id: 'f-1',
  projectId: 'p-1',
  sessionId: 's-1',
  source: 'static',
  severity: 'high',
  priority: 'High',
  title: 'Null pointer risk in auth.ts',
  description: 'x.y may be null when called from public API',
  status: 'new',
  createdAt: '2026-06-25T10:00:00.000Z',
  artifactId: null,
  category: 'potential_bug',
  evidenceText: 'const x = user.profile.name;',
  recommendation: 'Add a null check or use optional chaining.',
  confidence: 'high',
  fromRemarks: false,
  filePath: 'src/auth.ts',
  lineNumber: 42,
};

describe('FindingsPanel', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });
  afterEach(() => vi.restoreAllMocks());

  it('shows the latest occurrence once and sends actions to the original project finding ID', async () => {
    const latest: Finding = { ...baseFinding, id: 'original-issue', sessionId: 'latest-review', description: 'Latest review evidence',
      latestOccurrence: { findingId: 'new-occurrence', reviewId: 'latest-review', classification: 'recurring' },
      lineageHistory: [{ findingId: 'original-issue', reviewId: 'first-review', reviewName: 'First review', classification: 'recurring',
        status: 'new', title: 'Original issue', severity: 'high', createdAt: baseFinding.createdAt }] };
    vi.mocked(api.listFindings).mockResolvedValue([latest]);
    const user = userEvent.setup();
    const onOpenReview = vi.fn();
    render(<FindingsPanel projectId="p-1" presentation="project" onOpenReview={onOpenReview} />);
    const row = await screen.findByRole('row', { name: /Null pointer risk in auth.ts/i });
    await user.click(row);
    const details = screen.getByRole('article', { name: 'Finding details' });
    expect(within(details).getByText('Latest review evidence')).toBeInTheDocument();
    await user.click(within(details).getByRole('button', { name: 'Open review First review' }));
    expect(onOpenReview).toHaveBeenCalledWith('first-review');
    await user.click(within(details).getByRole('button', { name: 'Mark as resolved' }));
    expect(api.updateFinding).toHaveBeenCalledWith('p-1', 'original-issue', 'fixed');
  });

  it('maps legacy finding states to the three-state presentation', () => {
    expect(findingPresentationStatus('new')).toBe('unresolved');
    expect(findingPresentationStatus('carryover')).toBe('unresolved');
    expect(findingPresentationStatus('accepted')).toBe('unresolved');
    expect(findingPresentationStatus('fixed')).toBe('resolved');
    expect(findingPresentationStatus('dismissed')).toBe('dismiss');
  });

  it('shows a loading state while the API call is in flight', () => {
    vi.mocked(api.listFindings).mockReturnValue(new Promise(() => { /* never resolves */ }));
    render(<FindingsPanel projectId="p-1" />);
    expect(screen.getByText(/loading findings/i)).toBeInTheDocument();
  });

  it('shows an accessible skeleton during the initial Project Findings read', () => {
    vi.mocked(api.listFindings).mockReturnValue(new Promise(() => { /* never resolves */ }));
    render(<FindingsPanel projectId="p-1" presentation="project" />);
    const loading = screen.getByRole('status', { name: 'Loading findings' });
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading.querySelectorAll('.loading-skeleton-row')).toHaveLength(5);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders the empty state when there are no findings', async () => {
    vi.mocked(api.listFindings).mockResolvedValue([]);
    render(<FindingsPanel projectId="p-1" />);
    await waitFor(() => expect(screen.getByText(/no findings yet/i)).toBeInTheDocument());
  });

  it('renders a finding row with title, severity badge, source badge, and Unresolved status', async () => {
    vi.mocked(api.listFindings).mockResolvedValue([baseFinding]);
    render(<FindingsPanel projectId="p-1" />);
    await waitFor(() => expect(screen.getByText('Null pointer risk in auth.ts')).toBeInTheDocument());
    const row = screen.getByText('Null pointer risk in auth.ts').closest<HTMLElement>('.finding-row')!;
    expect(within(row).getByText('high')).toBeInTheDocument();
    expect(within(row).getByText('Review')).toBeInTheDocument();
    expect(within(row).getByText('Unresolved')).toBeInTheDocument();
  });

  it('sorts findings by severity (critical → info)', async () => {
    vi.mocked(api.listFindings).mockResolvedValue([
      { ...baseFinding, id: 'f-low', severity: 'low', title: 'Low one' },
      { ...baseFinding, id: 'f-crit', severity: 'critical', title: 'Critical one' },
      { ...baseFinding, id: 'f-med', severity: 'medium', title: 'Medium one' },
    ]);
    render(<FindingsPanel projectId="p-1" />);
    await waitFor(() => screen.getByText('Critical one'));
    const rows = Array.from(document.querySelectorAll('.finding-row')) as HTMLElement[];
    expect(within(rows[0]).getByText('Critical one')).toBeInTheDocument();
    expect(within(rows[rows.length - 1]).getByText('Low one')).toBeInTheDocument();
  });

  it('filters findings by source via the source dropdown', async () => {
    vi.mocked(api.listFindings).mockResolvedValue([
      { ...baseFinding, id: 'f-static', source: 'static' },
      { ...baseFinding, id: 'f-dyn', source: 'dynamic', title: 'Dynamic finding' },
    ]);
    const user = userEvent.setup();
    render(<FindingsPanel projectId="p-1" />);
    await waitFor(() => screen.getByText('Null pointer risk in auth.ts'));
    await user.click(screen.getByRole('button', { name: /^Filters/ }));
    await user.click(screen.getByRole('combobox', { name: 'Source' }));
    await user.click(screen.getByRole('option', { name: 'Dynamic Testing' }));
    expect(screen.queryByText('Null pointer risk in auth.ts')).not.toBeInTheDocument();
    expect(screen.getByText('Dynamic finding')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Source filter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('filters persisted accepted and carryover statuses as Unresolved', async () => {
    vi.mocked(api.listFindings).mockResolvedValue([
      { ...baseFinding, id: 'f-carry', status: 'carryover', title: 'Carryover from parent session' },
      { ...baseFinding, id: 'f-accepted', status: 'accepted', title: 'Accepted legacy finding' },
      { ...baseFinding, id: 'f-fixed', status: 'fixed', title: 'Resolved finding' },
      { ...baseFinding, id: 'f-dismissed', status: 'dismissed', title: 'Dismissed finding' },
    ]);
    const user = userEvent.setup();
    render(<FindingsPanel projectId="p-1" />);
    await waitFor(() => expect(screen.getByText('Carryover from parent session')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /^Filters/ }));
    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(screen.getByRole('option', { name: 'Unresolved' }));
    expect(screen.getByText('Carryover from parent session')).toBeInTheDocument();
    expect(screen.getByText('Accepted legacy finding')).toBeInTheDocument();
    expect(screen.queryByText('Resolved finding')).not.toBeInTheDocument();
    expect(screen.queryByText('Dismissed finding')).not.toBeInTheDocument();
  });

  it('calls api.updateFinding for Dismiss and Mark as resolved', async () => {
    vi.mocked(api.listFindings).mockResolvedValue([baseFinding]);
    const user = userEvent.setup();
    render(<FindingsPanel projectId="p-1" />);
    await waitFor(() => screen.getByText('Null pointer risk in auth.ts'));
    await user.click(screen.getByText('Null pointer risk in auth.ts'));
    await user.click(screen.getByRole('button', { name: 'Mark as resolved' }));
    expect(api.updateFinding).toHaveBeenCalledWith('p-1', 'f-1', 'fixed');
    expect(screen.getAllByText('Resolved')).not.toHaveLength(0);
  });

  it('hides the action that already represents the current state', async () => {
    vi.mocked(api.listFindings).mockResolvedValue([{ ...baseFinding, status: 'fixed' }]);
    const user = userEvent.setup();
    render(<FindingsPanel projectId="p-1" />);
    await waitFor(() => screen.getByText('Null pointer risk in auth.ts'));
    await user.click(screen.getByText('Null pointer risk in auth.ts'));
    expect(screen.queryByRole('button', { name: 'Mark as resolved' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('shows derived resolution evidence and opens its Review without writing a finding decision', async () => {
    const findingWithEvidence: Finding = {
      ...baseFinding,
      resolutionEvidence: {
        status: 'resolved', basis: 'not_reproduced_in_comparable_review', reviewId: 'review-new',
        reviewName: 'Re-review', sourceManifestId: 'manifest-new',
        previousSourceVersion: 'sha256:old', reviewedSourceVersion: 'sha256:new',
      },
    };
    vi.mocked(api.listFindings).mockResolvedValue([findingWithEvidence]);
    const onOpenReview = vi.fn();
    const user = userEvent.setup();
    render(<FindingsPanel projectId="p-1" presentation="project" onOpenReview={onOpenReview} />);
    const row = await screen.findByRole('row', { name: /Null pointer risk in auth.ts/i });
    expect(within(row).queryByText('Resolved')).not.toBeInTheDocument();
    await user.click(row);
    const details = screen.getByRole('article', { name: 'Finding details' });
    expect(details).toHaveTextContent('Resolved');
    expect(within(details).getByText(/Not reproduced in the comparable re-review/)).toBeInTheDocument();
    expect(within(details).getByText('sha256:old')).toBeInTheDocument();
    expect(within(details).getByText('sha256:new')).toBeInTheDocument();
    expect(within(details).getByText('manifest-new')).toBeInTheDocument();
    expect(within(details).queryByRole('button', { name: 'Mark as resolved' })).not.toBeInTheDocument();
    await user.click(within(details).getByRole('button', { name: 'Open review Re-review' }));
    expect(onOpenReview).toHaveBeenCalledWith('review-new');
    expect(api.updateFinding).not.toHaveBeenCalled();
  });

  it('supports numbered pages and ordered detail fields for Project Detail', async () => {
    const findings = Array.from({ length: 6 }, (_, index) => ({ ...baseFinding, id: `f-page-${index}`, title: `Paged finding ${index + 1}`, severity: index === 0 ? 'critical' : 'low' }));
    vi.mocked(api.listFindings).mockResolvedValue(findings);
    const user = userEvent.setup();
    render(<FindingsPanel projectId="p-1" presentation="project" pageSize={5} />);
    await waitFor(() => expect(screen.getByText('Paged finding 1')).toBeInTheDocument());
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.queryByText('Paged finding 6')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Paged finding 6')).toBeInTheDocument();
  });

  it('uses the Project Findings columns and supports keyboard row selection', async () => {
    vi.mocked(api.listFindings).mockResolvedValue([{ ...baseFinding, priority: 'high', title: 'Keyboard-selectable finding' }]);
    const user = userEvent.setup();
    render(<FindingsPanel projectId="p-1" presentation="project" pageSize={5} />);
    const table = await screen.findByRole('table', { name: 'Project findings' });
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual(['ID', 'Findings', 'Risk', 'Priority']);
    expect(screen.getByText('#f-1')).toBeInTheDocument();
    const row = within(table).getByRole('row', { name: /Keyboard-selectable finding/i });
    expect(within(row).getByText('Critical')).toHaveClass('project-finding-risk', 'project-risk-level-critical');
    expect(within(row).getByText('high')).toHaveClass('project-finding-priority', 'project-priority-level-high');
    expect(screen.queryByRole('article', { name: 'Finding details' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Source' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Filters/ }));
    expect(screen.getByRole('combobox', { name: 'Severity' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Priority' })).toBeInTheDocument();
    row.focus();
    await user.keyboard('{Enter}');
    const details = screen.getByRole('article', { name: 'Finding details' });
    expect(within(details).queryByText('Review')).not.toBeInTheDocument();
    expect(within(details).getByRole('heading', { name: 'Keyboard-selectable finding' })).toBeInTheDocument();
    expect(within(details).getByText('Add a null check or use optional chaining.')).toBeInTheDocument();
    expect(details.querySelector('.finding-provenance-details')).not.toHaveAttribute('open');
    await user.click(within(details).getByText('Technical provenance'));
    expect(within(details).getByText(/#f-1/)).toBeInTheDocument();
    expect(within(details).getByText('Recorded confidence')).toBeInTheDocument();
    const text = details.textContent || '';
    expect(text).not.toContain('Source type');
    expect(text).toContain('Review');
    expect(text).toContain('Priority high');
    expect(text).not.toContain('Severity');
    expect(text).not.toContain('Risk Category');
    expect(text).toContain('What to do');
  });

  it('keeps the Review-scoped table columns unchanged', async () => {
    vi.mocked(api.listStaticFindings).mockResolvedValue([baseFinding]);
    render(<FindingsPanel projectId="p-1" sessionId="s-1" presentation="project" />);
    const table = await screen.findByRole('table', { name: 'Review findings' });
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual(['ID', 'Status', 'Priority', 'Severity', 'Risk', 'Domain', 'Finding']);
  });

  it('keeps existing findings visible while the project list refreshes', async () => {
    let finishRefresh!: (findings: Finding[]) => void;
    vi.mocked(api.listFindings)
      .mockResolvedValueOnce([baseFinding])
      .mockReturnValueOnce(new Promise(resolve => { finishRefresh = resolve; }));
    const { rerender } = render(<FindingsPanel projectId="p-1" presentation="project" refreshKey="initial" />);
    expect(await screen.findByRole('row', { name: /Null pointer risk in auth.ts/i })).toBeInTheDocument();

    rerender(<FindingsPanel projectId="p-1" presentation="project" refreshKey="refresh" />);
    expect(await screen.findByText('Refreshing findings…')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Null pointer risk in auth.ts/i })).toBeInTheDocument();

    finishRefresh([{ ...baseFinding, id: 'f-new', title: 'Updated finding title' }]);
    expect(await screen.findByRole('row', { name: /Updated finding title/i })).toBeInTheDocument();
    expect(screen.queryByText('Refreshing findings…')).not.toBeInTheDocument();
  });

  it('calculates a display risk when a finding has severity but no recorded risk or priority', async () => {
    vi.mocked(api.listFindings).mockResolvedValue([{ ...baseFinding, priority: null, riskLevel: null, severity: 'critical' }]);
    render(<FindingsPanel projectId="p-1" presentation="project" pageSize={5} />);
    expect(await screen.findByTitle('Risk Level calculated from available finding data')).toHaveTextContent('Critical');
  });

  it('groups nesting locations once and updates only the selected occurrence', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listFindings).mockResolvedValue([
      { ...baseFinding, title: '[cq-deep-nesting] six levels', filePath: 'src/one.ts', status: 'fixed' },
      { ...baseFinding, id: 'f-2', title: '[cq-deep-nesting] eight levels', filePath: 'src/two.ts', lineNumber: 24 },
    ]);
    render(<FindingsPanel projectId="p-1" presentation="project" />);
    const row = await screen.findByRole('row', { name: /Code Deep Nesting Issue/ });
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(within(row).queryByText('Unresolved')).not.toBeInTheDocument();
    expect(within(row).getByText('2 affected occurrences')).toBeInTheDocument();
    await user.click(row);
    const details = screen.getByRole('article', { name: 'Finding details' });
    await user.selectOptions(within(details).getByRole('combobox', { name: 'Location' }), 'f-2');
    expect(within(details).getAllByRole('region', { name: /Selected occurrence/ })).toHaveLength(1);
    expect(within(details).getByRole('heading', { name: 'src/two.ts:24' })).toBeInTheDocument();
    await user.click(within(details).getByRole('button', { name: 'Mark as resolved' }));
    await waitFor(() => expect(api.updateFinding).toHaveBeenCalledWith('p-1', 'f-2', 'fixed'));
    expect(api.updateFinding).not.toHaveBeenCalledWith('p-1', 'f-1', 'fixed');
  });

  it('restores the findings scroll position and row focus after closing the full-width detail', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listFindings).mockResolvedValue([baseFinding]);
    const { container } = render(<div className="main-content"><FindingsPanel projectId="p-1" presentation="project" /></div>);
    const mainContent = container.querySelector<HTMLElement>('.main-content')!;
    mainContent.scrollTop = 238;
    const row = await screen.findByRole('row', { name: /Null pointer risk in auth.ts/i });
    await user.click(row);
    await user.click(screen.getByRole('button', { name: 'Back to findings' }));
    expect(await screen.findByRole('row', { name: /Null pointer risk in auth.ts/i })).toHaveFocus();
    expect(mainContent.scrollTop).toBe(238);
  });

  it('opens a finding ID inside its group and returns from its saved-source reader to the same occurrence', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getReviewArtifactContent).mockResolvedValue({ versionId: 'v1', content: btoa('export function pay() {}'), contentHash: 'hash', mimeType: 'text/typescript' });
    vi.mocked(api.listFindings).mockResolvedValue([
      { ...baseFinding, id: 'critical', title: 'An unrelated issue', severity: 'critical' },
      { ...baseFinding, title: '[cq-deep-nesting] six levels', filePath: 'src/one.ts' },
      { ...baseFinding, id: 'f-2', artifactId: 'artifact-2', title: '[cq-deep-nesting] eight levels', filePath: 'src/two.ts' },
    ]);
    render(<FindingsPanel projectId="p-1" presentation="project" pageSize={1} focusFindingId="f-2" />);
    const details = await screen.findByRole('article', { name: 'Finding details' });
    expect(await within(details).findByRole('heading', { name: 'Code Deep Nesting Issue' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(api.getReviewArtifactContent).not.toHaveBeenCalled();
    await user.click(within(details).getByRole('button', { name: 'Preview reviewed source src/two.ts:42' }));
    expect(api.getReviewArtifactContent).toHaveBeenCalledWith('p-1', 's-1', 'artifact-2');
    expect(await screen.findByRole('region', { name: 'Reviewed source preview src/two.ts' })).toHaveTextContent('export function pay() {}');
    await user.click(screen.getByRole('button', { name: 'Open full reviewed source' }));
    expect(screen.getByRole('article', { name: 'Reviewed source reader' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to finding' }));
    expect(await screen.findByRole('heading', { name: 'src/two.ts:42' })).toBeInTheDocument();
  });
});
