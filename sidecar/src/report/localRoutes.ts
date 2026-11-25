import type { ServerResponse } from 'node:http';
import { DynamicContractError } from '../dynamic/types.js';
import type { LocalHistory } from '../store/localHistory.js';
import type { LocalWorkspace } from '../store/localWorkspace.js';
import { LocalDownloadToken } from '../store/localDownloadToken.js';
import { buildProjectReportSnapshot, renderProjectReportFiles } from '../reportExport.js';
import { createLocalReportSnapshotSource } from './localSnapshot.js';
import { makeReportChecksums, REPORT_SIGNED_URL_TTL_SECONDS } from './storage.js';
import type { ProjectReportExportResult } from './types.js';

const formats = { json: ['application/json', 'snapshot.json'], markdown: ['text/markdown; charset=utf-8', 'report.md'], pdf: ['application/pdf', 'report.pdf'] } as const;
type Format = keyof typeof formats;
type Download = { owner: string; project: string; id: string; format: Format; expires: number };

export class LocalReportRoutes {
  private readonly tokens = new LocalDownloadToken<Download>();

  constructor(private readonly workspace: LocalWorkspace, private readonly history: LocalHistory) {}

  private links(origin: string, owner: string, project: string, id: string) {
    const expires = Date.now() + REPORT_SIGNED_URL_TTL_SECONDS * 1000;
    const link = (format: Format) => {
      const key = this.tokens.issue({ owner, project, id, format, expires });
      return `${origin}/local-report-download?key=${key}`;
    };
    return { reportId: id, expiresAt: new Date(expires).toISOString(), downloads: { json: link('json'), markdown: link('markdown'), pdf: link('pdf') } };
  }

  async projectRoute(owner: string, actorEmail: string | null, project: string, segments: string[], method: string | undefined,
    origin: string, readBody: () => Promise<Record<string, unknown>>) {
    if (!this.workspace.project(owner, project)) throw new DynamicContractError(404, 'Project not found on this device.');
    if (method === 'GET' && segments.length === 1) return this.workspace.listReports(owner, project);
    if (method === 'POST' && segments.length === 3 && segments[2] === 'links') {
      const id = segments[1];
      const availability = this.workspace.reportAvailability(owner, project, id);
      if (availability === 'missing') throw new DynamicContractError(404, 'Report not found on this device.');
      if (availability === 'unavailable') throw new DynamicContractError(409, 'The report is in history. Its original files are unavailable on this device.');
      return this.links(origin, owner, project, id);
    }
    if (method === 'POST' && segments.length === 2 && segments[1] === 'export') {
      const body = await readBody();
      const reviewId = typeof body.reviewId === 'string' && body.reviewId.trim() ? body.reviewId.trim() : undefined;
      if (reviewId && (await this.workspace.reviews(owner).getReview(reviewId))?.projectId !== project) {
        throw new DynamicContractError(404, 'Review not found on this device.');
      }
      const snapshot = await buildProjectReportSnapshot(project, { actorId: owner, actorEmail, reviewId,
        source: createLocalReportSnapshotSource(this.workspace, owner, project, this.history.autoTests(owner)) });
      const rendered = await renderProjectReportFiles(snapshot);
      const checksums = makeReportChecksums(rendered);
      this.workspace.saveReport(owner, snapshot, rendered, checksums);
      const { reportId, generatedAt, generatorVersion, riskPolicyVersion } = snapshot.metadata;
      return { ...this.links(origin, owner, project, reportId), generatedAt, generatorVersion, riskPolicyVersion,
        markdown: rendered.markdown, checksums, storage: 'private-local' } satisfies ProjectReportExportResult;
    }
    throw new DynamicContractError(404, 'Report operation unavailable.');
  }

  download(url: URL, res: ServerResponse) {
    const owned = this.tokens.read(url.searchParams.get('key'));
    if (!owned || !Object.hasOwn(formats, owned.format)) {
      res.writeHead(404, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    let bytes: Buffer | null;
    try { bytes = this.workspace.reportBytes(owned.owner, owned.project, owned.id, owned.format); }
    catch {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify({ error: 'The report file is missing or failed verification.' }));
      return;
    }
    if (!bytes) { res.writeHead(404, { 'Cache-Control': 'no-store' }).end(); return; }
    const [contentType, fileName] = formats[owned.format];
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': bytes.length,
      'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    res.end(bytes);
  }
}
