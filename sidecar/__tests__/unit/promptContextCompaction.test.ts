import { describe, expect, it } from 'vitest';
import { compactAnalysisMapForPrompt, deterministicFactsForPacket } from '../../src/review/promptContextCompaction.js';
import type { ReviewAnalysisMap } from '../../src/review/featurePathAnalysis.js';
import type { StaticFindingInput } from '../../src/review/types.js';

describe('lossless assessment fact compaction', () => {
  it('compacts only exact empty placeholders while preserving evidence, meaningful uncertainty and all domains', () => {
    const map = { schemaVersion: 1, status: 'partial', coverage: { sourceArtifacts: 1, unsupportedArtifacts: [] }, features: [{ id: 'feature', label: 'payment',
      entryPoints: [{ artifactId: 'a', filePath: 'payment.ts', lineNumber: 1, sourceVersion: 'hash' }], paths: [], unresolved: [{ reason: 'External database behavior is unverified.', evidence: [] }],
      assessments: [
        { domain: 'security', status: 'unverified', outcome: 'unverified', summary: 'No domain assessment was returned for this feature.', evidence: [] },
        { domain: 'technical', status: 'assessed', outcome: 'potential_gap', summary: 'Two writes are not atomic.', evidence: [{ artifactId: 'a', filePath: 'payment.ts', lineNumber: 1, sourceVersion: 'hash' }] },
        { domain: 'business', status: 'unverified', outcome: 'unverified', summary: 'Requirement exception is missing.', evidence: [] },
      ] }] } as unknown as ReviewAnalysisMap;
    const before = JSON.stringify(map);
    const compacted = compactAnalysisMapForPrompt(map);
    const result = JSON.parse(compacted);
    expect(result.features[0].pendingDomains).toEqual(['security']);
    expect(result.features[0].assessments).toEqual(map.features[0]!.assessments.slice(1));
    expect(result.features[0].entryPoints).toEqual(map.features[0]!.entryPoints);
    expect(result.features[0].unresolved).toEqual(map.features[0]!.unresolved);
    expect(JSON.stringify(map)).toBe(before);
    expect(compacted.length).toBeLessThan(before.length);
  });

  it('retains packet-relevant primary and related deterministic facts without changing stored occurrences', () => {
    const findings = [{ filePath: 'a.ts', evidence: 'EXACT_A' }, { filePath: 'b.ts', evidence: 'EXACT_B', relatedLocations: [{ filePath: 'a.ts' }] },
      { filePath: 'c.ts', evidence: 'EXACT_C' }, { filePath: '', evidence: 'UNKNOWN_SCOPE' }] as StaticFindingInput[];
    expect(deterministicFactsForPacket(findings, new Set(['a.ts']))).toEqual([findings[0], findings[1], findings[3]]);
    expect(findings).toHaveLength(4);
  });

  it('round-trips repeated graph references without losing facts, boundaries or version distinctions', () => {
    const current = { artifactId: 'artifact-with-a-long-exact-identity', filePath: 'src/payments/concurrent-transactions.ts', lineNumber: 42, sourceVersion: 'a'.repeat(64) };
    const unknownVersion = { ...current, sourceVersion: null };
    const reordered = { sourceVersion: current.sourceVersion, lineNumber: current.lineNumber, filePath: current.filePath, artifactId: current.artifactId };
    const map = { schemaVersion: 1, status: 'partial', coverage: { exhaustive: false, limitations: ['Runtime authorization remains unverified.'] },
      features: Array.from({ length: 8 }, (_, index) => ({ id: `f${index}`, label: `Payment flow ${index}`, provisional: true,
        entryPoints: [current, reordered, unknownVersion],
        paths: [{ id: `p${index}`, kind: 'failure', label: 'Concurrent duplicate write', status: 'unverified', evidence: [current] }],
        unresolved: [{ reason: 'External transaction isolation is unknown.', evidence: [unknownVersion] }],
        assessments: [{ domain: 'technical', status: 'assessed', outcome: 'potential_gap', summary: 'Retain this exact reusable fact.', evidence: [current] }],
      })) } as unknown as ReviewAnalysisMap;
    const before = JSON.stringify(map);
    const compacted = compactAnalysisMapForPrompt(map);
    const result = JSON.parse(compacted);
    expect(result.referenceEncoding).toContain('return full artifactId/filePath/lineNumber/sourceVersion');
    expect(Object.values(result.evidenceReferenceTable)).toEqual([current, unknownVersion]);
    const expand = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(expand);
      if (value && typeof value === 'object') {
        const row = value as Record<string, unknown>;
        if (Object.keys(row).length === 1 && typeof row.evidenceRef === 'string') {
          expect(result.evidenceReferenceTable[row.evidenceRef]).toBeDefined();
          return result.evidenceReferenceTable[row.evidenceRef];
        }
        return Object.fromEntries(Object.entries(row).map(([key, item]) => [key, expand(item)]));
      }
      return value;
    };
    const { referenceEncoding: _encoding, evidenceReferenceTable: _table, ...body } = result;
    expect(expand(body)).toEqual(map);
    expect(JSON.stringify(map)).toBe(before);
    expect(compacted.length).toBeLessThan(before.length);
  });

  it('keeps the ordinary reference format when a dictionary would increase context', () => {
    const map = { schemaVersion: 1, status: 'partial', coverage: {}, features: [{ id: 'f', label: 'single',
      entryPoints: [{ artifactId: 'a', filePath: 'a.ts', lineNumber: 1, sourceVersion: null }], paths: [], unresolved: [], assessments: [] }]
    } as unknown as ReviewAnalysisMap;
    expect(compactAnalysisMapForPrompt(map)).toBe(JSON.stringify(map));
  });
});
