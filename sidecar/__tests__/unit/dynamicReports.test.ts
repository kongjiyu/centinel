import {describe,it,expect,vi} from 'vitest';
import {renderDynamicReportMarkdown,renderDynamicReportPdf,reportHash} from '../../src/dynamic/reports/render.js';
import {handleDynamicReportRoute} from '../../src/dynamic/reports/routes.js';
import type {DynamicReportSnapshot} from '../../src/dynamic/reports/types.js';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalWorkspace } from '../../src/store/localWorkspace.js';
import { DynamicService } from '../../src/dynamic/service.js';
const project='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',runId='33333333-3333-4333-8333-333333333333';
const snapshot:DynamicReportSnapshot={metadata:{schemaVersion:'centinel-dynamic-report-v1',generatorVersion:'dynamic-report-1',reportId:id,projectId:project,runId,actorId:'reader',generatedAt:'2026-10-15T00:00:00.000Z'},run:{id:runId,projectId:project,missionId:'mission',revision:{id:'revision',missionId:'mission',projectId:project,createdBy:'producer',createdAt:'2026-10-14T00:00:00Z',revision:1,name:'Cancelled report',goal:'Inspect',targetUrl:'http://localhost:3017/defect',maxSteps:4,context:null,contextAcknowledged:false,checks:[{id:'check',criterionId:'criterion',description:'Visible',required:true,kind:'visible_text',expected:'Ready'}]},createdBy:'producer',createdAt:'2026-10-14T00:00:00Z',updatedAt:'2026-10-15T00:00:00Z',state:'cancelled',verdict:'not_tested',checks:[],evidence:[{id:'proof',kind:'screenshot',sha256:'a'.repeat(64),availability:'local',capturedAt:'2026-10-15T00:00:00Z'}],reason:'Stopped'},findings:[],evidenceCopies:[],artifacts:[],dataEvents:[],modelUsage:{status:'available',calls:[{id:'call',stage:'planner',provider:'codex',model:'model',outcome:'completed',input:null,output:8,cacheRead:null,cacheCreation:null,durationMs:42,createdAt:'2026-10-15T00:00:00Z'}]},limitations:['No real Static integration.']};
describe('immutable Dynamic report exports',()=>{
 it('discloses stopped checks, absent usability, missing usage and unsynced proof',()=>{const md=renderDynamicReportMarkdown(snapshot);expect(md).toContain('cancelled · independent verdict: not_tested');expect(md).toContain('| check | criterion | not_tested');expect(md).toContain('no completed usability assessment');expect(md).toContain('Not synced; local capture only');expect(md).toContain('| planner | codex / model | completed | Unavailable | 8');expect(md).toContain('No collected findings');});
 it('renders PDF deterministically without mutating the snapshot',async()=>{const original=structuredClone(snapshot);const one=await renderDynamicReportPdf(snapshot),two=await renderDynamicReportPdf(snapshot);expect(one.subarray(0,4).toString()).toBe('%PDF');expect(reportHash(one)).toBe(reportHash(two));expect(snapshot).toEqual(original);});
 it('authorizes before querying snapshots and rejects client-supplied verdicts',async()=>{const repository={list:vi.fn(),get:vi.fn(),capture:vi.fn()};const denied=vi.fn().mockRejectedValue(Error('revoked'));await expect(handleDynamicReportRoute({method:'GET',pathname:`/projects/${project}/dynamic/reports/${id}/json`,readBody:async()=>({})},{repository,requireMember:denied})).rejects.toThrow('revoked');expect(repository.get).not.toHaveBeenCalled();const result=await handleDynamicReportRoute({method:'POST',pathname:`/projects/${project}/dynamic/runs/${runId}/reports`,readBody:async()=>({reportId:id,verdict:'passed'})},{repository,requireMember:async()=>{}});expect(result?.status).toBe(400);expect(repository.capture).not.toHaveBeenCalled();});
 it('exports the selected frozen snapshot with a checksum and fixed filename',async()=>{const repository={list:vi.fn(),get:vi.fn().mockResolvedValue(snapshot),capture:vi.fn()};const result=await handleDynamicReportRoute({method:'GET',pathname:`/projects/${project}/dynamic/reports/${id}/markdown`,readBody:async()=>({})},{repository,requireMember:async()=>{}});expect(result?.status).toBe(200);expect(result&&'filename'in result&&result.filename).toBe(`centinel-dynamic-${id}.md`);expect(result&&'sha256'in result&&result.sha256).toBe(reportHash(Buffer.from(renderDynamicReportMarkdown(snapshot))));});
});

it('rejects active local Runs and freezes sanitized content from a stopped Run', async () => {
 const root = mkdtempSync(join(tmpdir(), 'centinel-report-fixture-'));
 const workspace = new LocalWorkspace(root);
 const owner = randomUUID();
 const app = workspace.createProject(owner, { name: 'Example project', description: '', workspacePath: '' });
 const deviceSecret = 'synthetic-private-session-value';
 const service = new DynamicService(workspace.dynamicRuns(owner));
 const repository = workspace.dynamicReports(owner, async () => [deviceSecret]);
 try {
  const revision = await service.saveMission(app.id, owner, {
   name: 'Stopped test', goal: 'Inspect /Users/demo/project and redact ' + deviceSecret,
   targetUrl: 'http://localhost:3000/?test=private-query-value', maxSteps: 4,
   checks: [{ id: 'read', criterionId: 'greeting', description: 'Read greeting', required: true, kind: 'visible_text', expected: 'Ready' }],
  });
  const { run } = await service.start(app.id, owner, revision.id, randomUUID());
  const reportId = randomUUID();
  await expect(repository.capture(app.id, run.id, reportId)).rejects.toMatchObject({ status: 409 });
  await service.stop(app.id, run.id, 'blocked', 'Failed to reach ' + deviceSecret);
  const report = await repository.capture(app.id, run.id, reportId);
  expect(report).toMatchObject({ metadata: { reportId, runId: run.id }, run: {
   state: 'blocked', verdict: 'not_tested', reason: 'Failed to reach [REDACTED]',
   revision: { id: revision.id, goal: 'Inspect [local path withheld] and redact [REDACTED]' },
  }, modelUsage: { status: 'unavailable', calls: [] } });
  expect(JSON.stringify(report)).not.toMatch(/synthetic-private-session-value|private-query-value|idempotencyKey|legacySessionId/);
  workspace.close();
  const restored = new LocalWorkspace(root);
  try {
   expect(await restored.dynamicReports(owner).get(app.id, reportId)).toEqual(report);
   await expect(restored.dynamicReports('other').get(app.id, reportId)).rejects.toMatchObject({ status: 404 });
  } finally { restored.close(); }
 } finally {
  workspace.close();
  rmSync(root, { recursive: true, force: true });
 }
});
