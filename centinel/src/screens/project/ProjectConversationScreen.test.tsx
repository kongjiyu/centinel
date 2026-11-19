import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { AutoTestEntry, AutoTestSession } from '../../autotest/types';
import { readPrefs, resetProjectPrefs } from '../../check/projectPrefs';
import { resetCheckStore } from '../../check/store';
import type { Project } from '../../types';
import { checkSentence, friendlyError, goalSteps, ProjectConversationScreen, testChanges } from './ProjectConversationScreen';

vi.mock('../../api/client', () => ({ api: { autoTests: vi.fn(), getConnectedSourceStatus: vi.fn().mockResolvedValue({ connected: true, sources: [] }), listArtifacts: vi.fn(), startAutoTest: vi.fn(), cancelAutoTest: vi.fn(), listStaticSessions: vi.fn(), listStaticFindings: vi.fn(), listRequirements: vi.fn(), exportProjectReport: vi.fn() } }));
vi.mock('../../autotest/liveStream', () => ({ openLiveStream: vi.fn() }));

const project: Project = { id: 'p1', name: 'sample-shop', description: '', workspacePath: '/work/sample-shop', createdAt: '', updatedAt: '' };
const test = (patch: Partial<AutoTestEntry> = {}): AutoTestEntry => ({
  id: '77777777-7777-4777-8777-777777777777', name: 'Two mugs total $24.00', goal: 'Open the shop.\nClick Add to cart for Ceramic Mug.\nClick it again.', rationale: '', requirementRef: null,
  sourceRefs: [], startPath: '/', state: 'failed', runId: 'run-1', controls: [{ selector: '#products > li:nth-of-type(1) > button', actions: ['click'] }],
  checks: [{ id: 'c1', criterionId: 'x', description: 'Total shown', required: true, kind: 'visible_text', expected: '$24.00' }],
  checkResults: [{ checkId: 'c1', criterionId: 'x', verdict: 'failed', observed: 'Expected visible text absent.', reason: '', evidenceIds: [] }],
  explanation: 'The total ignores `quantity`.', ...patch,
});
const session = (patch: Partial<AutoTestSession> = {}): AutoTestSession => ({
  schemaVersion: 1, id: '66666666-6666-4666-8666-666666666666', projectId: 'p1', ownerId: 'u', folder: '/work/sample-shop', createdAt: '2026-11-13T10:00:00.000Z', updatedAt: '',
  stage: 'completed', error: null, repository: null, launch: null, exploration: null, lanes: [], laneLimit: 1, laneNote: null, tests: [test()], dropped: [], summary: null,
  request: { text: 'Test that two mugs cost $24.00', base: null, history: [] }, reply: 'I wrote one test.', ...patch,
});

function renderScreen(onNavigate = vi.fn(), item = project) {
  render(<ProjectConversationScreen project={item} projects={[item]} onNavigate={onNavigate} />);
  return onNavigate;
}

describe('project conversation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    window.localStorage.clear();
    resetProjectPrefs();
    resetCheckStore();
    vi.mocked(api.autoTests).mockResolvedValue([]);
    vi.mocked(api.listArtifacts).mockResolvedValue([]);
    vi.mocked(api.listStaticSessions).mockResolvedValue([]);
    vi.mocked(api.listStaticFindings).mockResolvedValue([]);
    vi.mocked(api.listRequirements).mockResolvedValue([]);
    vi.mocked(api.startAutoTest).mockResolvedValue(session({ stage: 'reading', tests: [], reply: null }));
  });

  it('offers Connections when a saved Google Drive source cannot sync', async () => {
    vi.mocked(api.getConnectedSourceStatus).mockResolvedValueOnce({
      connected: false, status: 'disconnected', sources: [{ status: 'active' }],
    } as never);
    const navigate = renderScreen();
    const attention = await screen.findByRole('dialog', { name: 'Google Drive needs attention' });
    expect(api.getConnectedSourceStatus).toHaveBeenCalledWith('google_drive', project.id);
    await userEvent.click(within(attention).getByRole('button', { name: 'Open connections' }));
    expect(navigate).toHaveBeenCalledWith({ name: 'settings', section: 'connections' });
    expect(screen.queryByRole('dialog', { name: 'Google Drive needs attention' })).not.toBeInTheDocument();
  });

  it('skips the Google Drive alert if the project has no retained Drive sources', async () => {
    vi.mocked(api.getConnectedSourceStatus).mockResolvedValueOnce({
      connected: false, status: 'disconnected', sources: [{ status: 'removed' }],
    } as never);
    renderScreen();
    await waitFor(() => expect(api.getConnectedSourceStatus).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', { name: 'Google Drive needs attention' })).not.toBeInTheDocument();
  });

  it('splits steps, describes checks and diffs a revised test in words', () => {
    expect(goalSteps('1. Open the shop\n2. Click Add')).toEqual(['Open the shop', 'Click Add']);
    expect(goalSteps('Open the shop. Click Add to cart.')).toEqual(['Open the shop.', 'Click Add to cart.']);
    expect(checkSentence({ kind: 'visible_text', description: 'x', expected: '$24.00' })).toBe('The page shows “$24.00”');
    expect(checkSentence({ kind: 'url', description: 'x', expected: 'http://localhost:4100/orders?x=1' })).toBe('The address is /orders?x=1');
    const base = { name: 'Coupon', goal: 'Apply SAVE10', startPath: '/', requirementRef: null, sourceRefs: [], checks: [{ id: 'c', criterionId: 'x', description: 'Total', required: true, kind: 'visible_text', expected: '$10.80' }], controls: [] };
    const next = test({ goal: 'Apply SAVE10\nApply OLD5', checks: [{ id: 'c', criterionId: 'x', description: 'Total', required: true, kind: 'visible_text', expected: '$10.80' }, { id: 'd', criterionId: 'x', description: 'Expired', required: true, kind: 'visible_text', expected: 'This code has expired' }] });
    expect(testChanges(base, next)).toEqual({ added: ['Apply OLD5', 'Passes only if: The page shows “This code has expired”'], removed: [] });
    expect(friendlyError("browserType.launch: Executable doesn't exist at /x")).toMatch(/test browser is not installed/);
  });

  it('sends a request straight away in Auto mode and shows the written test with its result', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.type(screen.getByLabelText('Message to ORIN'), 'Test that two mugs cost $24.00{Enter}');
    expect(api.startAutoTest).toHaveBeenCalledWith('p1', { request: 'Test that two mugs cost $24.00', lanes: 1 });

  });

  it('collapses the work under "Worked for", shows the result in plain text and keeps actions outside the reply', async () => {
    const user = userEvent.setup();
    vi.mocked(api.autoTests).mockResolvedValue([session({ repository: { fingerprint: 'f', files: 10, routes: 4, forms: 1, requirements: true, truncated: false, persistence: [] }, launch: { recipeId: 'r', label: 'node server.js', framework: 'node', url: 'http://localhost:4101', portHonored: true, installing: false, log: '' }, exploration: { pages: [{ path: '/', controls: 8 }], controls: 8 } })]);
    const onNavigate = renderScreen();
    expect(await screen.findByText('Test that two mugs cost $24.00')).toBeInTheDocument();
    const reply = screen.getByRole('region', { name: "ORIN's reply" });
    expect(within(reply).getByText('“Two mugs total $24.00” found a problem. I expected the page to show “$24.00”, but it was not shown on the page.')).toBeInTheDocument();
    expect(within(reply).queryByText('I wrote one test.')).not.toBeInTheDocument();
    expect(screen.queryByText(/AI explanation/)).not.toBeInTheDocument();
    await user.click(within(reply).getByRole('button', { name: /^Worked for/ }));
    expect(within(reply).getByText('I wrote one test.')).toBeInTheDocument();
    const prep = within(reply).getByRole('button', { name: 'Read the project, started the app, looked at 1 page and wrote 1 test' });
    expect(within(reply).queryByText(/Read 10 files/)).not.toBeInTheDocument();
    await user.click(prep);
    expect(within(reply).getByText('Read 10 files: 4 routes, 1 form, and the requirements')).toBeInTheDocument();
    await user.click(within(reply).getByRole('button', { name: 'Tested Two mugs total $24.00 in the browser' }));
    expect(within(reply).getByText('Click it again.')).toBeInTheDocument();
    expect(within(reply).getByText('Passes only if the page shows “$24.00”')).toBeInTheDocument();
    const actions = screen.getByRole('group', { name: 'Actions for Two mugs total $24.00' });
    expect(reply).not.toContainElement(actions);
    await userEvent.click(screen.getByRole('button', { name: 'Replay' }));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'dynamic-testing', projectId: 'p1', runId: 'run-1' });
  });

  it('saves a test for every check with Undo, and runs it again as a saved test', async () => {
    const user = userEvent.setup();
    vi.mocked(api.autoTests).mockResolvedValue([session()]);
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Save for every check' }));
    expect(readPrefs('p1').pinned).toMatchObject([{ testId: test().id, name: 'Two mugs total $24.00' }]);
    const side = screen.getByRole('complementary', { name: 'What ORIN knows' });
    await user.click(within(side).getByRole('button', { name: 'Show the whole project' }));
    expect(within(side).getByText('Two mugs total $24.00')).toBeInTheDocument();
    await user.click(within(side).getByRole('button', { name: 'Back to the conversation' }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(readPrefs('p1').pinned).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Run again' }));
    expect(api.startAutoTest).toHaveBeenCalledWith('p1', { rerun: [{ sessionId: session().id, testId: test().id }], lanes: 1 });
  });

  it('changes a test by sending the request with that test as its base', async () => {
    const user = userEvent.setup();
    vi.mocked(api.autoTests).mockResolvedValue([session()]);
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Change it' }));
    expect(screen.getByText('Changing “Two mugs total $24.00”')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Message to ORIN'), 'Also check three mugs{Enter}');
    expect(api.startAutoTest).toHaveBeenCalledWith('p1', { request: 'Also check three mugs', base: { sessionId: session().id, testId: test().id }, lanes: 1 });
  });

  it('asks first in Ask first mode, records the mode change and reminds once about accounts', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('combobox', { name: 'Project conversation permission' }));
    await user.click(screen.getByRole('option', { name: /Ask first/ }));
    expect(screen.getByText('Permission mode changed to Ask first.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Message to ORIN'), 'Use admin@test.com / test123 to check orders{Enter}');
    expect(screen.getByText('The AI will see this account. Use test accounts only.')).toBeInTheDocument();
    expect(api.startAutoTest).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Go ahead' }));
    expect(api.startAutoTest).toHaveBeenCalledWith('p1', { request: 'Use admin@test.com / test123 to check orders', lanes: 1 });
  });

  it('explains that browser tests need a folder when the project has only a GitHub link', async () => {
    const user = userEvent.setup();
    renderScreen(vi.fn(), { ...project, workspacePath: '' });
    expect(screen.getByRole('button', { name: /Run a full check/ })).toBeDisabled();
    await user.type(screen.getByLabelText('Message to ORIN'), 'Test sign in{Enter}');
    expect(api.startAutoTest).not.toHaveBeenCalled();
    expect(screen.getByText(/Browser tests need the project folder on this computer/)).toBeInTheDocument();
  });

  it('answers a question in words without a test card', async () => {
    vi.mocked(api.autoTests).mockResolvedValue([session({ tests: [], reply: 'The browser cannot see the database.' })]);
    renderScreen();
    expect(await screen.findByText('The browser cannot see the database.')).toBeInTheDocument();
    expect(screen.queryByText('Passes only if')).not.toBeInTheDocument();
  });

  it('shows the latest saved result in What ORIN knows and downloads its report', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listStaticSessions).mockResolvedValue([{ id: 'r1', projectId: 'p1', status: 'completed', createdAt: '2026-11-12T10:00:00.000Z', progressJson: '{}', failureReason: '' }] as never);
    vi.mocked(api.listStaticFindings).mockResolvedValue([
      { id: 'f1', projectId: 'p1', sessionId: 'r1', source: 'static', severity: 'high', priority: 'high', riskLevel: 'critical', title: 'Orders open without sign-in', description: 'd', status: 'new', createdAt: '', artifactId: null, category: '', evidenceText: '', recommendation: '', confidence: '', fromRemarks: false, filePath: 'server.js', lineNumber: 76 },
      { id: 'f2', projectId: 'p1', sessionId: 'r1', source: 'static', severity: 'low', priority: 'low', riskLevel: 'low', title: 'Debug output', description: 'd', status: 'dismissed', createdAt: '', artifactId: null, category: '', evidenceText: '', recommendation: '', confidence: '', fromRemarks: false, filePath: 'server.js', lineNumber: 9 },
    ] as never);
    vi.mocked(api.listRequirements).mockResolvedValue([{ id: 'q1', projectId: 'p1', title: 'REQ-1 Generic sign-in error', description: '', category: '', priority: '', createdAt: '' }]);
    vi.mocked(api.exportProjectReport).mockResolvedValue({ downloads: { pdf: 'https://example.test/report.pdf', markdown: null, json: null } } as never);
    const open = vi.spyOn(globalThis, 'open').mockReturnValue(null);
    const onNavigate = renderScreen();
    const panel = screen.getByRole('complementary', { name: 'What ORIN knows' });
    expect(await within(panel).findByText('1 problem')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Show the whole project' }));
    expect(within(panel).getByRole('button', { name: 'Back to the conversation' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByRole('textbox', { name: 'Message to ORIN' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save for every check' })).not.toBeInTheDocument();
    expect(within(panel).getByText('Orders open without sign-in')).toBeInTheDocument();
    expect(within(panel).queryByText('Debug output')).not.toBeInTheDocument();
    expect(within(panel).getByText('REQ-1 Generic sign-in error')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Download report' }));
    expect(api.exportProjectReport).toHaveBeenCalledWith('p1', { reviewId: 'r1' });
    expect(open).toHaveBeenCalledWith('https://example.test/report.pdf', '_blank', 'noopener');
    await user.click(within(panel).getByRole('button', { name: 'Open the full result' }));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'review-activity', projectId: 'p1', sessionId: 'r1' });
    await user.keyboard('{Escape}');
    expect(readPrefs('p1').sideOpen).toBe(false);
    expect(within(panel).queryByRole('heading', { name: 'Requirements' })).not.toBeInTheDocument();
    const toggle = within(panel).getByRole('button', { name: 'Show the whole project' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
    expect(within(panel).getByText('1 problem')).toBeInTheDocument();
    open.mockRestore();
  });

  it('lists the latest full check\'s browser tests when the panel is open', async () => {
    const user = userEvent.setup();
    const full = session({ request: undefined, tests: [test(), test({ id: 't-ok', name: 'Sign in works', state: 'passed' })] } as never);
    vi.mocked(api.autoTests).mockResolvedValue([full]);
    renderScreen();
    const panel = screen.getByRole('complementary', { name: 'What ORIN knows' });
    await user.click(within(panel).getByRole('button', { name: 'Show the whole project' }));
    expect(await within(panel).findByText('Browser tests · 1 of 2 failed')).toBeInTheDocument();
    expect(within(panel).getByTitle('Sign in works: passed')).toBeInTheDocument();
  });
});
