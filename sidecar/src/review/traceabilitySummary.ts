import type { ReviewTraceabilityRecord, TraceabilitySummary } from './evidenceTypes.js';

/** Summarize a frozen Review's requirement states without loading local persistence. */
export function summarizeTraceability(records: ReviewTraceabilityRecord[]): TraceabilitySummary {
  const summary = records.reduce<TraceabilitySummary>((counts, record) => {
    counts[record.state] += 1;
    return counts;
  }, { complete: 0, incomplete: 0, missing: 0, attention: 0 });
  summary.attention = summary.incomplete + summary.missing;
  return summary;
}
