import type { ServerResponse } from 'node:http';
import { DynamicContractError } from '../dynamic/types.js';
import { LocalDownloadToken } from '../store/localDownloadToken.js';
import type { LocalWorkspace } from '../store/localWorkspace.js';
import { DECISION_ATTACHMENT_SIGNED_URL_TTL_SECONDS } from './decisionService.js';

type Download = { owner: string; project: string; review: string; decision: string; id: string; expires: number };

export class LocalDecisionDownloads {
  private readonly tokens = new LocalDownloadToken<Download>();

  constructor(private readonly workspace: LocalWorkspace) {}

  describe(owner: string, project: string, review: string, decision: string, id: string | undefined, origin: string) {
    const files = this.workspace.reviews(owner).decisionFiles(project, review, decision);
    if (!files) throw new DynamicContractError(404, 'Decision not found for this Review.');
    if (id === undefined) return files;
    const file = files.find(item => item.id === id && item.contentHash);
    if (!file) throw new DynamicContractError(404, 'The decision file is unavailable on this device.');
    const expires = Date.now() + DECISION_ATTACHMENT_SIGNED_URL_TTL_SECONDS * 1000;
    const key = this.tokens.issue({ owner, project, review, decision, id, expires });
    return { ...file, signedUrl: origin + '/local-review-decision-download?key=' + key, expiresAt: new Date(expires).toISOString() };
  }

  download(url: URL, res: ServerResponse): void {
    const token = this.tokens.read(url.searchParams.get('key'));
    const file = token && this.workspace.reviews(token.owner).decisionFiles(token.project, token.review, token.decision)
      ?.find(item => item.id === token.id && item.contentHash);
    if (!token || !file) { res.writeHead(404, { 'Cache-Control': 'no-store' }).end(); return; }
    const { owner, project, review, decision, id } = token;
    const bytes = this.workspace.decisionFileBytes(owner, project, review, decision, id);
    if (!bytes) { res.writeHead(404, { 'Cache-Control': 'no-store' }).end(); return; }
    const filename = Buffer.from(file.fileName.replace(/[\\/\u0000-\u001f\u007f]/g, '_'), 'utf8').toString('utf8');
    const encoded = encodeURIComponent(filename).replace(/['()*]/g, character => '%' + character.charCodeAt(0).toString(16));
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length,
      'Content-Disposition': `attachment; filename="review-attachment"; filename*=UTF-8''${encoded}`,
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    res.end(bytes);
  }
}
