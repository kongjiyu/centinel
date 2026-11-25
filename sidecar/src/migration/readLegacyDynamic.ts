import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { legacyEvidenceImageType, legacyEvidenceMaxBytes, type LegacyDynamicSnapshot } from '../dynamic/localLegacyHistory.js';
import type { DynamicEvidence, DynamicSession } from '../dynamicSessions.js';

const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const contained = (root: string, file: string) => {
  const child = relative(root, file);
  return Boolean(child && !isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep));
};

function readLegacyFile(workspace: string, session: string, filename: string): Buffer | null {
  if (!uuid.test(session) || !isAbsolute(workspace) || !isAbsolute(filename)) return null;
  let descriptor: number | undefined;
  try {
    const root = realpathSync(workspace);
    const resolvedSession = realpathSync(join(root, 'sessions', session));
    const location = realpathSync(filename);
    if (relative(root, resolvedSession) !== join('sessions', session) || !contained(resolvedSession, location) || !lstatSync(filename).isFile()) return null;
    descriptor = openSync(location, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 1 || stat.size > legacyEvidenceMaxBytes) {
      throw new Error('Legacy Dynamic evidence exceeds the supported byte limit or is empty.');
    }
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const read = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (!read) break;
      offset += read;
    }
    if (offset !== stat.size || fstatSync(descriptor).mtimeMs !== stat.mtimeMs) {
      throw new Error('Legacy Dynamic evidence changed during import.');
    }
    return bytes.subarray(0, offset);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if ((error as NodeJS.ErrnoException).code) throw new Error('Legacy Dynamic evidence could not be read from its session directory.');
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** The legacy database predates account IDs. Import only the selected project's rows into its authorized staging snapshot. */
export function readLegacyDynamic(database: string, project: string): LegacyDynamicSnapshot {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    db.exec('BEGIN');
    const saved = db.prepare('SELECT workspace_path FROM projects WHERE id = ?').get(project);
    if (!saved) throw new Error('The selected project is absent from the legacy Dynamic database.');
    const sessions: DynamicSession[] = db.prepare(`SELECT s.*, d.target_url, d.goal, d.mission_type, d.max_steps, d.final_summary, d.failure_reason
      FROM sessions s JOIN dynamic_session_details d ON d.session_id = s.id
      WHERE s.project_id = ? AND s.type = 'dynamic' ORDER BY s.id`).all(project).map(row => ({
      id: String(row.id), projectId: project, type: 'dynamic', name: String(row.name), status: row.status as DynamicSession['status'],
      targetUrl: String(row.target_url), goal: String(row.goal), missionType: row.mission_type as DynamicSession['missionType'], browserMode: 'headed',
      maxSteps: Number(row.max_steps), finalSummary: String(row.final_summary ?? ''), failureReason: String(row.failure_reason ?? ''),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }));
    const evidence = db.prepare(`SELECT e.* FROM evidence e JOIN sessions s ON s.id = e.session_id AND s.project_id = e.project_id
      WHERE e.project_id = ? AND s.type = 'dynamic' ORDER BY e.id`).all(project).map(row => {
      const type = row.type as DynamicEvidence['type'];
      const sessionId = String(row.session_id);
      const bytes = readLegacyFile(String(saved.workspace_path), sessionId, String(row.file_path));
      return {
        id: String(row.id), sessionId, type, summary: String(row.summary ?? ''), createdAt: String(row.created_at),
        ...(bytes ? { file: { sha256: createHash('sha256').update(bytes).digest('hex'), contentBase64: bytes.toString('base64'),
          imageType: type === 'screenshot' ? legacyEvidenceImageType(bytes) : undefined } } : {}),
      };
    });
    return { sessions, actions: [], evidence };
  } finally {
    db.close();
  }
}

export function mergeLegacyDynamic(hosted: LegacyDynamicSnapshot | undefined, local: LegacyDynamicSnapshot): LegacyDynamicSnapshot {
  if (!hosted) return local;
  const sessions = new Map(local.sessions.map(item => [item.id, item]));
  for (const item of hosted.sessions) sessions.set(item.id, item);
  const evidence = new Map(local.evidence.map(item => [item.id, item]));
  for (const item of hosted.evidence) {
    const existing = evidence.get(item.id);
    if (existing && (existing.sessionId !== item.sessionId || existing.type !== item.type
      || existing.file && item.file && existing.file.sha256 !== item.file.sha256)) {
      throw new Error('Hosted and on-device legacy evidence disagree for the same saved ID.');
    }
    evidence.set(item.id, { ...item, file: item.file ?? existing?.file });
  }
  return { sessions: [...sessions.values()], actions: hosted.actions, evidence: [...evidence.values()] };
}
