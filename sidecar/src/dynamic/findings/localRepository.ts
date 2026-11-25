import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { compactCanonicalJson } from '../../report/canonical.js';
import type { LocalDynamicHistory } from '../localHistory.js';
import { compareRegression } from '../regression.js';
import { DynamicContractError, type CheckDefinition, type CheckResult, type DynamicRun, type EvidenceReference } from '../types.js';
import type { FindingRepository } from './repository.js';
import { validateRemediation, validateReview } from './routes.js';
import type { DynamicFinding, FindingDetail, FindingEvent, FindingObservation, RemediationInput, ReviewFindingInput } from './types.js';

export const localDynamicFindingSchema = `
  CREATE TABLE IF NOT EXISTS local_dynamic_finding (
    owner TEXT NOT NULL, project TEXT NOT NULL, id TEXT NOT NULL, finding_key TEXT NOT NULL, updated TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, id), UNIQUE (owner, project, finding_key),
    FOREIGN KEY (owner, project) REFERENCES project(owner, id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS local_dynamic_finding_observation (
    owner TEXT NOT NULL, project TEXT NOT NULL, finding TEXT NOT NULL, id TEXT NOT NULL, run TEXT NOT NULL,
    source TEXT NOT NULL, check_id TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, id), UNIQUE (owner, project, run, source, check_id),
    FOREIGN KEY (owner, project, finding) REFERENCES local_dynamic_finding(owner, project, id),
    FOREIGN KEY (owner, project, run) REFERENCES local_dynamic_run(owner, project, id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_dynamic_finding_run ON local_dynamic_finding_observation (owner, project, finding, run);
  CREATE TABLE IF NOT EXISTS local_dynamic_finding_event (
    owner TEXT NOT NULL, project TEXT NOT NULL, finding TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, id), UNIQUE (owner, project, finding, version),
    FOREIGN KEY (owner, project, finding) REFERENCES local_dynamic_finding(owner, project, id)
  ) STRICT;
`;

const decode = <T>(row: { payload?: unknown }) => JSON.parse(String(row.payload)) as T;
// PostgreSQL jsonb arrays place one space after each comma. Preserve imported correlation keys.
const key = (...items: string[]) => createHash('sha256').update('[' + items.map(item => JSON.stringify(item)).join(', ') + ']').digest('hex');
const same = (left: unknown, right: unknown) => compactCanonicalJson(left) === compactCanonicalJson(right);
const target = (run: DynamicRun) => run.environment?.targetUrl ?? run.revision.targetUrl;
const digest = /^[a-f0-9]{64}$/;
const findingMissing = () => new DynamicContractError(404, 'Finding not found in this project.');
const staleDecision = () => new DynamicContractError(409, 'Finding changed. Refresh it before recording a decision.');

type Candidate = Pick<FindingObservation, 'result' | 'definition' | 'evidence' | 'usability' | 'suggestions'> & {
  source: DynamicFinding['source']; key: string;
};

function references(run: DynamicRun, ids: string[]): EvidenceReference[] {
  if (!ids.length || ids.length !== new Set(ids).size) return [];
  const refs = run.evidence.filter(ref => ids.includes(ref.id) && digest.test(ref.sha256));
  return refs.length === ids.length && new Set(refs.map(ref => ref.id)).size === ids.length ? refs : [];
}

function candidatesFor(run: DynamicRun): Candidate[] {
  const candidates: Candidate[] = [];
  for (const result of run.checks) {
    if (result.verdict !== 'failed' || run.checks.filter(row => row.checkId === result.checkId).length !== 1) continue;
    const definition = run.revision.checks.find(check => check.id === result.checkId && check.criterionId === result.criterionId);
    const evidence = references(run, result.evidenceIds);
    if (definition && evidence.length) candidates.push({ source: 'dynamic_checker', result, definition, evidence,
      key: key(run.missionId, result.checkId, result.criterionId, target(run)) });
  }
  const assessment = run.usability;
  if (!assessment) return candidates;
  if (!run.revision.usability || !same(assessment.config, run.revision.usability)) {
    throw new DynamicContractError(409, 'Frozen usability results required.');
  }
  for (const [index, observed] of assessment.observations.entries()) {
    if (observed.kind !== 'deterministic' || observed.verdict !== 'failed' || observed.persona !== assessment.config.persona
      || !assessment.config.rules.includes(observed.ruleId)) continue;
    const evidence = references(run, observed.evidenceIds);
    if (!evidence.some(ref => ref.kind === 'usability')) continue;
    const stable = observed.controlKey && digest.test(observed.controlKey) ? observed.controlKey : null;
    const correlation = stable ? 'stable_control' : observed.checkId ? 'explicit_check' : 'run_only';
    const identity = stable ?? observed.checkId ?? run.id + ':' + index;
    const checkId = 'usability:' + key(observed.ruleId, observed.persona, correlation, identity);
    const label = stable ? 'control ' + stable.slice(0, 8) : observed.checkId ? 'check ' + observed.checkId
      : 'Run ' + run.id.slice(0, 8) + ' · ' + (observed.controlRef ?? 'sampled rule');
    const definition: CheckDefinition = { id: checkId, criterionId: observed.ruleId,
      description: 'Usability: ' + observed.ruleId + ' · ' + label, required: false, kind: 'visible_text', expected: observed.expected };
    const result: CheckResult = { checkId, criterionId: observed.ruleId, verdict: 'failed', observed: observed.observed,
      reason: 'Recorded bounded usability rule failure; human review required.', evidenceIds: observed.evidenceIds, checkedAt: assessment.assessedAt };
    candidates.push({ source: 'dynamic_usability', key: key('usability', run.missionId, checkId, target(run)), result, definition, evidence,
      usability: { ...observed, observationIndex: index, correlation },
      suggestions: assessment.suggestions?.items.filter(item => item.observationIndexes.includes(index)) ?? [] });
  }
  return candidates;
}

export class LocalDynamicFindings implements FindingRepository {
  constructor(private readonly db: DatabaseSync, private readonly owner: string, private readonly history: LocalDynamicHistory) {}

  async list(project: string): Promise<DynamicFinding[]> {
    return this.db.prepare('SELECT payload FROM local_dynamic_finding WHERE owner = ? AND project = ? ORDER BY updated DESC, id')
      .all(this.owner, project).map(decode<DynamicFinding>);
  }

  async get(project: string, id: string): Promise<FindingDetail> {
    return this.detail(project, id);
  }

  detailsForRun(project: string, run: string): FindingDetail[] {
    return this.db.prepare(`SELECT DISTINCT finding FROM local_dynamic_finding_observation
      WHERE owner = ? AND project = ? AND run = ? ORDER BY finding`)
      .all(this.owner, project, run).map(row => this.detail(project, String(row.finding)));
  }

  /** Imported decisions stay historical. A reference can survive even if its original bytes were unavailable. */
  seed(project: string, details: FindingDetail[]): void {
    const invalid = () => new Error('Invalid Dynamic finding history or references.');
    if (!Array.isArray(details)) throw invalid();
    const ids = new Set<string>();
    const candidatesByRun = new Map<string, Candidate[]>();
    for (const detail of details) {
      const finding = detail?.finding;
      if (!finding || finding.projectId !== project || !finding.id || ids.has(finding.id) || !digest.test(finding.key)
        || !['dynamic_checker', 'dynamic_usability'].includes(finding.source)
        || finding.category !== (finding.source === 'dynamic_checker' ? 'functional' : 'usability')
        || !['unreviewed', 'confirmed', 'rejected', 'needs_investigation'].includes(finding.verification)
        || !['open', 'in_progress', 'resolved'].includes(finding.remediation)
        || !Number.isSafeInteger(finding.version) || finding.version < 1 || !Number.isFinite(Date.parse(finding.updatedAt))
        || !Array.isArray(detail.observations) || !detail.observations.length || detail.observations.length !== finding.observationCount
        || !Array.isArray(detail.events)) throw invalid();
      ids.add(finding.id);
      this.writeFinding(finding);
      for (const observed of detail.observations) {
        const run = observed && this.history.run(project, observed.runId);
        if (!run || run.state !== 'completed' || run.missionId !== finding.missionId || run.revision.id !== observed.revisionId
          || observed.projectId !== project || observed.findingId !== finding.id || !observed.id
          || !Array.isArray(observed.evidence) || !observed.evidence.length || !Number.isFinite(Date.parse(observed.createdAt))
          || observed.result?.verdict !== 'failed'
          || observed.evidence.some(ref => !ref || !run.evidence.some(saved => same(saved, ref)))) throw invalid();
        if (!candidatesByRun.has(run.id)) candidatesByRun.set(run.id, candidatesFor(run));
        if (!candidatesByRun.get(run.id)!.some(candidate => candidate.source === finding.source && candidate.result.checkId === observed.checkId
          && same(candidate.result, observed.result) && same(candidate.definition, observed.definition))) throw invalid();
        this.writeObservation(finding.source, observed);
      }
      for (const event of detail.events) {
        if (!event || event.projectId !== project || event.findingId !== finding.id || !event.id || !event.actorId
          || !Number.isSafeInteger(event.version) || event.version < 2 || event.version > finding.version
          || !['verification', 'remediation', 'recurrence'].includes(event.kind) || !Number.isFinite(Date.parse(event.createdAt))
          || typeof event.note !== 'string' || (event.regressionRunId && !this.history.run(project, event.regressionRunId))) throw invalid();
        this.insertEvent(event);
      }
    }
  }

  private detail(project: string, id: string): FindingDetail {
    const row = this.db.prepare('SELECT payload FROM local_dynamic_finding WHERE owner = ? AND project = ? AND id = ?')
      .get(this.owner, project, id);
    if (!row) throw findingMissing();
    return {
      finding: decode<DynamicFinding>(row),
      observations: this.db.prepare(`SELECT payload FROM local_dynamic_finding_observation
        WHERE owner = ? AND project = ? AND finding = ? ORDER BY created, id`).all(this.owner, project, id).map(decode<FindingObservation>),
      events: this.db.prepare(`SELECT payload FROM local_dynamic_finding_event
        WHERE owner = ? AND project = ? AND finding = ? ORDER BY version`).all(this.owner, project, id).map(decode<FindingEvent>),
    };
  }

  async collect(project: string, runId: string): Promise<DynamicFinding[]> {
    return this.transaction(() => {
      const run = this.history.run(project, runId);
      if (!run || run.state !== 'completed') throw new DynamicContractError(409, 'Only completed independent checks can produce findings.');
      const stamp = new Date().toISOString();
      const saved = new Map<string, DynamicFinding>();
      const verified = new Map<string, boolean>();
      for (const candidate of candidatesFor(run)) {
        const row = this.db.prepare(`SELECT f.payload FROM local_dynamic_finding_observation o JOIN local_dynamic_finding f
          ON f.owner = o.owner AND f.project = o.project AND f.id = o.finding
          WHERE o.owner = ? AND o.project = ? AND o.run = ? AND o.source = ? AND o.check_id = ?`)
          .get(this.owner, project, runId, candidate.source, candidate.result.checkId);
        if (row) {
          const finding = decode<DynamicFinding>(row);
          saved.set(finding.id, finding);
          continue;
        }
        for (const ref of candidate.evidence) {
          if (!verified.has(ref.id)) verified.set(ref.id, Boolean(this.history.evidence(project, run.id, ref.id)));
        }
        if (candidate.evidence.some(ref => !verified.get(ref.id))) continue;
        const existing = this.db.prepare('SELECT payload FROM local_dynamic_finding WHERE owner = ? AND project = ? AND finding_key = ?')
          .get(this.owner, project, candidate.key);
        const finding: DynamicFinding = existing ? decode<DynamicFinding>(existing) : {
          id: randomUUID(), projectId: project, missionId: run.missionId, key: candidate.key, version: 1, source: candidate.source,
          category: candidate.source === 'dynamic_usability' ? 'usability' : 'functional', title: candidate.definition.description,
          verification: 'unreviewed', remediation: 'open', severity: null, priority: null, confidence: null,
          confidenceBasis: 'An independent observation failed. Impact and triage require human verification.',
          observationCount: 0, createdAt: stamp, updatedAt: stamp,
        };
        finding.version += existing ? 1 : 0;
        finding.observationCount++;
        finding.updatedAt = stamp;
        const recurrence = finding.remediation === 'resolved';
        if (recurrence) {
          finding.remediation = 'open';
          finding.verification = 'needs_investigation';
          finding.confidence = null;
          finding.confidenceBasis = 'A new independent failure after resolution requires human verification.';
        }
        this.writeFinding(finding);
        this.writeObservation(finding.source, { id: randomUUID(), findingId: finding.id, projectId: project, runId,
          revisionId: run.revision.id, executorId: run.createdBy, checkId: candidate.result.checkId, criterionId: candidate.result.criterionId,
          definition: candidate.definition, result: candidate.result, evidence: candidate.evidence, targetUrl: target(run),
          targetVersion: run.environment?.targetVersion ?? null, goal: run.revision.goal, createdAt: stamp,
          ...(candidate.usability ? { usability: candidate.usability, suggestions: candidate.suggestions } : {}) });
        if (recurrence) this.writeEvent(finding, { kind: 'recurrence', automatic: true, remediation: 'open', regressionRunId: null,
          note: 'A new failed independent observation reopened the resolved finding. Inspect the retained Run.' });
        saved.set(finding.id, finding);
      }
      return [...saved.values()];
    });
  }

  async review(project: string, id: string, value: ReviewFindingInput): Promise<DynamicFinding> {
    const input = validateReview(value);
    return this.transaction(() => {
      const { finding } = this.detail(project, id);
      if (input.version !== finding.version) throw staleDecision();
      finding.verification = input.decision;
      finding.confidenceBasis = input.note;
      if (input.decision === 'confirmed') {
        finding.severity = input.severity!;
        finding.priority = input.priority!;
        finding.confidence = input.confidence!;
      }
      return this.decide(finding, { kind: 'verification', decision: input.decision, note: input.note,
        severity: finding.severity, priority: finding.priority, confidence: finding.confidence });
    });
  }

  async remediate(project: string, id: string, value: RemediationInput): Promise<DynamicFinding> {
    const input = validateRemediation(value);
    return this.transaction(() => {
      const { finding, observations } = this.detail(project, id);
      if (input.version !== finding.version) throw staleDecision();
      let regression: DynamicRun | null = null;
      if (input.status === 'resolved') regression = this.passedRegression(finding, observations, input.regressionRunId!);
      finding.remediation = input.status;
      return this.decide(finding, { kind: 'remediation', remediation: input.status, note: input.note,
        regressionRunId: regression?.id ?? null, conditionChanges: regression ? compareRegression(regression)?.conditionChanges ?? [] : [] });
    });
  }

  private passedRegression(finding: DynamicFinding, observations: FindingObservation[], id: string): DynamicRun {
    const run = this.history.run(finding.projectId, id.toLowerCase());
    const pinned = run?.regression;
    const observed = observations.find(item => item.runId === pinned?.runId);
    if (finding.verification !== 'confirmed' || !run || run.state !== 'completed' || run.verdict !== 'passed' || !pinned || !observed
      || run.missionId !== finding.missionId || pinned.revisionId !== observed.revisionId || run.revision.id !== observed.revisionId) {
      throw new DynamicContractError(409, 'Confirm the finding and inspect a passed regression pinned to its failed observation.');
    }
    const usability = observed.usability;
    const matched = usability ? (run.usability?.observations ?? []).filter(row => row.ruleId === usability.ruleId && row.persona === usability.persona
      && (usability.correlation === 'stable_control' ? !!usability.controlKey && row.controlKey === usability.controlKey
        : usability.correlation === 'explicit_check' && !!usability.checkId && row.checkId === usability.checkId))
      : run.checks.filter(row => row.checkId === observed.checkId && row.criterionId === observed.criterionId);
    const proof = matched.length === 1 && matched[0].verdict === 'passed' ? references(run, matched[0].evidenceIds) : [];
    if (!proof.length || (usability && !proof.some(ref => ref.kind === 'usability')) || !this.hasEvidence(run, proof)) {
      throw new DynamicContractError(409, 'A matching independent pass with retained evidence is required.');
    }
    return run;
  }

  private hasEvidence(run: DynamicRun, refs: EvidenceReference[]) {
    return refs.every(ref => Boolean(this.history.evidence(run.projectId, run.id, ref.id)));
  }

  private decide(finding: DynamicFinding, detail: EventDetail) {
    finding.version++;
    finding.updatedAt = new Date().toISOString();
    this.writeFinding(finding);
    this.writeEvent(finding, detail);
    return finding;
  }

  private writeFinding(finding: DynamicFinding) {
    this.db.prepare(`INSERT INTO local_dynamic_finding VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner, project, id) DO UPDATE SET updated = excluded.updated, payload = excluded.payload`)
      .run(this.owner, finding.projectId, finding.id, finding.key, finding.updatedAt, JSON.stringify(finding));
  }

  private writeObservation(source: DynamicFinding['source'], observation: FindingObservation) {
    this.db.prepare('INSERT INTO local_dynamic_finding_observation VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(this.owner, observation.projectId, observation.findingId, observation.id, observation.runId, source,
        observation.checkId, observation.createdAt, JSON.stringify(observation));
  }

  private writeEvent(finding: DynamicFinding, detail: EventDetail) {
    const event: FindingEvent = { ...detail, id: randomUUID(), projectId: finding.projectId, findingId: finding.id,
      actorId: this.owner, version: finding.version, createdAt: finding.updatedAt };
    this.insertEvent(event);
  }

  private insertEvent(event: FindingEvent) {
    this.db.prepare('INSERT INTO local_dynamic_finding_event VALUES (?, ?, ?, ?, ?, ?)')
      .run(this.owner, event.projectId, event.findingId, event.id, event.version, JSON.stringify(event));
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

type EventDetail = Omit<FindingEvent, 'id' | 'projectId' | 'findingId' | 'actorId' | 'version' | 'createdAt'>;
