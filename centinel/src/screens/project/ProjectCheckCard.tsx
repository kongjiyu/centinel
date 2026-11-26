import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Code, ListX, MonitorCheck, SquareChartGantt, ArrowUpRight, ChevronRight, Copy, Download, MessageCircle, TriangleAlert } from 'lucide-react';
import { api } from '../../api/client';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { Icon } from '../../components/Icon';
import { useCheckData } from '../../check/useCheckData';
import { reviewCoverageGaps } from '../../reviewCoverage';
import { checkName } from '../../check/checkName';
import { attachConversationCheck } from '../../check/conversation';
import { animateCheckTransition, rememberCheckTransition } from '../../check/checkTransition';
import { rememberProjectPosition } from '../../check/projectNavigation';
import { exportCheckSummary } from '../../check/exportCheckSummary';
import { CheckActionLabel } from '../check/CheckProjectWorkspace';
import { LiveView, formatDuration, InlineText } from '../check/CheckScreen';
import { CHECK_MODES, type CheckRecord } from '../../check/types';
import type { Screen } from '../../types';
import { copyConversationText, MessageTime } from './ConversationMessage';
import { BrowserWorkSection, CodeWorkSection, type CheckWorkBranches } from './CheckWorkActivity';
import { stageHeadline } from '../../autotest/presentation';

const checkTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** A check's summary in the project conversation. With onOpen, View opens its full result in the side panel. */
export function ProjectCheckCard({ check, onNavigate, onOpen, showOutcome, externalProgress, renderProgress }: { check: CheckRecord; onNavigate: (screen: Screen) => void; onOpen?(check: CheckRecord): void; showOutcome?: boolean; externalProgress?: boolean; renderProgress?: (work: CheckWorkBranches, currentWork?: ReactNode) => ReactNode }) {
  const data = useCheckData(check);
  const card = useRef<HTMLElement>(null);
  const gapsId = useId();
  const [gapsOpen, setGapsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => {
    if (!copyStatus) return;
    const timer = setTimeout(() => setCopyStatus(''), 1800);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  useLayoutEffect(() => { animateCheckTransition(check.id, card.current); }, [check.id]);
  const result = data?.result;
  const ready = !!data && data.evidenceLoaded === true;
  const running = check.phase !== 'failed' && check.phase !== 'done' && !result?.finished;
  const combined = (check.requestedMode ?? check.mode) === 'both';
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (externalProgress || renderProgress || !running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [externalProgress, renderProgress, running]);
  const gaps = ready && result && !running ? [...result.notChecked, ...result.stuckTests.map(test => test.text)] : [];
  const startedAt = Date.parse(check.createdAt);
  const exportable = ready && result?.finished && data.requirementsState !== 'loading'
    && Boolean(data.review || data.autoTest);
  const download = async () => {
    if (!exportable || !data) return;
    setExporting(true);
    setExportStatus('');
    try {
      if (await exportCheckSummary(check, data)) setExportStatus('Check report exported.');
    } catch {
      setExportStatus('The check report could not be saved. Try again.');
    } finally {
      setExporting(false);
    }
  };
  const open = (explain = false) => {
    // View opens the project's side panel on this check; Ask still opens the check with the explanation draft.
    if (onOpen && !explain) { onOpen(check); return; }
    rememberProjectPosition(check.projectId!, card.current);
    attachConversationCheck(check, explain);
    rememberCheckTransition(check.id, card.current);
    onNavigate({ name: 'check', checkId: check.id });
  };
  const count = data?.findings.length ?? 0;
  const savedReview = data?.review;
  const selectedFiles = savedReview?.scope?.artifactIds ?? check.sourceArtifactIds;
  const codeHasGaps = result?.codeGaps.length || (savedReview && reviewCoverageGaps(savedReview));
  const codeOutcome = result?.codeState === 'done'
      ? `I finished the Code Review and saved ${count === 1 ? 'one finding' : `${count} findings`}.${codeHasGaps ? ' Some scope remains unverified.' : ''}`
      : result?.codeState === 'paused' ? 'The Code Review paused.'
        : 'I couldn’t finish the Code Review.';
  const browserOutcome = result?.browserState === 'done'
    ? `The Browser Check recorded ${result.passedBrowserTests} passed ${result.passedBrowserTests === 1 ? 'test' : 'tests'}.`
    : 'I couldn’t finish the Browser Check.';
  const outcome = !ready || running || !result ? '' : [
    check.mode !== 'browser' && codeOutcome,
    check.mode !== 'code' && browserOutcome,
  ].filter(Boolean).join(' ');
  const outcomeIncomplete = !!result && !running && (check.mode !== 'browser' && result.codeState !== 'done'
    || check.mode !== 'code' && result.browserState !== 'done');
  const end = running ? now : Date.parse(check.finishedAt ?? check.updatedAt);
  const work: CheckWorkBranches = {
    code: data?.review ? <CodeWorkSection data={data} /> : undefined,
    browser: data?.autoTest ? <BrowserWorkSection session={data.autoTest} /> : undefined,
  };
  const currentWork = data?.result.codeState === 'running' && data.review
    ? data.live.currentFiles[0] ? <>Reviewing <code>{data.live.currentFiles[0]}</code></> : data.live.stageLabel
    : data?.result.browserState === 'running' && data.autoTest ? stageHeadline(data.autoTest) : undefined;
  return <Fragment>
    {renderProgress ? renderProgress(work, currentWork) : !externalProgress && Number.isFinite(startedAt) && Number.isFinite(end) && <details open={running} className="pc-progress pc-combined-progress">
      <summary className="pc-progress-summary"><span>{running ? 'Working for' : 'Worked for'} {formatDuration(Math.max(0, end - startedAt))}</span>{running && currentWork && <span>{currentWork}</span>}<Icon icon={ChevronRight} /></summary>
      {(work.code || work.browser) && <div className="pc-progress-body">{work.code}{work.browser}</div>}
    </details>}
    <section ref={card} className="pc-card pc-check-card" aria-label={'Check ' + checkName(check)}>
    <div className="pc-check-card-heading">
      <div className="pc-check-card-title">
        <div className="pc-check-card-name">
          <h2><Icon icon={SquareChartGantt} />{checkName(check)}</h2>
          {Number.isFinite(startedAt) && <time dateTime={check.createdAt}>{checkTime.format(startedAt)}</time>}
        </div>
        <p>{CHECK_MODES.find(mode => mode.value === check.mode)?.label}</p>
        {gaps.length > 0 && <button type="button" className="ck-button is-small pc-check-gaps" aria-expanded={gapsOpen}
          aria-controls={gapsId} onClick={() => setGapsOpen(value => !value)}>
          {gaps.length} unchecked
        </button>}
      </div>
      <div className="ck-header-toolbar pc-check-card-actions" role="group" aria-label="Report actions">
        {exportable && <button type="button" className="ck-toolbar-item" aria-label="Export" disabled={exporting} onClick={() => void download()}>
          <Icon icon={Download} /><CheckActionLabel>{exporting ? 'Exporting…' : 'Export'}</CheckActionLabel>
        </button>}
        {ready && result?.finished && check.projectId && (check.reviewId || check.autoTestId)
          && typeof api.sendConversationRequest === 'function' && <button type="button" className="ck-toolbar-item"
            aria-label="Ask about this check" onClick={() => open(true)}>
            <Icon icon={MessageCircle} /><CheckActionLabel>Ask</CheckActionLabel>
          </button>}
        <button type="button" className="ck-toolbar-item" aria-label="View" onClick={() => open()}>
          <Icon icon={ArrowUpRight} /><CheckActionLabel>View</CheckActionLabel>
        </button>
      </div>
    </div>
    {gaps.length > 0 && <ul id={gapsId} className="pc-check-gap-list" hidden={!gapsOpen}>
      {gaps.map((gap, index) => <li key={index}>{gap}</li>)}
    </ul>}
    {data?.loadError && <p className="pc-sub" role="status">{data.loadError}</p>}
    {/* A running check plays here in the conversation: stages, files, problems so far and the browsers (25 Nov 2026). */}
    {running && data ? <LiveView check={combined ? { ...check, mode: 'both' } : check} data={data} onNavigate={onNavigate} embedded />
    : !ready ? !data?.loadError && <LoadingSkeleton className="ck-metrics-skeleton" variant="cards" rows={check.mode === 'both' ? 3 : 2} label="Loading saved check" /> : <>
      {!result?.finished && <p role="status">{check.phase === 'failed' ? 'The check could not start.' : 'Check in progress'}</p>}
      <dl className="pc-check-card-counts">
        {check.mode !== 'code' && <div><dt><Icon icon={MonitorCheck} />Proven in the browser</dt><dd>{result?.browserState === 'done' ? result.proven.length : 'Not checked'}</dd></div>}
        {check.mode !== 'browser' && <div><dt><Icon icon={Code} />Found in code</dt><dd>{result?.codeState === 'done' ? result.foundInCode.length : 'Not checked'}</dd></div>}
        <div><dt><Icon icon={ListX} />Requirements not met</dt><dd>{data.requirementsState === 'unavailable' ? 'Requirements unavailable'
          : data.requirementsState === 'loading' ? 'Loading…' : result?.requirements
          ? <>{result.requirements.notMet}{result.requirements.notChecked > 0 && <small> · {result.requirements.notChecked} not checked</small>}</>
          : 'No requirements provided'}</dd></div>
      </dl>
    </>}
    {ready && result && !running && <details className="pc-check-details">
      <summary>Show Detail</summary>
      {check.focus && <p><strong>Goal</strong> <InlineText text={check.focus} /></p>}
      {check.mode !== 'browser' && <section aria-label="Code details"><h3>Code details</h3>
        <p><strong>Scope</strong> {selectedFiles?.length
          ? `${selectedFiles.length} files in the saved selection` : 'Open the full result for the saved file scope.'}</p>
        {result.foundInCode.length ? <ul>{result.foundInCode.map(problem => <li key={problem.key}><details><summary>{problem.title}</summary>
          {problem.location && <p><code>{problem.location}</code></p>}{problem.codeSummary && <p><InlineText text={problem.codeSummary} /></p>}
          <button type="button" className="ck-link" onClick={() => open()}>View full result</button>
        </details></li>)}</ul> : <p>{result.codeState === 'done' ? 'No Code problems recorded.' : 'Code results are incomplete.'}</p>}
      </section>}
      {check.mode !== 'code' && <section aria-label="Browser details"><h3>Browser details</h3>
        <p><strong>Scope</strong> {result.browserTestCount} saved tests</p>
        {result.proven.length ? <ul>{result.proven.map(problem => <li key={problem.key}><details><summary>{problem.title}</summary>
          {problem.browserChecks?.map((item, index) => <p key={index}><strong>Expected</strong> {item.expected}<br /><strong>Observed</strong> {item.observed}</p>)}
          <button type="button" className="ck-link" onClick={() => open()}>View full result</button>
        </details></li>)}</ul> : <p>{result.browserState === 'done' ? 'No Browser problems recorded.' : 'Browser results are incomplete.'}</p>}
      </section>}
    </details>}
    {exportStatus && <p className="pc-sub" role="status">{exportStatus}</p>}
  </section>
    {showOutcome && outcome && <div className="pc-agent-message">
      <p className="pc-ai-text pc-check-outcome">
        {outcomeIncomplete && <Icon icon={TriangleAlert} shape="triangle" />}
        <span>{outcome}</span>
      </p>
      <footer className="pc-response-actions" role="group" aria-label="Reply actions">
        <MessageTime at={check.finishedAt ?? check.updatedAt} />
        <button type="button" className="pc-message-action" aria-label="Copy reply" title="Copy reply" onClick={() => {
          void copyConversationText(outcome).then(() => setCopyStatus('Reply copied'), () => setCopyStatus('Copy failed'));
        }}><Copy size={14} aria-hidden="true" /></button>
        <span className="pc-copy-status" role="status">{copyStatus}</span>
      </footer>
    </div>}
  </Fragment>;
}
