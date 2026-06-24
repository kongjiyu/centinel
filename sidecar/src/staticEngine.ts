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

      // Mirror rule-based findings into the unified `findings` table so they
      // surface through /projects/:id/findings and the session detail endpoint.
      // Without this, the dashboard shows "0 findings" while the sidecar log
      // reports static_findings=71 — because /findings only reads from the
      // AI-populated `findings` table, not `static_analysis_results`.
      // We resolve artifact_id by matching finding.filePath (artifact destPath)
      // back to the artifact row so the UI can link each finding to its source.
      const artifact = artifacts.find((a) => a.filePath === finding.filePath);
      const findingId = crypto.randomUUID();
      const title = `[${finding.ruleId}] ${finding.message}`.substring(0, 200);
      const recommendation = generateRuleRecommendation(finding.ruleId, finding.category);
      db.run(
        'INSERT INTO findings (id, project_id, session_id, source, severity, title, description, status, created_at, artifact_id, category, evidence_text, recommendation, confidence, from_remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          findingId,
          projectId,
          sessionId ?? null,
          'static',
          finding.severity,
          title,
          finding.message,
          'new',
          now,
          artifact?.id ?? null,
          finding.category,
          finding.evidence,
          recommendation,
          'high',  // rule-based findings are deterministic
          0,
        ]
      );
    }
    saveDb();
  }

  return allFindings;
}

/**
 * Generate a recommendation string for a rule-based finding.
 * Kept short so it fits in the dashboard's recommendation column without
 * dominating the row. Falls back to a generic message when the ruleId
 * is unrecognized (future-proof for new rules).
 */
function generateRuleRecommendation(ruleId: string, category: string): string {
  const recommendations: Record<string, string> = {
    'secrets-api-key': 'Move the secret to an environment variable or secrets manager. Never commit credentials to source code.',
    'secrets-aws-key': 'Rotate the AWS key immediately and store credentials in AWS Secrets Manager or environment variables.',
    'secrets-private-key': 'Remove the private key from source code. Use a secrets manager or vault.',
    'secrets-connection-string': 'Use environment variables or a secrets manager for database credentials.',
    'secrets-jwt-token': 'Rotate the token. JWTs should not be committed to source code.',
    'secrets-bearer-token': 'Move the bearer token to an environment variable or secrets manager.',
    'cq-todo-comments': 'Address the TODO/FIXME comment or convert it to a tracked ticket before release.',
    'cq-console-log': 'Remove debug output statements or replace with proper structured logging before deployment.',
    'cq-empty-catch': 'Add error handling logic or re-throw the error. Do not silently swallow exceptions.',
    'cq-long-function': 'Break the function into smaller, single-responsibility helpers.',
    'cq-deep-nesting': 'Reduce nesting by extracting logic into helper functions or using early returns.',
    'cq-debugger': 'Remove the debugger statement before deploying to production.',
    'cq-alert': 'Replace alert() with proper UI notifications or structured logging.',
    'sec-eval': 'Replace eval() with safer alternatives like JSON.parse() or a validated Function constructor.',
    'sec-innerhtml': 'Use textContent or sanitize the input to prevent XSS attacks.',
    'sec-sql-injection': 'Use parameterized queries or an ORM to prevent SQL injection.',
    'sec-disabled-headers': 'Enable proper security headers (CSP, HSTS, X-Frame-Options) to protect against common attacks.',
    'sec-hardcoded-url-creds': 'Move credentials to environment variables or a secrets manager.',
    'sec-math-random': 'Use crypto.randomBytes() or crypto.randomUUID() instead of Math.random() for security-sensitive values.',
  };
  return recommendations[ruleId] ?? `Review and address this ${category.replace(/_/g, ' ')} finding.`;
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
