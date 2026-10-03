import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { persistReportPackage, ReportPersistenceError, makeReportChecksums, REPORT_BUCKET, REPORT_SIGNED_URL_TTL_SECONDS } from '../../src/report/storage';
import type { ProjectReportRenderings, ProjectReportSnapshot } from '../../src/report/types';

const snapshot = {
  metadata: {
    schemaVersion: 'centinel-project-report-v1',
    reportId: 'report-1',
    generatedAt: '2026-09-21T00:00:00.000Z',
    actorId: 'user-1',
    generatorVersion: 'project-report-v3',
    riskPolicyVersion: 'centinel-risk-v1',
    outputFiles: { json: 'snapshot.json', markdown: 'report.md', pdf: 'report.pdf' },
  },
  project: { id: 'project-1' },
} as ProjectReportSnapshot;

const renderings: ProjectReportRenderings = {
  json: '{"snapshot":"same"}\n',
  markdown: '# Same snapshot\n',
  pdf: Buffer.from('%PDF-1.7 representative'),
};

function createClient(options: {
  uploadErrorAt?: number;
  insertError?: boolean;
  signedUrlError?: boolean;
  cleanupError?: boolean;
} = {}) {
  let uploadNumber = 0;
  const upload = vi.fn(async (objectPath: string) => {
    uploadNumber += 1;
    if (options.uploadErrorAt === uploadNumber) return { data: null, error: { message: 'upload rejected' } };
    return { data: { path: objectPath }, error: null };
  });
  const remove = vi.fn(async () => ({ data: null, error: options.cleanupError ? { message: 'cleanup rejected' } : null }));
  const createSignedUrl = vi.fn(async (objectPath: string) => {
    if (options.signedUrlError && objectPath.endsWith('/report.pdf')) return { data: null, error: { message: 'sign rejected' } };
    return { data: { signedUrl: 'https://signed.example.test/' + objectPath }, error: null };
  });
  const single = vi.fn(async () => options.insertError
    ? { data: null, error: { message: 'insert rejected' } }
    : { data: { id: 'report-1', created_at: snapshot.metadata.generatedAt }, error: null });
  const insertBuilder = { select: vi.fn(() => insertBuilder), single };
  const eq = vi.fn(async () => ({ data: null, error: options.cleanupError ? { message: 'delete rejected' } : null }));
  const deleteBuilder = { eq };
  const query = {
    insert: vi.fn(() => insertBuilder),
    delete: vi.fn(() => deleteBuilder),
  };
  const storageBucket = { upload, remove, createSignedUrl };
  const client = {
    from: vi.fn(() => query),
    storage: { from: vi.fn(() => storageBucket) },
  } as unknown as SupabaseClient;
  return { client, upload, remove, createSignedUrl, single, eq, query };
}

describe('private report package persistence', () => {
  it('uploads all immutable formats, stores snapshot metadata, signs downloads, and checksums each file', async () => {
    const fake = createClient();
    const result = await persistReportPackage(fake.client, snapshot, renderings);

    expect(fake.upload).toHaveBeenCalledTimes(3);
    expect(fake.upload).toHaveBeenNthCalledWith(1, 'project-1/report-1/snapshot.json', expect.any(Buffer), expect.objectContaining({ contentType: 'application/json', upsert: false }));
    expect(fake.upload).toHaveBeenNthCalledWith(2, 'project-1/report-1/report.md', expect.any(Buffer), expect.objectContaining({ contentType: 'text/markdown; charset=utf-8', upsert: false }));
    expect(fake.upload).toHaveBeenNthCalledWith(3, 'project-1/report-1/report.pdf', renderings.pdf, expect.objectContaining({ contentType: 'application/pdf', upsert: false }));
    expect(fake.query.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'report-1', project_id: 'project-1', actor_id: 'user-1', snapshot,
      markdown_storage_path: 'project-1/report-1/report.md',
      json_storage_path: 'project-1/report-1/snapshot.json',
      checksum: makeReportChecksums(renderings).package,
    }));
    expect(fake.createSignedUrl).toHaveBeenCalledTimes(3);
    expect(fake.createSignedUrl).toHaveBeenCalledWith('project-1/report-1/report.pdf', REPORT_SIGNED_URL_TTL_SECONDS, { download: 'report.pdf' });
    expect(result.downloads).toEqual({
      json: 'https://signed.example.test/project-1/report-1/snapshot.json',
      markdown: 'https://signed.example.test/project-1/report-1/report.md',
      pdf: 'https://signed.example.test/project-1/report-1/report.pdf',
    });
    expect(result.checksums).toEqual(makeReportChecksums(renderings));
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('cleans up only successfully uploaded objects after a later upload fails', async () => {
    const fake = createClient({ uploadErrorAt: 2 });

    await expect(persistReportPackage(fake.client, snapshot, renderings))
      .rejects.toMatchObject({ name: 'ReportPersistenceError', cleanupIncomplete: false });
    expect(fake.upload).toHaveBeenCalledTimes(2);
    expect(fake.remove).toHaveBeenCalledWith(['project-1/report-1/snapshot.json']);
    expect(fake.query.insert).not.toHaveBeenCalled();
    expect(fake.eq).not.toHaveBeenCalled();
  });

  it('does not delete an object when the first immutable upload is rejected', async () => {
    const fake = createClient({ uploadErrorAt: 1 });

    await expect(persistReportPackage(fake.client, snapshot, renderings))
      .rejects.toBeInstanceOf(ReportPersistenceError);
    expect(fake.remove).not.toHaveBeenCalled();
  });

  it('cleans uploaded objects if the report row cannot be committed', async () => {
    const fake = createClient({ insertError: true });

    await expect(persistReportPackage(fake.client, snapshot, renderings))
      .rejects.toMatchObject({ name: 'ReportPersistenceError', cleanupIncomplete: false });
    expect(fake.remove).toHaveBeenCalledWith([
      'project-1/report-1/snapshot.json', 'project-1/report-1/report.md', 'project-1/report-1/report.pdf',
    ]);
    expect(fake.eq).not.toHaveBeenCalled();
    expect(fake.createSignedUrl).not.toHaveBeenCalled();
  });

  it('removes the inserted row and all objects when signed-link creation fails', async () => {
    const fake = createClient({ signedUrlError: true });

    await expect(persistReportPackage(fake.client, snapshot, renderings))
      .rejects.toMatchObject({ name: 'ReportPersistenceError', cleanupIncomplete: false });
    expect(fake.eq).toHaveBeenCalledWith('id', 'report-1');
    expect(fake.remove).toHaveBeenCalledWith([
      'project-1/report-1/snapshot.json', 'project-1/report-1/report.md', 'project-1/report-1/report.pdf',
    ]);
  });

  it('reports incomplete cleanup honestly when compensation fails', async () => {
    const fake = createClient({ uploadErrorAt: 2, cleanupError: true });

    await expect(persistReportPackage(fake.client, snapshot, renderings))
      .rejects.toMatchObject({ name: 'ReportPersistenceError', cleanupIncomplete: true });
  });

  it('changes the package checksum when any rendered format changes', () => {
    const original = makeReportChecksums(renderings);
    const differentPdf = makeReportChecksums({ ...renderings, pdf: Buffer.from('%PDF-1.7 changed') });

    expect(original.snapshot).toBe(differentPdf.snapshot);
    expect(original.markdown).toBe(differentPdf.markdown);
    expect(original.pdf).not.toBe(differentPdf.pdf);
    expect(original.package).not.toBe(differentPdf.package);
  });
});
