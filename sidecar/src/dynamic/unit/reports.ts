import type { SupabaseClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import { canonicalJson } from '../../report/canonical.js';
import { reportHash } from '../reports/render.js';
import { DynamicContractError } from '../types.js';
import type { DynamicUnitRun } from './types.js';
export type UnitReportSnapshot = {
    metadata: {
        schemaVersion: 'centinel-unit-report-v1';
        generatorVersion: 'unit-report-1';
        reportId: string;
        projectId: string;
        runId: string;
        actorId: string;
        generatedAt: string;
    };
    run: Omit<DynamicUnitRun, 'lease' | 'idempotencyKey'>;
    cleanupEvents: Array<{
        kind: string;
        outcome: string;
        note: string;
        actorId: string;
        createdAt: string;
    }>;
    limitations: string[];
};
const line = (x: unknown) => String(x ?? 'Unavailable').replace(/[\r\n]/g, ' ').replace(/[<>]/g, '');
export function renderUnitReportMarkdown(s: UnitReportSnapshot) {
    const r = s.run, result = r.result, lines = ['# Centinel existing unit-test report', '', `Report: ${s.metadata.reportId}`, `Captured: ${s.metadata.generatedAt}`, `Author: ${s.metadata.actorId}`, `Unit Run: ${r.id}`, `Executor: ${r.createdBy}`, `Execution: ${r.state} / ${r.verdict}`, `Framework: Vitest ${r.command.frameworkVersion ?? 'Unavailable'} / Node ${r.command.nodeVersion ?? 'Unavailable'}`, `Selected script: ${r.command.script ?? 'No executable script verified'}`, `Fixed command: node vitest.mjs run --reporter=json --outputFile=[private report] --cache=false`, `Workspace fingerprint: ${r.command.fingerprint ?? 'Unavailable'}`, `Installed CLI SHA-256: ${r.command.cliSha256 ?? 'Unavailable'}`, `Observed repository commit: ${r.command.gitCommit ?? 'Unavailable'}`, `Environment: ${line(r.environment.name)} v${r.environment.version}`, `Declared target version: ${line(r.environment.targetVersion)}`, `Timeout: ${r.timeoutMs} ms`, '', '## Framework outcome', '', result ? line(result.outcome) + ' / ' + line(result.reason) : 'No complete framework result retained.'];
    if (result) {
        lines.push(`Exit / signal / duration: ${result.process?.exitCode ?? 'Unavailable'} / ${result.process?.signal ?? 'None recorded'} / ${result.process?.durationMs ?? 'Unavailable'} ms`);
        if (result.assessment) {
            const c = result.assessment.counts;
            lines.push(`Total: ${c.total}; Passed: ${c.passed}; Failed: ${c.failed}; Pending/skipped: ${c.pending}; Todo: ${c.todo}; Framework suites: ${c.totalSuites}; Failed suites: ${c.failedSuites}`, `Details truncated: ${result.assessment.detailsTruncated}`, '', '## Test cases', '');
            for (const t of result.assessment.tests) {
                lines.push(`### ${line(t.file)} — ${line(t.name)}`, `Status: ${t.status}; duration: ${t.durationMs == null ? 'Unavailable' : t.durationMs.toFixed(2)} ms`);
                for (const msg of t.failureMessages)
                    lines.push(line(msg));
                lines.push('');
            }
            for (const e of result.assessment.suiteErrors)
                lines.push('Suite error: ' + line(e.file) + ' / ' + line(e.message));
        }
        lines.push('', '## Bounded redacted logs', '', `Logs truncated: ${result.process?.truncated ?? 'Unavailable'}`);
        const logs = result.process?.output ?? 'No logs retained.';
        let fence = '~~~';
        while (logs.includes(fence))
            fence += '~';
        lines.push(fence, logs, fence, '', ...result.limitations.map(x => '- ' + line(x)));
    }
    lines.push('', '## Preparation and cleanup', '', line(JSON.stringify(r.environment.preparation ?? null)));
    if (!s.cleanupEvents.length)
        lines.push('No cleanup event recorded at capture. Data is not assumed clean.');
    for (const e of s.cleanupEvents)
        lines.push(line(e.createdAt) + ' / ' + line(e.actorId) + ' / ' + e.outcome + ' / ' + line(e.note));
    lines.push('', '## Limitations', '', ...s.limitations.map(x => '- ' + line(x)), '');
    return lines.join('\n');
}
export function renderUnitReportPdf(s: UnitReportSnapshot): Promise<Buffer> { return new Promise((resolve, reject) => { const d = new Date(s.metadata.generatedAt), doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: 'Centinel unit report ' + s.metadata.reportId, Author: s.metadata.actorId, Creator: s.metadata.generatorVersion, CreationDate: d, ModDate: d } }), chunks: Buffer[] = []; doc.on('data', x => chunks.push(Buffer.from(x))); doc.on('error', reject); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.font('Helvetica').fontSize(10); doc.text('Latin-font PDF; JSON/Markdown preserve exact Unicode text.'); for (const raw of renderUnitReportMarkdown(s).split('\n')) {
    if (/^~{3,}/.test(raw))
        continue;
    const heading = raw.startsWith('#'), text = raw.replace(/^#+ /, '').replace(/[\u2010-\u2015\u2212]/g, '-').normalize('NFKD').replace(/[^\x20-\x7e]/g, '?');
    if (heading && doc.y > 700)
        doc.addPage();
    doc.font(heading ? 'Helvetica-Bold' : 'Helvetica').fontSize(heading ? 13 : 10).fillColor(heading ? '#28623c' : '#17211a').text(text, { lineGap: 3 });
} doc.end(); }); }
export class UnitReportRepository {
    constructor(private readonly client: SupabaseClient) { }
    async capture(project: string, run: string, id: string): Promise<UnitReportSnapshot> { const { data, error } = await this.client.rpc('capture_dynamic_unit_report', { p_project_id: project, p_run_id: run, p_report_id: id }).abortSignal(AbortSignal.timeout(15000)); if (error)
        throw new DynamicContractError(error.code === 'P0001' ? 409 : 503, 'Unit report capture unavailable. Refresh the stopped Run.'); return data; }
    async get(project: string, id: string): Promise<UnitReportSnapshot> { const { data, error } = await this.client.from('dynamic_unit_reports').select('payload').eq('project_id', project).eq('id', id).abortSignal(AbortSignal.timeout(15000)).maybeSingle(); if (error)
        throw new DynamicContractError(503, 'Unit report history unavailable.'); if (!data)
        throw new DynamicContractError(404, 'Unit report not available to this account.'); return data.payload; }
    async list(project: string, run: string) { const { data, error } = await this.client.from('dynamic_unit_reports').select('payload->metadata').eq('project_id', project).eq('unit_run_id', run).order('created_at', { ascending: false }).limit(100).abortSignal(AbortSignal.timeout(15000)); if (error)
        throw new DynamicContractError(503, 'Unit report history unavailable.'); return (data ?? []).map(row => row.metadata) as UnitReportSnapshot['metadata'][]; }
}
export async function handleUnitReportRoute(req: {
    method: string;
    pathname: string;
    readBody(): Promise<Record<string, unknown>>;
}, deps: {
    repository: UnitReportRepository;
    requireMember(project: string): Promise<void>;
}) {
    const m = req.pathname.match(/^\/projects\/([^/]+)\/dynamic\/(?:unit-runs\/([^/]+)\/reports|unit-reports\/([^/]+)(?:\/(json|markdown|pdf))?)$/);
    if (!m)
        return null;
    const [, project, run, id, format] = m;
    await deps.requireMember(project);
    try {
        if (run && req.method === 'GET')
            return { status: 200, body: await deps.repository.list(project, run) };
        if (run && req.method === 'POST') {
            const body = await req.readBody();
            if (Object.keys(body).some(k => k !== 'reportId') || typeof body.reportId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.reportId))
                throw new DynamicContractError(400, 'Fresh report UUID required.');
            return { status: 201, body: await deps.repository.capture(project, run, body.reportId) };
        }
        if (id && req.method === 'GET') {
            const snapshot = await deps.repository.get(project, id);
            if (!format)
                return { status: 200, body: snapshot };
            const bytes = format === 'pdf' ? await renderUnitReportPdf(snapshot) : Buffer.from(format === 'json' ? canonicalJson(snapshot) : renderUnitReportMarkdown(snapshot));
            if (bytes.length > 8 * 1024 * 1024)
                throw new DynamicContractError(409, 'Unit export exceeds its bound.');
            return { status: 200, body: bytes, mimeType: format === 'pdf' ? 'application/pdf' : format === 'json' ? 'application/json' : 'text/markdown; charset=utf-8', filename: `centinel-dynamic-${id}.${format === 'markdown' ? 'md' : format}`, sha256: reportHash(bytes) };
        }
        return { status: 405, body: { error: 'Method not allowed.' } };
    }
    catch (e) {
        if (e instanceof DynamicContractError)
            return { status: e.status, body: { error: e.message } };
        throw e;
    }
}
