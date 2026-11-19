import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Globe, LoaderCircle, Maximize2, Minimize2, MonitorCheck, MousePointer2, TriangleAlert, WifiOff, X } from 'lucide-react';
import { openLiveStream } from '../../autotest/liveStream';
import { actionCaption, boxRect, cursorPoint, laneNumber, stageHeadline } from '../../autotest/presentation';
import type { AutoTestEntry, AutoTestLane, AutoTestSession, LiveActionEvent } from '../../autotest/types';
import { Icon } from '../../components/Icon';

type LaneView = { frame: string | null; event: LiveActionEvent | null; pressKey: number };
const EMPTY: LaneView = { frame: null, event: null, pressKey: 0 };

export const laneVar = (laneId: string) => `var(--color-lane-${((laneNumber(laneId) - 1) % 4) + 1})`;

function Cursor({ color }: { color: string }) {
  return (
    <svg className="ck-cursor-arrow" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 2.5 19.5 12l-6.8 1.6L9.6 20 4 2.5Z" fill={color} stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function Tile({ lane, test, view, focused, onFocus }: { lane: AutoTestLane; test: AutoTestEntry | undefined; view: LaneView; focused: boolean; onFocus(): void }) {
  const number = laneNumber(lane.id);
  const color = laneVar(lane.id);
  const running = lane.state === 'running' && !!test;
  const point = running ? cursorPoint(view.event) : null;
  const rect = running ? boxRect(view.event) : null;
  const typing = running && view.event?.phase === 'type';
  let address = lane.url ?? 'Starting a copy of the app';
  try { if (lane.url) { const url = new URL(lane.url); address = `${url.host}${test?.startPath ?? url.pathname}`; } } catch { /* keep raw */ }
  const caption = running ? actionCaption(view.event) : lane.state === 'starting' ? 'Starting a copy of the app' : test ? (test.state === 'passed' ? 'Test passed' : test.state === 'failed' ? 'Test found a problem' : 'Waiting for the next test') : 'Waiting for the next test';
  return (
    <article className={`ck-tile${running ? ' is-working' : ''}${focused ? ' is-focused' : ''}`} style={{ ['--lane' as string]: color }} aria-label={`Browser ${number}${test ? `: ${test.name}` : ''}`}>
      <header className="ck-tile-bar">
        <span className="ck-dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="ck-address"><Icon icon={Globe} /><span>{address}</span></span>
        <span className="ck-browser-number">Browser {number}</span>
        <button type="button" className="ck-tile-zoom" onClick={onFocus} aria-label={focused ? 'Back to all browsers' : `Watch browser ${number} full size`}>
          {focused ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
        </button>
      </header>
      <div className="ck-screen-frame">
        {view.frame ? <img src={view.frame} alt={`Live picture of browser ${number}`} draggable={false} /> : (
          <div className="ck-screen-empty"><Icon icon={MonitorCheck} /><span>{lane.state === 'starting' ? 'Starting the app…' : 'The page appears when this browser starts a test.'}</span></div>
        )}
        {rect && <span className="ck-target" style={{ left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%` }} />}
        {point && (
          <span className={`ck-cursor${point.x > 62 ? ' is-flipped' : ''}`} style={{ left: `${point.x}%`, top: `${point.y}%` }}>
            {view.event?.phase === 'press' && <span key={view.pressKey} className="ck-ripple" aria-hidden="true" />}
            <Cursor color={color} />
            {typing && <span className="ck-typing" aria-hidden="true">{view.event?.masked ? '••••' : '•'.repeat(Math.min(view.event?.textLength ?? 3, 12))}<i /></span>}
          </span>
        )}
      </div>
      <p className="ck-tile-caption" aria-live="polite"><Icon icon={running ? MousePointer2 : lane.state === 'starting' ? LoaderCircle : MonitorCheck} className={lane.state === 'starting' ? 'ci-spin' : ''} /><span>{test && running ? `${test.name} · ` : ''}{caption}</span></p>
    </article>
  );
}

const TEST_ICON: Record<string, { icon: typeof Check; tone: string; label: string }> = {
  queued: { icon: LoaderCircle, tone: 'muted', label: 'Waiting' },
  running: { icon: LoaderCircle, tone: 'browser', label: 'Testing' },
  passed: { icon: Check, tone: 'muted', label: 'Passed' },
  failed: { icon: TriangleAlert, tone: 'danger', label: 'Found a problem' },
  uncertain: { icon: TriangleAlert, tone: 'warning', label: 'Unclear result' },
  blocked: { icon: X, tone: 'warning', label: 'Could not run' },
  not_tested: { icon: X, tone: 'muted', label: 'Not run' },
  cancelled: { icon: X, tone: 'muted', label: 'Stopped' },
};

/** Live browsers for one Auto test session, as light browser windows (DESIGN.md §4.2). */
export function BrowserTiles({ session, compact = false }: { session: AutoTestSession; compact?: boolean }) {
  const [views, setViews] = useState<Record<string, LaneView>>({});
  const [connected, setConnected] = useState(true);
  const [focus, setFocus] = useState<string | null>(null);
  const urls = useRef<Record<string, string>>({});
  const active = ['reading', 'starting', 'exploring', 'planning', 'testing', 'summarizing'].includes(session.stage);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    openLiveStream(session.projectId, session.id, message => {
      if (message.type === 'frame') {
        const { frame } = message;
        const bytes = Uint8Array.from(atob(frame.data), char => char.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: frame.mimeType }));
        const previous = urls.current[frame.laneId];
        urls.current[frame.laneId] = url;
        if (previous) setTimeout(() => URL.revokeObjectURL(previous), 1000);
        setViews(current => ({ ...current, [frame.laneId]: { ...(current[frame.laneId] ?? EMPTY), frame: url } }));
      } else if (message.type === 'action') {
        const { event } = message;
        setViews(current => {
          const view = current[event.laneId] ?? EMPTY;
          return { ...current, [event.laneId]: { ...view, event, pressKey: event.phase === 'press' ? view.pressKey + 1 : view.pressKey } };
        });
      }
    }, controller.signal, setConnected);
    return () => controller.abort();
  }, [active, session.projectId, session.id]);

  useEffect(() => () => { Object.values(urls.current).forEach(url => URL.revokeObjectURL(url)); }, []);
  useEffect(() => {
    if (!focus) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setFocus(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus]);

  const byId = useMemo(() => new Map(session.tests.map(test => [test.id, test])), [session.tests]);
  const lanes = focus ? session.lanes.filter(lane => lane.id === focus) : session.lanes;
  const beforeTesting = ['reading', 'starting', 'exploring', 'planning'].includes(session.stage);
  const startupFailed = session.stage === 'failed' && !session.launch?.url;

  return (
    <div className={`ck-browsers${compact ? ' is-compact' : ''}`}>
      {!connected && active && <p className="ck-col-note"><Icon icon={WifiOff} />Reconnecting to the live view…</p>}
      {startupFailed ? <div className="ck-stage">
        <div className="ck-stage-waiting"><Icon icon={TriangleAlert} /><span>The app did not start.</span></div>
      </div> : session.lanes.length === 0 || (beforeTesting && session.lanes.every(lane => lane.state !== 'running')) ? (
        <div className="ck-stage">
          <div className="ck-stage-waiting"><Icon icon={LoaderCircle} className={active ? 'ci-spin' : ''} /><span>{stageHeadline(session)}</span></div>
          {session.launch?.url && <p className="ck-col-note"><Icon icon={Globe} /><span className="ck-mono">{session.launch.url}</span></p>}
          {session.laneNote && <p className="ck-col-note"><Icon icon={MonitorCheck} />{session.laneNote}</p>}
        </div>
      ) : (
        <div className={`ck-stage ck-tiles${focus ? ' is-focused' : ''}`}>
          {lanes.map(lane => {
            const test = (lane.currentTestId ? byId.get(lane.currentTestId) : undefined) ?? [...session.tests].reverse().find(entry => entry.laneId === lane.id);
            return <Tile key={lane.id} lane={lane} test={test} view={views[lane.id] ?? EMPTY} focused={focus === lane.id} onFocus={() => setFocus(focus === lane.id ? null : lane.id)} />;
          })}
        </div>
      )}
      {session.tests.length > 0 && !compact && (
        <ul className="ck-test-list" aria-label="Browser tests">
          {session.tests.map(test => {
            const look = TEST_ICON[test.state] ?? TEST_ICON.queued;
            return (
              <li key={test.id} className={`tone-${look.tone}`} style={test.laneId && test.state === 'running' ? { ['--lane' as string]: laneVar(test.laneId) } : undefined}>
                <Icon icon={look.icon} shape={look.icon === TriangleAlert ? 'triangle' : undefined} className={test.state === 'running' ? 'ci-spin' : ''} />
                <span className="ck-test-name">{test.name}</span>
                <span className="ck-test-state">{test.state === 'running' && test.laneId ? `Browser ${laneNumber(test.laneId)}` : look.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
