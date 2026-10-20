import type { EvidenceArtifact } from './evidenceSufficiency.js';
import type { StaticFindingInput } from './types.js';

const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/^\.\//, '');

/** Model-provided paths and line numbers are claims checked against frozen
 * inputs. Keep the observation, but remove unsupported location claims. */
export function validateFindingLocations(findings: StaticFindingInput[], sources: EvidenceArtifact[]) {
  let rejectedLocations = 0;
  let verifiedLocations = 0;
  const validated = findings.map(finding => {
    const matchesPath = (item: EvidenceArtifact) => [item.artifact.filePath, item.artifact.originalPath, item.artifact.fileName].some(value => value && normalizePath(value) === normalizePath(finding.filePath));
    const claimedSource = sources.find(item => item.artifact.id === finding.artifactId);
    const pathMatches = sources.filter(matchesPath);
    // An artifact ID cannot justify a contradictory path, and a basename
    // shared by several artifacts does not establish an exact location.
    const source = claimedSource
      ? (!finding.filePath || matchesPath(claimedSource) ? claimedSource : undefined)
      : pathMatches.length === 1 ? pathMatches[0] : undefined;
    if (!source || typeof source.content !== 'string') {
      if (finding.filePath || finding.lineNumber != null || finding.artifactId) rejectedLocations++;
      return { ...finding, artifactId: null, filePath: '', lineNumber: null, sourceIdentity: null, sourceVersion: null };
    }
    const lines = source.content.split(/\r?\n/).length;
    const validLine = finding.lineNumber == null || (Number.isInteger(finding.lineNumber) && finding.lineNumber >= 1 && finding.lineNumber <= lines);
    if (!validLine) rejectedLocations++;
    else verifiedLocations++;
    return { ...finding, artifactId: source.artifact.id, filePath: source.artifact.filePath, lineNumber: validLine ? finding.lineNumber : null, sourceIdentity: source.artifact.originalPath ?? source.artifact.filePath, sourceVersion: source.artifact.contentHash };
  });
  return { findings: validated, verifiedLocations, rejectedLocations };
}
