import crypto from 'node:crypto';
import type { Artifact } from '../artifacts.js';
import type { StaticAnalysisModelProvider } from './types.js';

export type GroundingCandidateKind = 'requirement' | 'acceptance_criterion';
export type GroundingCandidateStatus = 'pending_confirmation' | 'confirmed' | 'rejected';

export type SourceLocator = {
  artifactId: string;
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  page?: number;
  section?: string;
  excerpt?: string;
};

export type RequirementCandidate = {
  id: string;
  projectId: string;
  kind: GroundingCandidateKind;
  title: string;
  statement: string;
  sourceLocator: SourceLocator;
  sourceVersion: string;
  confidence: number;
  fingerprint: string;
  status: GroundingCandidateStatus;
  confirmedRequirementId: string | null;
  confirmedBy: string | null;
  rejectedBy?: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConfirmedRequirement = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  sourceCandidateId: string | null;
  sourceLocator: SourceLocator | null;
  sourceVersion: string | null;
  confidence: number | null;
  createdAt: string;
};

export type RequirementCandidateDraft = Omit<RequirementCandidate,
  'id' | 'status' | 'confirmedRequirementId' | 'confirmedBy' | 'rejectedBy' | 'confirmedAt' | 'createdAt' | 'updatedAt'
>;

export type StandardRuleDraft = {
  stableKey: string;
  title: string;
  statement: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  recommendation: string;
  sourceArtifactId: string;
  sourceLocator: SourceLocator;
  sourceVersion: string;
  standardVersion: string;
  enabled: boolean;
};

export type StandardRule = StandardRuleDraft & {
  id: string;
  projectId: string;
  standardId: string;
  createdAt: string;
  updatedAt: string;
};

export type GroundingArtifactInput = {
  projectId: string;
  artifact: Artifact;
  content: string;
  sourceVersion?: string;
};

export type RequirementCandidateModel = Pick<StaticAnalysisModelProvider, 'analyze'>;

export interface GroundingRepository {
  saveRequirementCandidates(candidates: RequirementCandidateDraft[]): Promise<RequirementCandidate[]>;
  listRequirementCandidates(projectId: string, status?: GroundingCandidateStatus, signal?: AbortSignal): Promise<RequirementCandidate[]>;
  confirmRequirementCandidate(candidateId: string, actorId: string): Promise<ConfirmedRequirement>;
  rejectRequirementCandidate(candidateId: string, actorId: string): Promise<RequirementCandidate>;
  saveStandardRules(input: {
    projectId: string;
    artifact: Artifact;
    label?: string;
    sourceVersion: string;
    standardVersion: string;
    rules: StandardRuleDraft[];
  }): Promise<StandardRule[]>;
  listStandardRules(projectId: string, standardIds?: string[], signal?: AbortSignal): Promise<StandardRule[]>;
  setStandardRuleEnabled(ruleId: string, enabled: boolean): Promise<StandardRule>;
  listConfirmedRequirements(projectId: string, requirementIds?: string[], signal?: AbortSignal): Promise<ConfirmedRequirement[]>;
}

function clampConfidence(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, number));
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function requirementCandidateFingerprint(kind: GroundingCandidateKind, statement: string, sourceArtifactId = '', sourceVersion = ''): string {
  return hash(`${kind}|${sourceArtifactId}|${sourceVersion}|${statement.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`);
}

function locator(value: unknown, artifact: Artifact, statement: string): SourceLocator {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const lineStart = Number(candidate.lineStart ?? candidate.line ?? candidate.startLine);
  const lineEnd = Number(candidate.lineEnd ?? candidate.endLine ?? lineStart);
  const page = Number(candidate.page);
  return {
    artifactId: artifact.id,
    filePath: artifact.filePath,
    ...(Number.isInteger(lineStart) && lineStart > 0 ? { lineStart } : {}),
    ...(Number.isInteger(lineEnd) && lineEnd >= lineStart && lineEnd > 0 ? { lineEnd } : {}),
    ...(Number.isInteger(page) && page > 0 ? { page } : {}),
    ...(string(candidate.section) ? { section: string(candidate.section) } : {}),
    ...(string(candidate.excerpt) ? { excerpt: string(candidate.excerpt).slice(0, 800) } : { excerpt: statement.slice(0, 800) }),
  };
}

/** Parse only candidate-shaped outputs. The returned objects are always
 * pending confirmation; this function cannot write to the authoritative
 * requirements set. */
export function parseRequirementCandidateDrafts(
  projectId: string,
  artifact: Artifact,
  sourceVersion: string,
  value: unknown,
): RequirementCandidateDraft[] {
  const output = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const entries: Array<{ kind: GroundingCandidateKind; value: unknown }> = [];
  const pushEntries = (key: 'requirements' | 'acceptanceCriteria' | 'acceptance_criteria', kind: GroundingCandidateKind) => {
    const list = output[key];
    if (Array.isArray(list)) list.forEach(item => entries.push({ kind, value: item }));
  };
  pushEntries('requirements', 'requirement');
  pushEntries('acceptanceCriteria', 'acceptance_criterion');
  pushEntries('acceptance_criteria', 'acceptance_criterion');
  if (Array.isArray(value)) value.forEach(item => entries.push({ kind: 'requirement', value: item }));

  const seen = new Set<string>();
  const now = new Date().toISOString();
  return entries.flatMap(({ kind, value: entry }) => {
    const row = typeof entry === 'string' ? { statement: entry } : entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    const statement = string(row.statement ?? row.text ?? row.description ?? row.title);
    if (statement.length < 8) return [];
    const title = string(row.title, statement).slice(0, 240);
    const fingerprint = requirementCandidateFingerprint(kind, statement, artifact.id, sourceVersion);
    if (seen.has(fingerprint)) return [];
    seen.add(fingerprint);
    return [{
      projectId,
      kind,
      title,
      statement,
      sourceLocator: locator(row.sourceLocator ?? row.locator, artifact, statement),
      sourceVersion,
      confidence: clampConfidence(row.confidence),
      fingerprint,
    }];
  });
}

const REQUIREMENT_EXTRACTION_SYSTEM = `Extract requirement and acceptance-criterion candidates from the supplied project artifact. Preserve the meaning and scope; do not invent requirements. Return JSON only as {"requirements":[{"title":"...","statement":"...","confidence":0.0,"sourceLocator":{"lineStart":1,"lineEnd":1,"section":"...","excerpt":"..."}}],"acceptanceCriteria":[...]} . The caller will require a human to explicitly confirm every candidate before it becomes authoritative.`;

/** Extract and persist candidate rows only. Explicit confirmation remains a
 * separate call, so model output cannot silently alter project scope. */
export async function extractRequirementCandidates(
  input: GroundingArtifactInput,
  provider: RequirementCandidateModel,
  repository: GroundingRepository,
  signal?: AbortSignal,
): Promise<RequirementCandidate[]> {
  if (input.artifact.projectId !== input.projectId) throw new Error('Requirement artifact does not belong to the requested project');
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
  const response = await provider.analyze({
    reviewId: `grounding:${input.projectId}`,
    projectId: input.projectId,
    stage: 'requirement_elicitation',
    systemPrompt: REQUIREMENT_EXTRACTION_SYSTEM,
    prompt: `Artifact: ${input.artifact.fileName}\nArtifact id: ${input.artifact.id}\nSource version: ${input.sourceVersion ?? input.artifact.contentHash}\n\n${input.content}`,
    signal,
  });
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
  const candidates = parseRequirementCandidateDrafts(
    input.projectId,
    input.artifact,
    input.sourceVersion ?? input.artifact.contentHash,
    response.result,
  );
  return repository.saveRequirementCandidates(candidates);
}

function normalizeRuleStatement(value: string): string {
  return value.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '').replace(/\s+/g, ' ').trim();
}

function inferRuleCategory(statement: string): string {
  const text = statement.toLowerCase();
  if (/security|secret|credential|auth|encrypt|password|token/.test(text)) return 'security';
  if (/performance|latency|memory|cpu|cache|complexity/.test(text)) return 'performance';
  if (/test|coverage|assert/.test(text)) return 'testing';
  if (/error|exception|failure|retry|timeout/.test(text)) return 'error_handling';
  if (/log|audit/.test(text)) return 'observability';
  return 'style';
}

function inferRuleSeverity(category: string, statement: string): StandardRuleDraft['severity'] {
  if (category === 'security' && /must not|shall not|never|prohibit|forbid|required/.test(statement.toLowerCase())) return 'high';
  if (category === 'security') return 'medium';
  return 'low';
}

function parseDocumentVersion(content: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  const version = content.match(/^\s*(?:version|standard[-_ ]?version)\s*:\s*["']?([^\s"']+)/im);
  return version?.[1] ?? `sha256:${hash(content).slice(0, 16)}`;
}

/** Deterministic parser for normative standard statements. It retains the
 * source line, exact text, standard revision, and content-derived stable key.
 * Non-normative explanatory prose is ignored rather than turned into a rule. */
export function parseStandardRules(input: {
  artifact: Artifact;
  content: string;
  sourceVersion?: string;
  standardVersion?: string;
}): StandardRuleDraft[] {
  const sourceVersion = input.sourceVersion ?? input.artifact.contentHash;
  const standardVersion = parseDocumentVersion(input.content, input.standardVersion);
  const lines = input.content.split(/\r?\n/);
  const rules: StandardRuleDraft[] = [];
  const seen = new Set<string>();
  let section = '';
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index].trim();
    if (!raw) continue;
    const heading = raw.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (heading) { section = heading[1].trim(); continue; }
    const statement = normalizeRuleStatement(raw);
    if (!/\b(?:must|shall|should|must not|shall not|should not|required|never|do not|avoid|prohibited|forbidden)\b/i.test(statement)) continue;
    if (statement.length < 12) continue;
    const normalized = statement.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const stableKey = hash(`${input.artifact.id}|${normalized}`);
    if (seen.has(stableKey)) continue;
    seen.add(stableKey);
    const category = inferRuleCategory(statement);
    rules.push({
      stableKey,
      title: statement.slice(0, 240),
      statement,
      category,
      severity: inferRuleSeverity(category, statement),
      recommendation: `Verify that the implementation follows this standard: ${statement}`,
      sourceArtifactId: input.artifact.id,
      sourceLocator: {
        artifactId: input.artifact.id,
        filePath: input.artifact.filePath,
        lineStart: index + 1,
        lineEnd: index + 1,
        ...(section ? { section } : {}),
        excerpt: raw.slice(0, 800),
      },
      sourceVersion,
      standardVersion,
      enabled: true,
    });
  }
  return rules;
}

export async function ingestStandardRules(
  input: GroundingArtifactInput & { label?: string; standardVersion?: string },
  repository: GroundingRepository,
): Promise<StandardRule[]> {
  if (input.artifact.projectId !== input.projectId) throw new Error('Coding-standard artifact does not belong to the requested project');
  const sourceVersion = input.sourceVersion ?? input.artifact.contentHash;
  const rules = parseStandardRules({ ...input, sourceVersion, standardVersion: input.standardVersion });
  return repository.saveStandardRules({
    projectId: input.projectId,
    artifact: input.artifact,
    label: input.label,
    sourceVersion,
    standardVersion: input.standardVersion ?? rules[0]?.standardVersion ?? `sha256:${hash(input.content).slice(0, 16)}`,
    rules,
  });
}

export class InMemoryGroundingRepository implements GroundingRepository {
  readonly candidates = new Map<string, RequirementCandidate>();
  readonly requirements = new Map<string, ConfirmedRequirement>();
  readonly standardRules = new Map<string, StandardRule>();
  readonly currentStandardVersions = new Map<string, { standardVersion: string; sourceVersion: string }>();

  async saveRequirementCandidates(drafts: RequirementCandidateDraft[]): Promise<RequirementCandidate[]> {
    const now = new Date().toISOString();
    const saved: RequirementCandidate[] = [];
    for (const draft of drafts) {
      const existing = [...this.candidates.values()].find(item => item.projectId === draft.projectId && item.fingerprint === draft.fingerprint);
      if (existing) { saved.push(structuredClone(existing)); continue; }
      const item: RequirementCandidate = {
        ...structuredClone(draft), id: crypto.randomUUID(), status: 'pending_confirmation',
        confirmedRequirementId: null, confirmedBy: null, rejectedBy: null, confirmedAt: null, createdAt: now, updatedAt: now,
      };
      this.candidates.set(item.id, item);
      saved.push(structuredClone(item));
    }
    return saved;
  }

  async listRequirementCandidates(projectId: string, status?: GroundingCandidateStatus): Promise<RequirementCandidate[]> {
    return [...this.candidates.values()]
      .filter(item => item.projectId === projectId && (!status || item.status === status))
      .map(item => structuredClone(item));
  }

  async confirmRequirementCandidate(candidateId: string, actorId: string): Promise<ConfirmedRequirement> {
    if (!actorId.trim()) throw new Error('An authenticated reviewer identity is required to confirm a requirement');
    const candidate = this.candidates.get(candidateId);
    if (!candidate) throw new Error('Requirement candidate not found');
    if (candidate.status === 'rejected') throw new Error('Rejected requirement candidate cannot be confirmed');
    if (candidate.confirmedRequirementId) {
      const existing = this.requirements.get(candidate.confirmedRequirementId);
      if (existing) return structuredClone(existing);
    }
    const now = new Date().toISOString();
    const requirement: ConfirmedRequirement = {
      id: crypto.randomUUID(), projectId: candidate.projectId, title: candidate.title,
      description: candidate.statement, category: candidate.kind, priority: 'medium',
      sourceCandidateId: candidate.id, sourceLocator: structuredClone(candidate.sourceLocator),
      sourceVersion: candidate.sourceVersion, confidence: candidate.confidence, createdAt: now,
    };
    this.requirements.set(requirement.id, requirement);
    candidate.status = 'confirmed';
    candidate.confirmedRequirementId = requirement.id;
    candidate.confirmedBy = actorId;
    candidate.rejectedBy = null;
    candidate.confirmedAt = now;
    candidate.updatedAt = now;
    return structuredClone(requirement);
  }

  async rejectRequirementCandidate(candidateId: string, actorId: string): Promise<RequirementCandidate> {
    if (!actorId.trim()) throw new Error('An authenticated reviewer identity is required to reject a requirement');
    const candidate = this.candidates.get(candidateId);
    if (!candidate) throw new Error('Requirement candidate not found');
    if (candidate.status === 'confirmed') throw new Error('Confirmed requirement candidate cannot be rejected');
    if (candidate.status === 'rejected') return structuredClone(candidate);
    candidate.status = 'rejected';
    candidate.confirmedBy = null;
    candidate.rejectedBy = actorId;
    candidate.updatedAt = new Date().toISOString();
    return structuredClone(candidate);
  }

  async saveStandardRules(input: {
    projectId: string;
    artifact: Artifact;
    label?: string;
    sourceVersion: string;
    standardVersion: string;
    rules: StandardRuleDraft[];
  }): Promise<StandardRule[]> {
    const standardId = `standard:${input.projectId}:${input.artifact.id}`;
    this.currentStandardVersions.set(`${input.projectId}|${standardId}`, { standardVersion: input.standardVersion, sourceVersion: input.sourceVersion });
    const now = new Date().toISOString();
    return input.rules.map(draft => {
      const existing = [...this.standardRules.values()].find(item => item.projectId === input.projectId && item.standardId === standardId && item.stableKey === draft.stableKey && item.standardVersion === draft.standardVersion && item.sourceVersion === draft.sourceVersion);
      const item: StandardRule = {
        ...structuredClone(draft), id: existing?.id ?? crypto.randomUUID(), projectId: input.projectId,
        standardId, enabled: existing?.enabled ?? draft.enabled, createdAt: existing?.createdAt ?? now, updatedAt: now,
      };
      this.standardRules.set(item.id, item);
      return structuredClone(item);
    });
  }

  async listStandardRules(projectId: string, standardIds?: string[]): Promise<StandardRule[]> {
    const selected = standardIds?.length ? new Set(standardIds) : null;
    return [...this.standardRules.values()].filter(item => {
      if (item.projectId !== projectId || (selected && !selected.has(item.standardId))) return false;
      const current = this.currentStandardVersions.get(`${projectId}|${item.standardId}`);
      return !current || (current.standardVersion === item.standardVersion && current.sourceVersion === item.sourceVersion);
    }).map(item => structuredClone(item));
  }

  async setStandardRuleEnabled(ruleId: string, enabled: boolean): Promise<StandardRule> {
    const rule = this.standardRules.get(ruleId);
    if (!rule) throw new Error('Standard rule not found');
    rule.enabled = enabled;
    rule.updatedAt = new Date().toISOString();
    return structuredClone(rule);
  }

  async listConfirmedRequirements(projectId: string, requirementIds?: string[]): Promise<ConfirmedRequirement[]> {
    const selected = requirementIds?.length ? new Set(requirementIds) : null;
    return [...this.requirements.values()].filter(item => item.projectId === projectId && (!selected || selected.has(item.id))).map(item => structuredClone(item));
  }
}
