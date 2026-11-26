import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { AutoTestEntry, AutoTestSession } from '../../autotest/types';
import type { ConversationRequest } from '../../check/conversationTypes';
import { readPrefs, resetProjectPrefs } from '../../check/projectPrefs';
import { resetCheckStore, saveCheck } from '../../check/store';
import type { Project } from '../../types';
import { checkSentence, friendlyError, goalSteps, ProjectConversationScreen, testChanges } from './ProjectConversationScreen';

vi.mock('../../api/client', () => ({ api: { autoTests: vi.fn(), autoTest: vi.fn(), dynamicRunSteps: vi.fn(), getConnectedSourceStatus: vi.fn().mockResolvedValue({ connected: true, sources: [] }), listArtifacts: vi.fn(), startAutoTest: vi.fn(), cancelAutoTest: vi.fn(), listStaticSessions: vi.fn(), getStaticSession: vi.fn(), getReviewHarness: vi.fn().mockResolvedValue(null), listStaticFindings: vi.fn(), listRequirements: vi.fn(), listRequirementCandidates: vi.fn(), updateRequirement: vi.fn(), listConnectedSources: vi.fn(), retryStaticSession: vi.fn(), exportProjectReport: vi.fn(), conversationRequests: vi.fn(), sendConversationRequest: vi.fn() } }));
vi.mock('../../components/SourceIndexStatus', () => ({ SourceIndexStatus: () => null }));
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
const conversationRequest = (index: number): ConversationRequest => {
  const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
  const createdAt = new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString();
  return { id, projectId: project.id, ownerId: 'u', revision: 1, createdAt, updatedAt: createdAt,
    input: { id, text: `User message ${index}`, mode: 'code', permission: 'auto', references: [] }, inputHash: `hash-${index}`,
    state: 'completed', action: 'suggest', policyVersion: 'test', events: [] };
};

function renderScreen(onNavigate = vi.fn(), item = project) {
  render(<ProjectConversationScreen project={item} projects={[item]} onNavigate={onNavigate} />);
  return onNavigate;
}
async function returnToConversation(user: ReturnType<typeof userEvent.setup>) {
  const back = await screen.findByRole('button', { name: 'Back to the conversation' });
  await user.click(back);
}
describe('project conversation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    window.localStorage.clear();
    resetProjectPrefs();
    resetCheckStore();
    vi.mocked(api.autoTests).mockResolvedValue([]);
    vi.mocked(api.autoTest).mockResolvedValue(session());
    vi.mocked(api.listArtifacts).mockResolvedValue([]);
    vi.mocked(api.listStaticSessions).mockResolvedValue([]);
    vi.mocked(api.listStaticFindings).mockResolvedValue([]);
    vi.mocked(api.listRequirements).mockResolvedValue([]);
    vi.mocked(api.listRequirementCandidates).mockResolvedValue([]);
    vi.mocked(api.listConnectedSources).mockResolvedValue([]);
    vi.mocked(api.conversationRequests).mockResolvedValue([]);
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

  it.each(['toolbar', 'message'])('routes the %s through the combined Check entry point', async (entry) => {
    renderScreen();
    if (entry === 'toolbar') {
      await userEvent.click(screen.getByRole('button', { name: 'Run a full check' }));
    } else {
      await userEvent.type(screen.getByRole('textbox', { name: 'Message to ORIN' }), 'Run both');
      await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    }
    await waitFor(() => expect(window.localStorage.getItem('centinel:checks:local')).toContain('"mode":"both"'));
    expect(api.sendConversationRequest).not.toHaveBeenCalled();
  });

  it('asks which Check, recommends the latest, and sends the chosen older reference', async () => {
    const common = { projectId: project.id, projectName: project.name, phase: 'done' as const, mode: 'code' as const,
      focus: 'Check catalogue', documents: [], notes: [], updatedAt: '2026-11-25T10:30:00Z' };
    const older = { ...common, id: '11111111-1111-4111-8111-111111111111', reviewId: '22222222-2222-4222-8222-222222222222',
      title: 'Earlier catalogue', createdAt: '2026-11-25T10:20:00Z' };
    const latest = { ...common, id: '33333333-3333-4333-8333-333333333333', reviewId: '44444444-4444-4444-8444-444444444444',
      title: 'Latest catalogue', createdAt: '2026-11-25T10:30:00Z' };
    saveCheck(older);
    saveCheck(latest);
    renderScreen();
    await returnToConversation(userEvent.setup());
    await userEvent.type(screen.getByRole('textbox', { name: 'Message to ORIN' }), 'What did that check cover?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('heading', { name: 'Which Check do you mean?' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Latest catalogue.*Recommended/ })).toBeInTheDocument();
    expect(api.sendConversationRequest).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('radio', { name: /Earlier catalogue.*2026/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Use this Check' }));
    await waitFor(() => expect(api.sendConversationRequest).toHaveBeenCalledWith(project.id,
      expect.objectContaining({ references: [{ checkId: older.id, checkFocus: older.focus, reviewId: older.reviewId }] })));
  });

  it('loads a ten-message conversation page, keeps the visible turns, and offers a retry for an older-page failure', async () => {
    const user = userEvent.setup();
    const all = Array.from({ length: 12 }, (_, index) => conversationRequest(index));
    vi.mocked(api.conversationRequests)
      .mockResolvedValueOnce(all.slice(2).reverse())
      .mockRejectedValueOnce(new Error('Older page unavailable'))
      .mockResolvedValueOnce(all.slice(0, 2).reverse());
    renderScreen();
    expect(await screen.findByText('User message 2')).toBeInTheDocument();
    expect(screen.queryByText('User message 1')).not.toBeInTheDocument();
    expect(screen.queryByText('User message 0')).not.toBeInTheDocument();
    expect(api.conversationRequests).toHaveBeenNthCalledWith(1, project.id, undefined, 10);
    await user.click(screen.getByRole('button', { name: 'Load earlier messages' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Earlier messages could not be loaded.');
    expect(api.conversationRequests).toHaveBeenNthCalledWith(2, project.id, all[2].id, 10);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('User message 0')).toBeInTheDocument();
    expect(screen.getByText('User message 1')).toBeInTheDocument();
  });

  it('returns a custom Check clarification to the composer without resolving an identity', async () => {
    const user = userEvent.setup();
    const common = { projectId: project.id, projectName: project.name, phase: 'done' as const, mode: 'code' as const,
      documents: [], notes: [], updatedAt: '2026-11-25T10:30:00Z' };
    saveCheck({ ...common, id: '11111111-1111-4111-8111-111111111111', reviewId: '22222222-2222-4222-8222-222222222222',
      title: 'Earlier catalogue', focus: 'Check catalogue', createdAt: '2026-11-25T10:20:00Z' });
    saveCheck({ ...common, id: '33333333-3333-4333-8333-333333333333', reviewId: '44444444-4444-4444-8444-444444444444',
      title: 'Latest catalogue', focus: 'Check catalogue', createdAt: '2026-11-25T10:30:00Z' });
    renderScreen();
    await returnToConversation(user);
    const input = screen.getByRole('textbox', { name: 'Message to ORIN' });
    await user.type(input, 'What did that check cover?');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(screen.getByRole('radio', { name: 'Something else' }));
    await user.type(screen.getByRole('textbox', { name: 'Clarify which Check you mean' }), 'the earlier catalogue check');
    await user.click(screen.getByRole('button', { name: 'Add clarification to message' }));
    expect(input).toHaveValue('What did that check cover?\nthe earlier catalogue check');
    expect(input).toHaveFocus();
    expect(api.sendConversationRequest).not.toHaveBeenCalled();
  });

  it('skips the Google Drive alert if the project has no retained Drive sources', async () => {
    vi.mocked(api.getConnectedSourceStatus).mockResolvedValueOnce({
      connected: false, status: 'disconnected', sources: [{ status: 'removed' }],
    } as never);
    renderScreen();
    await waitFor(() => expect(api.getConnectedSourceStatus).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', { name: 'Google Drive needs attention' })).not.toBeInTheDocument();
  });

  it('opens a saved Check card in the project side panel without navigating away', async () => {
    const user = userEvent.setup();
    vi.mocked(api.autoTests).mockResolvedValue([session()]);
    const navigate = renderScreen();
    const card = within(await screen.findByRole('region', { name: 'Check Two mugs total $24.00' }));
    expect(card.getByText('Proven in the browser')).toBeInTheDocument();
    await user.click(card.getByRole('button', { name: 'View' }));
    expect(screen.getByRole('complementary', { name: 'What ORIN knows' })).toHaveClass('is-open');
    expect(within(screen.getByRole('complementary', { name: 'What ORIN knows' }))
      .getByText('Two mugs total $24.00', { selector: '.pc-side-meta' })).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Back to the conversation' }));
    expect(screen.getAllByRole('region', { name: 'Check Two mugs total $24.00' })).toHaveLength(1);
  });

  it('opens the latest saved Check first and returns to the newest conversation position', async () => {
    const user = userEvent.setup();
    saveCheck({ id: 'saved-check', projectId: project.id, projectName: project.name, title: 'Latest saved Check',
      reviewId: 'review-1', mode: 'code', phase: 'done', createdAt: '2026-11-25T10:00:00Z', updatedAt: '2026-11-25T10:01:00Z',
      focus: 'Review checkout', documents: [], notes: [] });
    renderScreen();
    const panel = screen.getByRole('complementary', { name: 'What ORIN knows' });
    await waitFor(() => expect(panel).toHaveClass('is-open'));
    expect(within(panel).getByText('Latest saved Check', { selector: '.pc-side-meta' })).toBeInTheDocument();
    const pane = document.querySelector<HTMLElement>('.ck-detail-content')!;
    Object.defineProperty(pane, 'scrollHeight', { configurable: true, value: 5000 });
    Object.defineProperty(pane, 'clientHeight', { configurable: true, value: 1000 });
    await user.click(within(panel).getByRole('button', { name: 'Back to the conversation' }));
    await waitFor(() => expect(pane.scrollTop).toBe(5000));
  });

  it('defaults the project composer to Code after the latest combined check falls back', async () => {
    saveCheck({ id: 'fallback', projectId: project.id, projectName: project.name, title: 'Cypress checkout', mode: 'code', requestedMode: 'both',
      phase: 'done', createdAt: '2026-11-21T00:01:00Z', updatedAt: '2026-11-21T00:02:00Z', focus: '', notes: [], documents: [] });
    renderScreen();
    expect(await screen.findByRole('combobox', { name: 'Check mode' })).toHaveTextContent('Code');
    expect(screen.getByRole('region', { name: 'Check Cypress checkout' })).toBeInTheDocument();
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

  it('sends a Browser request in Auto mode through the conversation planner', async () => {
    const user = userEvent.setup();
    renderScreen();
    const text = 'In the Browser, verify the home page shows "Ceramic Mug".';
    await user.type(screen.getByLabelText('Message to ORIN'), text + '{Enter}');
    expect(api.sendConversationRequest).toHaveBeenCalledWith('p1', expect.objectContaining({ text, mode: 'browser', permission: 'auto' }));
    expect(api.startAutoTest).not.toHaveBeenCalled();
  });

  it('collapses the work under "Worked for", shows failed assertions as discoveries and groups reply actions', async () => {
    const user = userEvent.setup();
    vi.mocked(api.dynamicRunSteps).mockResolvedValue({ runId: 'run-1', state: 'finished', verdict: 'failed', reason: null, truncated: false,
      steps: [{ step: 1, action: 'click', target: 'Add to cart', page: '/', result: 'success', error: null, typedLength: null, screenshot: false }] });
    vi.mocked(api.autoTests).mockResolvedValue([session({ updatedAt: '2026-11-26T12:05:00.000Z', repository: { fingerprint: 'f', files: 10, routes: 4, forms: 1, requirements: true, truncated: false, persistence: [] }, launch: { recipeId: 'r', label: 'node server.js', framework: 'node', url: 'http://localhost:4101', portHonored: true, installing: false, log: '' }, exploration: { pages: [{ path: '/', controls: 8 }], controls: 8 } })]);
    const onNavigate = renderScreen();
    expect(await screen.findByText('Test that two mugs cost $24.00')).toBeInTheDocument();
    const reply = screen.getByRole('region', { name: "ORIN's reply" });
    const outcome = within(reply).getByText('I found a problem in “Two mugs total $24.00”. I expected the page to show “$24.00”. The browser recorded “This was not shown on the page”.');
    expect(outcome.closest('.pc-result-text')?.querySelector('.ci-triangle')).toBeNull();
    const card = screen.getByRole('region', { name: 'Check Two mugs total $24.00' });
    expect(card.compareDocumentPosition(outcome) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(reply).queryByText('I wrote one test.')).not.toBeInTheDocument();
    expect(screen.queryByText(/AI explanation/)).not.toBeInTheDocument();
    await user.click(within(reply).getByRole('button', { name: /^Worked for/ }));
    expect(within(reply).getByText('I wrote one test.')).toBeInTheDocument();
    const start = within(reply).getByText('Started the Browser Check');
    await user.click(start);
    const branch = within(start.closest('details')!);
    expect(branch.getByText(/I read 10 project files, started the app, inspected 1 page/)).toBeVisible();
    expect(await within(reply).findByText(/Read 10 files.*4 routes.*1 form/)).toBeInTheDocument();
    await user.click(within(reply).getByText('Started Two mugs total $24.00'));
    expect(await within(reply).findByText(/Clicked Add to cart/)).toBeInTheDocument();
    expect(within(reply).queryByText('Click it again.')).not.toBeInTheDocument();
    expect(within(reply).getByText('Checked Total shown')).toBeInTheDocument();
    const actions = screen.getByRole('group', { name: 'Actions for Two mugs total $24.00' });
    const replyActions = within(reply).getByRole('group', { name: 'Reply actions' });
    expect(replyActions.firstElementChild?.tagName).toBe('TIME');
    expect(replyActions).toContainElement(within(replyActions).getByRole('button', { name: 'Copy reply' }));
    expect(replyActions).toContainElement(actions);
    await userEvent.click(screen.getByRole('button', { name: 'Replay' }));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'dynamic-testing', projectId: 'p1', runId: 'run-1' });
  });

  it('keeps the warning icon for a real Browser execution error', async () => {
    vi.mocked(api.autoTests).mockResolvedValue([session({ tests: [], stage: 'failed', reply: null, updatedAt: '2026-11-26T12:05:00.000Z',
      error: { reason: 'browser_startup', message: 'The Browser Check could not start.' } })]);
    renderScreen();
    const reply = await screen.findByRole('region', { name: "ORIN's reply" });
    expect(within(reply).getByText(/The Browser Check could not start/).closest('.pc-error')?.querySelector('.ci-triangle')).toBeInTheDocument();
    const actions = within(reply).getByRole('group', { name: 'Reply actions' });
    expect(actions.firstElementChild?.tagName).toBe('TIME');
    expect(within(actions).getByRole('button', { name: 'Copy reply' })).toBeInTheDocument();
  });

  it('runs a test again without offering to save it for every check', async () => {
    const user = userEvent.setup();
    vi.mocked(api.autoTests).mockResolvedValue([session()]);
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Run again' }));
    expect(screen.queryByRole('button', { name: 'Save for every check' })).not.toBeInTheDocument();
    expect(api.startAutoTest).toHaveBeenCalledWith('p1', { rerun: [{ sessionId: session().id, testId: test().id }], lanes: 1, startupPermission: 'auto' });
  });

  it('changes a test by sending the request with that test as its base', async () => {
    const user = userEvent.setup();
    vi.mocked(api.autoTests).mockResolvedValue([session()]);
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Change it' }));
    expect(screen.getByText('Changing “Two mugs total $24.00”')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Message to ORIN'), 'Also check three mugs{Enter}');
    expect(api.startAutoTest).toHaveBeenCalledWith('p1', { request: 'Also check three mugs', base: { sessionId: session().id, testId: test().id }, lanes: 1, startupPermission: 'auto' });
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
    expect(api.sendConversationRequest).toHaveBeenCalledWith('p1', expect.objectContaining({
      text: 'Use admin@test.com / test123 to check orders', mode: 'browser', permission: 'ask',
    }));
  });

  it('allows conversation planning but keeps direct full runs disabled without a folder', async () => {
    const user = userEvent.setup();
    renderScreen(vi.fn(), { ...project, workspacePath: '' });
    expect(screen.getByRole('button', { name: /Run a full check/ })).toBeDisabled();
    await user.type(screen.getByLabelText('Message to ORIN'), 'Test sign in{Enter}');
    expect(api.startAutoTest).not.toHaveBeenCalled();
    expect(api.sendConversationRequest).toHaveBeenCalledWith('p1', expect.objectContaining({ text: 'Test sign in' }));
  });

  it('answers a question in words without a test card', async () => {
    vi.mocked(api.autoTests).mockResolvedValue([session({ tests: [], reply: 'The browser cannot see the database.' })]);
    renderScreen();
    expect(await screen.findByText('The browser cannot see the database.')).toBeInTheDocument();
    expect(screen.queryByText('Passes only if')).not.toBeInTheDocument();
  });

  it('shows the latest saved result in What ORIN knows and downloads its report', async () => {
    const user = userEvent.setup();
    const review = { id: 'r1', projectId: 'p1', status: 'completed', createdAt: '2026-11-12T10:00:00.000Z', progressJson: '{}', failureReason: '' };
    vi.mocked(api.listStaticSessions).mockResolvedValue([review] as never);
    vi.mocked(api.getStaticSession).mockResolvedValue(review as never);
    vi.mocked(api.listStaticFindings).mockResolvedValue([
      { id: 'f1', projectId: 'p1', sessionId: 'r1', source: 'static', severity: 'high', priority: 'high', riskLevel: 'critical', title: 'Orders open without sign-in', description: 'd', status: 'new', createdAt: '', artifactId: null, category: '', evidenceText: '', recommendation: '', confidence: '', fromRemarks: false, filePath: 'server.js', lineNumber: 76 },
      { id: 'f2', projectId: 'p1', sessionId: 'r1', source: 'static', severity: 'low', priority: 'low', riskLevel: 'low', title: 'Debug output', description: 'd', status: 'dismissed', createdAt: '', artifactId: null, category: '', evidenceText: '', recommendation: '', confidence: '', fromRemarks: false, filePath: 'server.js', lineNumber: 9 },
    ] as never);
    saveCheck({ id: 'latest-project-check', projectId: project.id, projectName: project.name, title: 'Current Review', reviewId: 'r1',
      mode: 'code', phase: 'done', createdAt: '2026-11-12T10:00:00.000Z', updatedAt: '2026-11-12T10:00:00.000Z', focus: '', documents: [], notes: [] });
    vi.mocked(api.listRequirements).mockResolvedValue([{ id: 'q1', projectId: 'p1', title: 'REQ-1 Generic sign-in error', description: '', category: '', priority: '', createdAt: '' }]);
    vi.mocked(api.exportProjectReport).mockResolvedValue({ downloads: { pdf: 'https://example.test/report.pdf', markdown: null, json: null } } as never);
    const open = vi.spyOn(globalThis, 'open').mockReturnValue(null);
    const onNavigate = renderScreen();
    const panel = screen.getByRole('complementary', { name: 'What ORIN knows' });
    expect(await within(panel).findByText('Orders open without sign-in')).toBeInTheDocument();
    expect(panel).toHaveClass('is-open');
    expect(within(panel).getByRole('button', { name: 'Back to the conversation' })).toHaveAttribute('aria-expanded', 'true');
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Message to ORIN' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save for every check' })).not.toBeInTheDocument();
    expect(within(panel).getByText('Orders open without sign-in')).toBeInTheDocument();
    expect(within(panel).queryByText('Debug output')).not.toBeInTheDocument();
    expect(within(panel).getByText('REQ-1 Generic sign-in error')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Download report' }));
    expect(api.exportProjectReport).toHaveBeenCalledWith('p1', { reviewId: 'r1' });
    expect(open).toHaveBeenCalledWith('https://example.test/report.pdf', '_blank', 'noopener');
    expect(within(panel).queryByRole('button', { name: 'Open full Check' })).not.toBeInTheDocument();
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
    const full = session({ request: undefined, tests: [test(), test({ id: 't-ok', name: 'Sign in works', state: 'passed' })] } as never);
    vi.mocked(api.autoTests).mockResolvedValue([full]);
    renderScreen();
    const panel = screen.getByRole('complementary', { name: 'What ORIN knows' });
    expect(await within(panel).findByText('Browser tests · 1 of 2 failed')).toBeInTheDocument();
    expect(within(panel).getByTitle('Sign in works: passed')).toBeInTheDocument();
  });
});
