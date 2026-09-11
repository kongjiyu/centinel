import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FindingsPanel, findingPresentationStatus } from './FindingsPanel';
import { api } from '../api/client';
import type { Finding } from '../types';

vi.mock('../api/client', () => ({
  api: {
    listFindings: vi.fn(),
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
  beforeEach(() => vi.clearAllMocks());

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

  it('uses the Project Detail master-detail table and supports keyboard row selection', async () => {
    vi.mocked(api.listFindings).mockResolvedValue([{ ...baseFinding, priority: 'high', title: 'Keyboard-selectable finding' }]);
    const user = userEvent.setup();
    render(<FindingsPanel projectId="p-1" presentation="project" pageSize={5} />);
    expect(await screen.findByRole('columnheader', { name: 'Priority' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Severity' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Description' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByText('#f-1')).toBeInTheDocument();
    expect(screen.getByText('Select a finding to review its details')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Source' })).not.toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Keyboard-selectable finding/i });
    row.focus();
    await user.keyboard('{Enter}');
    const details = screen.getByRole('complementary', { name: 'Finding details' });
    expect(within(details).queryByText('Review')).not.toBeInTheDocument();
    expect(within(details).getByRole('heading', { name: 'Keyboard-selectable finding' })).toBeInTheDocument();
    expect(within(details).getByText('#f-1')).toBeInTheDocument();
    expect(within(details).getByText('Add a null check or use optional chaining.')).toBeInTheDocument();
    const text = details.textContent || '';
    expect(text).not.toContain('Source type');
    expect(text).not.toContain('Review');
    expect(text.indexOf('Priority')).toBeLessThan(text.indexOf('Severity'));
    expect(text.indexOf('Recommendation')).toBeLessThan(text.indexOf('Evidence'));
    expect(text).not.toMatch(/Confidence/i);
  });
});
