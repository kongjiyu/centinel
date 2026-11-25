import type { ReportHistoryEntry } from './history.js';
import { reportFileChecksums } from './storage.js';
import type { ProjectReportSnapshot } from './types.js';

export const reportFormats = ['json', 'markdown', 'pdf'] as const;
export type ReportFormat = typeof reportFormats[number];
export type ArchivedReport = {
  history: Omit<ReportHistoryEntry, 'storage'>;
  files: Record<ReportFormat, string> | null;
};

export function verifyArchivedReport(history: ArchivedReport['history'], files: Record<ReportFormat, Buffer>) {
  if (reportFormats.some(format => !files[format].length) || !files.pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new Error('Archived report files have an invalid format.');
  }
  const checksums = reportFileChecksums(files);
  if (checksums.package !== history.checksum) throw new Error('Archived report package checksum does not match.');
  const snapshot = JSON.parse(files.json.toString('utf8')) as ProjectReportSnapshot;
  if (snapshot?.project?.id !== history.projectId || snapshot.metadata?.reportId !== history.id
    || history.actorId !== null && snapshot.metadata.actorId !== history.actorId
    || snapshot.metadata.generatorVersion !== history.generatorVersion
    || snapshot.metadata.riskPolicyVersion !== history.policyVersion
    || Date.parse(snapshot.metadata.generatedAt) !== Date.parse(history.createdAt)) {
    throw new Error('Archived report metadata does not match its project and files.');
  }
  return { snapshot, checksums };
}
