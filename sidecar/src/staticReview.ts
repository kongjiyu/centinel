import fs from 'fs';
import { getRawAiSetting } from './settings.js';
import { readArtifactContent, listArtifacts } from './artifacts.js';
import {
  createFinding,
  updateStaticSessionStatus,
  updateStaticSessionProgress,
  createReviewArtifact,
  type ReviewProgress,
} from './staticSessions.js';
import type { StaticSession, ReviewType } from './staticSessions.js';
import type { Artifact } from './artifacts.js';
import { indexProject } from './repoIndex.js';
import { retrieveContext } from './contextRetrieval.js';
import { runStaticAnalysis, type Finding } from './staticEngine.js';
import { scoreFindings, type RiskInput } from './riskScore.js';

type ReviewFinding = {
  title: string;
  severity: string;
  category: string;
  artifactReference: string;
  description: string;
  evidence: string;
  recommendation: string;
  confidence: string;
};

const REVIEW_PROMPTS: Record<ReviewType, { system: string; build: (artifacts: { name: string; type: string; content: string }[]) => string }> = {
  requirement_review: {
    system: `You are a senior software quality analyst specializing in requirement specification review. Your job is to analyze requirement documents and identify issues that could lead to poor implementation, ambiguity, or incomplete coverage.

You must return your findings as a JSON array. Each finding must have these fields:
- title: short descriptive title
- severity: one of "critical", "high", "medium", "low", "info"
- category: one of "unclear_requirement", "missing_detail", "ambiguous_language", "unverifiable", "incomplete", "contradiction", "other"
- artifactReference: which file and section the finding relates to
- description: detailed explanation of the issue
- evidence: specific text or passage from the artifact that demonstrates the issue
- recommendation: concrete suggestion for fixing the issue
- confidence: one of "high", "medium", "low"

If no issues are found, return an empty array: []
Return ONLY the JSON array, no other text.`,
    build: (artifacts) => {
      const content = artifacts.map(a => `--- File: ${a.name} (Type: ${a.type}) ---\n${a.content}`).join('\n\n');
      return `Analyze the following requirement document(s) for quality issues. Look for:\n- Unclear or ambiguous requirements\n- Missing details or specifications\n- Unverifiable or untestable requirements\n- Contradictions between requirements\n- Incomplete coverage\n\n${content}`;
    },
  },
  code_review: {
    system: `You are a senior software engineer performing code inspection. Your job is to analyze source code and identify potential defects, maintainability issues, missing validation, risky logic patterns, and code quality concerns.

You must return your findings as a JSON array. Each finding must have these fields:
- title: short descriptive title
- severity: one of "critical", "high", "medium", "low", "info"
- category: one of "potential_bug", "missing_validation", "error_handling", "security_concern", "maintainability", "performance", "code_smell", "other"
- artifactReference: which file and function/section the finding relates to
- description: detailed explanation of the issue
- evidence: specific code snippet or pattern that demonstrates the issue
- recommendation: concrete suggestion for fixing the issue
- confidence: one of "high", "medium", "low"

If no issues are found, return an empty array: []
Return ONLY the JSON array, no other text.`,
    build: (artifacts) => {
      const content = artifacts.map(a => `--- File: ${a.name} (Type: ${a.type}) ---\n${a.content}`).join('\n\n');
      return `Analyze the following source code for potential issues. Look for:\n- Potential bugs or logic errors\n- Missing input validation\n- Poor error handling\n- Security concerns\n- Maintainability issues\n- Risky patterns\n\n${content}`;
    },
  },
  requirement_to_code_traceability: {
    system: `You are a software quality analyst specializing in requirement-to-code traceability. Your job is to analyze requirement documents alongside source code to identify which requirements are implemented, partially implemented, or missing from the code.

You must return your findings as a JSON array. Each finding must have these fields:
- title: short descriptive title
- severity: one of "critical", "high", "medium", "low", "info"
- category: one of "missing_implementation", "partial_implementation", "unclear_mapping", "extra_implementation", "well_covered"
- artifactReference: which requirement and/or code file the finding relates to
- description: detailed explanation of the traceability relationship
- evidence: specific requirement text and corresponding code (or lack thereof)
- recommendation: concrete suggestion for improving traceability
- confidence: one of "high", "medium", "low"

Focus especially on requirements that appear to have NO corresponding code implementation.
If no issues are found, return an empty array: []
Return ONLY the JSON array, no other text.`,
    build: (artifacts) => {
      const reqs = artifacts.filter(a => a.type === 'requirement' || a.type === 'design');
      const code = artifacts.filter(a => a.type === 'source_code');
      const reqContent = reqs.map(a => `--- Requirement File: ${a.name} ---\n${a.content}`).join('\n\n');
      const codeContent = code.map(a => `--- Code File: ${a.name} ---\n${a.content}`).join('\n\n');
      return `Analyze the traceability between the following requirements and source code.\n\n## Requirements\n${reqContent}\n\n## Source Code\n${codeContent}\n\nFor each requirement, determine if it is implemented, partially implemented, or missing from the code. Identify any code that implements functionality not described in requirements.`;
    },
  },
  cross_artifact_consistency: {
    system: `You are a software quality analyst specializing in cross-artifact consistency checking. Your job is to compare different software artifacts (requirements, design documents, source code) and identify inconsistencies, mismatches, and conflicts.

You must return your findings as a JSON array. Each finding must have these fields:
- title: short descriptive title
- severity: one of "critical", "high", "medium", "low", "info"
- category: one of "terminology_mismatch", "missing_entity", "conflicting_behavior", "naming_inconsistency", "missing_flow", "other"
- artifactReference: which files are involved in the inconsistency
- description: detailed explanation of the inconsistency
- evidence: specific text/code from each artifact that demonstrates the conflict
- recommendation: concrete suggestion for resolving the inconsistency
- confidence: one of "high", "medium", "low"

If no issues are found, return an empty array: []
Return ONLY the JSON array, no other text.`,
    build: (artifacts) => {
      const content = artifacts.map(a => `--- File: ${a.name} (Type: ${a.type}) ---\n${a.content}`).join('\n\n');
      return `Analyze the following software artifacts for cross-artifact consistency. Look for:\n- Terminology mismatches between documents\n- Entities mentioned in requirements but missing in code/design\n- Conflicting behavior descriptions\n- Naming inconsistencies\n- Missing flows or features\n\n${content}`;
    },
  },
};

async function callAi(prompt: string, systemPrompt: string): Promise<string> {
  const setting = await getRawAiSetting('text');
  if (!setting) throw new Error('Text AI provider not configured');
  if (!setting.apiKey) throw new Error('Text AI API key not configured');

  let body: string;
  let headers: Record<string, string>;

  if (setting.compatibilityMode === 'anthropic') {
    headers = { 'Content-Type': 'application/json', 'api-key': setting.apiKey };
    body = JSON.stringify({
      model: setting.model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    });
  } else {
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${setting.apiKey}` };
    body = JSON.stringify({
      model: setting.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_completion_tokens: 8192,
    });
  }

  const res = await fetch(setting.baseUrl, { method: 'POST', headers, body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI API error: HTTP ${res.status} — ${text}`);
  }

  const json = await res.json();

  // Extract text from response based on format
  if (setting.compatibilityMode === 'anthropic') {
    const content = json.content;
    if (Array.isArray(content) && content.length > 0) {
      return content[0].text ?? '';
    }
    return json.completion ?? JSON.stringify(json);
  } else {
    return json.choices?.[0]?.message?.content ?? JSON.stringify(json);
  }
}

function parseFindingsJson(raw: string): ReviewFinding[] {
  // Try to extract JSON from the response (may be wrapped in markdown code blocks)
  let jsonStr = raw.trim();

  // Remove markdown code block wrapping
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Try to find JSON array in the text
  const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    jsonStr = arrayMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item: unknown) => {
        if (typeof item !== 'object' || item === null) return false;
        const obj = item as Record<string, unknown>;
        return typeof obj.title === 'string' && typeof obj.severity === 'string';
      })
      .map((item: Record<string, unknown>) => ({
        ...item,
        // Normalize artifactReference: AI may return array or string
        artifactReference: Array.isArray(item.artifactReference)
          ? (item.artifactReference as string[]).join(', ')
          : String(item.artifactReference ?? ''),
      })) as ReviewFinding[];
  } catch {
    return [];
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

/**
 * Build a summary of static analysis findings to include in the AI prompt.
 */
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
    for (const item of items.slice(0, 10)) { // limit per category
      lines.push(`- [${item.severity}] ${item.message} — ${item.filePath}:${item.lineNumber}`);
    }
    if (items.length > 10) lines.push(`  ... and ${items.length - 10} more`);
  }
  lines.push('\nPlease validate these findings and add any additional issues the rules may have missed.');
  return lines.join('\n');
}

export async function runStaticReview(
  session: StaticSession,
  artifacts: Artifact[],
  onProgress?: (progress: ReviewProgress) => void
): Promise<void> {
  const emit = async (stage: string, message: string, steps: ReviewProgress['steps']) => {
    const progress: ReviewProgress = { stage, message, steps, startedAt: session.createdAt, updatedAt: new Date().toISOString() };
    await updateStaticSessionProgress(session.id, progress);
    onProgress?.(progress);
  };

  try {
    await updateStaticSessionStatus(session.id, 'running', '', '');

    // Group artifacts by source type
    const SOURCE_LABELS: Record<string, string> = {
      documents: 'Documents',
      repository: 'Repository',
      drive: 'Drive',
    };
    const groups: Record<string, Artifact[]> = {};
    for (const a of artifacts) {
      const key = a.source || 'documents';
      if (!groups[key]) groups[key] = [];
      groups[key].push(a);
    }
    const groupEntries = Object.entries(groups);

    // Progress: initializing — show grouped steps
    const initialSteps = groupEntries.map(([source, items]) => ({
      label: `${SOURCE_LABELS[source] || source} (${items.length} files)`,
      status: 'pending' as const,
    }));
    await emit('initializing', 'Starting review session...', initialSteps);

    // ── Phase A: Index repository ──────────────────────────────────
    await emit('indexing', 'Indexing repository structure...', [
      ...initialSteps.map(s => ({ ...s, status: 'done' as const })),
    ]);
    await indexProject(session.projectId, artifacts);

    // ── Phase B: Retrieve relevant context ─────────────────────────
    const retrieved = await retrieveContext(session.projectId, session.reviewType);
    // Map retrieved file paths back to artifacts
    const retrievedPaths = new Set(retrieved.files.map(f => f.filePath));
    const relevantArtifacts = artifacts.filter(a =>
      retrievedPaths.size === 0 || retrievedPaths.has(a.filePath) || retrievedPaths.has(a.fileName)
    );
    // Fall back to all artifacts if retrieval returned nothing
    const artifactsToAnalyze = relevantArtifacts.length > 0 ? relevantArtifacts : artifacts;

    const retrieveSteps = [
      { label: 'Index repository', status: 'done' as const },
      { label: `Retrieve context (${artifactsToAnalyze.length}/${artifacts.length} files)`, status: 'done' as const },
      { label: 'Static analysis', status: 'pending' as const },
      { label: 'AI analysis', status: 'pending' as const },
    ];
    await emit('retrieving', `Retrieved ${artifactsToAnalyze.length} relevant file(s) from ${artifacts.length} total`, retrieveSteps);

    // ── Phase C: Run static analysis rules ─────────────────────────
    const staticFindings = await runStaticAnalysis(session.projectId, artifactsToAnalyze, session.id);

    const staticSteps = [
      { label: 'Index repository', status: 'done' as const },
      { label: `Retrieve context (${artifactsToAnalyze.length}/${artifacts.length} files)`, status: 'done' as const },
      { label: `Static analysis (${staticFindings.length} findings)`, status: 'done' as const },
      { label: 'AI analysis', status: 'pending' as const },
    ];
    await emit('static_analysis', `Static analysis found ${staticFindings.length} issue(s)`, staticSteps);

    // ── Phase D: Read artifact contents ────────────────────────────
    const artifactContents: { name: string; type: string; content: string }[] = [];
    for (const artifact of artifactsToAnalyze) {
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

    // ── Phase E: AI analysis ───────────────────────────────────────
    const REVIEW_ARCHITECTURE: Record<string, { analyzes: string; outcome: string }> = {
      requirement_review: {
        analyzes: 'Analyzing requirement documents for clarity, completeness, and testability',
        outcome: 'Findings on ambiguous, missing, or unverifiable requirements',
      },
      code_review: {
        analyzes: 'Inspecting source code for defects, security issues, and maintainability',
        outcome: 'Findings on potential bugs, code smells, and quality concerns',
      },
      requirement_to_code_traceability: {
        analyzes: 'Mapping requirements to source code implementations',
        outcome: 'Traceability report showing implemented, partial, and missing implementations',
      },
      cross_artifact_consistency: {
        analyzes: 'Comparing artifacts for terminology, behavior, and structural consistency',
        outcome: 'Findings on mismatches, conflicts, and inconsistencies across artifacts',
      },
    };
    const arch = REVIEW_ARCHITECTURE[session.reviewType] || { analyzes: 'Analyzing artifacts', outcome: 'Review findings' };

    const aiSteps = [
      { label: 'Index repository', status: 'done' as const },
      { label: `Retrieve context (${artifactsToAnalyze.length}/${artifacts.length} files)`, status: 'done' as const },
      { label: `Static analysis (${staticFindings.length} findings)`, status: 'done' as const },
      { label: 'AI analysis', status: 'active' as const },
    ];
    await emit('analyzing', `${arch.analyzes} — ${artifactContents.length} artifact(s)`, aiSteps);

    const promptConfig = REVIEW_PROMPTS[session.reviewType];
    let userPrompt = promptConfig.build(artifactContents);

    // Include static analysis summary in prompt
    const staticSummary = buildStaticAnalysisSummary(staticFindings);
    if (staticSummary) {
      userPrompt = staticSummary + '\n\n' + userPrompt;
    }

    let systemPrompt = promptConfig.system;

    // Append reviewer remarks if present
    if (session.remarks) {
      systemPrompt += `\n\n## Reviewer Notes\nThe reviewer has provided the following additional instructions/context:\n---\n${session.remarks}\n---\nApply these notes to your analysis. If the notes request supplementary outputs (risk matrices, traceability maps, test case suggestions, etc.), include them in a separate "extra_artifacts" array in your JSON response with the shape: [{ "title": "...", "content": "...", "type": "risk_matrix|traceability|test_cases|other" }]. Findings that directly address the reviewer's specific criteria should include "fromRemarks": true in the finding object.`;
    }

    const rawResponse = await callAi(userPrompt, systemPrompt);

    // Parse findings using the robust parser (handles truncated/malformed JSON)
    const aiFindings = parseFindingsJson(rawResponse);

    // Extract extra artifacts from raw response (only present when remarks are used)
    let extraArtifacts: { title: string; content: string; type: string }[] = [];
    if (session.remarks) {
      try {
        let jsonStr = rawResponse.trim();
        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
        const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
        const allParsed = JSON.parse(arrayMatch ? arrayMatch[0] : '[]');
        extraArtifacts = allParsed.filter((f: any) =>
          typeof f === 'object' && f !== null && f.title && f.content && f.type && !f.severity
        );
      } catch {
        // Ignore — extra artifacts are optional
      }
    }

    // ── Phase F: Merge findings + apply risk scoring ───────────────
    const generatingSteps = [
      { label: 'Index repository', status: 'done' as const },
      { label: `Retrieve context (${artifactsToAnalyze.length}/${artifacts.length} files)`, status: 'done' as const },
      { label: `Static analysis (${staticFindings.length} findings)`, status: 'done' as const },
      { label: 'AI analysis', status: 'done' as const },
      { label: 'Risk scoring', status: 'active' as const },
    ];
    const totalFindings = aiFindings.length + staticFindings.length;
    await emit('generating_findings', `Processing ${totalFindings} finding(s)...`, generatingSteps);

    // Save extra artifacts
    for (const ea of extraArtifacts) {
      await createReviewArtifact(session.id, session.projectId, {
        title: ea.title,
        content: ea.content,
        artifactType: ea.type || 'analysis',
      });
    }

    // Convert static findings to risk inputs
    const staticRiskInputs: RiskInput[] = staticFindings.map(f => ({
      severity: f.severity,
      confidence: 'medium', // rules don't have confidence, default to medium
      category: f.category,
      filePath: f.filePath,
    }));

    // Convert AI findings to risk inputs
    const aiRiskInputs: RiskInput[] = aiFindings.map(f => ({
      severity: f.severity,
      confidence: f.confidence || 'medium',
      category: f.category || '',
      filePath: f.artifactReference || '',
    }));

    // Score all findings
    const allRiskInputs = [...staticRiskInputs, ...aiRiskInputs];
    const scored = scoreFindings(allRiskInputs, artifacts.length);

    // Save AI findings with risk scores
    let savedCount = 0;
    for (let i = 0; i < aiFindings.length; i++) {
      const finding = aiFindings[i];
      const risk = scored[staticRiskInputs.length + i]?.risk;
      await createFinding(session.projectId, session.id, {
        severity: validateSeverity(risk?.level || finding.severity),
        title: finding.title,
        description: finding.description || '',
        category: finding.category || '',
        evidenceText: finding.evidence || '',
        recommendation: finding.recommendation || '',
        confidence: validateConfidence(finding.confidence),
        artifactId: finding.artifactReference || undefined,
        fromRemarks: !!(finding as any).fromRemarks,
      });
      savedCount++;
    }

    const summary = `Review completed. ${savedCount} AI finding(s) + ${staticFindings.length} static finding(s) from ${artifactContents.length} artifact(s).`;
    await updateStaticSessionStatus(session.id, 'success', summary, '');

    // Progress: completed
    const completedSteps = [
      { label: 'Index repository', status: 'done' as const },
      { label: `Retrieve context (${artifactsToAnalyze.length}/${artifacts.length} files)`, status: 'done' as const },
      { label: `Static analysis (${staticFindings.length} findings)`, status: 'done' as const },
      { label: 'AI analysis', status: 'done' as const },
      { label: 'Risk scoring', status: 'done' as const },
    ];
    await emit('completed', summary, completedSteps);

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await updateStaticSessionStatus(session.id, 'failure', '', errorMsg);

    // Progress: failed
    await emit('failed', `Review failed: ${errorMsg}`, [
      { label: 'Review failed', status: 'pending' as const },
    ]);

    throw err;
  }
}
