import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DynamicWorkspaceScreen } from './DynamicWorkspaceScreen';
import { api } from '../api/client';
import {createStaticContextFixture} from '../../../sidecar/src/dynamic/testing/staticContextStub';
import type { MissionRevision, DynamicRun } from '../dynamic/types';

vi.mock('../api/client', () => ({ api: { dynamicEnvironments: vi.fn(), dynamicEnvironmentValues: vi.fn(), dynamicMissions: vi.fn(), dynamicRevision: vi.fn(), dynamicRuns: vi.fn(), dynamicReports:vi.fn().mockResolvedValue([]),dynamicFindings:vi.fn().mockResolvedValue([]),dynamicEvidenceCopies:vi.fn().mockResolvedValue([]),dynamicRecordedEvidenceBlob:vi.fn().mockRejectedValue(Error("No local proof")), saveDynamicMission: vi.fn(), startDynamicRun: vi.fn(), stopDynamicRun: vi.fn(), listDynamicEvidence: vi.fn(), dynamicEvidenceBlob: vi.fn() } }));
const project = { id: 'project-a', name: 'Demo web app', description: '', workspacePath: '', createdAt: '', updatedAt: '' };
const revision: MissionRevision = { id: 'revision-one', missionId: 'mission-one', projectId: 'project-a', revision: 1, createdBy: 'actor', createdAt: '2026-10-13T00:00:00Z', name: 'Sign-in smoke', goal: 'Inspect sign-in form', targetUrl: 'http://localhost:3000', maxSteps: 3, context: null, contextAcknowledged: false, checks: [{ id: 'heading', criterionId: 'manual-heading', description: 'Visible sign-in heading', kind: 'visible_text', expected: 'Sign in', required: true }] };
const makeRun = (state: DynamicRun['state'] = 'completed'): DynamicRun => ({ id: 'run-one', projectId: 'project-a', missionId: 'mission-one', revision, idempotencyKey: 'one', createdBy: 'actor', createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z', state, verdict: state === 'completed' ? 'passed' : 'not_tested', checks: [], evidence: [], reason: state === 'interrupted' ? 'Execution stopped responding.' : null, legacySessionId: null });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.dynamicEnvironments).mockResolvedValue([]);
  vi.mocked(api.dynamicMissions).mockResolvedValue([]); vi.mocked(api.dynamicRuns).mockResolvedValue([]);
  vi.mocked(api.dynamicRevision).mockResolvedValue(revision);
  vi.mocked(api.saveDynamicMission).mockResolvedValue(revision);
});
const renderScreen = (runId?: string) => render(<DynamicWorkspaceScreen projects={[project]} initialProjectId={project.id} initialRunId={runId} onNavigate={vi.fn()} />);

async function fillDraft(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save test' })).toBeEnabled());
  await user.type(screen.getByLabelText('Test name'), 'Sign-in smoke');
  await user.type(screen.getByLabelText('Website address'), 'http://localhost:3000');
  await user.type(screen.getByLabelText('Test goal'), 'Inspect sign-in form');
  await user.type(screen.getByLabelText('Expected visible text'), 'Sign in');
}

describe('Dynamic saved tests and run history', () => {
  it('saves explicit bounded exploration mode rather than changing historical execution implicitly',async()=>{const user=userEvent.setup();renderScreen();await fillDraft(user);await user.click(screen.getByRole('combobox',{name:'Testing mode'}));await user.click(screen.getByRole('option',{name:'Bounded exploration'}));await user.click(screen.getByRole('button',{name:'Save test'}));await waitFor(()=>expect(api.saveDynamicMission).toHaveBeenCalledWith('project-a',expect.objectContaining({mode:'exploratory'}),undefined));});
  it('saves an explicit unchecked expectation with its CSS target',async()=>{
    const user=userEvent.setup();renderScreen();await fillDraft(user);await user.click(screen.getByRole('combobox',{name:'Verify'}));await user.click(screen.getByRole('option',{name:'Checked state'}));const selector=screen.getByLabelText('CSS selector');await user.clear(selector);await user.type(selector,'#agree');await user.click(screen.getByRole('combobox',{name:'Expected form state'}));await user.click(screen.getByRole('option',{name:'Not checked'}));await user.click(screen.getByRole('button',{name:'Save test'}));await waitFor(()=>expect(api.saveDynamicMission).toHaveBeenCalledWith('project-a',expect.objectContaining({checks:[expect.objectContaining({kind:'field_checked',selector:'#agree',expected:false,required:true})]}),undefined));
  });

  it('saves configured checks without executing a model until Run is selected', async () => {
    const user = userEvent.setup(); renderScreen(); await fillDraft(user);
    await user.click(screen.getByRole('button', { name: 'Save test' }));
    await screen.findByText('Saved revision 1. Ready to run.');
    expect(api.saveDynamicMission).toHaveBeenCalledWith('project-a', expect.objectContaining({ name: 'Sign-in smoke', context: null, checks: [expect.objectContaining({ kind: 'visible_text', expected: 'Sign in', required: true })] }), undefined);
    expect(api.startDynamicRun).not.toHaveBeenCalled();
  });
  it('preserves form input and announces save errors', async () => {
    vi.mocked(api.saveDynamicMission).mockRejectedValue(new Error('The test could not be saved.'));
    const user = userEvent.setup(); renderScreen(); await fillDraft(user);
    await user.click(screen.getByRole('button', { name: 'Save test' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    expect(screen.getByLabelText('Test name')).toHaveValue('Sign-in smoke');
  });
  it('shows interrupted state without a passing verdict and reruns the pinned revision', async () => {
    vi.mocked(api.dynamicRuns).mockResolvedValue([makeRun('interrupted')]);
    vi.mocked(api.startDynamicRun).mockResolvedValue({ ...makeRun('queued'), id: 'run-two' });
    const user = userEvent.setup(); renderScreen('run-one');
    expect(await screen.findByText('Execution stopped responding.')).toBeInTheDocument();
    expect(screen.getByText(/not resumed automatically/)).toBeInTheDocument();
    expect(screen.queryByText('Passed')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run this revision again' }));
    expect(api.startDynamicRun).toHaveBeenCalledWith('project-a', 'revision-one', expect.any(String));
  });
  it('reuses the request key when a start response is lost', async () => {
    vi.mocked(api.dynamicRuns).mockResolvedValue([makeRun('interrupted')]);
    vi.mocked(api.startDynamicRun).mockRejectedValueOnce(new Error('Temporary transport failure')).mockResolvedValueOnce({ ...makeRun('queued'), id: 'run-two' });
    const user = userEvent.setup(); renderScreen('run-one'); await screen.findByText('Execution stopped responding.');
    await user.click(screen.getByRole('button', { name: 'Run this revision again' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Run this revision again' }));
    expect(vi.mocked(api.startDynamicRun).mock.calls[0][2]).toBe(vi.mocked(api.startDynamicRun).mock.calls[1][2]);
  });
  it('stops active work and does not show a rerun action for that run', async () => {
    vi.mocked(api.dynamicRuns).mockResolvedValue([makeRun('running')]);
    vi.mocked(api.stopDynamicRun).mockResolvedValue(makeRun('cancelled'));
    const user = userEvent.setup(); renderScreen('run-one');
    await user.click(await screen.findByRole('button', { name: 'Stop run' }));
    expect(api.stopDynamicRun).toHaveBeenCalledWith('project-a', 'run-one');
    expect(screen.queryByRole('button', { name: 'Run this revision again' })).not.toBeInTheDocument();
  });
  it('does not present an old pass as verification of the edited revision', async () => {
    vi.mocked(api.dynamicMissions).mockResolvedValue([{ id: 'mission-one', projectId: 'project-a', currentRevisionId: 'revision-two', createdBy: 'actor', createdAt: '' }]);
    vi.mocked(api.dynamicRevision).mockResolvedValue({ ...revision, id: 'revision-two', revision: 2 });
    vi.mocked(api.dynamicRuns).mockResolvedValue([makeRun()]); renderScreen('run-one');
    expect(await screen.findByText(/does not validate the current test/)).toBeInTheDocument();
  });
  it('labels mock input explicitly and exposes criterion selection', async () => {
    const user = userEvent.setup(); renderScreen(); await fillDraft(user);
    await user.click(screen.getByRole('combobox', { name: 'Criteria source' }));
    await user.click(screen.getByRole('option', { name: 'Example requirements (mock)' }));
    expect(screen.getByText(/No real Review or approval/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Requirement criterion' })).toBeInTheDocument();
  });
  it('requires acknowledgment for exceptional input and persists exclusions with reasons',async()=>{
    const user=userEvent.setup();renderScreen();await fillDraft(user);await user.click(screen.getByRole('combobox',{name:'Criteria source'}));await user.click(screen.getByRole('option',{name:'Example requirements (mock)'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Save test'})).toBeEnabled());
    await user.click(screen.getByRole('combobox',{name:'Mock input scenario'}));await user.click(screen.getByRole('option',{name:'Stale source'}));const acknowledgment=await screen.findByRole('checkbox',{name:/I acknowledge this snapshot/});expect(screen.getByRole('button',{name:'Save test'})).toBeDisabled();await user.click(acknowledgment);
    await user.click(screen.getByRole('combobox',{name:'Requirement criterion'}));await user.click(screen.getByRole('option',{name:'After sign-out a protected page requires authentication.'}));await user.click(screen.getByText('Unselected criteria and exclusions'));await user.click(screen.getByRole('checkbox',{name:'Exclude An incomplete payment form cannot create a transaction.'}));await user.type(screen.getByLabelText('Reason for excluding MOCK-RWA-PAYMENT-01-C1'),'Payment outside read-only authentication scope');await user.click(screen.getByRole('button',{name:'Save test'}));
    await waitFor(()=>expect(api.saveDynamicMission).toHaveBeenCalledWith('project-a',expect.objectContaining({context:expect.objectContaining({snapshotId:'mock-snapshot-rwa-stale'}),contextAcknowledged:true,criterionExclusions:[{criterionId:'MOCK-RWA-PAYMENT-01-C1',reason:'Payment outside read-only authentication scope'}]}),undefined));
  });
  it('preserves criterion options from the loaded revision instead of regenerating a normal fixture',async()=>{
    const context=createStaticContextFixture('project-a')!;context.sources[0].version='historical-v0';context.requirements[0].criteria[1].description='Historical authentication criterion';const historical={...revision,context,checks:[{...revision.checks[0],criterionId:'MOCK-RWA-AUTH-01-C2'}]};vi.mocked(api.dynamicMissions).mockResolvedValue([{id:revision.missionId,projectId:'project-a',currentRevisionId:revision.id,createdBy:'actor',createdAt:''}]);vi.mocked(api.dynamicRevision).mockResolvedValue(historical);
    const user=userEvent.setup();renderScreen();await user.click(await screen.findByRole('button',{name:/Sign-in smoke Revision 1/}));await user.click(screen.getByRole('combobox',{name:'Requirement criterion'}));expect(screen.getByRole('option',{name:'Historical authentication criterion'})).toBeInTheDocument();expect(screen.queryByRole('option',{name:'After sign-out a protected page requires authentication.'})).not.toBeInTheDocument();await user.keyboard('{Escape}');await user.click(screen.getByRole('button',{name:'Save test'}));await waitFor(()=>expect(api.saveDynamicMission).toHaveBeenCalledWith('project-a',expect.objectContaining({context:expect.objectContaining({sources:[expect.objectContaining({version:'historical-v0'})]})}),revision.missionId));
  });
  it('does not generate substitute context or permit a mock save after the injected source fails',async()=>{
    const user=userEvent.setup();render(<DynamicWorkspaceScreen projects={[project]} initialProjectId={project.id} onNavigate={vi.fn()} incomingContextSource={()=>({load:async()=>{throw Error('Unavailable source');}})}/>);await fillDraft(user);await user.click(screen.getByRole('combobox',{name:'Criteria source'}));await user.click(screen.getByRole('option',{name:'Example requirements (mock)'}));await screen.findByRole('alert');expect(screen.queryByText('Incoming snapshot details')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Save test'})).toBeDisabled();expect(screen.getByLabelText('Test goal')).toHaveValue('Inspect sign-in form');expect(api.saveDynamicMission).not.toHaveBeenCalled();
  });

  it('discards pending context when the selected project changes',async()=>{
    let resolve!:(value:ReturnType<typeof createStaticContextFixture>)=>void;const factory=()=>({load:()=>new Promise<ReturnType<typeof createStaticContextFixture>>(done=>{resolve=done;})});const other={...project,id:'project-b',name:'Other project'};const user=userEvent.setup();const props={projects:[project,other],onNavigate:vi.fn(),incomingContextSource:factory};const {rerender}=render(<DynamicWorkspaceScreen {...props} initialProjectId={project.id}/>);await fillDraft(user);await user.click(screen.getByRole('combobox',{name:'Criteria source'}));await user.click(screen.getByRole('option',{name:'Example requirements (mock)'}));
    rerender(<DynamicWorkspaceScreen {...props} initialProjectId={other.id}/>);await waitFor(()=>expect(screen.getByLabelText('Test name')).toHaveValue(''));resolve(createStaticContextFixture('project-a'));await waitFor(()=>expect(screen.queryByText('Incoming snapshot details')).not.toBeInTheDocument());expect(screen.queryByRole('combobox',{name:'Mock input scenario'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Save test'})).toBeEnabled();
  });

  it('generates an editable name and goal from a selected criterion without starting execution',async()=>{
    const user=userEvent.setup();renderScreen();await waitFor(()=>expect(screen.getByRole('button',{name:'Save test'})).toBeEnabled());await user.click(screen.getByRole('combobox',{name:'Criteria source'}));await user.click(screen.getByRole('option',{name:'Example requirements (mock)'}));await waitFor(()=>expect(screen.getByRole('combobox',{name:'Requirement criterion'})).toBeEnabled());await user.click(screen.getByRole('combobox',{name:'Requirement criterion'}));await user.click(screen.getByRole('option',{name:'After sign-out a protected page requires authentication.'}));expect(screen.getByLabelText('Test goal')).toHaveValue('After sign-out a protected page requires authentication.');expect(screen.getByLabelText('Test name')).toHaveValue('After sign-out a protected page requires authentication.');expect(api.startDynamicRun).not.toHaveBeenCalled();
  });

});

it('publishes Run history before slow revisions and coalesces polling during hydration',async()=>{
 vi.useFakeTimers();let resolveRevision:(revision:MissionRevision)=>void=()=>{};
 vi.mocked(api.dynamicMissions).mockResolvedValue([{id:revision.missionId,projectId:project.id,currentRevisionId:revision.id,createdBy:'actor',createdAt:revision.createdAt}]);
 vi.mocked(api.dynamicRuns).mockResolvedValue([makeRun()]);
 vi.mocked(api.dynamicRevision).mockImplementation(()=>new Promise(resolve=>{resolveRevision=resolve;}));
 try{render(<DynamicWorkspaceScreen projects={[project]} initialProjectId={project.id} onNavigate={vi.fn()}/>);
  await act(async()=>{await Promise.resolve();await Promise.resolve();});
  expect(screen.getByRole('button',{name:/Sign-in smoke.*Completed.*Passed/})).toBeInTheDocument();
  await act(async()=>{vi.advanceTimersByTime(15000);});
  expect(api.dynamicRuns).toHaveBeenCalledOnce();expect(api.dynamicRevision).toHaveBeenCalledOnce();
  await act(async()=>{resolveRevision(revision);});
  expect(screen.getByRole('button',{name:/Sign-in smoke.*Revision 1 · 1 checks/})).toBeInTheDocument();
  await act(async()=>{vi.advanceTimersByTime(5000);});
  expect(api.dynamicRuns).toHaveBeenCalledTimes(2);expect(api.dynamicRevision).toHaveBeenCalledOnce();
 }finally{vi.useRealTimers();}
});
