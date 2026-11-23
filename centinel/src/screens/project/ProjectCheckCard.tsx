import { useLayoutEffect, useRef } from 'react';
import { Code, ListX, MonitorCheck, ArrowRight, LoaderCircle } from 'lucide-react';
import { Icon } from '../../components/Icon';
import { useCheckData } from '../../check/useCheckData';
import { checkName } from '../../check/checkName';
import { attachConversationCheck } from '../../check/conversation';
import { animateCheckTransition, rememberCheckTransition } from '../../check/checkTransition';
import { rememberProjectPosition } from '../../check/projectNavigation';
import type { CheckRecord } from '../../check/types';
import type { Screen } from '../../types';

/** A check's summary in the project conversation. With onOpen, View opens its full result in the side panel. */
export function ProjectCheckCard({ check, onNavigate, onOpen }: { check: CheckRecord; onNavigate: (screen: Screen) => void; onOpen?(check: CheckRecord): void }) {
  const data = useCheckData(check);
  const card = useRef<HTMLElement>(null);
  useLayoutEffect(() => { animateCheckTransition(check.id, card.current); }, [check.id]);
  const result = data?.result;
  const ready = !!data && data.evidenceLoaded === true;
  const open = () => {
    if (onOpen) { onOpen(check); return; }
    rememberProjectPosition(check.projectId!, card.current);
    attachConversationCheck(check);
    rememberCheckTransition(check.id, card.current);
    onNavigate({ name: 'check', checkId: check.id });
  };
  return <section ref={card} className="pc-card pc-check-card" aria-label={'Check ' + checkName(check)}>
    <div className="pc-check-card-heading"><h2>{checkName(check)}</h2>
      <button type="button" className="ck-button is-small" onClick={open}>View<Icon icon={ArrowRight} /></button></div>
    {!ready ? <p role="status"><Icon icon={LoaderCircle} />Loading saved check…</p> : <>
      {!result?.finished && <p role="status">{check.phase === 'failed' ? 'The check could not start.' : 'Check in progress'}</p>}
      {data.loadError && <p role="status">{data.loadError}</p>}
      {result?.notChecked.length || result?.stuckTests.length ? <p className="pc-label">Some parts could not be checked. View shows which.</p> : null}
      <dl className="pc-check-card-counts">
        <div><dt><Icon icon={MonitorCheck} />Proven in the browser</dt><dd>{result?.browserState === 'done' ? result.proven.length : 'Not checked'}</dd></div>
        <div><dt><Icon icon={Code} />Found in code</dt><dd>{result?.codeState === 'done' ? result.foundInCode.length : 'Not checked'}</dd></div>
        <div><dt><Icon icon={ListX} />Requirements not met</dt><dd>{data.requirementsState === 'unavailable' ? 'Requirements unavailable'
          : data.requirementsState === 'loading' ? 'Loading…' : result?.requirements
          ? <>{result.requirements.notMet}{result.requirements.notChecked > 0 && <small> · {result.requirements.notChecked} not checked</small>}</>
          : 'No requirements provided'}</dd></div>
      </dl>
    </>}
  </section>;
}
