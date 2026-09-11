import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, saveDb } from './db.js';

/**
 * Seed a deterministic, clearly named development fixture. This command is
 * opt-in (`pnpm --filter @centinel/sidecar seed:mock`) and never runs during
 * application startup, so mock evidence cannot silently enter a real workspace.
 */
const projectId = '11111111-1111-4111-8111-111111111111';
const pendingReviewId = '22222222-2222-4222-8222-222222222222';
const completedReviewId = '33333333-3333-4333-8333-333333333333';
const requirementOneId = '44444444-4444-4444-8444-444444444444';
const requirementTwoId = '55555555-5555-4555-8555-555555555555';
const sourceOneId = '66666666-6666-4666-8666-666666666666';
const sourceTwoId = '77777777-7777-4777-8777-777777777777';
const findingOneId = '88888888-8888-4888-8888-888888888888';
const findingTwoId = '99999999-9999-4999-8999-999999999999';

const root = path.resolve(process.cwd(), 'data', 'mock-centinel-project');
const now = '2026-09-11T06:30:00.000Z';

function progress(stages: Array<{ id: string; label: string; status: string; summary: string; evidence: string[] }>) {
  return JSON.stringify({
    currentStage: stages.at(-1)?.id ?? 'summarizing',
    startedAt: '2026-09-11T06:00:00.000Z',
    updatedAt: now,
    stages: stages.map(stage => ({ ...stage, thoughts: [], details: { evidence: stage.evidence } })),
  });
}

export async function seedMockProject() {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'requirements.md'), '# Checkout requirements\n\nThe checkout flow must validate a payment before creating an order.\n', 'utf8');
  fs.writeFileSync(path.join(root, 'checkout.ts'), 'export function createOrder(payment: Payment) { return payment.valid ? persistOrder(payment) : null; }\n', 'utf8');

  const db = await getDb();
  // Remove only this fixture's stable records so rerunning the command is safe.
  db.run('DELETE FROM requirement_mappings WHERE requirement_id IN (?, ?)', [requirementOneId, requirementTwoId]);
  db.run('DELETE FROM requirements WHERE id IN (?, ?)', [requirementOneId, requirementTwoId]);
  db.run('DELETE FROM review_decisions WHERE session_id IN (?, ?)', [pendingReviewId, completedReviewId]);
  db.run('DELETE FROM findings WHERE id IN (?, ?)', [findingOneId, findingTwoId]);
  db.run('DELETE FROM artifacts WHERE id IN (?, ?)', [sourceOneId, sourceTwoId]);
  db.run('DELETE FROM static_sessions WHERE id IN (?, ?)', [pendingReviewId, completedReviewId]);
  db.run('DELETE FROM projects WHERE id = ?', [projectId]);

  db.run(
    'INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [projectId, 'Mock Checkout Workspace', 'Deterministic review workflow fixture for UI verification.', root, '2026-09-10T08:00:00.000Z', now],
  );
  db.run(
    'INSERT INTO artifacts (id, project_id, type, file_name, file_path, original_path, content_hash, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [sourceOneId, projectId, 'requirement', 'requirements.md', path.join(root, 'requirements.md'), path.join(root, 'requirements.md'), 'mock-requirements-hash', 'documents', '2026-09-10T08:15:00.000Z'],
  );
  db.run(
    'INSERT INTO artifacts (id, project_id, type, file_name, file_path, original_path, content_hash, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [sourceTwoId, projectId, 'source_code', 'checkout.ts', path.join(root, 'checkout.ts'), path.join(root, 'checkout.ts'), 'mock-checkout-hash', 'repository', '2026-09-10T08:20:00.000Z'],
  );
  db.run(
    'INSERT INTO requirements (id, project_id, title, description, category, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [requirementOneId, projectId, 'Validate payment before order creation', 'A payment must be validated before an order is persisted.', 'Checkout', 'high', '2026-09-10T08:30:00.000Z'],
  );
  db.run(
    'INSERT INTO requirements (id, project_id, title, description, category, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [requirementTwoId, projectId, 'Keep payment failure recoverable', 'Invalid payments should return a recoverable validation result.', 'Checkout', 'medium', '2026-09-10T08:35:00.000Z'],
  );
  db.run('INSERT INTO requirement_mappings (id, requirement_id, file_id, symbol_id, coverage_status, confidence) VALUES (?, ?, ?, ?, ?, ?)', ['aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', requirementOneId, sourceTwoId, null, 'covered', 0.96]);
  db.run('INSERT INTO requirement_mappings (id, requirement_id, file_id, symbol_id, coverage_status, confidence) VALUES (?, ?, ?, ?, ?, ?)', ['aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2', requirementTwoId, sourceOneId, null, 'partial', 0.74]);

  const stageData = [
    { id: 'understanding_context', label: 'Source readiness check', status: 'done', summary: 'Read the requirement and repository sources.', evidence: ['requirements.md', 'checkout.ts'] },
    { id: 'code_review', label: 'Facts gathering', status: 'done', summary: 'Collected payment validation and order persistence facts.', evidence: ['checkout.ts'] },
    { id: 'requirement_validation', label: 'Connecting facts', status: 'done', summary: 'Connected the checkout requirements to source evidence.', evidence: ['requirements.md', 'checkout.ts'] },
    { id: 'summarizing', label: 'Reviewing', status: 'done', summary: 'Prepared findings for reviewer approval.', evidence: ['checkout.ts'] },
  ];
  const config = JSON.stringify({ instructions: 'Verify the checkout payment validation flow.', reviewMode: 'regular', reviewer: 'Project owner', supportiveDocuments: [{ id: sourceOneId, name: 'requirements.md' }] });
  db.run(
    'INSERT INTO static_sessions (id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at, base_ref, head_ref, changed_files_json, parent_session_id, review_diff_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [pendingReviewId, projectId, 'Checkout approval review', 'code_review', 'success', config, progress(stageData), 'Verify the checkout payment validation flow.', 'Review completed and is waiting for a human approval decision.', '', '2026-09-11T06:00:00.000Z', now, '', '', '[]', '', ''],
  );
  db.run(
    'INSERT INTO static_sessions (id, project_id, name, review_type, status, config_json, progress_json, remarks, final_summary, failure_reason, created_at, updated_at, base_ref, head_ref, changed_files_json, parent_session_id, review_diff_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [completedReviewId, projectId, 'Checkout baseline review', 'code_review', 'success', config, progress(stageData), 'Verify the checkout payment validation flow.', 'Approved review with one resolved and one unresolved observation.', '', '2026-09-10T09:00:00.000Z', '2026-09-10T09:18:00.000Z', '', '', '[]', '', ''],
  );
  const insertFinding = (id: string, sessionId: string, severity: string, title: string, description: string, status: string, line: number) => db.run(
    'INSERT INTO findings (id, project_id, session_id, source, severity, title, description, status, created_at, artifact_id, category, evidence_text, recommendation, confidence, from_remarks, file_path, line_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, projectId, sessionId, 'static', severity, title, description, status, now, sourceTwoId, 'security', 'The source validates the result in one branch but does not guard persistence consistently.', 'Return a clear validation result before persisting the order.', 'high', 0, path.join(root, 'checkout.ts'), line],
  );
  insertFinding(findingOneId, pendingReviewId, 'high', 'Payment validation can be bypassed', 'Order creation should not continue when the payment result is invalid.', 'new', 1);
  insertFinding(findingTwoId, completedReviewId, 'medium', 'Validation feedback is difficult to recover', 'The invalid payment path should return a user-actionable validation result.', 'fixed', 1);
  db.run(
    'INSERT INTO review_decisions (id, session_id, project_id, decision, comment, reviewer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1', completedReviewId, projectId, 'approved', 'Evidence reviewed and baseline accepted.', 'Project owner', '2026-09-10T09:20:00.000Z'],
  );
  saveDb();
  console.log(`Seeded mock project ${projectId} at ${root}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void seedMockProject().catch(error => { console.error(error); process.exitCode = 1; });
}
