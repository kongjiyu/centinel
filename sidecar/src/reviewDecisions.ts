/**
 * Review decisions (P0-3).
 *
 * A session-level lifecycle event distinct from per-finding status. The
 * existing `findings.status` field tracks what happened to a single
 * finding; this module tracks what happened to the review as a whole:
 *
 *   - 'approved'         — sign-off; the report can ship
 *   - 'changes_requested' — blocking; new findings or unresolved issues remain
 *   - 'commented'        — non-blocking note, no verdict yet
 *
 * The most recent decision is the "current" one. The full history is
 * preserved so the audit trail shows how the team got there, including
 * back-and-forth between author and reviewer.
 *
 * No auth layer yet — Centinel is single-tenant (one user, one workspace).
 * The `reviewer` field is captured for future use when multi-reviewer
 * support lands, but it's a free-form string for now.
 */

import crypto from 'crypto';
import { getDb, saveDb } from './db.js';

export type ReviewDecision = 'approved' | 'changes_requested' | 'commented';

export type ReviewDecisionAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  createdAt: string;
};

export type ReviewDecisionAttachmentInput = {
  fileName: string;
  mimeType: string;
  content: string;
};

export type ReviewDecisionRecord = {
  id: string;
  sessionId: string;
  projectId: string;
  decision: ReviewDecision;
  comment: string;
  reviewer: string;
  createdAt: string;
  attachments: ReviewDecisionAttachment[];
};

const VALID_DECISIONS: ReadonlySet<ReviewDecision> = new Set([
  'approved',
  'changes_requested',
  'commented',
]);

export function isValidDecision(value: unknown): value is ReviewDecision {
  return typeof value === 'string' && VALID_DECISIONS.has(value as ReviewDecision);
}

function mapRow(row: unknown[]): ReviewDecisionRecord {
  return {
    id: row[0] as string,
    sessionId: row[1] as string,
    projectId: row[2] as string,
    decision: row[3] as ReviewDecision,
    comment: (row[4] as string) ?? '',
    reviewer: (row[5] as string) ?? '',
    createdAt: row[6] as string,
    attachments: [],
  };
}

async function listDecisionAttachments(decisionId: string): Promise<ReviewDecisionAttachment[]> {
  const db = await getDb();
  const stmt = db.prepare(
    `SELECT id, file_name, mime_type, created_at
     FROM review_decision_attachments
     WHERE decision_id = ?
     ORDER BY created_at ASC, id ASC`
  );
  stmt.bind([decisionId]);
  const attachments: ReviewDecisionAttachment[] = [];
  while (stmt.step()) {
    const row = stmt.get() as unknown[];
    attachments.push({ id: row[0] as string, fileName: row[1] as string, mimeType: row[2] as string, createdAt: row[3] as string });
  }
  stmt.free();
  return attachments;
}

export type SubmitDecisionInput = {
  decision: ReviewDecision;
  comment?: string;
  reviewer?: string;
  attachments?: ReviewDecisionAttachmentInput[];
};

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  'text/plain', 'text/markdown', 'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
]);

/**
 * Append a new decision to a session's history. Validates the decision
 * value and trims the optional comment. Returns the persisted record.
 */
export async function submitReviewDecision(
  sessionId: string,
  projectId: string,
  input: SubmitDecisionInput
): Promise<ReviewDecisionRecord> {
  if (!isValidDecision(input.decision)) {
    throw new Error(`Invalid decision: ${String(input.decision)}`);
  }
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const comment = (input.comment ?? '').trim();
  const reviewer = (input.reviewer ?? '').trim();
  const attachments = input.attachments ?? [];
  if (attachments.length > MAX_ATTACHMENTS) throw new Error(`A maximum of ${MAX_ATTACHMENTS} supportive documents can be attached.`);
  for (const attachment of attachments) {
    const fileName = attachment.fileName.trim();
    if (!fileName || fileName.length > 255) throw new Error('Supportive document names must be between 1 and 255 characters.');
    if (!ALLOWED_ATTACHMENT_TYPES.has(attachment.mimeType)) throw new Error(`Unsupported supportive document type: ${attachment.mimeType}`);
    if (!attachment.content || !/^[A-Za-z0-9+/]+={0,2}$/.test(attachment.content)) throw new Error(`Supportive document content is invalid: ${fileName}`);
    if (Math.ceil(attachment.content.length * 3 / 4) > MAX_ATTACHMENT_BYTES) throw new Error(`Supportive document is too large: ${fileName}`);
  }

  db.run(
    `INSERT INTO review_decisions
     (id, session_id, project_id, decision, comment, reviewer, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, sessionId, projectId, input.decision, comment, reviewer, now]
  );
  for (const attachment of attachments) {
    db.run(
      `INSERT INTO review_decision_attachments
       (id, decision_id, session_id, project_id, file_name, mime_type, content_base64, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), id, sessionId, projectId, attachment.fileName.trim(), attachment.mimeType, attachment.content, now]
    );
  }
  saveDb();

  return {
    id,
    sessionId,
    projectId,
    decision: input.decision,
    comment,
    reviewer,
    createdAt: now,
    attachments: await listDecisionAttachments(id),
  };
}

/**
 * Most recent decision for a session, or null if the team has never
 * recorded one. This is the verdict the dashboard shows next to the
 * session row (or, on the session detail view, as a status pill).
 */
export async function getCurrentDecision(
  sessionId: string
): Promise<ReviewDecisionRecord | null> {
  const db = await getDb();
  const stmt = db.prepare(
    `SELECT id, session_id, project_id, decision, comment, reviewer, created_at
     FROM review_decisions
     WHERE session_id = ?
       AND decision != 'commented'
     ORDER BY created_at DESC, id DESC
     LIMIT 1`
  );
  stmt.bind([sessionId]);
  const out = stmt.step() ? mapRow(stmt.get() as unknown[]) : null;
  stmt.free();
  if (out) out.attachments = await listDecisionAttachments(out.id);
  return out;
}

/**
 * Full history of decisions on a session, newest first. Bounded by the
 * caller (the UI typically limits to 10–20 entries for the history
 * dropdown).
 */
export async function listReviewDecisions(
  sessionId: string,
  limit = 50
): Promise<ReviewDecisionRecord[]> {
  const db = await getDb();
  const stmt = db.prepare(
    `SELECT id, session_id, project_id, decision, comment, reviewer, created_at
     FROM review_decisions
     WHERE session_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`
  );
  stmt.bind([sessionId, limit]);
  const out: ReviewDecisionRecord[] = [];
  while (stmt.step()) {
    const decision = mapRow(stmt.get() as unknown[]);
    decision.attachments = await listDecisionAttachments(decision.id);
    out.push(decision);
  }
  stmt.free();
  return out;
}
