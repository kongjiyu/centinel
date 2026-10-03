import type { Artifact } from './artifacts.js';

// --- Types ---

export type Rule = {
  id: string;
  name: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  description: string;
  filePatterns: string[];
  analyze: (content: string, filePath: string) => Finding[];
};

export type Finding = {
  ruleId: string;
  filePath: string;
  lineNumber: number;
  severity: string;
  category: string;
  message: string;
  evidence: string;
};

export type StaticAnalysisOptions = {
  /** Abort between artifact and rule work. */
  signal?: AbortSignal;
  /** Authenticated frozen-content reader. Persistence belongs to the Review repository. */
  contentReader: (artifact: Artifact, signal?: AbortSignal) => Promise<string>;
};

// --- Import all rules ---

import secretsRules from './rules/secrets.js';
import codeQualityRules from './rules/codeQuality.js';
import securityRules from './rules/security.js';

const allRules: Rule[] = [...secretsRules, ...codeQualityRules, ...securityRules];

/**
 * Get all registered rules, optionally filtered by category.
 */
export function getRules(category?: string): Rule[] {
  if (!category) return [...allRules];
  return allRules.filter(r => r.category === category);
}

/**
 * Run static analysis on a set of artifacts for a project.
 * Applies all applicable rules based on file extension matching.
 * Returns findings for the Review orchestrator to normalize and persist in
 * Supabase. The analyzer has no local-file or SQLite execution path.
 */
export async function runStaticAnalysis(
  projectId: string,
  artifacts: Artifact[],
  sessionId: string,
  options: StaticAnalysisOptions,
): Promise<Finding[]> {
  const allFindings: Finding[] = [];

  const checkCancelled = () => {
    if (options.signal?.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }
  };

  for (const artifact of artifacts) {
    checkCancelled();
    const ext = getExtension(artifact.fileName);

    // Find rules applicable to this file extension
    const applicableRules = allRules.filter(rule =>
      rule.filePatterns.some(fp => fp.toLowerCase() === ext.toLowerCase())
    );

    if (applicableRules.length === 0) continue;

    // Read file content
    let content: string;
    try {
      content = await options.contentReader(artifact, options.signal);
    } catch (error) {
      // Skip unreadable artifacts
      if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
      continue;
    }

    // Run each applicable rule
    for (const rule of applicableRules) {
      checkCancelled();
      const findings = rule.analyze(content, artifact.filePath);
      allFindings.push(...findings);
    }
  }

  // Per-rule and per-file breakdown — logged so the user can see which rules
  // actually fired (and which ones matched ZERO files). Without this, a "0
  // findings" completion log is indistinguishable from "code is clean" vs.
  // "rules never matched the file extensions".
  const byRule: Record<string, number> = {};
  const byFile: Record<string, number> = {};
  for (const f of allFindings) {
    byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1;
    byFile[f.filePath] = (byFile[f.filePath] ?? 0) + 1;
  }
  console.info(
    `[static-analysis] session=${sessionId ?? 'none'} artifacts=${artifacts.length} ` +
    `rules=${allRules.length} findings=${allFindings.length} ` +
    `by_rule=${JSON.stringify(byRule)} by_file=${JSON.stringify(byFile)}`
  );


  return allFindings;
}


// --- Helpers ---

function getExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) return '';
  return fileName.substring(dotIndex).toLowerCase();
}
