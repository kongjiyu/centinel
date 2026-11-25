import type { DatabaseSync } from 'node:sqlite';
import type { StoreModelUsage } from '../../store/types.js';
import { redactObservation } from '../browser/privacy.js';
import type { LocalEnvironmentRepository } from '../environment/localRepository.js';
import type { LocalDynamicFindings } from '../findings/localRepository.js';
import type { LocalDynamicHistory } from '../localHistory.js';
import type { LocalEvidenceCopies } from '../sharedEvidence/localRepository.js';
import { DynamicContractError, type DynamicRun } from '../types.js';
import type { DynamicReportRepository } from './repository.js';
import type { DynamicReportSnapshot, DynamicReportSummary } from './types.js';

export const localDynamicReportSchema = `
  CREATE TABLE IF NOT EXISTS local_dynamic_report (
    owner TEXT NOT NULL, project TEXT NOT NULL, id TEXT NOT NULL, run TEXT NOT NULL, generated TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, id),
    FOREIGN KEY (owner, project, run) REFERENCES local_dynamic_run(owner, project, id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_dynamic_report_run ON local_dynamic_report(owner, project, run, generated DESC, id);
`;

const maxSnapshotBytes = 4 * 1024 * 1024;
const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const unavailable = () => new DynamicContractError(404, 'Report not available to this project/account.');
const protectedKey = /password|secret|cookie|authorization|api_?key|prompt|reasoning|object_?path|workspace_?path|session_?reference|idempotency|lease/i;
const runtimeField = /^(?:token|access_?token|refresh_?token|legacySessionId|actionPolicy|sessionSnapshot|startupInstructions)$/i;
const localPath = /(?:[A-Z]:[\\/]|\\\\[\w.-]+\\|\/(?:Users|home|private|tmp|var|Volumes|Applications|mnt)\/)[^\s"'<>]*/gi;
const stableDigest = /^[a-f0-9]{64}$/i;

/** The report is public to the authorized project audience. Redact text at capture, including the pinned baseline. */
export function redactDynamicReportPayload(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') {
    if (idPattern.test(value) || stableDigest.test(value)) return value;
    return redactObservation(value, secrets).replace(localPath, '[local path withheld]');
  }
  if (Array.isArray(value)) return value.map(item => redactDynamicReportPayload(item, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([label]) => !protectedKey.test(label) && !runtimeField.test(label))
      .map(([label, item]) => [label, redactDynamicReportPayload(item, secrets)]));
  }
  return value;
}

export class LocalDynamicReports implements DynamicReportRepository {
  constructor(private readonly db: DatabaseSync, private readonly owner: string, private readonly sources: {
    runs: LocalDynamicHistory;
    findings: LocalDynamicFindings;
    environments: LocalEnvironmentRepository;
    evidence: LocalEvidenceCopies;
    usage(project: string, run: string): StoreModelUsage[];
    secrets?(project: string): Promise<string[]>;
  }) {}

  async list(project: string, run: string): Promise<DynamicReportSummary[]> {
    return this.db.prepare(`SELECT json_extract(payload, '$.metadata') AS metadata FROM local_dynamic_report
      WHERE owner = ? AND project = ? AND run = ? ORDER BY generated DESC, id LIMIT 100`)
      .all(this.owner, project, run.toLowerCase()).map(row => JSON.parse(String(row.metadata)) as DynamicReportSummary);
  }

  async get(project: string, id: string): Promise<DynamicReportSnapshot> {
    const saved = this.find(id.toLowerCase());
    if (!saved || saved.metadata.projectId !== project) throw unavailable();
    return saved;
  }

  async capture(project: string, runId: string, reportId: string): Promise<DynamicReportSnapshot> {
    const id = reportId.toLowerCase();
    const runKey = runId.toLowerCase();
    const existing = this.find(id);
    if (existing) return this.replay(existing, project, runKey);
    const secrets = await this.sources.secrets?.(project) ?? [];
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const raced = this.find(id);
      let snapshot: DynamicReportSnapshot;
      if (raced) snapshot = this.replay(raced, project, runKey);
      else {
        const run = this.sources.runs.run(project, runKey);
        if (!run || !['completed', 'blocked', 'cancelled', 'interrupted'].includes(run.state)) {
          throw new DynamicContractError(409, 'Select a stopped Run before capturing a report.');
        }
        snapshot = this.snapshot(run, id, secrets);
        this.insert(snapshot);
      }
      this.db.exec('COMMIT');
      return snapshot;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Hosted reports are already captured snapshots. Preserve their original metadata and content. */
  seed(project: string, snapshots: DynamicReportSnapshot[]): void {
    if (!Array.isArray(snapshots)) throw new Error('Invalid Dynamic report history.');
    for (const snapshot of snapshots) {
      const metadata = snapshot?.metadata;
      const run = metadata && this.sources.runs.run(project, metadata.runId);
      if (!metadata || metadata.projectId !== project || metadata.schemaVersion !== 'centinel-dynamic-report-v1'
        || metadata.generatorVersion !== 'dynamic-report-1' || !idPattern.test(metadata.reportId) || !idPattern.test(metadata.actorId)
        || !Number.isFinite(Date.parse(metadata.generatedAt)) || !run || snapshot.run?.projectId !== project
        || snapshot.run.id !== run.id || snapshot.run.revision?.id !== run.revision.id
        || ![snapshot.run.checks, snapshot.run.evidence, snapshot.run.revision.checks, snapshot.findings, snapshot.evidenceCopies,
          snapshot.artifacts, snapshot.dataEvents, snapshot.modelUsage?.calls, snapshot.limitations].every(Array.isArray)
        || snapshot.findings.some(item => item?.finding?.projectId !== project || !Array.isArray(item.observations) || !Array.isArray(item.events))
        || [...snapshot.artifacts, ...snapshot.evidenceCopies].some(item => item?.projectId !== project || item.runId !== run.id)) {
        throw new Error('An archived Dynamic report has invalid project or Run metadata.');
      }
      this.insert(snapshot);
    }
  }

  private snapshot(run: DynamicRun, reportId: string, secrets: string[]): DynamicReportSnapshot {
    const { projectId: project, id } = run;
    const calls = this.sources.usage(project, id).filter(item => item.ownerId === run.createdBy)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(item => ({ id: item.id, stage: item.stage, provider: item.provider, model: item.model, outcome: item.outcome,
        input: item.inputTokens, output: item.outputTokens, cacheRead: item.cacheReadTokens,
        cacheCreation: item.cacheCreationTokens, durationMs: item.durationMs, createdAt: item.createdAt }));
    const localEvidence = run.evidence.map(ref => {
      let status: NonNullable<DynamicReportSnapshot['localEvidence']>[number]['status'];
      try { status = this.sources.runs.evidence(project, id, ref.id) ? 'available' : 'missing'; }
      catch (error) {
        if (!(error instanceof DynamicContractError)) throw error;
        status = 'unverifiable';
      }
      return { evidenceId: ref.id, status };
    });
    const body = {
      run, findings: this.sources.findings.detailsForRun(project, id), evidenceCopies: this.sources.evidence.list(project, id),
      artifacts: this.sources.evidence.artifacts(project, id),
      dataEvents: run.environment ? this.sources.environments.eventsForRun(project, run.environment.id, id) : [],
      localEvidence, modelUsage: { status: calls.length ? 'available' : 'unavailable', calls },
      limitations: [
        'This report covers the recorded Browser Run. Finding decisions and evidence availability are frozen at capture.',
        'Evidence references grant no access. The evidence bytes remain separate on the executing device.',
        'Captured evidence covers the recorded checks and observations. Diagnostic artifacts are separate.',
        'Environment metadata does not establish identical runtime conditions. Persona simulation is a bounded usability assessment.',
        'Recorded usage may be incomplete. Missing token counts or durations are unavailable.',
      ],
    };
    return { ...(redactDynamicReportPayload(body, secrets) as Omit<DynamicReportSnapshot, 'metadata'>), metadata: {
      schemaVersion: 'centinel-dynamic-report-v1', generatorVersion: 'dynamic-report-1',
      reportId, projectId: project, runId: id, actorId: this.owner, generatedAt: new Date().toISOString(),
    } };
  }

  private replay(snapshot: DynamicReportSnapshot, project: string, run: string) {
    const metadata = snapshot.metadata;
    if (metadata.projectId !== project || metadata.runId !== run || metadata.actorId !== this.owner) throw unavailable();
    return snapshot;
  }

  private find(id: string): DynamicReportSnapshot | null {
    const row = this.db.prepare('SELECT payload FROM local_dynamic_report WHERE owner = ? AND id = ?').get(this.owner, id);
    return row ? JSON.parse(String(row.payload)) as DynamicReportSnapshot : null;
  }

  private insert(snapshot: DynamicReportSnapshot) {
    const payload = JSON.stringify(snapshot);
    if (Buffer.byteLength(payload) > maxSnapshotBytes) throw new DynamicContractError(409, 'Report exceeds bounded snapshot size.');
    const { projectId, reportId, runId, generatedAt } = snapshot.metadata;
    this.db.prepare('INSERT INTO local_dynamic_report VALUES (?, ?, ?, ?, ?, ?)')
      .run(this.owner, projectId, reportId.toLowerCase(), runId, generatedAt, payload);
  }
}
