import fs from 'fs';
import path from 'path';
import { getRawAiSetting } from './settings.js';
import { readArtifactContent, listArtifacts } from './artifacts.js';
import {
  getAuthHeaders,
  buildRequestUrl,
  capMessages,
  MAX_PROMPT_CHARS,
  callAiWithTools,
  setToolExecutor,
  parseAnthropicToolTurn,
  parseOpenAIToolTurn,
  parseGoogleToolTurn,
  type ToolCall,
  type ToolResult,
  type AppendableMessage,
  type TokenUsage,
} from './aiClient.js';
import { executeTool, TOOL_SCHEMAS } from './tools.js';
import { getDb } from './db.js';
import {
  createFinding,
  updateStaticSessionStatus,
  updateStaticSessionProgress,
  createReviewArtifact,
  type ReviewProgress,
  type ReviewStageProgress,
} from './staticSessions.js';
import type { StaticSession } from './staticSessions.js';
import type { Artifact } from './artifacts.js';
import { indexProject } from './repoIndex.js';
import { retrieveContext } from './contextRetrieval.js';
import { runStaticAnalysis, type Finding } from './staticEngine.js';
import { scoreFindings, type RiskInput } from './riskScore.js';
import { recordTokenUsage, type CallKind, type TokenScope } from './tokenUsage.js';

// ── Types ──────────────────────────────────────────────────────────────

type StageFinding = {
  title: string;
  severity: string;
  category: string;
  artifactReference: string;
  description: string;
  evidence: string;
  recommendation: string;
  confidence: string;
};

type StageResponse = {
  thoughts: string[];
  findings: StageFinding[];
  [key: string]: unknown;
};

/**
 * Pull (filePath, lineNumber) out of an AI-generated finding.
 * The AI is asked to use "path:line" in `artifactReference` and may include
 * "line 42" or "L42" in `evidence`. Returns empty filePath when no match.
 */
export function extractLocation(finding: { artifactReference?: string; evidence?: string }): { filePath: string; lineNumber: number | null } {
  const candidates = [finding.artifactReference ?? '', finding.evidence ?? ''].join('\n');

  // path:line form (e.g. "src/auth.ts:42")
  const colonLine = candidates.match(/([^\s:]+\.[a-zA-Z0-9]+):(\d{1,5})/);
  if (colonLine) {
    return { filePath: colonLine[1], lineNumber: Number(colonLine[2]) };
  }

  // "line 42" / "L42" form, with a path mentioned elsewhere
  const pathOnly = candidates.match(/([^\s:]+\.[a-zA-Z0-9]+)/);
  const lineOnly = candidates.match(/(?:^|\s)(?:line|L)\s*(\d{1,5})\b/i);
  if (pathOnly && lineOnly) {
    return { filePath: pathOnly[1], lineNumber: Number(lineOnly[1]) };
  }

  return { filePath: '', lineNumber: null };
}

/**
 * Drop AI findings that duplicate an existing static-analysis finding in the
 * same session. Dedup key: (file_path, |line_diff| <= 2, evidence token-overlap
 * >= 30%). Higher confidence wins; ties go to the static finding (deterministic
 * rules > LLM judgement).
 *
 * Exported so the unit test can import it directly (OPTION A in the brief).
 *
 * Generic over the caller-supplied finding type so the returned `kept` /
 * `dropped` arrays preserve every field the caller attached (severity,
 * description, recommendation, etc.). The function only reads filePath,
 * lineNumber, evidence, confidence, and title from each item.
 */
export async function dedupeAgainstStaticFindings<T extends {
  filePath: string;
  lineNumber: number | null;
  evidence: string;
  confidence: string;
  title: string;
}>(
  sessionId: string,
  projectId: string,
  aiFindings: T[],
): Promise<{ kept: T[]; dropped: T[] }> {
  const db = await getDb();
  const stmt = db.prepare(
    'SELECT file_path, line_number, evidence, confidence FROM static_analysis_results WHERE project_id = ? AND session_id = ?'
  );
  stmt.bind([projectId, sessionId]);
  const staticRows: { filePath: string; lineNumber: number; evidence: string; confidence: string }[] = [];
  while (stmt.step()) {
    const r = stmt.get() as unknown[];
    staticRows.push({
      filePath: r[0] as string,
      lineNumber: r[1] as number,
      evidence: (r[2] as string) ?? '',
      confidence: (r[3] as string) ?? 'high',
    });
  }
  stmt.free();

  const confidenceRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const tokenize = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter(t => t.length > 2));
  const overlap = (a: string, b: string) => {
    const aT = tokenize(a), bT = tokenize(b);
    if (aT.size === 0 || bT.size === 0) return 0;
    let shared = 0;
    for (const t of aT) if (bT.has(t)) shared++;
    return shared / Math.min(aT.size, bT.size);
  };

  const kept: T[] = [];
  const dropped: T[] = [];
  for (const ai of aiFindings) {
    if (!ai.filePath || ai.lineNumber == null) {
      kept.push(ai);  // can't dedup without location — pass through
      continue;
    }
    // Bind the narrowed lineNumber to a local so the closure in .find() can
    // see the non-null type. TS doesn't carry the narrowing through a
    // lambda capture otherwise.
    const aiLine = ai.lineNumber;
    const match = staticRows.find(s =>
      s.filePath === ai.filePath &&
      Math.abs(s.lineNumber - aiLine) <= 2 &&
      overlap(s.evidence, ai.evidence) >= 0.3
    );
    if (match) {
      const aiRank = confidenceRank[ai.confidence] ?? 2;
      const staticRank = confidenceRank[match.confidence] ?? 3;
      // Static findings (deterministic rules) are preferred on ties.
      if (staticRank >= aiRank) {
        dropped.push(ai);
      } else {
        // AI wins — drop the static one (mark via marker; for now, we just
        // keep the AI finding and log the suppression). A future task can
        // delete the static row from the findings table.
        kept.push(ai);
        console.info(
          `[dedup] session=${sessionId} suppressed static finding at ${match.filePath}:${match.lineNumber} ` +
          `in favor of AI finding (higher confidence)`
        );
      }
    } else {
      kept.push(ai);
    }
  }
  return { kept, dropped };
}

// ── Stage Definitions ──────────────────────────────────────────────────

const STAGE_DEFINITIONS = [
  { id: 'understanding_context' as const, label: 'Understanding Context' },
  { id: 'code_review' as const, label: 'Code Review' },
  { id: 'requirement_validation' as const, label: 'Requirement Validation' },
  { id: 'summarizing' as const, label: 'Summarizing Findings' },
];

// ── Stage Prompts ──────────────────────────────────────────────────────

const CONTEXT_UNDERSTANDING_PROMPT = {
  system: `You are a project analyst. Your job is to understand a software project by reading its artifacts.

IMPORTANT: As you analyze each artifact, explain your observations step by step in the "thoughts" array. What do you see? What role does each file play? What patterns emerge? What is the user asking about?

Do NOT produce findings. This stage is purely about understanding.

You must return your response as a JSON object with these fields:
- thoughts: array of strings — your reasoning chain as you analyze each artifact
- projectSummary: string — one-paragraph summary of the project
- artifactInventory: array of { name, type, purpose } for each artifact
- userIntent: string — what the user is asking for based on their notes

Return ONLY the JSON object, no other text.`,
  build: (artifacts: { name: string; type: string; content: string }[], userThoughts: string) => {
    const content = artifacts.map(a => `--- File: ${a.name} (Type: ${a.type}) ---\n${a.content}`).join('\n\n');
    const thoughtsSection = userThoughts
      ? `\n\n## User's Notes\nThe user has provided these thoughts/instructions:\n---\n${userThoughts}\n---\n`
      : '';
    return `Analyze the following software artifacts to understand this project.${thoughtsSection}\n\n## Artifacts\n${content}`;
  },
};

const CODE_REVIEW_PROMPT = {
  system: `You are a senior software engineer performing code review. You have the project context from a prior analysis stage.

IMPORTANT: As you read each source file, explain what you observe in the "thoughts" array. What patterns do you see? What looks correct? What concerns arise? Think out loud before producing findings.

You must return your response as a JSON object with these fields:
- thoughts: array of strings — your reasoning chain as you review each file
- findings: array of findings, each with:
  - title: short descriptive title
  - severity: string — REQUIRED, one of "critical", "high", "medium", "low", "info". Pick the level a code-reviewer would actually use to triage the finding, e.g.:
    * "critical" — exploitable security flaw, data loss, or correctness bug that crashes production (e.g. SQL injection, missing auth check, null deref on hot path)
    * "high" — likely bug, race condition, resource leak, or broken error path that will bite in normal operation
    * "medium" — maintainability concern, missing validation, suboptimal pattern that will cost more later
    * "low" — style nits, naming, minor refactor opportunities
    * "info" — observations, suggestions, things to know about but not defects
    The dashboard sorts and color-codes by this field; an unparseable or missing severity will be coerced to "medium" and the finding will be deprioritized.
  - category: one of "potential_bug", "missing_validation", "error_handling", "security_concern", "maintainability", "performance", "code_smell", "other"
  - artifactReference: which file and section the finding relates to
  - description: detailed explanation of the issue
  - evidence: specific code snippet or pattern that demonstrates the issue
  - recommendation: concrete suggestion for fixing the issue
  - confidence: one of "high", "medium", "low"
- codeQualitySummary: string — overall assessment of code quality
- riskAreas: array of strings — high-risk files or functions

If no issues are found, return an empty findings array: []
Return ONLY the JSON object, no other text.`,
  build: (
    artifacts: { name: string; type: string; content: string }[],
    contextBrief: { projectSummary: string; artifactInventory: { name: string; type: string; purpose: string }[]; userIntent: string },
    userThoughts: string
  ) => {
    const content = artifacts.map(a => `--- File: ${a.name} (Type: ${a.type}) ---\n${a.content}`).join('\n\n');
    const thoughtsSection = userThoughts
      ? `\n\n## User's Notes\n---\n${userThoughts}\n---\n`
      : '';
    return `## Project Context\n${contextBrief.projectSummary}\n\nUser intent: ${contextBrief.userIntent}${thoughtsSection}\n\n## Source Code to Review\n${content}`;
  },
};

const TRACEABILITY_PROMPT = {
  system: `You are a software quality analyst specializing in requirement-to-code traceability. You have the project context and code review results from prior stages.

IMPORTANT: For each requirement, trace it to the codebase step by step. Explain your reasoning in the "thoughts" array. Which files implement it? Is the implementation complete? What's missing?

You must return your response as a JSON object with these fields:
- thoughts: array of strings — your reasoning chain as you trace each requirement
- findings: array of findings, each with:
  - title: short descriptive title
  - severity: string — REQUIRED, one of "critical", "high", "medium", "low", "info". Reflect the operational risk of the gap, e.g.:
    * "critical" — a stated requirement has no implementation at all and it's a security or correctness requirement
    * "high" — a core requirement is only partially implemented, or the implementation is in the wrong module
    * "medium" — a secondary requirement is partially covered; tests or doc updates would close it
    * "low" — naming or comment drift between spec and code, easy to align
    * "info" — "well_covered" observations and nice-to-have notes
    The dashboard sorts and color-codes by this field; an unparseable or missing severity will be coerced to "medium".
  - category: one of "missing_implementation", "partial_implementation", "unclear_mapping", "extra_implementation", "well_covered"
  - artifactReference: which requirement and/or code file the finding relates to
  - description: detailed explanation of the traceability relationship
  - evidence: specific requirement text and corresponding code (or lack thereof)
  - recommendation: concrete suggestion for improving traceability
  - confidence: one of "high", "medium", "low"
- coverageScore: number between 0 and 1 — percentage of requirements covered
- mappings: array of { reqTitle, status ("implemented"|"partial"|"missing"|"extra"), evidence }

If no issues are found, return an empty findings array: []
Return ONLY the JSON object, no other text.`,
  build: (
    reqArtifacts: { name: string; type: string; content: string }[],
    codeArtifacts: { name: string; type: string; content: string }[],
    contextBrief: { projectSummary: string; userIntent: string },
    codeReviewSummary: string,
    userThoughts: string
  ) => {
    const reqContent = reqArtifacts.map(a => `--- Requirement File: ${a.name} ---\n${a.content}`).join('\n\n');
    const codeContent = codeArtifacts.map(a => `--- Code File: ${a.name} ---\n${a.content}`).join('\n\n');
    const thoughtsSection = userThoughts
      ? `\n\n## User's Notes\n---\n${userThoughts}\n---\n`
      : '';
    return `## Project Context\n${contextBrief.projectSummary}\n\nUser intent: ${contextBrief.userIntent}\n\n## Code Review Summary\n${codeReviewSummary}${thoughtsSection}\n\n## Requirements\n${reqContent}\n\n## Source Code\n${codeContent}`;
  },
};

const SUMMARY_PROMPT = {
  system: `You are a QA lead consolidating findings from a multi-stage review. You have all prior analysis results.

IMPORTANT: Explain your prioritization reasoning in the "thoughts" array. Why is one finding more critical than another? How do findings relate to each other? How do they connect to the user's original concerns?

You must return your response as a JSON object with these fields:
- thoughts: array of strings — your reasoning as you consolidate and prioritize
- executiveSummary: string — 2-3 paragraph summary of the review
- totalFindings: object with { critical, high, medium, low, info } counts
- topConcerns: array of strings — the most important issues
- recommendations: array of strings — actionable next steps
- addressedUserThoughts: string — direct response to the user's original notes/concerns

Return ONLY the JSON object, no other text.`,
  build: (
    contextBrief: { projectSummary: string; userIntent: string },
    codeFindings: StageFinding[],
    traceFindings: StageFinding[],
    staticFindings: Finding[],
    userThoughts: string
  ) => {
    const thoughtsSection = userThoughts
      ? `\n\n## User's Original Notes\n---\n${userThoughts}\n---\n`
      : '';
    return `## Project Context\n${contextBrief.projectSummary}\n\nUser intent: ${contextBrief.userIntent}${thoughtsSection}\n\n## Code Review Findings (${codeFindings.length})\n${codeFindings.map(f => `- [${f.severity}] ${f.title}: ${f.description}`).join('\n')}\n\n## Traceability Findings (${traceFindings.length})\n${traceFindings.map(f => `- [${f.severity}] ${f.title}: ${f.description}`).join('\n')}\n\n## Static Analysis Findings (${staticFindings.length})\n${staticFindings.map(f => `- [${f.severity}] ${f.message}`).join('\n')}`;
  },
};

// ── AI Client ──────────────────────────────────────────────────────────

type CallContext = {
  /** Current stage index (0-3) so the cap can emit a progress thought on trim. */
  stageIdx: number;
  /** Optional progress emitter; passed in by runStaticReview. */
  onTruncate?: (stageIdx: number, thought: string) => void;
};

/**
 * Build the Anthropic / OpenAI messages array for a (systemPrompt, prompt) pair.
 * Pulled out so callAi can apply capMessages() to the result without duplicating
 * the per-format shape logic.
 */
function buildMessages(apiFormat: 'openai-compatible' | 'anthropic-compatible' | 'google-native', systemPrompt: string, prompt: string): Record<string, unknown>[] {
  if (apiFormat === 'anthropic-compatible') {
    return [
      { role: 'user', content: [{ type: 'text', text: prompt }] },
    ];
  }
  // openai-compatible (and the openai-shaped branch used for MiMo)
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];
}

function buildRequestBody(
  apiFormat: 'openai-compatible' | 'anthropic-compatible' | 'google-native',
  model: string,
  systemPrompt: string,
  prompt: string
): { body: Record<string, unknown>; messages: Record<string, unknown>[] } {
  if (apiFormat === 'anthropic-compatible') {
    const messages = buildMessages(apiFormat, systemPrompt, prompt);
    return {
      messages,
      body: {
        model,
        max_tokens: 8192,
        system: systemPrompt,
        messages,
      },
    };
  }
  // openai-compatible
  const messages = buildMessages(apiFormat, systemPrompt, prompt);
  return {
    messages,
    body: {
      model,
      messages,
      max_completion_tokens: 8192,
      thinking: { type: 'disabled' },
    },
  };
}

/**
 * Single-call AI wrapper used by every review stage. Exported so the
 * test plan generator (Group 2c) and other one-off prompts can reuse
 * the same auth / message-building / truncation path. Returns the
 * raw response text — callers parse JSON themselves when needed.
 */
export async function callAi(prompt: string, systemPrompt: string, ctx: CallContext = { stageIdx: -1 }, onUsage?: (usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number; totalTokens?: number }) => void): Promise<string> {
  const setting = await getRawAiSetting('text');
  if (!setting) throw new Error('Text AI provider not configured');
  if (!setting.apiKey) throw new Error('Text AI API key not configured');

  const { apiFormat, model } = setting;

  // Cap user content before serializing. System prompt is left intact.
  const { messages: cappedMessages, truncated } = capMessages(
    buildMessages(apiFormat, systemPrompt, prompt)
  );
  if (truncated) {
    ctx.onTruncate?.(
      ctx.stageIdx,
      `Prompt was over ${MAX_PROMPT_CHARS.toLocaleString()} chars; truncated to fit the model context window. The model is working with a partial view of the project.`
    );
  }

  const { body: requestBody } = buildRequestBody(apiFormat, model, systemPrompt, prompt);
  // Replace the (uncapped) messages in the request body with the capped version.
  requestBody.messages = cappedMessages;
  const body = JSON.stringify(requestBody);
  const headers = getAuthHeaders(setting);

  const res = await fetch(buildRequestUrl(setting), { method: 'POST', headers, body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI API error: HTTP ${res.status} — ${text}`);
  }

  const json = await res.json();

  // Fire the usage callback (no-op if onUsage is undefined). The provider
  // returns usage on every successful response; we just forward it.
  if (onUsage) {
    const usage = apiFormat === 'anthropic-compatible'
      ? parseAnthropicToolTurn(json).usage
      : apiFormat === 'openai-compatible'
      ? parseOpenAIToolTurn(json).usage
      : parseGoogleToolTurn(json).usage;
    if (usage) onUsage(usage);
  }

  if (apiFormat === 'anthropic-compatible') {
    const content = json.content;
    if (Array.isArray(content) && content.length > 0) {
      return content[0].text ?? '';
    }
    return json.completion ?? JSON.stringify(json);
  } else {
    return json.choices?.[0]?.message?.content ?? JSON.stringify(json);
  }
}

// ── Parsers ────────────────────────────────────────────────────────────

function parseStageResponse(raw: string): StageResponse {
  let jsonStr = raw.trim();

  // Remove markdown code block wrapping
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed !== 'object' || parsed === null) {
      return { thoughts: [], findings: [] };
    }
    return {
      thoughts: Array.isArray(parsed.thoughts) ? parsed.thoughts.map(String) : [],
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      ...parsed,
    };
  } catch {
    // Try to extract JSON object from the text
    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        const parsed = JSON.parse(objMatch[0]);
        return {
          thoughts: Array.isArray(parsed.thoughts) ? parsed.thoughts.map(String) : [],
          findings: Array.isArray(parsed.findings) ? parsed.findings : [],
          ...parsed,
        };
      } catch { /* fall through */ }
    }
    return { thoughts: [], findings: [] };
  }
}

function validateSeverity(severity: string): string {
  const valid = ['critical', 'high', 'medium', 'low', 'info'];
  return valid.includes(severity) ? severity : 'medium';
}

function validateConfidence(confidence: string): string {
  const valid = ['high', 'medium', 'low'];
  return valid.includes(confidence) ? confidence : 'medium';
}

// ── Static Analysis Summary ────────────────────────────────────────────

function buildStaticAnalysisSummary(staticFindings: Finding[]): string {
  if (staticFindings.length === 0) return '';
  const grouped: Record<string, Finding[]> = {};
  for (const f of staticFindings) {
    if (!grouped[f.category]) grouped[f.category] = [];
    grouped[f.category].push(f);
  }
  const lines = ['## Pre-computed Static Analysis Results\nThe following issues were detected by rule-based analysis before AI review.'];
  for (const [category, items] of Object.entries(grouped)) {
    lines.push(`\n### ${category.replace(/_/g, ' ')} (${items.length})`);
    for (const item of items.slice(0, 10)) {
      lines.push(`- [${item.severity}] ${item.message} — ${item.filePath}:${item.lineNumber}`);
    }
    if (items.length > 10) lines.push(`  ... and ${items.length - 10} more`);
  }
  return lines.join('\n');
}

// ── Tool-use path ─────────────────────────────────────────────────────────────

/** Read the workspace path from the projects table. Returns '' if missing. */
async function getWorkspacePathForProject(projectId: string): Promise<string> {
  try {
    const db = await getDb();
    const stmt = db.prepare('SELECT workspace_path FROM projects WHERE id = ?');
    stmt.bind([projectId]);
    let workspacePath = '';
    if (stmt.step()) {
      workspacePath = (stmt.get() as unknown[])[0] as string;
    }
    stmt.free();
    return workspacePath ?? '';
  } catch {
    return '';
  }
}

/** Wrap `executeTool` into a `ToolExecutor` closure over the project + workspace. */
function makeToolExecutor(projectId: string, workspacePath: string) {
  return async (call: ToolCall): Promise<ToolResult> => {
    try {
      const content = await executeTool(call.name, call.input, workspacePath, projectId);
      return { toolCallId: call.id, name: call.name, content };
    } catch (err) {
      return {
        toolCallId: call.id,
        name: call.name,
        content: err instanceof Error ? err.message : String(err),
        isError: true,
      };
    }
  };
}

type SettingWithCreds = {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: 'mimo' | 'gemini' | 'custom';
  apiFormat: 'openai-compatible' | 'anthropic-compatible' | 'google-native';
};

async function runStageWithTools(
  stageIdx: number,
  systemPrompt: string,
  userPrompt: string,
  projectId: string,
  workspacePath: string,
  setting: SettingWithCreds,
  emitThinking: (thought: string) => void,
  onUsage?: (usage: TokenUsage) => void
): Promise<string> {
  setToolExecutor(makeToolExecutor(projectId, workspacePath));

  const messages: AppendableMessage[] = [
    { role: 'user', content: userPrompt },
  ];

  const turn = await callAiWithTools({
    apiKey: setting.apiKey,
    apiFormat: setting.apiFormat,
    model: setting.model,
    baseUrl: setting.baseUrl,
    provider: setting.provider,
    systemPrompt,
    messages,
    tools: [...TOOL_SCHEMAS],
    onToolCall: (name, args) =>
      emitThinking(`🔧 ${name}: ${JSON.stringify(args).substring(0, 200)}`),
    onUsage: onUsage
      ? (usage) => onUsage(usage)
      : undefined,
  });

  if (turn.stopReason === 'max_rounds' && !turn.content) {
    emitThinking('⚠️ Model used all tool rounds without producing a final answer');
  }
  return turn.content ?? '';
}



// ── Dispatcher ──────────────────────────────────────────────────────────
//
// Public entry point. Computes artifact sizes, runs the shared pre-flight
// (indexProject + runStaticAnalysis), looks up the workspace path for the
// tool path, then routes to either runStaticReviewPrefetch (legacy pre-fetch
// path) or runStaticReviewWithTools (tool-use path).
//
// Routing rule:
//   - Run the tool path if total artifact bytes >= STATIC_REVIEW_SMALL_PROJECT_BYTES
//     (default 200_000) OR any single artifact > 100_000 bytes
//   - Otherwise run the prefetch path
//
// The legacy prefetch path is unchanged in behavior; it just receives a
// precomputed `staticFindings` array so the dispatcher doesn't have to call
// runStaticAnalysis twice when the prefetch path is chosen.

/** Single-file rule: any artifact over this size forces the tool path. */
const SINGLE_FILE_TOOL_THRESHOLD_BYTES = 100_000;

/** Total-size threshold above which the tool path is preferred. Overridable
 *  via STATIC_REVIEW_SMALL_PROJECT_BYTES env var. */
function getSmallProjectThresholdBytes(): number {
  return Number(process.env.STATIC_REVIEW_SMALL_PROJECT_BYTES) || 200_000;
}

export async function runStaticReview(
  session: StaticSession,
  artifacts: Artifact[],
  onProgress?: (progress: ReviewProgress) => void
): Promise<void> {
  try {
    await updateStaticSessionStatus(session.id, 'running', '', '');

    // Compute sizes once for routing decisions.
    const sizes = artifacts.map((a) => {
      try {
        return a.filePath && fs.existsSync(a.filePath) ? fs.statSync(a.filePath).size : 0;
      } catch {
        return 0;
      }
    });
    const totalBytes = sizes.reduce((sum, n) => sum + n, 0);
    const maxArtifactBytes = sizes.length > 0 ? Math.max(...sizes) : 0;
    const envOverride = process.env.STATIC_REVIEW_SMALL_PROJECT_BYTES;
    const envSet = envOverride !== undefined && envOverride !== '';
    const smallProjectBytes = getSmallProjectThresholdBytes();
    // The single-file rule normally fires above 100KB. The env override
    // (when explicitly set) raises BOTH the total and single-file thresholds
    // so callers can keep a single oversized file on the cheap prefetch path.
    const singleFileThreshold = envSet
      ? Math.max(SINGLE_FILE_TOOL_THRESHOLD_BYTES, smallProjectBytes)
      : SINGLE_FILE_TOOL_THRESHOLD_BYTES;
    const useToolPath = totalBytes >= smallProjectBytes || maxArtifactBytes > singleFileThreshold;

    // Pre-flight shared by both paths: index the project and run static
    // analysis. The dispatcher runs these once and passes the results to the
    // chosen path so the work isn't duplicated.
    await indexProject(session.projectId, artifacts);
    const staticFindings = await runStaticAnalysis(session.projectId, artifacts, session.id);

    if (useToolPath) {
      // Tool path needs the workspace path for on-demand file reads. Look
      // it up here (in the dispatcher) so both paths could be re-entered
      // without recomputation.
      const workspacePath = await getWorkspacePathForProject(session.projectId);
      await runStaticReviewWithTools(session, artifacts, onProgress, staticFindings, workspacePath);
      return;
    }

    await runStaticReviewPrefetch(session, artifacts, onProgress, staticFindings);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await updateStaticSessionStatus(session.id, 'failure', '', errorMsg);
    throw err;
  }
}

/**
 * Legacy pre-fetch path. Concatenates all artifact content into the prompt
 * for each stage; cheap and effective for small projects, but blows past
 * provider context windows for large projects (see runStaticReview dispatcher).
 *
 * When called from the dispatcher, `precomputedStaticFindings` is provided so
 * we don't re-run static analysis. When called directly (e.g. from a unit
 * test that exercises this function in isolation), the parameter is omitted
 * and we fall back to running indexProject + runStaticAnalysis ourselves.
 */
export async function runStaticReviewPrefetch(
  session: StaticSession,
  artifacts: Artifact[],
  onProgress?: (progress: ReviewProgress) => void,
  precomputedStaticFindings?: Finding[]
): Promise<void> {
  const completedThoughts: string[][] = [[], [], [], []];
  const completedSummaries: string[] = ['', '', '', ''];

  // Per-stage usage recorders. The prefetch path makes one AI call per stage,
  // but we still use the same round-tracking machinery as the tool path so a
  // future refactor (e.g. self-reflect loops) doesn't have to be rewritten
  // to surface in the dashboard.
  const makeStageUsageRecorder = (stageId: string) => {
    let round = 0;
    let setting: { provider: 'mimo' | 'gemini' | 'custom'; apiFormat: 'openai-compatible' | 'anthropic-compatible' | 'google-native'; model: string } | null = null;
    return {
      bindProvider: (s: { provider: 'mimo' | 'gemini' | 'custom'; apiFormat: 'openai-compatible' | 'anthropic-compatible' | 'google-native'; model: string }) => { setting = s; },
      handler: async (usage: TokenUsage) => {
        if (!setting) return;
        await recordTokenUsage({
          ...usage,
          scope: 'text' as TokenScope,
          callKind: 'review' as CallKind,
          projectId: session.projectId,
          sessionId: session.id,
          stage: stageId,
          roundNumber: round,
          provider: setting.provider,
          apiFormat: setting.apiFormat,
          model: setting.model,
        });
        round += 1;
      },
    };
  };

  const emitThinking = (stageIdx: number, thought: string) => {
    const stages: ReviewStageProgress[] = STAGE_DEFINITIONS.map((def, i) => ({
      id: def.id,
      label: def.label,
      status: i < stageIdx ? 'done' : i === stageIdx ? 'active' : 'pending',
      thoughts: i === stageIdx ? [thought] : (i < stageIdx ? completedThoughts[i] : []),
      summary: i < stageIdx ? completedSummaries[i] : undefined,
    }));
    const progress: ReviewProgress = {
      currentStage: STAGE_DEFINITIONS[stageIdx].id,
      stages,
      startedAt: session.createdAt,
      updatedAt: new Date().toISOString(),
    };
    updateStaticSessionProgress(session.id, progress);
    onProgress?.(progress);
  };

  const emit = (stageIdx: number, status: 'active' | 'done', thoughts: string[], summary?: string) => {
    const stages: ReviewStageProgress[] = STAGE_DEFINITIONS.map((def, i) => ({
      id: def.id,
      label: def.label,
      status: i < stageIdx ? 'done' : i === stageIdx ? status : 'pending',
      thoughts: i === stageIdx ? thoughts : (i < stageIdx ? completedThoughts[i] : []),
      summary: i < stageIdx ? completedSummaries[i] : undefined,
    }));
    const progress: ReviewProgress = {
      currentStage: STAGE_DEFINITIONS[stageIdx].id,
      stages,
      startedAt: session.createdAt,
      updatedAt: new Date().toISOString(),
    };
    updateStaticSessionProgress(session.id, progress);
    onProgress?.(progress);
  };

  try {
    await updateStaticSessionStatus(session.id, 'running', '', '');

    // ── Pre-flight: Index + Static Analysis ───────────────────
    // When the dispatcher has already run these, reuse the results. When
    // this function is called directly (legacy/test path), compute them here.
    let staticFindings: Finding[];
    if (precomputedStaticFindings) {
      staticFindings = precomputedStaticFindings;
    } else {
      await indexProject(session.projectId, artifacts);
      staticFindings = await runStaticAnalysis(session.projectId, artifacts, session.id);
    }

    // Read all artifact contents
    const artifactContents: { name: string; type: string; content: string }[] = [];
    for (const artifact of artifacts) {
      try {
        const content = await readArtifactContent(artifact.id);
        const maxChars = 50000;
        const truncated = content.length > maxChars
          ? content.substring(0, maxChars) + '\n\n[... truncated ...]'
          : content;
        artifactContents.push({ name: artifact.fileName, type: artifact.type, content: truncated });
      } catch {
        // Skip unreadable artifacts
      }
    }

    if (artifactContents.length === 0) {
      throw new Error('No artifacts could be read');
    }

    // ── Stage 1: Understanding Context ────────────────────────
    emit(0, 'active', []);
    emitThinking(0, `Reading ${artifactContents.length} artifact(s) to understand the project...`);
    const s1Recorder = makeStageUsageRecorder('understanding_context');
    {
      const setting = await getRawAiSetting('text');
      if (setting) s1Recorder.bindProvider(setting);
    }
    const s1Response = await callAi(
      CONTEXT_UNDERSTANDING_PROMPT.build(artifactContents, session.remarks),
      CONTEXT_UNDERSTANDING_PROMPT.system,
      { stageIdx: 0, onTruncate: emitThinking },
      s1Recorder.handler
    );
    const s1 = parseStageResponse(s1Response);
    completedThoughts[0] = s1.thoughts;
    completedSummaries[0] = (s1.projectSummary as string) || 'Context understood';
    console.info(
      `[review-session] stage=understanding_context session=${session.id} ` +
      `thoughts=${s1.thoughts.length} findings=${s1.findings.length} ` +
      `raw_response_length=${s1Response.length}`
    );
    if (s1.thoughts.length === 0) {
      console.warn(`[review-session] stage=understanding_context raw_response=${s1Response.substring(0, 500)}`);
    }
    emit(0, 'done', s1.thoughts, completedSummaries[0]);

    // ── Stage 2: Code Review ──────────────────────────────────
    emit(1, 'active', []);
    const codeArtifacts = artifactContents.filter(a => a.type === 'source_code');
    // If no code artifacts, use all artifacts
    const codeToReview = codeArtifacts.length > 0 ? codeArtifacts : artifactContents;
    emitThinking(1, `Inspecting ${codeToReview.length} source file(s) for code-quality issues...`);
    const s2Recorder = makeStageUsageRecorder('code_review');
    {
      const setting = await getRawAiSetting('text');
      if (setting) s2Recorder.bindProvider(setting);
    }

    const s2Response = await callAi(
      CODE_REVIEW_PROMPT.build(codeToReview, {
        projectSummary: (s1.projectSummary as string) || '',
        artifactInventory: (s1.artifactInventory as { name: string; type: string; purpose: string }[]) || [],
        userIntent: (s1.userIntent as string) || session.remarks,
      }, session.remarks),
      CODE_REVIEW_PROMPT.system,
      { stageIdx: 1, onTruncate: emitThinking },
      s2Recorder.handler
    );
    const s2 = parseStageResponse(s2Response);

    // Save code review findings
    const codeRiskInputs: RiskInput[] = s2.findings.map(f => ({
      severity: f.severity,
      confidence: f.confidence || 'medium',
      category: f.category || '',
      filePath: f.artifactReference || '',
    }));
    const codeScored = scoreFindings(codeRiskInputs, artifacts.length);

    const codeFindingsWithLocation = s2.findings.map(f => {
      const location = extractLocation(f);
      return {
        ...f,
        filePath: location.filePath,
        lineNumber: location.lineNumber,
      };
    });
    const deduped = await dedupeAgainstStaticFindings(session.id, session.projectId, codeFindingsWithLocation);
    console.info(
      `[review-session] stage=code_review session=${session.id} ` +
      `dedup kept=${deduped.kept.length} dropped=${deduped.dropped.length}`
    );

    for (let i = 0; i < deduped.kept.length; i++) {
      const f = deduped.kept[i];
      const original = codeFindingsWithLocation.indexOf(f);
      const risk = codeScored[original]?.risk;
      const location = extractLocation(f);
      await createFinding(session.projectId, session.id, {
        severity: validateSeverity(risk?.level || f.severity),
        title: f.title,
        description: f.description || '',
        category: f.category || '',
        evidenceText: f.evidence || '',
        recommendation: f.recommendation || '',
        confidence: validateConfidence(f.confidence),
        artifactId: f.artifactReference || undefined,
        filePath: location.filePath || undefined,
        lineNumber: location.lineNumber ?? undefined,
      });
    }

    completedThoughts[1] = s2.thoughts;
    completedSummaries[1] = `${s2.findings.length} code issue(s) found`;
    console.info(
      `[review-session] stage=code_review session=${session.id} ` +
      `thoughts=${s2.thoughts.length} findings=${s2.findings.length} ` +
      `raw_response_length=${s2Response.length}`
    );
    if (s2.findings.length === 0 && s2.thoughts.length === 0) {
      console.warn(`[review-session] stage=code_review raw_response=${s2Response.substring(0, 500)}`);
    }
    emit(1, 'done', s2.thoughts, completedSummaries[1]);

    // ── Stage 3: Requirement-to-Code Validation ───────────────
    emit(2, 'active', []);
    const reqArtifacts = artifactContents.filter(a => a.type === 'requirement' || a.type === 'design');
    // If no requirement artifacts, skip with empty results
    emitThinking(2, reqArtifacts.length > 0
      ? `Tracing ${reqArtifacts.length} requirement document(s) to the codebase...`
      : 'No artifacts to analyze.');
    let s3: StageResponse = { thoughts: ['No requirement documents found — skipping traceability analysis.'], findings: [] };
    let s3Response: string = '';  // hoisted so the post-stage log can reference it

    if (reqArtifacts.length > 0) {
      const s3Recorder = makeStageUsageRecorder('requirement_validation');
      {
        const setting = await getRawAiSetting('text');
        if (setting) s3Recorder.bindProvider(setting);
      }
      s3Response = await callAi(
        TRACEABILITY_PROMPT.build(
          reqArtifacts,
          codeToReview,
          {
            projectSummary: (s1.projectSummary as string) || '',
            userIntent: (s1.userIntent as string) || session.remarks,
          },
          (s2.codeQualitySummary as string) || '',
          session.remarks
        ),
        TRACEABILITY_PROMPT.system,
        { stageIdx: 2, onTruncate: emitThinking },
        s3Recorder.handler
      );
      s3 = parseStageResponse(s3Response);

      // Save traceability findings
      const traceRiskInputs: RiskInput[] = s3.findings.map(f => ({
        severity: f.severity,
        confidence: f.confidence || 'medium',
        category: f.category || '',
        filePath: f.artifactReference || '',
      }));
      const traceScored = scoreFindings(traceRiskInputs, artifacts.length);

      for (let i = 0; i < s3.findings.length; i++) {
        const f = s3.findings[i];
        const risk = traceScored[i]?.risk;
        const location = extractLocation(f);
        await createFinding(session.projectId, session.id, {
          severity: validateSeverity(risk?.level || f.severity),
          title: f.title,
          description: f.description || '',
          category: f.category || '',
          evidenceText: f.evidence || '',
          recommendation: f.recommendation || '',
          confidence: validateConfidence(f.confidence),
          artifactId: f.artifactReference || undefined,
          filePath: location.filePath || undefined,
          lineNumber: location.lineNumber ?? undefined,
        });
      }
    }

    completedThoughts[2] = s3.thoughts;
    completedSummaries[2] = `${s3.findings.length} traceability issue(s) found`;
    console.info(
      `[review-session] stage=requirement_validation session=${session.id} ` +
      `thoughts=${s3.thoughts.length} findings=${s3.findings.length} ` +
      `raw_response_length=${s3Response.length}`
    );
    if (s3.findings.length === 0 && s3.thoughts.length === 0 && reqArtifacts.length > 0) {
      console.warn(`[review-session] stage=requirement_validation raw_response=${s3Response.substring(0, 500)}`);
    }
    emit(2, 'done', s3.thoughts, completedSummaries[2]);

    // ── Stage 4: Summarize Findings ───────────────────────────
    emit(3, 'active', []);
    emitThinking(3, `Consolidating findings and prioritizing recommendations...`);

    // Extract extra artifacts from Stage 4 if user provided remarks
    let extraArtifacts: { title: string; content: string; type: string }[] = [];
    const s4Recorder = makeStageUsageRecorder('summarizing');
    {
      const setting = await getRawAiSetting('text');
      if (setting) s4Recorder.bindProvider(setting);
    }

    const s4Response = await callAi(
      SUMMARY_PROMPT.build(
        {
          projectSummary: (s1.projectSummary as string) || '',
          userIntent: (s1.userIntent as string) || session.remarks,
        },
        s2.findings,
        s3.findings,
        staticFindings,
        session.remarks
      ),
      SUMMARY_PROMPT.system,
      { stageIdx: 3, onTruncate: emitThinking },
      s4Recorder.handler
    );
    const s4 = parseStageResponse(s4Response);

    // Extract extra artifacts if present
    if (s4.extra_artifacts && Array.isArray(s4.extra_artifacts)) {
      extraArtifacts = s4.extra_artifacts.filter((f: any) =>
        typeof f === 'object' && f !== null && f.title && f.content
      );
    }

    // Save extra artifacts
    for (const ea of extraArtifacts) {
      await createReviewArtifact(session.id, session.projectId, {
        title: ea.title,
        content: ea.content,
        artifactType: ea.type || 'analysis',
      });
    }

    completedThoughts[3] = s4.thoughts;
    completedSummaries[3] = 'Review complete';
    console.info(
      `[review-session] stage=summarizing session=${session.id} ` +
      `thoughts=${s4.thoughts.length} extra_artifacts=${extraArtifacts.length} ` +
      `raw_response_length=${s4Response.length}`
    );
    emit(3, 'done', s4.thoughts, 'Review complete');

    const totalAiFindings = s2.findings.length + s3.findings.length;
    const summary = (s4.executiveSummary as string) || `Review completed. ${totalAiFindings} AI finding(s) + ${staticFindings.length} static finding(s) from ${artifactContents.length} artifact(s).`;
    await updateStaticSessionStatus(session.id, 'success', summary, '');

    // Group 2c: auto-generate the test plan from the findings. This
    // runs after the session is marked 'success' so the dashboard can
    // show "Test plan: 12 items proposed" right alongside the verdict.
    // Failures are logged but don't fail the review — the user can
    // always click "Regenerate plan" to retry, and the review itself
    // is already committed.
    try {
      const { generateTestPlanForSession } = await import('./testPlanGenerator.js');
      const plan = await generateTestPlanForSession(session.id, session.projectId);
      console.info(
        `[review-session] test-plan generated session=${session.id} ` +
        `findings=${plan.findings} items=${plan.items} smoke=${plan.smoke}`
      );
    } catch (e) {
      console.warn(
        `[review-session] test-plan generation failed session=${session.id}: ${(e as Error).message}`
      );
    }

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await updateStaticSessionStatus(session.id, 'failure', '', errorMsg);
    throw err;
  }
}

// ── Tool-use review pipeline ─────────────────────────────────────────────────
//
// When the artifact payload is large (total bytes >= STATIC_REVIEW_SMALL_PROJECT_BYTES,
// or any single file > 100KB), the model fetches files on demand via `fetch_file` /
// `fetch_files` / `get_symbol_body` / `search_symbols` instead of receiving
// everything pre-inlined. The repository index and dependency graph are sent
// as system context so the model has a navigation map; tools supply the
// bodies it asks for.
//
// The dispatcher (runStaticReview) routes to this path when the routing
// rules fire. When called from the dispatcher, precomputedStaticFindings and
// precomputedWorkspacePath are supplied so this function does not redo the
// indexing/analysis pass or the workspace-path lookup.

export async function runStaticReviewWithTools(
  session: StaticSession,
  artifacts: Artifact[],
  onProgress?: (progress: ReviewProgress) => void,
  precomputedStaticFindings?: Finding[],
  precomputedWorkspacePath?: string
): Promise<void> {
  const completedThoughts: string[][] = [[], [], [], []];
  const completedSummaries: string[] = ['', '', '', ''];

  const emitThinking = (stageIdx: number, thought: string) => {
    const stages: ReviewStageProgress[] = STAGE_DEFINITIONS.map((def, i) => ({
      id: def.id,
      label: def.label,
      status: i < stageIdx ? 'done' : i === stageIdx ? 'active' : 'pending',
      thoughts: i === stageIdx ? [thought] : (i < stageIdx ? completedThoughts[i] : []),
      summary: i < stageIdx ? completedSummaries[i] : undefined,
    }));
    const progress: ReviewProgress = {
      currentStage: STAGE_DEFINITIONS[stageIdx].id,
      stages,
      startedAt: session.createdAt,
      updatedAt: new Date().toISOString(),
    };
    updateStaticSessionProgress(session.id, progress);
    onProgress?.(progress);
  };

  const emit = (stageIdx: number, status: 'active' | 'done', thoughts: string[], summary?: string) => {
    const stages: ReviewStageProgress[] = STAGE_DEFINITIONS.map((def, i) => ({
      id: def.id,
      label: def.label,
      status: i < stageIdx ? 'done' : i === stageIdx ? status : 'pending',
      thoughts: i === stageIdx ? thoughts : (i < stageIdx ? completedThoughts[i] : []),
      summary: i < stageIdx ? completedSummaries[i] : undefined,
    }));
    const progress: ReviewProgress = {
      currentStage: STAGE_DEFINITIONS[stageIdx].id,
      stages,
      startedAt: session.createdAt,
      updatedAt: new Date().toISOString(),
    };
    updateStaticSessionProgress(session.id, progress);
    onProgress?.(progress);
  };

  try {
    await updateStaticSessionStatus(session.id, 'running', '', '');

    // Configure AI provider + locate workspace
    const setting = await getRawAiSetting('text');
    if (!setting) throw new Error('Text AI provider not configured');
    if (!setting.apiKey) throw new Error('Text AI API key not configured');

    // Per-stage usage recorders. The tool path may make multiple round-trips
    // per stage (model uses fetch_file/search_symbols), so the recorder
    // tracks the round number so the dashboard can show "5 calls in stage 2".
    const makeStageUsageRecorder = (stageId: string) => {
      let round = 0;
      return async (usage: TokenUsage) => {
        await recordTokenUsage({
          ...usage,
          scope: 'text' as TokenScope,
          callKind: 'review' as CallKind,
          projectId: session.projectId,
          sessionId: session.id,
          stage: stageId,
          roundNumber: round,
          provider: setting.provider,
          apiFormat: setting.apiFormat,
          model: setting.model,
        });
        round += 1;
      };
    };

    // Prefer the project's configured workspace_path. If absent (e.g. a test
    // session or a freshly-imported project without a workspace row), fall
    // back to the directory of the first artifact's filePath so the tool path
    // can still read files on demand.
    let workspacePath = precomputedWorkspacePath ?? await getWorkspacePathForProject(session.projectId);
    if (!workspacePath) {
      const firstWithFile = artifacts.find((a) => a.filePath);
      if (firstWithFile?.filePath) {
        workspacePath = path.dirname(firstWithFile.filePath);
      }
    }
    if (!workspacePath) {
      throw new Error(`Project ${session.projectId} has no workspace_path and no artifacts with filePath; cannot use tool path`);
    }

    // Pre-flight: index + static analysis. `indexProject` also writes
    // .centinel/index.json + graph.json to the workspace for us to load. If
    // either file is missing on disk (e.g. indexing was a no-op, mocked in
    // tests, or failed silently), fall back to a minimal placeholder so the
    // tool path still runs.
    //
    // When the dispatcher already ran these (Task 6), skip the redundant
    // calls and reuse the precomputed values.
    let staticFindings: Finding[];
    if (precomputedStaticFindings) {
      staticFindings = precomputedStaticFindings;
    } else {
      await indexProject(session.projectId, artifacts);
      staticFindings = await runStaticAnalysis(session.projectId, artifacts, session.id);
    }

    const indexPath = path.join(workspacePath, '.centinel', 'index.json');
    const graphPath = path.join(workspacePath, '.centinel', 'graph.json');
    const indexJson = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf-8') : '{}';
    const graphJson = fs.existsSync(graphPath) ? fs.readFileSync(graphPath, 'utf-8') : '{}';

    const baseSystemPrefix = `You are reviewing a software project. The repository index and dependency graph are provided below as your navigation aids. Use the available tools (fetch_file, fetch_files, get_symbol_body, search_symbols) to read the specific files you need to inspect.

## Repository Index (.centinel/index.json)
${indexJson}

## Dependency Graph (.centinel/graph.json)
${graphJson}
`;

    // ── Stage 1: Understanding Context ────────────────────────
    emit(0, 'active', []);
    emitThinking(0, `Indexing ${artifacts.length} artifact(s); model will fetch files on demand...`);
    const s1UserPrompt = `Analyze the following software artifacts to understand this project.${session.remarks ? `\n\n## User's Notes\n---\n${session.remarks}\n---` : ''}\n\n## Artifacts\n${artifacts.map(a => `- ${a.fileName} (${a.type})`).join('\n')}`;
    const s1Response = await runStageWithTools(
      0,
      baseSystemPrefix + '\n\n' + CONTEXT_UNDERSTANDING_PROMPT.system,
      s1UserPrompt,
      session.projectId,
      workspacePath,
      setting,
      (thought) => emitThinking(0, thought),
      makeStageUsageRecorder('understanding_context')
    );
    const s1 = parseStageResponse(s1Response);
    completedThoughts[0] = s1.thoughts;
    completedSummaries[0] = (s1.projectSummary as string) || 'Context understood';
    console.info(
      `[review-session] stage=understanding_context session=${session.id} ` +
      `thoughts=${s1.thoughts.length} findings=${s1.findings.length} ` +
      `raw_response_length=${s1Response.length}`
    );
    if (s1.thoughts.length === 0) {
      console.warn(`[review-session] stage=understanding_context raw_response=${s1Response.substring(0, 500)}`);
    }
    emit(0, 'done', s1.thoughts, completedSummaries[0]);

    // ── Stage 2: Code Review ──────────────────────────────────
    emit(1, 'active', []);
    const codeArtifactNames = artifacts.filter(a => a.type === 'source_code').map(a => a.fileName);
    emitThinking(1, `Reviewing ${codeArtifactNames.length || artifacts.length} file(s) via tools...`);
    const s2UserPrompt = `## Project Context\n${(s1.projectSummary as string) || ''}\n\nUser intent: ${(s1.userIntent as string) || session.remarks}${session.remarks ? `\n\n## User's Notes\n---\n${session.remarks}\n---` : ''}\n\n## Source Code to Review\nUse the tools to fetch the following files (or others you discover via search_symbols):\n${(codeArtifactNames.length > 0 ? codeArtifactNames : artifacts.map(a => a.fileName)).map(n => `- ${n}`).join('\n')}`;
    const s2Response = await runStageWithTools(
      1,
      baseSystemPrefix + '\n\n' + CODE_REVIEW_PROMPT.system,
      s2UserPrompt,
      session.projectId,
      workspacePath,
      setting,
      (thought) => emitThinking(1, thought),
      makeStageUsageRecorder('code_review')
    );
    const s2 = parseStageResponse(s2Response);

    // Save code review findings
    const codeRiskInputs: RiskInput[] = s2.findings.map(f => ({
      severity: f.severity,
      confidence: f.confidence || 'medium',
      category: f.category || '',
      filePath: f.artifactReference || '',
    }));
    const codeScored = scoreFindings(codeRiskInputs, artifacts.length);

    const codeFindingsWithLocation = s2.findings.map(f => {
      const location = extractLocation(f);
      return {
        ...f,
        filePath: location.filePath,
        lineNumber: location.lineNumber,
      };
    });
    const deduped = await dedupeAgainstStaticFindings(session.id, session.projectId, codeFindingsWithLocation);
    console.info(
      `[review-session] stage=code_review session=${session.id} ` +
      `dedup kept=${deduped.kept.length} dropped=${deduped.dropped.length}`
    );

    for (let i = 0; i < deduped.kept.length; i++) {
      const f = deduped.kept[i];
      const original = codeFindingsWithLocation.indexOf(f);
      const risk = codeScored[original]?.risk;
      const location = extractLocation(f);
      await createFinding(session.projectId, session.id, {
        severity: validateSeverity(risk?.level || f.severity),
        title: f.title,
        description: f.description || '',
        category: f.category || '',
        evidenceText: f.evidence || '',
        recommendation: f.recommendation || '',
        confidence: validateConfidence(f.confidence),
        artifactId: f.artifactReference || undefined,
        filePath: location.filePath || undefined,
        lineNumber: location.lineNumber ?? undefined,
      });
    }

    completedThoughts[1] = s2.thoughts;
    completedSummaries[1] = `${s2.findings.length} code issue(s) found`;
    console.info(
      `[review-session] stage=code_review session=${session.id} ` +
      `thoughts=${s2.thoughts.length} findings=${s2.findings.length} ` +
      `raw_response_length=${s2Response.length}`
    );
    if (s2.findings.length === 0 && s2.thoughts.length === 0) {
      console.warn(`[review-session] stage=code_review raw_response=${s2Response.substring(0, 500)}`);
    }
    emit(1, 'done', s2.thoughts, completedSummaries[1]);

    // ── Stage 3: Requirement-to-Code Validation ───────────────
    emit(2, 'active', []);
    const reqArtifacts = artifacts.filter(a => a.type === 'requirement' || a.type === 'design');
    emitThinking(2, reqArtifacts.length > 0
      ? `Tracing ${reqArtifacts.length} requirement document(s) to the codebase...`
      : 'No artifacts to analyze.');
    let s3: StageResponse = { thoughts: ['No requirement documents found — skipping traceability analysis.'], findings: [] };
    let s3Response: string = '';  // hoisted so the post-stage log can reference it

    if (reqArtifacts.length > 0) {
      const s3UserPrompt = `## Project Context\n${(s1.projectSummary as string) || ''}\n\nUser intent: ${(s1.userIntent as string) || session.remarks}\n\n## Code Review Summary\n${(s2.codeQualitySummary as string) || ''}${session.remarks ? `\n\n## User's Notes\n---\n${session.remarks}\n---` : ''}\n\n## Requirements\n${reqArtifacts.map(a => `--- Requirement File: ${a.fileName} ---\n(use the tools to read this file)`).join('\n\n')}\n\n## Source Code\n${codeArtifactNames.map(n => `--- Code File: ${n} ---\n(use the tools to read this file)`).join('\n\n')}`;
      s3Response = await runStageWithTools(
        2,
        baseSystemPrefix + '\n\n' + TRACEABILITY_PROMPT.system,
        s3UserPrompt,
        session.projectId,
        workspacePath,
        setting,
        (thought) => emitThinking(2, thought),
        makeStageUsageRecorder('requirement_validation')
      );
      s3 = parseStageResponse(s3Response);

      const traceRiskInputs: RiskInput[] = s3.findings.map(f => ({
        severity: f.severity,
        confidence: f.confidence || 'medium',
        category: f.category || '',
        filePath: f.artifactReference || '',
      }));
      const traceScored = scoreFindings(traceRiskInputs, artifacts.length);

      for (let i = 0; i < s3.findings.length; i++) {
        const f = s3.findings[i];
        const risk = traceScored[i]?.risk;
        const location = extractLocation(f);
        await createFinding(session.projectId, session.id, {
          severity: validateSeverity(risk?.level || f.severity),
          title: f.title,
          description: f.description || '',
          category: f.category || '',
          evidenceText: f.evidence || '',
          recommendation: f.recommendation || '',
          confidence: validateConfidence(f.confidence),
          artifactId: f.artifactReference || undefined,
          filePath: location.filePath || undefined,
          lineNumber: location.lineNumber ?? undefined,
        });
      }
    }

    completedThoughts[2] = s3.thoughts;
    completedSummaries[2] = `${s3.findings.length} traceability issue(s) found`;
    console.info(
      `[review-session] stage=requirement_validation session=${session.id} ` +
      `thoughts=${s3.thoughts.length} findings=${s3.findings.length} ` +
      `raw_response_length=${s3Response.length}`
    );
    if (s3.findings.length === 0 && s3.thoughts.length === 0 && reqArtifacts.length > 0) {
      console.warn(`[review-session] stage=requirement_validation raw_response=${s3Response.substring(0, 500)}`);
    }
    emit(2, 'done', s3.thoughts, completedSummaries[2]);

    // ── Stage 4: Summarize Findings ───────────────────────────
    emit(3, 'active', []);
    emitThinking(3, `Consolidating findings and prioritizing recommendations...`);
    let extraArtifacts: { title: string; content: string; type: string }[] = [];

    const s4UserPrompt = SUMMARY_PROMPT.build(
      {
        projectSummary: (s1.projectSummary as string) || '',
        userIntent: (s1.userIntent as string) || session.remarks,
      },
      s2.findings,
      s3.findings,
      staticFindings,
      session.remarks
    );
    const s4Response = await runStageWithTools(
      3,
      baseSystemPrefix + '\n\n' + SUMMARY_PROMPT.system,
      s4UserPrompt,
      session.projectId,
      workspacePath,
      setting,
      (thought) => emitThinking(3, thought),
      makeStageUsageRecorder('summarizing')
    );
    const s4 = parseStageResponse(s4Response);

    if (s4.extra_artifacts && Array.isArray(s4.extra_artifacts)) {
      extraArtifacts = (s4.extra_artifacts as unknown[]).filter((f: any) =>
        typeof f === 'object' && f !== null && f.title && f.content
      ) as { title: string; content: string; type: string }[];
    }

    for (const ea of extraArtifacts) {
      await createReviewArtifact(session.id, session.projectId, {
        title: ea.title,
        content: ea.content,
        artifactType: ea.type || 'analysis',
      });
    }

    completedThoughts[3] = s4.thoughts;
    completedSummaries[3] = 'Review complete';
    console.info(
      `[review-session] stage=summarizing session=${session.id} ` +
      `thoughts=${s4.thoughts.length} extra_artifacts=${extraArtifacts.length} ` +
      `raw_response_length=${s4Response.length}`
    );
    emit(3, 'done', s4.thoughts, 'Review complete');

    const totalAiFindings = s2.findings.length + s3.findings.length;
    const summary = (s4.executiveSummary as string) || `Review completed. ${totalAiFindings} AI finding(s) + ${staticFindings.length} static finding(s) from ${artifacts.length} artifact(s).`;
    await updateStaticSessionStatus(session.id, 'success', summary, '');

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await updateStaticSessionStatus(session.id, 'failure', '', errorMsg);
    throw err;
  }
}
