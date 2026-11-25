import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProjectReportRenderings, ProjectReportSnapshot, ReportChecksums } from './types.js';

export const REPORT_BUCKET = 'project-reports';
export const REPORT_SIGNED_URL_TTL_SECONDS = 15 * 60;

export class ReportPersistenceError extends Error {
  readonly cleanupIncomplete: boolean;

  constructor(cleanupIncomplete: boolean) {
    super(cleanupIncomplete
      ? 'Report storage failed and cleanup could not be confirmed. Check report storage before retrying.'
      : 'Report could not be stored. No report was published; retry when storage is available.');
    this.name = 'ReportPersistenceError';
    this.cleanupIncomplete = cleanupIncomplete;
  }
}

export function sha256(bytes: string | Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function makeReportChecksums(rendered: ProjectReportRenderings): ReportChecksums {
  const snapshot = Buffer.from(rendered.json, 'utf8');
  const markdown = Buffer.from(rendered.markdown, 'utf8');
  const pdf = rendered.pdf;
  const snapshotHash = sha256(snapshot);
  const markdownHash = sha256(markdown);
  const pdfHash = sha256(pdf);
  const packageHash = sha256(
    'json:' + snapshotHash + '\nmarkdown:' + markdownHash + '\npdf:' + pdfHash,
  );
  return { snapshot: snapshotHash, markdown: markdownHash, pdf: pdfHash, package: packageHash };
}

function safeMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message: unknown }).message ?? '');
    return message.slice(0, 300);
  }
  return String(error ?? '').slice(0, 300);
}

async function cleanup(client: SupabaseClient, reportId: string, objectPaths: string[], removeRecord: boolean): Promise<boolean> {
  let failed = false;
  if (removeRecord) {
    try {
      const result = await client.from('report_exports').delete().eq('id', reportId);
      if (result.error) failed = true;
    } catch {
      failed = true;
    }
  }
  if (objectPaths.length) {
    try {
      const result = await client.storage.from(REPORT_BUCKET).remove(objectPaths);
      if (result.error) failed = true;
    } catch {
      failed = true;
    }
  }
  return failed;
}

async function upload(
  client: SupabaseClient,
  objectPath: string,
  content: Buffer,
  contentType: string,
): Promise<void> {
  const result = await client.storage.from(REPORT_BUCKET).upload(objectPath, content, {
    contentType,
    cacheControl: '3600',
    upsert: false,
  });
  if (result.error) throw new Error('Private report object upload failed: ' + safeMessage(result.error));
}

async function signedUrl(client: SupabaseClient, objectPath: string, downloadName: string): Promise<string> {
  const result = await client.storage.from(REPORT_BUCKET).createSignedUrl(
    objectPath,
    REPORT_SIGNED_URL_TTL_SECONDS,
    { download: downloadName },
  );
  if (result.error || !result.data?.signedUrl) {
    throw new Error('Private report download link could not be created: ' + safeMessage(result.error));
  }
  return result.data.signedUrl;
}

export type PersistedReportPackage = {
  reportId: string;
  createdAt: string;
  expiresAt: string;
  downloads: {
    json: string;
    markdown: string;
    pdf: string;
  };
  checksums: ReportChecksums;
};

/** Upload immutable objects, commit one row, then create short-lived URLs. */
export async function persistReportPackage(
  client: SupabaseClient,
  snapshot: ProjectReportSnapshot,
  rendered: ProjectReportRenderings,
): Promise<PersistedReportPackage> {
  const reportId = snapshot.metadata.reportId;
  const basePath = snapshot.project.id + '/' + reportId;
  const paths = {
    json: basePath + '/' + snapshot.metadata.outputFiles.json,
    markdown: basePath + '/' + snapshot.metadata.outputFiles.markdown,
    pdf: basePath + '/' + snapshot.metadata.outputFiles.pdf,
  };
  const uploadedPaths: string[] = [];
  let recordInserted = false;
  const checksums = makeReportChecksums(rendered);
  const createdAt = snapshot.metadata.generatedAt;

  try {
    const files = [
      [paths.json, Buffer.from(rendered.json, 'utf8'), 'application/json'],
      [paths.markdown, Buffer.from(rendered.markdown, 'utf8'), 'text/markdown; charset=utf-8'],
      [paths.pdf, rendered.pdf, 'application/pdf'],
    ] as const;
    for (const [objectPath, content, contentType] of files) {
      await upload(client, objectPath, content, contentType);
      // Only remove objects the caller confirmed it created; never let a
      // path collision cause cleanup to delete somebody else's immutable file.
      uploadedPaths.push(objectPath);
    }

    const saved = await client.from('report_exports').insert({
      id: reportId,
      project_id: snapshot.project.id,
      actor_id: snapshot.metadata.actorId,
      policy_version: snapshot.metadata.riskPolicyVersion,
      generator_version: snapshot.metadata.generatorVersion,
      snapshot,
      markdown_storage_path: paths.markdown,
      json_storage_path: paths.json,
      pdf_storage_path: paths.pdf,
      object_paths: paths,
      checksum: checksums.package,
      created_at: createdAt,
    }).select('id, created_at').single();
    if (saved.error || !saved.data) {
      throw new Error('Private report record insert failed: ' + safeMessage(saved.error));
    }
    recordInserted = true;

    const signedAt = Date.now();
    const [jsonUrl, markdownUrl, pdfUrl] = await Promise.all([
      signedUrl(client, paths.json, snapshot.metadata.outputFiles.json),
      signedUrl(client, paths.markdown, snapshot.metadata.outputFiles.markdown),
      signedUrl(client, paths.pdf, snapshot.metadata.outputFiles.pdf),
    ]);
    const savedRow = saved.data as Record<string, unknown>;
    return {
      reportId,
      createdAt: typeof savedRow.created_at === 'string' ? savedRow.created_at : createdAt,
      expiresAt: new Date(signedAt + REPORT_SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
      downloads: { json: jsonUrl, markdown: markdownUrl, pdf: pdfUrl },
      checksums,
    };
  } catch (error) {
    const cleanupIncomplete = await cleanup(client, reportId, uploadedPaths, recordInserted);
    if (error instanceof ReportPersistenceError) throw error;
    throw new ReportPersistenceError(cleanupIncomplete);
  }
}
