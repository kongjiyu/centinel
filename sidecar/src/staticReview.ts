import fs from 'fs';
import { getRawAiSetting } from './settings.js';
import { readArtifactContent, listArtifacts } from './artifacts.js';
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
  - severity: one of "critical", "high", "medium", "low", "info"
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
  - severity: one of "critical", "high", "medium", "low", "info"
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

async function callAi(prompt: string, systemPrompt: string): Promise<string> {
  const setting = await getRawAiSetting('text');
  if (!setting) throw new Error('Text AI provider not configured');
  if (!setting.apiKey) throw new Error('Text AI API key not configured');

  const { provider, apiFormat, apiKey, baseUrl, model } = setting;

  let body: string;
  let headers: Record<string, string>;

  function getAuthHeaders(): Record<string, string> {
    if (provider === 'mimo') {
      return { 'Content-Type': 'application/json', 'api-key': apiKey };
    }
    if (apiFormat === 'anthropic-compatible') {
      return { 'Content-Type': 'application/json', 'api-key': apiKey };
    }
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  }

  if (apiFormat === 'anthropic-compatible') {
    headers = getAuthHeaders();
    body = JSON.stringify({
      model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    });
  } else {
    headers = getAuthHeaders();
    body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_completion_tokens: 8192,
      thinking: { type: 'disabled' },
    });
  }

  const res = await fetch(baseUrl, { method: 'POST', headers, body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI API error: HTTP ${res.status} — ${text}`);
  }

  const json = await res.json();

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

// ── Main Review Pipeline ───────────────────────────────────────────────

export async function runStaticReview(
  session: StaticSession,
  artifacts: Artifact[],
  onProgress?: (progress: ReviewProgress) => void
): Promise<void> {
  const completedThoughts: string[][] = [[], [], [], []];
  const completedSummaries: string[] = ['', '', '', ''];

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
    await indexProject(session.projectId, artifacts);
    const staticFindings = await runStaticAnalysis(session.projectId, artifacts, session.id);

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
    const s1Response = await callAi(
      CONTEXT_UNDERSTANDING_PROMPT.build(artifactContents, session.remarks),
      CONTEXT_UNDERSTANDING_PROMPT.system
    );
    const s1 = parseStageResponse(s1Response);
    completedThoughts[0] = s1.thoughts;
    completedSummaries[0] = (s1.projectSummary as string) || 'Context understood';
    emit(0, 'done', s1.thoughts, completedSummaries[0]);

    // ── Stage 2: Code Review ──────────────────────────────────
    emit(1, 'active', []);
    const codeArtifacts = artifactContents.filter(a => a.type === 'source_code');
    // If no code artifacts, use all artifacts
    const codeToReview = codeArtifacts.length > 0 ? codeArtifacts : artifactContents;

    const s2Response = await callAi(
      CODE_REVIEW_PROMPT.build(codeToReview, {
        projectSummary: (s1.projectSummary as string) || '',
        artifactInventory: (s1.artifactInventory as { name: string; type: string; purpose: string }[]) || [],
        userIntent: (s1.userIntent as string) || session.remarks,
      }, session.remarks),
      CODE_REVIEW_PROMPT.system
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

    for (let i = 0; i < s2.findings.length; i++) {
      const f = s2.findings[i];
      const risk = codeScored[i]?.risk;
      await createFinding(session.projectId, session.id, {
        severity: validateSeverity(risk?.level || f.severity),
        title: f.title,
        description: f.description || '',
        category: f.category || '',
        evidenceText: f.evidence || '',
        recommendation: f.recommendation || '',
        confidence: validateConfidence(f.confidence),
        artifactId: f.artifactReference || undefined,
      });
    }

    completedThoughts[1] = s2.thoughts;
    completedSummaries[1] = `${s2.findings.length} code issue(s) found`;
    emit(1, 'done', s2.thoughts, completedSummaries[1]);

    // ── Stage 3: Requirement-to-Code Validation ───────────────
    emit(2, 'active', []);
    const reqArtifacts = artifactContents.filter(a => a.type === 'requirement' || a.type === 'design');
    // If no requirement artifacts, skip with empty results
    let s3: StageResponse = { thoughts: ['No requirement documents found — skipping traceability analysis.'], findings: [] };

    if (reqArtifacts.length > 0) {
      const s3Response = await callAi(
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
        TRACEABILITY_PROMPT.system
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
        await createFinding(session.projectId, session.id, {
          severity: validateSeverity(risk?.level || f.severity),
          title: f.title,
          description: f.description || '',
          category: f.category || '',
          evidenceText: f.evidence || '',
          recommendation: f.recommendation || '',
          confidence: validateConfidence(f.confidence),
          artifactId: f.artifactReference || undefined,
        });
      }
    }

    completedThoughts[2] = s3.thoughts;
    completedSummaries[2] = `${s3.findings.length} traceability issue(s) found`;
    emit(2, 'done', s3.thoughts, completedSummaries[2]);

    // ── Stage 4: Summarize Findings ───────────────────────────
    emit(3, 'active', []);

    // Extract extra artifacts from Stage 4 if user provided remarks
    let extraArtifacts: { title: string; content: string; type: string }[] = [];

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
      SUMMARY_PROMPT.system
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
    emit(3, 'done', s4.thoughts, 'Review complete');

    const totalAiFindings = s2.findings.length + s3.findings.length;
    const summary = (s4.executiveSummary as string) || `Review completed. ${totalAiFindings} AI finding(s) + ${staticFindings.length} static finding(s) from ${artifactContents.length} artifact(s).`;
    await updateStaticSessionStatus(session.id, 'success', summary, '');

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await updateStaticSessionStatus(session.id, 'failure', '', errorMsg);
    throw err;
  }
}