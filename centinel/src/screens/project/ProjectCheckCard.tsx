import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Code, ListX, MonitorCheck, SquareChartGantt, ArrowUpRight, Download, MessageCircle } from 'lucide-react';
import { api } from '../../api/client';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { Icon } from '../../components/Icon';
import { useCheckData } from '../../check/useCheckData';
import { checkName } from '../../check/checkName';
import { attachConversationCheck } from '../../check/conversation';
import { animateCheckTransition, rememberCheckTransition } from '../../check/checkTransition';
import { rememberProjectPosition } from '../../check/projectNavigation';
import { exportCheckSummary } from '../../check/exportCheckSummary';
import { CheckActionLabel } from '../check/CheckProjectWorkspace';
import type { CheckRecord } from '../../check/types';
import type { Screen } from '../../types';

/** A check's summary in the project conversation. With onOpen, View opens its full result in the side panel. */
export function ProjectCheckCard({ check, onNavigate, onOpen }: { check: CheckRecord; onNavigate: (screen: Screen) => void; onOpen?(check: CheckRecord): void }) {
  const data = useCheckData(check);
  const card = useRef<HTMLElement>(null);
  const gapsId = useId();
  const [gapsOpen, setGapsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  useLayoutEffect(() => { animateCheckTransition(check.id, card.current); }, [check.id]);
  const result = data?.result;
  const ready = !!data && data.evidenceLoaded === true;
  const gaps = ready && result ? [...result.notChecked, ...result.stuckTests.map(test => test.text)] : [];
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
  return <section ref={card} className="pc-card pc-check-card" aria-label={'Check ' + checkName(check)}>
    <div className="pc-check-card-heading">
      <div className="pc-check-card-title">
        <h2><Icon icon={SquareChartGantt} />{checkName(check)}</h2>
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
    {!ready ? !data?.loadError && <LoadingSkeleton className="ck-metrics-skeleton" variant="cards" rows={3} label="Loading saved check" /> : <>
      {!result?.finished && <p role="status">{check.phase === 'failed' ? 'The check could not start.' : 'Check in progress'}</p>}
      <dl className="pc-check-card-counts">
        <div><dt><Icon icon={MonitorCheck} />Proven in the browser</dt><dd>{result?.browserState === 'done' ? result.proven.length : 'Not checked'}</dd></div>
        <div><dt><Icon icon={Code} />Found in code</dt><dd>{result?.codeState === 'done' ? result.foundInCode.length : 'Not checked'}</dd></div>
        <div><dt><Icon icon={ListX} />Requirements not met</dt><dd>{data.requirementsState === 'unavailable' ? 'Requirements unavailable'
          : data.requirementsState === 'loading' ? 'Loading…' : result?.requirements
          ? <>{result.requirements.notMet}{result.requirements.notChecked > 0 && <small> · {result.requirements.notChecked} not checked</small>}</>
          : 'No requirements provided'}</dd></div>
      </dl>
    </>}
    {exportStatus && <p className="pc-sub" role="status">{exportStatus}</p>}
  </section>;
}
