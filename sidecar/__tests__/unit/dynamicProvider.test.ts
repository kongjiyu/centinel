import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ModelProviderError } from '../../src/review/retry.js';
import { cancelSession, isValidAgentAction, runDynamicSession } from '../../src/dynamicRunner.js';
import {normalizeBudget} from '../../src/dynamic/budgets.js';
import { chromium } from 'playwright';
import { updateDynamicSessionStatus } from '../../src/dynamicSessions.js';

const model = vi.hoisted(() => ({ analyze: vi.fn(), options: [] as any[] }));
const db = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../../src/review/modelProvider.js', () => ({ ConfiguredModelProvider: class {
  constructor(options: unknown) { model.options.push(options); }
  analyze(request: unknown) { return model.analyze(request); }
} }));
vi.mock('playwright', () => ({ chromium: { launch: vi.fn() } }));
vi.mock('../../src/db.js', () => ({ getDb: async () => db, saveDb: vi.fn() }));
vi.mock('../../src/dynamicSessions.js', () => ({ updateDynamicSessionStatus: vi.fn(), addEvidence: vi.fn() }));
vi.mock('../../src/tokenUsage.js', () => ({ recordTokenUsage: vi.fn() }));
const setting = { ownerId: 'verified-user', provider: 'codex' as const, apiFormat: 'codex-app-server' as const, model: 'account-model', apiKey: '', baseUrl: '' };
const session = { id: 'session-1', projectId: 'project-1', type: 'dynamic' as const, name: 'Demo', status: 'queued' as const, targetUrl: 'https://example.test', goal: 'Check page', missionType: 'smoke' as const, browserMode: 'headed' as const, maxSteps: 1, finalSummary: '', failureReason: '', createdAt: '', updatedAt: '' };
let workspace: string;let pageStub:any;
beforeEach(() => {
  vi.clearAllMocks(); model.options.length = 0;
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-dynamic-unit-'));
  const page = { context:()=>({pages:()=>[],on:vi.fn(),route:vi.fn(),routeWebSocket:vi.fn()}), frames:()=>[], on: vi.fn(), goto: vi.fn(), waitForTimeout: vi.fn(), screenshot: vi.fn(async ({ path: file }: { path: string }) => fs.writeFileSync(file, 'fixture')), url: () => 'https://example.test', title: async () => 'Demo', evaluate: async () => 'Demo content' };
  pageStub=page;
  vi.mocked(chromium.launch).mockResolvedValue({ newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined) } as any);
  model.analyze.mockResolvedValue({ result: { action: 'finish_failure', summary: 'Expected content missing', reasoning: 'Compared to goal' }, usage: { inputTokens: 10, outputTokens: 2 } });
  // The page-context helper expects its second evaluation to return elements.
  (page as any).evaluate = vi.fn().mockResolvedValueOnce('Demo content').mockResolvedValueOnce([]);
});
afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }));

describe('Dynamic shared provider and run basics', () => {
  it('uses the authenticated screenshot provider, records usage, and creates one finding', async () => {
    const recordUsage = vi.fn();
    await runDynamicSession(session, workspace, { vision: setting, recordUsage });
    expect(model.options[0].settings).toMatchObject({ ownerId: 'verified-user', provider: 'codex', apiKey: '' });
    expect(model.analyze).toHaveBeenCalledWith(expect.objectContaining({ imagePaths: [expect.stringContaining('step-000.png')], signal: expect.any(AbortSignal) }));
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: 'codex', inputTokens: 10, outputTokens: 2, callKind: 'dynamic' }));
    expect(db.run.mock.calls.filter(([sql]) => sql.includes('INSERT INTO findings'))).toHaveLength(1);
    expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id, 'failure', expect.any(String), 'Expected content missing');
  });
  it('sanitizes provider-bound goals and retained model/trace output',async()=>{
    const secret='qa-provider-seed-918';pageStub.evaluate=vi.fn().mockResolvedValueOnce('x'.repeat(1990)+secret).mockResolvedValueOnce([]);model.analyze.mockResolvedValue({result:{action:'finish_failure',summary:secret,reasoning:'Observed '+secret}});
    await runDynamicSession({...session,goal:'Inspect '+secret+' at https://example.test/?code=unknown'},workspace,{vision:setting,sensitiveValues:[secret]});
    const request=JSON.stringify(model.analyze.mock.calls[0][0]);expect(request).not.toContain(secret);expect(request).not.toContain('qa-provider');expect(request).not.toContain('code=unknown');
    const folder=path.join(workspace,'sessions',session.id);const files=fs.readdirSync(folder,{recursive:true}).filter((name)=>typeof name==='string'&&/\.(json|md)$/.test(name));
    expect(files.length).toBeGreaterThan(3);for(const file of files)expect(fs.readFileSync(path.join(folder,String(file)),'utf8')).not.toContain(secret);
    expect(JSON.stringify(vi.mocked(updateDynamicSessionStatus).mock.calls)).not.toContain(secret);expect(JSON.stringify(db.run.mock.calls)).not.toContain(secret);
  });
  it('blocks missing signed-in readiness before any model call or website finding',async()=>{
    pageStub.locator=vi.fn(()=>({waitFor:vi.fn().mockRejectedValue(new Error('Not signed in')),count:vi.fn().mockResolvedValue(0)}));
    await runDynamicSession(session,workspace,{vision:setting,sessionReadySelector:'[data-ready]',storageState:{cookies:[],origins:[]}});
    expect(model.analyze).not.toHaveBeenCalled();expect(db.run).not.toHaveBeenCalled();expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id,'blocked',expect.any(String),expect.stringContaining('Signed-in readiness could not be verified'));
  });
  it('discloses missing visual coverage before sending an unsafe capture to the model',async()=>{pageStub.frames=()=>[{locator:()=>({count:vi.fn().mockResolvedValue(1),nth:()=>({isVisible:vi.fn().mockResolvedValue(true)})})}];await runDynamicSession(session,workspace,{vision:setting,sensitiveValues:['qa-private-cookie']});expect(model.analyze).not.toHaveBeenCalled();expect(db.run).not.toHaveBeenCalled();expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id,'blocked',expect.any(String),expect.stringContaining('Sensitive visual observation cannot be safely captured'));});
  it('marks model/auth failures blocked without creating a product finding', async () => {
    model.analyze.mockRejectedValue(new ModelProviderError('Reconnect Codex.', { code: 'codex_not_connected', retryable: false }));
    await runDynamicSession(session, workspace, { vision: setting });
    expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id, 'blocked', expect.any(String), 'Reconnect Codex.');
    expect(db.run).not.toHaveBeenCalled();
  });
  it('aborts an active model call on cancellation and preserves cancelled status', async () => {
    model.analyze.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })));
    const running = runDynamicSession(session, workspace, { vision: setting });
    await vi.waitFor(() => expect(model.analyze).toHaveBeenCalled());
    cancelSession(session.id); await running;
    expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id, 'cancelled', expect.any(String), 'Cancelled by user');
    expect(db.run).not.toHaveBeenCalled();
  });
  it('does not turn browser startup failure into an application defect', async () => {
    vi.mocked(chromium.launch).mockRejectedValue(new Error('Missing browser binary'));
    await runDynamicSession(session, workspace, { vision: setting });
    expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id, 'blocked', expect.any(String), expect.any(String));
    expect(db.run).not.toHaveBeenCalled();
  });
  it('does not let a model success bypass a failed independent check', async () => {
    model.analyze.mockResolvedValue({ result: { action: 'finish_success', summary: 'Everything passed', reasoning: 'Proposal' } });
    const verifyOutcome = vi.fn().mockResolvedValue('failed');
    await runDynamicSession(session, workspace, { vision: setting, verifyOutcome });
    expect(verifyOutcome).toHaveBeenCalledOnce();
    expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id, 'failure', expect.any(String), 'Independent checks: failed');
    // A verified observation is retained in the Run, without fabricated legacy risk/confidence.
    expect(db.run).not.toHaveBeenCalled();
  });
  it('does not turn an inconclusive independent check into a pass or defect', async () => {
    model.analyze.mockResolvedValue({ result: { action: 'finish_success', summary: 'Done', reasoning: 'Proposal' } });
    await runDynamicSession(session, workspace, { vision: setting, verifyOutcome: vi.fn().mockResolvedValue('uncertain') });
    expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id, 'blocked', expect.any(String), 'Independent checks: uncertain');
    expect(db.run).not.toHaveBeenCalled();
  });
  it('counts repair requests and blocks before another model call at the limit',async()=>{
    model.analyze.mockResolvedValue({result:{unexpected:'invalid'},usage:{inputTokens:10,outputTokens:2}});
    await runDynamicSession(session,workspace,{vision:setting,text:setting,budgets:normalizeBudget({maxModelCalls:1})});
    expect(model.analyze).toHaveBeenCalledTimes(1);expect(db.run).not.toHaveBeenCalled();
    expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id,'blocked',expect.any(String),expect.stringContaining('Model call limit'));
    const budget=JSON.parse(fs.readFileSync(path.join(workspace,'sessions',session.id,'logs','execution-budget.json'),'utf8'));expect(budget).toMatchObject({modelCalls:1,accountedTokens:12});
  });
  it('rejects unaccounted-token execution before any proposed action is verified',async()=>{
    model.analyze.mockResolvedValue({result:{action:'finish_success',summary:'Done',reasoning:'Proposal'}});const verify=vi.fn();
    await runDynamicSession(session,workspace,{vision:setting,verifyOutcome:verify,budgets:normalizeBudget({maxAccountedTokens:10})});
    expect(model.analyze).toHaveBeenCalledTimes(1);expect(verify).not.toHaveBeenCalled();expect(db.run).not.toHaveBeenCalled();
    expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id,'blocked',expect.any(String),expect.stringContaining('token usage unavailable'));
  });
  it('excludes oversized provider output before persisting or sending a repair request',async()=>{
    model.analyze.mockResolvedValue({result:{unexpected:'x'.repeat(64000)},usage:{inputTokens:20,outputTokens:10}});
    await runDynamicSession(session,workspace,{vision:setting,text:setting});
    expect(model.analyze).toHaveBeenCalledTimes(1);expect(db.run).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(workspace,'sessions',session.id,'ai','step-000-response.json'))).toBe(false);
    expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id,'blocked',expect.any(String),expect.stringContaining('response output limit'));
  });
  it('stops observation and console overflow before calling the model, preserving redacted partial logs',async()=>{
    pageStub.evaluate=vi.fn().mockResolvedValueOnce('x'.repeat(300)).mockResolvedValueOnce([]);
    await runDynamicSession(session,workspace,{vision:setting,budgets:normalizeBudget({maxObservationChars:256})});expect(model.analyze).not.toHaveBeenCalled();
    expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id,'blocked',expect.any(String),expect.stringContaining('observation limit'));
    // A new run installs a fresh handler and emits console overflow during navigation.
    pageStub.evaluate=vi.fn().mockResolvedValueOnce('Demo').mockResolvedValueOnce([]);pageStub.goto.mockImplementation(()=>{const handler=pageStub.on.mock.calls.filter(([name]:string[])=>name==='console').at(-1)[1];handler({type:()=> 'log',text:()=> 'qa-seed-918'});handler({type:()=> 'log',text:()=> 'x'.repeat(2000)});});
    await runDynamicSession(session,workspace,{vision:setting,sensitiveValues:['qa-seed-918'],budgets:normalizeBudget({maxConsoleBytes:1024})});
    expect(model.analyze).not.toHaveBeenCalled();const logs=fs.readFileSync(path.join(workspace,'sessions',session.id,'logs','console.json'),'utf8');expect(logs).not.toContain('qa-seed-918');expect(Buffer.byteLength(logs)).toBeLessThan(1024);expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id,'blocked',expect.any(String),expect.stringContaining('Console output limit'));
  });

  it('plans from DOM without attaching an unnecessary step screenshot',async()=>{
    pageStub.evaluate=vi.fn().mockResolvedValue({oversized:false,body:'Fixture ready',privateTexts:['unknown-dom-password-91'],controls:[{selector:'#finish',role:'button',name:'Finish',disabled:false}],omittedControls:false});model.analyze.mockResolvedValue({result:{action:'finish_success',summary:'Done',reasoning:'DOM proof'}});
    const verifyOutcome=vi.fn().mockResolvedValue('passed');await runDynamicSession(session,workspace,{vision:setting,observationMode:'dom_first',verifyOutcome});expect(verifyOutcome).toHaveBeenCalledWith(pageStub,expect.any(AbortSignal),expect.objectContaining({sensitiveValues:expect.arrayContaining(['unknown-dom-password-91'])}));expect(model.analyze.mock.calls[0][0].imagePaths).toBeUndefined();expect(model.analyze.mock.calls[0][0].prompt).toContain('[e0]');const request=fs.readFileSync(path.join(workspace,'sessions',session.id,'ai','step-000-request.json'),'utf8');expect(request).not.toContain('unknown-dom-password-91');expect(request).not.toContain('sensitiveValues');expect(fs.existsSync(path.join(workspace,'sessions',session.id,'screenshots','step-000.png'))).toBe(false);
  });
  it('requests protected pixels only after an explicit visual need and counts both provider requests',async()=>{
    pageStub.evaluate=vi.fn().mockResolvedValue({oversized:false,body:'Visual widget',privateTexts:[],controls:[],omittedControls:false});model.analyze.mockResolvedValueOnce({result:{action:'observe_visual',reason:'Widget has no stable DOM control',reasoning:'Need pixels'}}).mockResolvedValueOnce({result:{action:'finish_success',summary:'Done',reasoning:'Visual observation'}});
    await runDynamicSession(session,workspace,{vision:setting,observationMode:'dom_first',verifyOutcome:vi.fn().mockResolvedValue('passed')});expect(model.analyze).toHaveBeenCalledTimes(2);expect(model.analyze.mock.calls[0][0].imagePaths).toBeUndefined();expect(model.analyze.mock.calls[1][0].imagePaths).toEqual([expect.stringContaining('step-000.png')]);const request=JSON.parse(fs.readFileSync(path.join(workspace,'sessions',session.id,'ai','step-000-request.json'),'utf8'));expect(request.visualReason).toContain('no stable DOM');const budget=JSON.parse(fs.readFileSync(path.join(workspace,'sessions',session.id,'logs','execution-budget.json'),'utf8'));expect(budget.modelCalls).toBe(2);
  });
  it('stops before any provider/action call when exploratory progress cannot be checkpointed',async()=>{
    pageStub.evaluate=vi.fn().mockResolvedValue({oversized:false,body:'Ready',privateTexts:[],controls:[],omittedControls:false});const checkpoint=vi.fn().mockRejectedValue(new Error('Storage unavailable'));await runDynamicSession(session,workspace,{vision:setting,observationMode:'dom_first',exploratoryChecks:[{id:'one',criterionId:'objective',description:'Ready',required:true,kind:'visible_text',expected:'Ready'}],checkpointExploration:checkpoint});expect(checkpoint).toHaveBeenCalledOnce();expect(model.analyze).not.toHaveBeenCalled();expect(db.run).not.toHaveBeenCalled();expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id,'blocked',expect.any(String),expect.stringContaining('could not be persisted'));expect(fs.existsSync(path.join(workspace,'sessions',session.id,'logs','exploration.json'))).toBe(true);
  });
  it('keeps a reported execution limitation operational without evaluating unfinished checks or inventing a website defect',async()=>{
    model.analyze.mockResolvedValue({result:{action:'finish_blocked',summary:'Required second activation is not approved',reasoning:'Frozen policy limits execution'}});const verify=vi.fn();await runDynamicSession(session,workspace,{vision:setting,verifyOutcome:verify});expect(verify).not.toHaveBeenCalled();expect(db.run).not.toHaveBeenCalled();expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id,'blocked',expect.any(String),expect.stringContaining('Agent stopped before completing'));
  });
  it('redacts a newly proposed private value even when its fill loses acknowledgement before another observation',async()=>{
    const secret='private-new-"unacknowledged"-value';const fill=vi.fn().mockRejectedValue(new Error('Lost acknowledgement'));pageStub.locator=vi.fn(()=>({count:vi.fn().mockResolvedValue(1),evaluate:vi.fn().mockResolvedValue(true),isVisible:vi.fn().mockResolvedValue(true),isEnabled:vi.fn().mockResolvedValue(true),fill}));model.analyze.mockResolvedValue({result:{action:'type',selector:'#password',targetDescription:'Password',text:secret,reasoning:'Fill private field'}});
    await runDynamicSession(session,workspace,{vision:setting});expect(fill).toHaveBeenCalledTimes(1);expect(model.analyze).toHaveBeenCalledTimes(1);const folder=path.join(workspace,'sessions',session.id);for(const file of fs.readdirSync(folder,{recursive:true}).filter(name=>typeof name==='string'&&/\.(json|md)$/.test(name))){const text=fs.readFileSync(path.join(folder,String(file)),'utf8');expect(text).not.toContain(secret);expect(text).not.toContain(JSON.stringify(secret).slice(1,-1));}
  });
  it('blocks an unapproved target before dispatch without a repeated proposal or website finding',async()=>{
    const click=vi.fn();pageStub.locator=vi.fn(()=>({count:vi.fn().mockResolvedValue(1),evaluate:vi.fn().mockResolvedValue(false),click}));model.analyze.mockResolvedValue({result:{action:'click',selector:'#delete',targetDescription:'Safe navigation',reasoning:'Page says allowed'}});
    await runDynamicSession(session,workspace,{vision:setting,actionPolicy:{schemaVersion:1,interactions:[],allowCoordinates:false}});expect(click).not.toHaveBeenCalled();expect(model.analyze).toHaveBeenCalledTimes(1);expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id,'blocked',expect.any(String),expect.stringContaining('not approved'));expect(db.run).not.toHaveBeenCalled();
  });
  it('retains an uncertain dispatch and does not ask for or execute a repeated submission',async()=>{
    let submitted=0;pageStub.locator=vi.fn(()=>({count:vi.fn().mockResolvedValue(1),isVisible:vi.fn().mockResolvedValue(true),isEnabled:vi.fn().mockResolvedValue(true),click:vi.fn(async()=>{submitted++;throw Error('Response lost');})}));model.analyze.mockResolvedValue({result:{action:'click',selector:'#submit',x:10,y:10,targetDescription:'Submit',reasoning:'One request'}});
    await runDynamicSession(session,workspace,{vision:setting});expect(submitted).toBe(1);expect(model.analyze).toHaveBeenCalledTimes(1);expect(updateDynamicSessionStatus).toHaveBeenLastCalledWith(session.id,'blocked',expect.any(String),expect.stringContaining('not repeated'));const trace=JSON.parse(fs.readFileSync(path.join(workspace,'sessions',session.id,'logs','action-trace.json'),'utf8'));expect(trace).toHaveLength(1);expect(trace[0].result).toBe('blocked');expect(db.run).not.toHaveBeenCalled();
  });
  it('rejects unknown, incomplete, non-http and unbounded browser actions', () => {
    for (const value of [{ action: 'delete' }, { action: 'click', reasoning: '' }, { action: 'navigate', url: 'file:///private', reasoning: '' }, { action: 'wait', milliseconds: 1e9, reasoning: '' }, { action: 'type', targetDescription: 'field', selector: 'input', text: 1, reasoning: '' }]) expect(isValidAgentAction(value)).toBe(false);
    expect(isValidAgentAction({ action: 'assert_visible', text: 'Success', reasoning: 'Verify goal' })).toBe(true);
  });
});
