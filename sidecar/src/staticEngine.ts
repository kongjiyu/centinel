import crypto from 'crypto';
import { getDb, saveDb } from './db.js';
import { readArtifactContent, type Artifact } from './artifacts.js';

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

export type StaticFinding = {
  id: string;
  projectId: string;
  sessionId: string | null;
  filePath: string;
  lineNumber: number;
  ruleId: string;
  severity: string;
  category: string;
  message: string;
  evidence: string;
  createdAt: string;
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
 * Stores findings in the static_analysis_results table.
 * Returns the collected findings.
 */
export async function runStaticAnalysis(
  projectId: string,
  artifacts: Artifact[],
  sessionId?: string
): Promise<Finding[]> {
  const allFindings: Finding[] = [];

  for (const artifact of artifacts) {
    const ext = getExtension(artifact.fileName);

    // Find rules applicable to this file extension
    const applicableRules = allRules.filter(rule =>
      rule.filePatterns.some(fp => fp.toLowerCase() === ext.toLowerCase())
    );

    if (applicableRules.length === 0) continue;

    // Read file content
    let content: string;
    try {
      content = await readArtifactContent(artifact.id);
    } catch {
      // Skip unreadable artifacts
      continue;
    }

    // Run each applicable rule
    for (const rule of applicableRules) {
      const findings = rule.analyze(content, artifact.filePath);
      allFindings.push(...findings);
    }
  }

  // Store findings in database
  if (allFindings.length > 0) {
    const db = await getDb();
    const now = new Date().toISOString();

    for (const finding of allFindings) {
      const id = crypto.randomUUID();
      db.run(
        'INSERT INTO static_analysis_results (id, project_id, session_id, file_path, line_number, rule_id, severity, category, message, evidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          projectId,
          sessionId ?? null,
          finding.filePath,
          finding.lineNumber,
          finding.ruleId,
          finding.severity,
          finding.category,
          finding.message,
          finding.evidence,
          now,
        ]
      );
    }
    saveDb();
  }

  return allFindings;
}

/**
 * Retrieve stored static analysis findings for a project.
 * Optionally filter by session ID.
 */
export async function getStaticFindings(
  projectId: string,
  sessionId?: string
): Promise<StaticFinding[]> {
  const db = await getDb();
  let stmt;

  if (sessionId) {
    stmt = db.prepare(
      'SELECT id, project_id, session_id, file_path, line_number, rule_id, severity, category, message, evidence, created_at FROM static_analysis_results WHERE project_id = ? AND session_id = ? ORDER BY created_at DESC'
    );
    stmt.bind([projectId, sessionId]);
  } else {
    stmt = db.prepare(
      'SELECT id, project_id, session_id, file_path, line_number, rule_id, severity, category, message, evidence, created_at FROM static_analysis_results WHERE project_id = ? ORDER BY created_at DESC'
    );
    stmt.bind([projectId]);
  }

  const rows: StaticFinding[] = [];
  while (stmt.step()) {
    const row = stmt.get() as unknown[];
    rows.push({
      id: row[0] as string,
      projectId: row[1] as string,
      sessionId: row[2] as string | null,
      filePath: row[3] as string,
      lineNumber: row[4] as number,
      ruleId: row[5] as string,
      severity: row[6] as string,
      category: row[7] as string,
      message: row[8] as string,
      evidence: row[9] as string,
      createdAt: row[10] as string,
    });
  }
  stmt.free();
  return rows;
}

/**
 * Clear all stored static analysis findings for a project.
 */
export async function clearStaticFindings(projectId: string): Promise<void> {
  const db = await getDb();
  db.run('DELETE FROM static_analysis_results WHERE project_id = ?', [projectId]);
  saveDb();
}

// --- Helpers ---

function getExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) return '';
  return fileName.substring(dotIndex).toLowerCase();
}
