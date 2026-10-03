import crypto from 'node:crypto';
import { createSupabaseClient, getSupabaseUserId } from './supabase.js';
import { buildProjectReportSnapshot } from './report/snapshot.js';
import { createSupabaseReportSnapshotSource } from './report/supabaseSnapshot.js';
import { canonicalJson } from './report/canonical.js';
import { renderProjectReportMarkdown } from './report/markdown.js';
import { renderProjectReportPdf } from './report/pdf.js';
import { persistReportPackage } from './report/storage.js';
import type {
  ProjectReportExportResult,
  ProjectReportRenderings,
  ProjectReportSnapshot,
  SnapshotContext,
} from './report/types.js';

export type {
  ProjectReportExportResult,
  ProjectReportFinding,
  ProjectReportSnapshot,
  ProjectReportRenderings,
  ReportChecksums,
} from './report/types.js';
export { buildProjectReportSnapshot, canonicalJson };

/** Compatibility renderer; all export formats are derived from the same snapshot. */
export function renderProjectReport(snapshot: ProjectReportSnapshot): string {
  return renderProjectReportMarkdown(snapshot);
}

export function renderProjectReportJson(snapshot: ProjectReportSnapshot): string {
  return canonicalJson(snapshot);
}

export async function renderProjectReportFiles(snapshot: ProjectReportSnapshot): Promise<ProjectReportRenderings> {
  const json = renderProjectReportJson(snapshot);
  const markdown = renderProjectReportMarkdown(snapshot);
  const pdf = await renderProjectReportPdf(snapshot);
  return { json, markdown, pdf };
}

function reportContext(actorId: string): Omit<SnapshotContext, 'source'> {
  const reportId = crypto.randomUUID();
  const generatedAt = new Date().toISOString();
  return {
    reportId,
    actorId,
    generatedAt,
    outputFiles: { json: 'snapshot.json', markdown: 'report.md', pdf: 'report.pdf' },
  };
}

function resultBase(snapshot: ProjectReportSnapshot, markdown: string, checksums: ProjectReportExportResult['checksums']): Omit<ProjectReportExportResult, 'storage' | 'downloads' | 'expiresAt'> {
  return {
    reportId: snapshot.metadata.reportId,
    generatedAt: snapshot.metadata.generatedAt,
    generatorVersion: snapshot.metadata.generatorVersion,
    riskPolicyVersion: snapshot.metadata.riskPolicyVersion,
    markdown,
    checksums,
  };
}

/** Persist private, immutable report objects and return only short-lived links. */
export async function generateProjectReport(
  projectId: string,
  actorId: string | null,
  accessToken?: string | null,
): Promise<ProjectReportExportResult> {
  const client = createSupabaseClient(accessToken);
  if (!client) throw new Error('Supabase is required for private report export.');

  const authenticatedUserId = actorId ?? (accessToken ? await getSupabaseUserId(accessToken) : null);
  if (!authenticatedUserId) throw new Error('An authenticated Supabase user is required for private report export.');
  const snapshot = await buildProjectReportSnapshot(projectId, {
    ...reportContext(authenticatedUserId),
    source: createSupabaseReportSnapshotSource(client, authenticatedUserId),
  });
  const rendered = await renderProjectReportFiles(snapshot);
  const persisted = await persistReportPackage(client, snapshot, rendered);
  return {
    ...resultBase(snapshot, rendered.markdown, persisted.checksums),
    storage: 'private-supabase',
    expiresAt: persisted.expiresAt,
    downloads: persisted.downloads,
  };
}
