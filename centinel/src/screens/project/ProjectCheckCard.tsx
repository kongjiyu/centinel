import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Code, ListX, MonitorCheck, SquareChartGantt, ArrowUpRight, Download, Info } from 'lucide-react';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { Icon } from '../../components/Icon';
import { useCheckData } from '../../check/useCheckData';
import { getCheck, saveCheck } from '../../check/store';
import type { AutoTestSession } from '../../autotest/types';
import { checkName } from '../../check/checkName';
import { attachConversationCheck } from '../../check/conversation';
import { animateCheckTransition, rememberCheckTransition } from '../../check/checkTransition';
import { rememberProjectPosition } from '../../check/projectNavigation';
import { exportCheckSummary } from '../../check/exportCheckSummary';
import { CheckActionLabel, CheckActionToolbar } from '../check/CheckProjectWorkspace';
import { CHECK_MODES, type CheckRecord } from '../../check/types';
import type { Screen } from '../../types';

const checkTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function ProjectCheckCard({ check, onNavigate, savedBrowserSession }: { check: CheckRecord; onNavigate: (screen: Screen) => void; savedBrowserSession?: AutoTestSession }) {
  const data = useCheckData(check, savedBrowserSession);
  const card = useRef<HTMLElement>(null);
  const gapsId = useId();
  const [gapsOpen, setGapsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  useLayoutEffect(() => { animateCheckTransition(check.id, card.current); }, [check.id]);
  const result = data?.result;
  const ready = !!data && data.evidenceLoaded === true;
  const gaps = ready ? result?.notChecked ?? [] : [];
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
  const open = () => {
    if (!getCheck(check.id)) saveCheck(check);
    rememberProjectPosition(check.projectId!, card.current);
    attachConversationCheck(check);
    rememberCheckTransition(check.id, card.current);
    onNavigate({ name: 'check', checkId: check.id });
  };
  return <section ref={card} className="pc-card pc-check-card" aria-label={'Check ' + checkName(check)}>
    <div className="pc-check-card-heading">
      <div className="pc-check-card-title">
        <div className="pc-check-card-name">
          <h2><Icon icon={SquareChartGantt} />{checkName(check)}</h2>
          {Number.isFinite(startedAt) && <time dateTime={check.createdAt}>{checkTime.format(startedAt)}</time>}
        </div>
        <p>{CHECK_MODES.find(mode => mode.value === check.mode)?.label}</p>
      </div>
      <CheckActionToolbar className="pc-check-card-actions" label="Check actions">
        {gaps.length > 0 && <button type="button" className="ck-toolbar-item" aria-label={`${gaps.length} unchecked`} aria-expanded={gapsOpen}
          aria-controls={gapsId} onClick={() => setGapsOpen(value => !value)}>
          <Icon icon={Info} /><CheckActionLabel>{gaps.length} unchecked</CheckActionLabel>
        </button>}
        {exportable && <button type="button" className="ck-toolbar-item" aria-label="Export" disabled={exporting} onClick={() => void download()}>
          <Icon icon={Download} /><CheckActionLabel>{exporting ? 'Exporting…' : 'Export'}</CheckActionLabel>
        </button>}
        <button type="button" className="ck-toolbar-item" aria-label="View" onClick={open}>
          <Icon icon={ArrowUpRight} /><CheckActionLabel>View</CheckActionLabel>
        </button>
      </CheckActionToolbar>
    </div>
    {gaps.length > 0 && <ul id={gapsId} className="pc-check-gap-list" hidden={!gapsOpen}>
      {gaps.map((gap, index) => <li key={index}>{gap}</li>)}
    </ul>}
    {data?.loadError && <p className="pc-sub" role="status">{data.loadError}</p>}
    {!ready ? !data?.loadError && <LoadingSkeleton className="ck-metrics-skeleton" variant="cards" rows={check.mode === 'both' ? 3 : 2} label="Loading saved check" /> : <>
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
    {exportStatus && <p className="pc-sub" role="status">{exportStatus}</p>}
  </section>;
}
