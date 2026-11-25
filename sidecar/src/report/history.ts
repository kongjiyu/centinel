import type { SupabaseClient } from '@supabase/supabase-js';
import { REPORT_BUCKET, REPORT_SIGNED_URL_TTL_SECONDS } from './storage.js';
import type { ProjectReportSnapshot, ReportChecksums } from './types.js';

type Row = Record<string, unknown>;

function table(client: SupabaseClient, name: string): any {
  return (client as any).from(name);
}

function row(value: unknown): Row {
  return value && typeof value === 'object' ? value as Row : {};
}

function text(value: unknown, fallback = ''): string {
  return value == null ? fallback : String(value);
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message ?? '');
  return String(error ?? '');
}

export type ReportHistoryEntry = {
  id: string;
  projectId: string;
  actorId: string | null;
  policyVersion: string;
  generatorVersion: string;
  snapshot: ProjectReportSnapshot;
  checksum: string | null;
  createdAt: string;
  storage: {
    json: string | null;
    markdown: string | null;
    pdf: string | null;
  };
};

export type ReportDownloadLinks = {
  reportId: string;
  expiresAt: string;
  downloads: { json: string; markdown: string; pdf: string };
};

async function requireMember(client: SupabaseClient, projectId: string): Promise<void> {
  const result = await table(client, 'projects').select('id').eq('id', projectId).maybeSingle();
  if (result.error) throw new Error(`Report authorization failed: ${errorMessage(result.error)}`);
  if (!result.data) throw new Error(`You do not have access to project ${projectId}.`);
}

function mapHistory(value: unknown): ReportHistoryEntry {
  const source = row(value);
  const snapshot = (source.snapshot && typeof source.snapshot === 'object' ? source.snapshot : {}) as ProjectReportSnapshot;
  return {
    id: text(source.id), projectId: text(source.project_id), actorId: source.actor_id == null ? null : String(source.actor_id),
    policyVersion: text(source.policy_version), generatorVersion: text(source.generator_version), snapshot,
    checksum: source.checksum == null ? null : String(source.checksum), createdAt: text(source.created_at),
    storage: { json: source.json_storage_path == null ? null : String(source.json_storage_path), markdown: source.markdown_storage_path == null ? null : String(source.markdown_storage_path), pdf: source.pdf_storage_path == null ? null : String(source.pdf_storage_path) },
  };
}

/** List immutable exports visible through the caller's project-membership RLS. */
export async function listProjectReportHistory(client: SupabaseClient, projectId: string, options: { limit?: number } = {}): Promise<ReportHistoryEntry[]> {
  await requireMember(client, projectId);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const result = await table(client, 'report_exports').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(limit);
  if (result.error) throw new Error(`Report history query failed: ${errorMessage(result.error)}`);
  return (Array.isArray(result.data) ? result.data : []).map(mapHistory);
}

export async function getProjectReportHistoryEntry(client: SupabaseClient, projectId: string, reportId: string): Promise<ReportHistoryEntry | null> {
  await requireMember(client, projectId);
  const result = await table(client, 'report_exports').select('*').eq('project_id', projectId).eq('id', reportId).maybeSingle();
  if (result.error) throw new Error(`Report history query failed: ${errorMessage(result.error)}`);
  return result.data ? mapHistory(result.data) : null;
}

async function sign(client: SupabaseClient, path: string, downloadName: string): Promise<string> {
  const result = await client.storage.from(REPORT_BUCKET).createSignedUrl(path, REPORT_SIGNED_URL_TTL_SECONDS, { download: downloadName });
  if (result.error || !result.data?.signedUrl) throw new Error(`Report download link could not be created: ${errorMessage(result.error)}`);
  return result.data.signedUrl;
}

/** Regenerate short-lived links for an existing immutable report package. */
export async function renewProjectReportLinks(client: SupabaseClient, projectId: string, reportId: string): Promise<ReportDownloadLinks> {
  await requireMember(client, projectId);
  const result = await table(client, 'report_exports').select('*').eq('project_id', projectId).eq('id', reportId).maybeSingle();
  if (result.error) throw new Error(`Report lookup failed: ${errorMessage(result.error)}`);
  if (!result.data) throw new Error('Report export not found.');
  const source = row(result.data);
  const snapshot = (source.snapshot && typeof source.snapshot === 'object' ? source.snapshot : {}) as ProjectReportSnapshot;
  const outputFiles = snapshot.metadata?.outputFiles ?? { json: 'snapshot.json', markdown: 'report.md', pdf: 'report.pdf' };
  const jsonPath = source.json_storage_path == null ? `${projectId}/${reportId}/${outputFiles.json}` : String(source.json_storage_path);
  const markdownPath = source.markdown_storage_path == null ? `${projectId}/${reportId}/${outputFiles.markdown}` : String(source.markdown_storage_path);
  const pdfPath = source.pdf_storage_path == null ? `${projectId}/${reportId}/${outputFiles.pdf}` : String(source.pdf_storage_path);
  const signedAt = Date.now();
  const [json, markdown, pdf] = await Promise.all([
    sign(client, jsonPath, outputFiles.json), sign(client, markdownPath, outputFiles.markdown), sign(client, pdfPath, outputFiles.pdf),
  ]);
  return { reportId, expiresAt: new Date(signedAt + REPORT_SIGNED_URL_TTL_SECONDS * 1000).toISOString(), downloads: { json, markdown, pdf } };
}

/** Aliases keep the backend seam discoverable for route adapters. */
export const listReportHistory = listProjectReportHistory;
export const regenerateReportLinks = renewProjectReportLinks;

export type { ReportChecksums };

