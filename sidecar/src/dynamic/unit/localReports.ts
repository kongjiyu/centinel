import type { DatabaseSync } from 'node:sqlite';
import { redactDynamicReportPayload } from '../reports/localRepository.js';
import { DynamicContractError } from '../types.js';
import type { LocalUnitRuns } from './localRepository.js';
import type { UnitReportSnapshot } from './reports.js';

export const localUnitReportSchema = `
  CREATE TABLE IF NOT EXISTS local_dynamic_unit_report (
    owner TEXT NOT NULL, project TEXT NOT NULL, id TEXT NOT NULL, run TEXT NOT NULL, generated TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, id),
    FOREIGN KEY (owner, project, run) REFERENCES local_dynamic_unit_run(owner, project, id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_dynamic_unit_report_run ON local_dynamic_unit_report(owner, project, run, generated DESC, id);
`;
const unavailable = () => new DynamicContractError(404, 'Unit report not available to this account.');
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export class LocalUnitReports {
  constructor(private readonly db: DatabaseSync, private readonly owner: string, private readonly runs: LocalUnitRuns,
    private readonly secrets?: (project: string) => Promise<string[]>) {}

  async list(project: string, run: string): Promise<UnitReportSnapshot['metadata'][]> {
    return this.db.prepare(`SELECT json_extract(payload, '$.metadata') AS metadata FROM local_dynamic_unit_report
      WHERE owner = ? AND project = ? AND run = ? ORDER BY generated DESC, id LIMIT 100`).all(this.owner, project, run)
      .map(row => JSON.parse(String(row.metadata)) as UnitReportSnapshot['metadata']);
  }

  async get(project: string, id: string): Promise<UnitReportSnapshot> {
    const saved = this.find(id);
    if (!saved || saved.metadata.projectId !== project) throw unavailable();
    return saved;
  }

  async capture(project: string, runId: string, id: string): Promise<UnitReportSnapshot> {
    const existing = this.find(id);
    if (existing) return this.replay(existing, project, runId);
    const secrets = await this.secrets?.(project) ?? [];
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const raced = this.find(id);
      let report: UnitReportSnapshot;
      if (raced) report = this.replay(raced, project, runId);
      else {
        const run = this.runs.read(project, runId);
        if (run.state === 'queued' || run.state === 'running') {
          throw new DynamicContractError(409, 'Select a stopped Unit Run before capturing a report.');
        }
        report = {
          metadata: { schemaVersion: 'centinel-unit-report-v1', generatorVersion: 'unit-report-1',
            reportId: id.toLowerCase(), projectId: project, runId, actorId: this.owner, generatedAt: new Date().toISOString() },
          run: redactDynamicReportPayload(run, secrets) as UnitReportSnapshot['run'],
          cleanupEvents: redactDynamicReportPayload(this.runs.eventsForRun(project, runId), secrets) as UnitReportSnapshot['cleanupEvents'],
          limitations: ['Existing Vitest tests only. Findings and browser verification are separate.',
            'This report freezes the framework outcome and cleanup records available at capture.'],
        };
        this.insert(report);
      }
      this.db.exec('COMMIT');
      return report;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  seed(project: string, reports: UnitReportSnapshot[]): void {
    if (!Array.isArray(reports)) throw new Error('Invalid Unit report history.');
    for (const report of reports) {
      const metadata = report?.metadata;
      if (!metadata || metadata.projectId !== project || metadata.schemaVersion !== 'centinel-unit-report-v1'
        || metadata.generatorVersion !== 'unit-report-1' || !uuid.test(metadata.reportId) || !uuid.test(metadata.actorId)
        || !Number.isFinite(Date.parse(metadata.generatedAt)) || report.run?.id !== metadata.runId || report.run.projectId !== project
        || !Array.isArray(report.cleanupEvents) || !Array.isArray(report.limitations)) throw new Error('Invalid archived Unit report.');
      const run = this.runs.read(project, metadata.runId);
      if (run.environmentId !== report.run.environmentId) throw new Error('Archived Unit report environment does not match its Run.');
      this.insert(report);
    }
  }

  private replay(report: UnitReportSnapshot, project: string, runId: string) {
    if (report.metadata.projectId !== project || report.metadata.runId !== runId || report.metadata.actorId !== this.owner) throw unavailable();
    return report;
  }

  private find(id: string): UnitReportSnapshot | null {
    const row = this.db.prepare('SELECT payload FROM local_dynamic_unit_report WHERE owner = ? AND id = ?').get(this.owner, id.toLowerCase());
    return row ? JSON.parse(String(row.payload)) as UnitReportSnapshot : null;
  }

  private insert(report: UnitReportSnapshot): void {
    const payload = JSON.stringify(report);
    if (Buffer.byteLength(payload) > 4 * 1024 * 1024) throw new DynamicContractError(409, 'Unit report exceeds its snapshot limit.');
    const { projectId, reportId, runId, generatedAt } = report.metadata;
    this.db.prepare('INSERT INTO local_dynamic_unit_report VALUES (?, ?, ?, ?, ?, ?)')
      .run(this.owner, projectId, reportId.toLowerCase(), runId, generatedAt, payload);
  }
}
