import { findingSourceReferences } from './findingGroups';
import type { Finding } from './types';

type Range = [start: number, end: number];
type FileEvidence = { path: string; findings: Finding[]; ranges: Range[] };

function coveredLines(ranges: Range[]): number {
  let count = 0;
  let lastEnd = 0;
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    count += Math.max(0, end - Math.max(start, lastEnd + 1) + 1);
    lastEnd = Math.max(end, lastEnd);
  }
  return count;
}

export function rankFindingEvidence(findings: Finding[], byFeature = true) {
  const features = new Map<string, Map<string, FileEvidence>>();
  for (const finding of findings) {
    const featureId = byFeature ? finding.location?.sourceLocator?.analysis?.featureId || '' : '';
    for (const ref of findingSourceReferences(finding)) {
      if (!ref.filePath) continue;
      const files = features.get(featureId) ?? new Map<string, FileEvidence>();
      const path = ref.filePath.replace(/\\/g, '/');
      const file = files.get(path) ?? { path, findings: [], ranges: [] };
      if (!file.findings.includes(finding)) file.findings.push(finding);
      if (ref.lineNumber && Number.isSafeInteger(ref.lineNumber) && ref.lineNumber > 0) {
        const lines = ref.excerpt?.trim().split(/\r\n?|\n/).length ?? 1;
        file.ranges.push([ref.lineNumber, ref.lineNumber + lines - 1]);
      }
      files.set(path, file);
      features.set(featureId, files);
    }
  }
  return Array.from(features, ([id, fileMap]) => {
    const files = Array.from(fileMap.values(), ({ path, findings, ranges }) => ({ path, findings, lines: coveredLines(ranges) }))
      .sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path));
    const highlightedFiles = files.filter(file => file.lines > 0).length;
    return { id, files, highlightedFiles, lines: files.reduce((sum, file) => sum + file.lines, 0) };
  }).sort((a, b) => Number(Boolean(b.id)) - Number(Boolean(a.id)) || b.lines - a.lines || b.highlightedFiles - a.highlightedFiles || a.id.localeCompare(b.id));
}
