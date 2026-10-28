import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { ReviewModelUsage, ReviewUsagePhase, ReviewUsagePhaseBreakdown, ReviewUsageProjection } from '../types';
import { userFacingError } from '../utils/userFacingError';
import './ReviewUsageDetails.css';

type Props = { projectId: string; sessionId: string };
type UsageStage = ReviewUsageProjection['byStage'][number];
type UsageFile = ReviewUsageProjection['sourceInventory']['files'][number];
type PhysicalFile = ReviewUsageProjection['byStage'][number]['physicalFiles'][number];

const STAGES = [
  { id: 'freezing_sources', label: 'Freeze review sources' },
  { id: 'indexing_context', label: 'Index project context' },
  { id: 'deterministic_analysis', label: 'Run deterministic checks' },
  { id: 'model_analysis', label: 'Analyze with models' },
  { id: 'persisting_evidence', label: 'Save review evidence' },
] as const;

const PHASE_LABELS: Record<ReviewUsagePhase, string> = {
  initial_analysis: 'Initial analysis',
  domain_repair: 'Domain repair',
  citation_repair: 'Citation repair',
  semantic_support: 'Support check',
  support_repair: 'Support repair',
  response_repair: 'Response repair',
  source_indexing: 'Source indexing',
  context_retrieval: 'Context retrieval',
};

const PHASE_TOKEN_FIELDS = [
  'inputTokens', 'unknownInputCalls', 'outputTokens', 'unknownOutputCalls',
  'cacheReadTokens', 'unknownCacheReadCalls', 'cacheCreationTokens', 'unknownCacheCreationCalls',
  'providerReportedTotalTokens', 'providerReportedTotalCalls', 'unknownProviderTotalCalls',
  'canonicalTotalTokens', 'unknownCanonicalTotalCalls',
  'assumedZeroNoResponseCalls', 'assumedZeroNoResponseTokens', 'accountedTokens',
] as const satisfies readonly (keyof Omit<ReviewUsagePhaseBreakdown, 'phase' | 'calls' | 'repairCalls'>)[];

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const formatCount = (value: number | null | undefined) => value == null ? '—' : numberFormat.format(value);
const formatStageState = (state: UsageStage['state']) => ({
  not_reached: 'Not reached', running: 'In progress', completed: 'Completed', stopped: 'Stopped',
}[state]);
const formatProjectionStatus = (status: ReviewUsageProjection['status']) => ({
  available: 'Available', partial: 'Partial records', unavailable: 'Unavailable',
}[status]);
const formatInventoryStatus = (status: ReviewUsageProjection['sourceInventory']['status']) => ({
  available: 'Complete source inventory', partial: 'Partial source inventory', unavailable: 'Source inventory unavailable',
}[status]);

function fileIdentity(file: { artifactId: string; artifactVersionId: string | null; contentHash: string | null; filePath: string }) {
  return JSON.stringify([file.artifactId, file.artifactVersionId, file.contentHash, file.filePath]);
}

function mergeRanges<T extends { lineStart: number | null; lineEnd: number | null }>(ranges: T[]) {
  const unique = new Map<string, T>();
  for (const range of ranges) unique.set(JSON.stringify([range.lineStart, range.lineEnd]), range);
  return [...unique.values()];
}

function mergeStageFiles(files: UsageStage['aiFiles']) {
  const merged = new Map<string, UsageStage['aiFiles'][number]>();
  for (const file of files) {
    const key = fileIdentity(file);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...file, phases: [...file.phases], ranges: [...file.ranges] });
      continue;
    }
    current.appearances += file.appearances;
    current.phases = [...new Set([...current.phases, ...file.phases])];
    current.ranges = mergeRanges([...current.ranges, ...file.ranges]);
  }
  return [...merged.values()];
}

function mergePhysicalFiles(files: PhysicalFile[]) {
  const merged = new Map<string, PhysicalFile>();
  for (const file of files) {
    const key = fileIdentity(file);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...file });
      continue;
    }
    current.readAttempts += file.readAttempts;
    current.successfulReads += file.successfulReads;
    current.failedReads += file.failedReads;
    current.lines = current.lines === null || file.lines === null ? null : Math.max(current.lines, file.lines);
    current.characters = current.characters === null || file.characters === null ? null : Math.max(current.characters, file.characters);
  }
  return [...merged.values()];
}

function combineState(rows: UsageStage[]): UsageStage['state'] {
  const states = new Set(rows.map(row => row.state));
  if (states.has('running')) return 'running';
  if (states.size === 1 && states.has('completed')) return 'completed';
  if (states.size === 1 && states.has('not_reached')) return 'not_reached';
  return 'stopped';
}

function mergeStage(rows: UsageStage[], stageId: string): UsageStage | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return { ...rows[0], stage: stageId };
  const phaseRows = new Map<ReviewUsagePhase, ReviewUsagePhaseBreakdown[]>();
  for (const row of rows) for (const phase of row.phases) phaseRows.set(phase.phase, [...(phaseRows.get(phase.phase) ?? []), phase]);
  const phases: ReviewUsagePhaseBreakdown[] = [...phaseRows].map(([phase, entries]) => {
    const subtotals: Partial<Omit<ReviewUsagePhaseBreakdown, 'phase' | 'calls' | 'repairCalls'>> = {};
    for (const field of PHASE_TOKEN_FIELDS) {
      const values = entries.map(entry => entry[field]);
      if (values.every((value): value is number => typeof value === 'number')) {
        Object.assign(subtotals, { [field]: values.reduce((total, value) => total + value, 0) });
      }
    }
    return {
      phase,
      calls: entries.reduce((total, entry) => total + entry.calls, 0),
      repairCalls: entries.reduce((total, entry) => total + entry.repairCalls, 0),
      ...subtotals,
    };
  });
  const aiFiles = mergeStageFiles(rows.flatMap(row => row.aiFiles));
  const physicalFiles = mergePhysicalFiles(rows.flatMap(row => row.physicalFiles));
  const componentKeys = new Set(rows.flatMap(row => Object.keys(row.requestContext.componentsCharacters)));
  const componentsCharacters = Object.fromEntries([...componentKeys].map(key => [key, rows.reduce((total, row) => total + (row.requestContext.componentsCharacters[key] ?? 0), 0)]));
  const aiFileCountKnown = rows.every(row => row.aiFileCount !== null && row.aiFileCount === row.aiFiles.length);
  const physicalFileCountKnown = rows.every(row => row.physicalReadFileCount !== null && row.physicalReadFileCount === row.physicalFiles.length);
  const requestContext = {
    callsWithContext: rows.reduce((total, row) => total + row.requestContext.callsWithContext, 0),
    callsWithoutContext: rows.reduce((total, row) => total + row.requestContext.callsWithoutContext, 0),
    estimatedInputTokens: rows.reduce((total, row) => total + row.requestContext.estimatedInputTokens, 0),
    estimatedCalls: rows.reduce((total, row) => total + row.requestContext.estimatedCalls, 0),
    componentsCharacters,
  };
  return {
    ...rows[0],
    stage: stageId,
    operations: [...new Set(rows.flatMap(row => row.operations))],
    state: combineState(rows),
    calls: rows.reduce((total, row) => total + row.calls, 0),
    successfulCalls: rows.reduce((total, row) => total + row.successfulCalls, 0),
    failedCalls: rows.reduce((total, row) => total + row.failedCalls, 0),
    cancelledCalls: rows.reduce((total, row) => total + row.cancelledCalls, 0),
    inProgressCalls: rows.reduce((total, row) => total + row.inProgressCalls, 0),
    repairCalls: rows.reduce((total, row) => total + row.repairCalls, 0),
    phases,
    inputTokens: rows.reduce((total, row) => total + row.inputTokens, 0),
    unknownInputCalls: rows.reduce((total, row) => total + row.unknownInputCalls, 0),
    outputTokens: rows.reduce((total, row) => total + row.outputTokens, 0),
    unknownOutputCalls: rows.reduce((total, row) => total + row.unknownOutputCalls, 0),
    cacheReadTokens: rows.reduce((total, row) => total + row.cacheReadTokens, 0),
    unknownCacheReadCalls: rows.reduce((total, row) => total + row.unknownCacheReadCalls, 0),
    cacheCreationTokens: rows.reduce((total, row) => total + row.cacheCreationTokens, 0),
    unknownCacheCreationCalls: rows.reduce((total, row) => total + row.unknownCacheCreationCalls, 0),
    providerReportedTotalTokens: rows.reduce((total, row) => total + row.providerReportedTotalTokens, 0),
    providerReportedTotalCalls: rows.reduce((total, row) => total + row.providerReportedTotalCalls, 0),
    unknownProviderTotalCalls: rows.reduce((total, row) => total + row.unknownProviderTotalCalls, 0),
    canonicalTotalTokens: rows.reduce((total, row) => total + row.canonicalTotalTokens, 0),
    unknownCanonicalTotalCalls: rows.reduce((total, row) => total + row.unknownCanonicalTotalCalls, 0),
    assumedZeroNoResponseCalls: rows.every(row => typeof row.assumedZeroNoResponseCalls === 'number') ? rows.reduce((total, row) => total + row.assumedZeroNoResponseCalls!, 0) : undefined,
    assumedZeroNoResponseTokens: rows.every(row => typeof row.assumedZeroNoResponseTokens === 'number') ? rows.reduce((total, row) => total + row.assumedZeroNoResponseTokens!, 0) : undefined,
    accountedTokens: rows.every(row => typeof row.accountedTokens === 'number') ? rows.reduce((total, row) => total + row.accountedTokens!, 0) : undefined,
    requestContext,
    aiFileCount: aiFileCountKnown ? aiFiles.length : null,
    aiFileAppearances: rows.every(row => row.aiFileAppearances !== null) ? rows.reduce((total, row) => total + (row.aiFileAppearances ?? 0), 0) : null,
    aiFiles: aiFiles.map(file => ({ ...file, stages: [stageId] })),
    physicalReadAttempts: rows.every(row => row.physicalReadAttempts !== null) ? rows.reduce((total, row) => total + (row.physicalReadAttempts ?? 0), 0) : null,
    physicalReadFileCount: physicalFileCountKnown ? physicalFiles.length : null,
    physicalFiles,
  };
}

function stageBucket(stage: string) {
  return STAGES.find(candidate => stage === candidate.id || stage.startsWith(`${candidate.id}:`))?.id ?? null;
}

function orderedStages(projection: ReviewUsageProjection) {
  return STAGES.flatMap(stage => {
    const rows = projection.byStage.filter(row => stageBucket(row.stage) === stage.id);
    const merged = mergeStage(rows, stage.id);
    return merged ? [merged] : [];
  });
}

function PhaseTokenMetric({ label, value, unknownCalls, reportedCalls }: {
  label: string;
  value: number | undefined;
  unknownCalls?: number;
  reportedCalls?: number;
}) {
  return <div><dt>{label}</dt><dd>{formatCount(value)}{reportedCalls != null && <small>{formatCount(reportedCalls)} calls with provider totals</small>}{unknownCalls != null && unknownCalls > 0 && <small>{formatCount(unknownCalls)} {unknownCalls === 1 ? 'call' : 'calls'} unknown</small>}{unknownCalls == null && value != null && <small>Unknown-call count unavailable</small>}</dd></div>;
}

function PhaseTokenBreakdown({ phases }: { phases: ReviewUsagePhaseBreakdown[] }) {
  if (phases.length === 0) return null;
  return (
    <details className="review-usage-phase-breakdown">
      <summary>Phase token subtotals ({formatCount(phases.length)})</summary>
      <div className="review-usage-phase-cards" aria-label="Recorded analysis phase usage">
        {phases.map(item => {
          const label = PHASE_LABELS[item.phase];
          return <section className="review-usage-phase-card" key={item.phase} aria-label={`${label} phase usage`}>
            <header><h4>{label}</h4><span>{formatCount(item.calls)} {item.calls === 1 ? 'call' : 'calls'} · {formatCount(item.repairCalls)} {item.repairCalls === 1 ? 'repair' : 'repairs'}</span></header>
            <dl>
              <PhaseTokenMetric label="Provider-reported total" value={item.providerReportedTotalTokens} reportedCalls={item.providerReportedTotalCalls} unknownCalls={item.unknownProviderTotalCalls} />
              <PhaseTokenMetric label="Known total tokens" value={item.canonicalTotalTokens} unknownCalls={item.unknownCanonicalTotalCalls} />
              <PhaseTokenMetric label="Input tokens" value={item.inputTokens} unknownCalls={item.unknownInputCalls} />
              <PhaseTokenMetric label="Output tokens" value={item.outputTokens} unknownCalls={item.unknownOutputCalls} />
              <PhaseTokenMetric label="Cache read tokens" value={item.cacheReadTokens} unknownCalls={item.unknownCacheReadCalls} />
              <PhaseTokenMetric label="Cache creation tokens" value={item.cacheCreationTokens} unknownCalls={item.unknownCacheCreationCalls} />
            </dl>
            <NoResponseAccounting calls={item.assumedZeroNoResponseCalls} />
          </section>;
        })}
      </div>
    </details>
  );
}

function DetailedTokenBreakdown({ stage }: { stage: UsageStage }) {
  return (
    <details className="review-usage-stage-breakdown">
      <summary>{STAGES.find(item => item.id === stage.stage)?.label ?? stage.stage} token and operation details</summary>
      <dl className="review-usage-stage-metrics">
        <div><dt>Input tokens</dt><dd>{formatCount(stage.inputTokens)}{stage.unknownInputCalls > 0 && <small>{formatCount(stage.unknownInputCalls)} calls unknown</small>}</dd></div>
        <div><dt>Output tokens</dt><dd>{formatCount(stage.outputTokens)}{stage.unknownOutputCalls > 0 && <small>{formatCount(stage.unknownOutputCalls)} calls unknown</small>}</dd></div>
        <div><dt>Cache reads</dt><dd>{formatCount(stage.cacheReadTokens)}{stage.unknownCacheReadCalls > 0 && <small>{formatCount(stage.unknownCacheReadCalls)} calls unknown</small>}</dd></div>
        <div><dt>Cache creation</dt><dd>{formatCount(stage.cacheCreationTokens)}{stage.unknownCacheCreationCalls > 0 && <small>{formatCount(stage.unknownCacheCreationCalls)} calls unknown</small>}</dd></div>
        <div><dt>Completed calls</dt><dd>{formatCount(stage.successfulCalls)}</dd></div>
        <div><dt>Failed calls</dt><dd>{formatCount(stage.failedCalls)}</dd></div>
        <div><dt>Cancelled calls</dt><dd>{formatCount(stage.cancelledCalls)}</dd></div>
        <div><dt>Calls in progress</dt><dd>{formatCount(stage.inProgressCalls)}</dd></div>
      </dl>
      <NoResponseAccounting calls={stage.assumedZeroNoResponseCalls} />
      <PhaseTokenBreakdown phases={stage.phases} />
      {stage.requestContext.callsWithContext + stage.requestContext.callsWithoutContext > 0 && <p className="review-usage-estimate">Estimated request context: {formatCount(stage.requestContext.estimatedInputTokens)} tokens across {formatCount(stage.requestContext.estimatedCalls)} calls. This is an estimate, separate from recorded provider usage.</p>}
      {stage.operations.length > 0 && <details className="review-usage-operations"><summary>{formatCount(stage.operations.length)} recorded operation keys</summary><ul>{stage.operations.map(operation => <li key={operation}><code>{operation}</code></li>)}</ul></details>}
    </details>
  );
}

function NoResponseAccounting({ calls }: { calls?: number }) {
  if (!calls) return null;
  return <p className="review-usage-muted">No-response accounting: {formatCount(calls)} failed {calls === 1 ? 'call counted' : 'calls counted'} as 0 tokens. This is an assumption; actual provider consumption remains unknown.</p>;
}

function GroupTokenCell({ value, unknown, calls }: { value: number; unknown?: number; calls: number }) {
  const unavailable = calls > 0 && (unknown === calls || unknown == null && value === 0);
  return <td>{formatCount(unavailable ? null : value)}{unknown != null && unknown > 0
    ? <small>{formatCount(unknown)} calls unknown</small>
    : unknown == null ? <small>Unknown-call count unavailable</small> : null}</td>;
}

function SourceFileList({ files }: { files: UsageFile[] }) {
  return (
    <ul className="review-usage-file-list">
      {files.map(file => (
        <li key={fileIdentity(file)}>
          <code className="review-usage-file-path">{file.filePath}</code>
          <dl className="review-usage-file-metadata">
            <div><dt>Artifact</dt><dd><code>{file.artifactId}</code></dd></div>
            <div><dt>Version</dt><dd>{file.artifactVersionId ? <code>{file.artifactVersionId}</code> : 'Version metadata unavailable'}</dd></div>
            {file.contentHash && <div><dt>Content hash</dt><dd><code>{file.contentHash}</code></dd></div>}
            <div><dt>Recorded appearances</dt><dd>{formatCount(file.appearances)}</dd></div>
            {file.stages.length > 0 && <div><dt>Stages</dt><dd>{file.stages.map(stage => STAGES.find(item => item.id === stage)?.label ?? stage).join(', ')}</dd></div>}
            {file.phases.length > 0 && <div><dt>Phases</dt><dd>{file.phases.map(phase => PHASE_LABELS[phase]).join(', ')}</dd></div>}
            {file.ranges.length > 0 && <div><dt>Line ranges</dt><dd>{file.ranges.map((range, index) => <span key={`${range.lineStart}-${range.lineEnd}-${index}`}>{range.lineStart == null ? 'Unknown start' : range.lineStart}{range.lineEnd == null ? '–unknown end' : `–${range.lineEnd}`}{index < file.ranges.length - 1 ? ', ' : ''}</span>)}</dd></div>}
          </dl>
        </li>
      ))}
    </ul>
  );
}

function PhysicalReadDetails({ projection }: { projection: ReviewUsageProjection }) {
  const physical = projection.sourceInventory.physical;
  const files = mergePhysicalFiles(physical.byStage.flatMap(stage => stage.files));
  return (
    <details className="review-usage-physical">
      <summary>Physical source reads</summary>
      <p>{physical.readAttempts == null ? 'Exact read attempts unavailable' : `${formatCount(physical.readAttempts)} recorded read attempts`} · {physical.uniqueFiles == null ? 'exact unique-file count unavailable' : `${formatCount(physical.uniqueFiles)} unique source ${physical.uniqueFiles === 1 ? 'file' : 'files'}`} · {formatCount(physical.unknownReadAttempts)} read attempts without exact source identity</p>
      <p className="review-usage-muted">These are repository reads performed by the review. They are separate from files sent as AI context.</p>
      {files.length > 0 && <details className="review-usage-file-disclosure"><summary>View {formatCount(files.length)} identified physical source files</summary>
        <ul className="review-usage-file-list">{files.map(file => <li key={fileIdentity(file)}><code className="review-usage-file-path">{file.filePath}</code><dl className="review-usage-file-metadata"><div><dt>Artifact</dt><dd><code>{file.artifactId}</code></dd></div><div><dt>Version</dt><dd>{file.artifactVersionId ? <code>{file.artifactVersionId}</code> : 'Version metadata unavailable'}</dd></div><div><dt>Read attempts</dt><dd>{formatCount(file.readAttempts)}</dd></div><div><dt>Successful reads</dt><dd>{formatCount(file.successfulReads)}</dd></div><div><dt>Failed reads</dt><dd>{formatCount(file.failedReads)}</dd></div></dl></li>)}</ul>
      </details>}
    </details>
  );
}

function UsageReport({ usage }: { usage: ReviewModelUsage }) {
  const projection = usage.reviewUsage;
  const stages = projection ? orderedStages(projection) : [];
  const totalTokens = projection?.canonicalTotalTokens ?? usage.totals.totalTokens ?? null;
  const unknownTotals = projection?.unknownCanonicalTotalCalls ?? usage.totals.unknownTotalCalls;
  const unknownMetricCalls = (key: 'unknownInputCalls' | 'unknownOutputCalls' | 'unknownCacheReadCalls' | 'unknownCacheCreationCalls') =>
    projection?.byStage.reduce((total, stage) => total + stage[key], 0) ?? usage.totals[key];
  const knownValue = (value: number, unknown: number | undefined) =>
    usage.totals.calls > 0 && (unknown === usage.totals.calls || unknown == null && value === 0) ? undefined : value;
  return (
    <div className="review-usage-report">
      <dl className="review-usage-metrics" aria-label="Recorded Review usage totals">
        <PhaseTokenMetric label="Input tokens" value={knownValue(usage.totals.input, unknownMetricCalls('unknownInputCalls'))} unknownCalls={unknownMetricCalls('unknownInputCalls')} />
        <PhaseTokenMetric label="Output tokens" value={knownValue(usage.totals.output, unknownMetricCalls('unknownOutputCalls'))} unknownCalls={unknownMetricCalls('unknownOutputCalls')} />
        <PhaseTokenMetric label="Cache read tokens" value={knownValue(usage.totals.cacheRead, unknownMetricCalls('unknownCacheReadCalls'))} unknownCalls={unknownMetricCalls('unknownCacheReadCalls')} />
        <PhaseTokenMetric label="Cache creation tokens" value={knownValue(usage.totals.cacheCreation, unknownMetricCalls('unknownCacheCreationCalls'))} unknownCalls={unknownMetricCalls('unknownCacheCreationCalls')} />
        <div><dt>Known total tokens</dt><dd>{formatCount(totalTokens)}{unknownTotals != null && unknownTotals > 0 && <small>{formatCount(unknownTotals)} {unknownTotals === 1 ? 'call has' : 'calls have'} no exact total</small>}</dd></div>
        <div><dt>Recorded calls</dt><dd>{formatCount(usage.totals.calls)}</dd></div>
      </dl>

      <NoResponseAccounting calls={projection?.assumedZeroNoResponseCalls ?? usage.totals.assumedZeroNoResponseCalls} />

      {projection ? <>
        <div className="review-usage-statusline">
          <span className={`review-usage-status is-${projection.status}`}>{formatProjectionStatus(projection.status)}</span>
          <span>{formatCount(projection.totalProviderReportedTokens)} provider-reported total tokens across {formatCount(projection.providerReportedCalls)} calls</span>
          <span>{formatCount(projection.unknownProviderTotalCalls)} {projection.unknownProviderTotalCalls === 1 ? 'call' : 'calls'} without provider-reported totals</span>
        </div>
        {projection.status !== 'available' && <p className="review-usage-muted">Some exact usage or source records are unavailable. Missing measured values stay unavailable; no-response accounting assumptions are shown separately.</p>}
        {projection.reusedAssessments && (projection.reusedAssessments.batchCount !== 0 || projection.reusedAssessments.status !== 'available') && <p className="review-usage-muted" role="status">
          {projection.reusedAssessments.status === 'available'
            ? `${formatCount(projection.reusedAssessments.batchCount)} validated batches reused from earlier Reviews, covering ${formatCount(projection.reusedAssessments.uniqueFileCount)} files. At least ${formatCount(projection.reusedAssessments.minimumCallsAvoided)} new model calls avoided.`
            : 'Exact reused-assessment counts are unavailable.'}
          {' '}Earlier Review costs remain with those Reviews. The totals and AI source inventory here count new requests only.
        </p>}

        {usage.byGroup.length > 0 && <details className="review-usage-groups">
          <summary>Provider and model breakdown ({formatCount(usage.byGroup.length)} groups)</summary>
          <div className="review-usage-table-wrap" role="region" aria-label="Provider and model breakdown" tabIndex={0}>
            <table className="review-usage-table review-usage-group-table" aria-label="Provider and model usage"><thead><tr><th scope="col">Provider</th><th scope="col">Model</th><th scope="col">Calls</th><th scope="col">Input</th><th scope="col">Output</th><th scope="col">Cache read</th><th scope="col">Cache creation</th><th scope="col">Known total</th></tr></thead>
              <tbody>{usage.byGroup.map(group => <tr key={`${group.provider}-${group.apiFormat}-${group.model}`}><th scope="row">{group.provider}</th><td><code>{group.model}</code></td><td>{formatCount(group.totalCalls)}</td>
                <GroupTokenCell value={group.totalInput} unknown={group.unknownInputCalls} calls={group.totalCalls} />
                <GroupTokenCell value={group.totalOutput} unknown={group.unknownOutputCalls} calls={group.totalCalls} />
                <GroupTokenCell value={group.totalCacheRead} unknown={group.unknownCacheReadCalls} calls={group.totalCalls} />
                <GroupTokenCell value={group.totalCacheCreation} unknown={group.unknownCacheCreationCalls} calls={group.totalCalls} />
                <td>{formatCount(group.totalCalls > 0 && group.unknownTotalCalls === group.totalCalls ? null : group.totalTokens)}{group.unknownTotalCalls != null && group.unknownTotalCalls > 0 && <small>{formatCount(group.unknownTotalCalls)} calls unknown</small>}</td></tr>)}</tbody>
            </table>
          </div>
        </details>}

        {stages.length > 0 && <section className="review-usage-stage-section" aria-labelledby="review-usage-stage-heading">
          <div className="review-usage-section-heading"><h3 id="review-usage-stage-heading">Pipeline stages</h3><p>Per-stage file counts can overlap. The source inventory below reports the deduplicated review-wide total.</p></div>
          <div className="review-usage-table-wrap" role="region" aria-label="Usage by Review pipeline stage" tabIndex={0}>
            <table className="review-usage-table" aria-label="Usage by Review pipeline stage"><thead><tr><th scope="col">Stage</th><th scope="col">State</th><th scope="col">Calls</th><th scope="col">Known total</th><th scope="col">AI-referenced files</th></tr></thead>
              <tbody>{stages.map(stage => <tr key={stage.stage}><th scope="row">{STAGES.find(item => item.id === stage.stage)?.label ?? stage.stage}</th><td>{formatStageState(stage.state)}</td><td>{formatCount(stage.calls)}</td><td>{formatCount(stage.canonicalTotalTokens)}{stage.unknownCanonicalTotalCalls > 0 && <small>{formatCount(stage.unknownCanonicalTotalCalls)} calls unknown</small>}</td><td>{formatCount(stage.aiFileCount)}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="review-usage-stage-breakdowns">{stages.map(stage => <DetailedTokenBreakdown key={stage.stage} stage={stage} />)}</div>
        </section>}

        <section className="review-usage-source-section" aria-labelledby="review-usage-source-heading">
          <div className="review-usage-section-heading"><h3 id="review-usage-source-heading">AI source inventory</h3><p>{formatInventoryStatus(projection.sourceInventory.status)}</p></div>
          <p className="review-usage-source-count">{projection.sourceInventory.totalUniqueFiles == null ? 'Exact unique-file total unavailable' : `${formatCount(projection.sourceInventory.totalUniqueFiles)} unique files referenced in AI context`} · {formatCount(projection.sourceInventory.knownUniqueFiles)} identified file records · {formatCount(projection.sourceInventory.aiFileAppearances)} recorded appearances · {formatCount(projection.sourceInventory.unknownAiFileAttempts)} attempts without exact file identity</p>
          {projection.sourceInventory.files.length > 0 && <details className="review-usage-file-disclosure"><summary>View {formatCount(projection.sourceInventory.files.length)} identified AI-referenced files</summary><SourceFileList files={projection.sourceInventory.files} /></details>}
          {projection.sourceInventory.totalUniqueFiles == null && projection.sourceInventory.files.length === 0 && <p className="review-usage-muted">No exact frozen-source identities were available for this review.</p>}
        </section>

        <PhysicalReadDetails projection={projection} />
      </> : <p className="review-usage-muted" role="status">Detailed pipeline and frozen-source accounting was not captured for this review. This can apply to older records. Cache counts are shown separately and are not added to the total.</p>}
    </div>
  );
}

export function ReviewUsageDetails({ projectId, sessionId }: Props) {
  const [usage, setUsage] = useState<ReviewModelUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    setUsage(null);
    setError(null);
    setLoading(false);
    inFlight.current = false;
    sequence.current += 1;
    return () => { sequence.current += 1; };
  }, [projectId, sessionId]);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const requestSequence = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.getReviewModelUsage(projectId, sessionId);
      if (sequence.current === requestSequence) setUsage(result);
    } catch (cause) {
      if (sequence.current === requestSequence) setError(userFacingError(cause, 'Review usage could not be loaded. Try again.'));
    } finally {
      if (sequence.current === requestSequence) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  }, [projectId, sessionId]);

  return (
    <section className="review-usage-panel" aria-label="Review model usage">
      <details className="review-usage-disclosure" onToggle={event => {
        if (event.currentTarget.open && !usage && !error && !loading) void load();
      }}>
        <summary><span>Model usage</span><span className="review-usage-summary-hint">Saved token and source accounting</span></summary>
        <div className="review-usage-content">
          <div className="review-usage-content-heading"><div><h2>Review model usage</h2><p>Recorded provider usage, pipeline stages, and frozen-source references for this review.</p></div>
            <button type="button" className="review-usage-refresh" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : error ? 'Retry loading' : 'Refresh usage'}</button>
          </div>
          {loading && <p className="review-usage-loading" role="status">Loading saved Review usage…</p>}
          {error && <p className="review-usage-error" role="alert">{error}</p>}
          {usage && <UsageReport usage={usage} />}
        </div>
      </details>
    </section>
  );
}
