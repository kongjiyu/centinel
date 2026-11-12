import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, MonitorPlay, WifiOff } from 'lucide-react';
import { openLiveStream } from '../../autotest/liveStream';
import { actionCaption, boxRect, cursorPoint, laneColor, laneNumber, STATE_LABEL, STATE_TONE } from '../../autotest/presentation';
import type { AutoTestEntry, AutoTestLane, LiveActionEvent } from '../../autotest/types';

type LaneView = { frame: string | null; event: LiveActionEvent | null; pressKey: number; steps: LiveActionEvent[] };
const EMPTY: LaneView = { frame: null, event: null, pressKey: 0, steps: [] };

/** Cursor arrow drawn by Centinel over the streamed frame; the website itself is never modified. */
function CursorArrow({ color }: { color: string }) {
  return (
    <svg className="at-cursor-arrow" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 2.5 19.5 12l-6.8 1.6L9.6 20 4 2.5Z" fill={color} stroke="var(--color-surface)" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function LiveTile({ lane, test, view, focused, onToggleFocus }: { lane: AutoTestLane; test: AutoTestEntry | undefined; view: LaneView; focused: boolean; onToggleFocus(): void }) {
  const color = laneColor(lane.id);
  const point = cursorPoint(view.event);
  const rect = boxRect(view.event);
  const typing = view.event?.phase === 'type';
  const running = lane.state === 'running' && !!test;
  const caption = running ? actionCaption(view.event) : lane.state === 'starting' ? 'Starting a copy of the app' : test ? STATE_LABEL[test.state] : 'Waiting for the next test';
  return (
    <article className={`at-tile${focused ? ' is-focused' : ''}`} style={{ ['--lane-color' as string]: color }} aria-label={`Lane ${laneNumber(lane.id)}${test ? `: ${test.name}` : ''}`}>
      <header className="at-tile-header">
        <span className="at-lane-dot" aria-hidden="true" />
        <span className="at-tile-title">
          <strong>Lane {laneNumber(lane.id)}</strong>
          <span>{test?.name ?? (lane.state === 'starting' ? 'Starting app' : 'Idle')}</span>
        </span>
        {test && <span className={`at-chip tone-${STATE_TONE[test.state]}`}>{STATE_LABEL[test.state]}</span>}
        <button type="button" className="at-icon-button" onClick={onToggleFocus} aria-label={focused ? 'Back to all lanes' : `Watch lane ${laneNumber(lane.id)} full size`}>
          {focused ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </header>
      <div className="at-screen">
        {view.frame ? <img src={view.frame} alt={`Live browser for lane ${laneNumber(lane.id)}`} draggable={false} /> : (
          <div className="at-screen-empty"><MonitorPlay size={24} aria-hidden="true" /><span>{lane.state === 'starting' ? 'Starting the app…' : 'The browser appears when this lane starts a test.'}</span></div>
        )}
        {running && rect && <span className="at-target" style={{ left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%` }} />}
        {running && point && (
          <span className={`at-cursor${point.x > 62 ? ' is-flipped' : ''}`} style={{ left: `${point.x}%`, top: `${point.y}%` }}>
            {view.event?.phase === 'press' && <span key={view.pressKey} className="at-ripple" aria-hidden="true" />}
            <CursorArrow color={color} />
            <span className="at-cursor-label">{test ? `Test · ${test.name}` : `Lane ${laneNumber(lane.id)}`}</span>
            {typing && <span className="at-typing" aria-hidden="true">{view.event?.masked ? '••••' : '•'.repeat(Math.min(view.event?.textLength ?? 3, 12))}<i /></span>}
          </span>
        )}
      </div>
      <p className="at-caption" aria-live="polite">{caption}</p>
      {focused && view.steps.length > 0 && (
        <ol className="at-steps" aria-label="Recent actions">
          {view.steps.slice(-8).map(step => <li key={`${step.step}-${step.phase}`}><span className="at-step-number">{step.step}</span>{actionCaption(step)}</li>)}
        </ol>
      )}
    </article>
  );
}

/**
 * Live grid of up to four browsers testing at once (like watching computer use).
 * Frames and cursor events come from the authenticated SSE stream; nothing is stored.
 */
export function AutoTestLiveGrid({ projectId, sessionId, lanes, tests, active }: { projectId: string; sessionId: string; lanes: AutoTestLane[]; tests: AutoTestEntry[]; active: boolean }) {
  const [views, setViews] = useState<Record<string, LaneView>>({});
  const [connected, setConnected] = useState(true);
  const [focus, setFocus] = useState<string | null>(null);
  const urls = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    openLiveStream(projectId, sessionId, message => {
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
          return { ...current, [event.laneId]: { ...view, event: event.phase === 'done' ? { ...event, phase: 'done' } : event, pressKey: event.phase === 'press' ? view.pressKey + 1 : view.pressKey, steps: event.phase === 'move' ? [...view.steps, event].slice(-30) : view.steps } };
        });
      }
    }, controller.signal, setConnected);
    return () => controller.abort();
  }, [active, projectId, sessionId]);

  useEffect(() => () => { Object.values(urls.current).forEach(url => URL.revokeObjectURL(url)); }, []);
  useEffect(() => {
    if (!focus) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setFocus(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus]);

  const byId = useMemo(() => new Map(tests.map(test => [test.id, test])), [tests]);
  const shown = focus ? lanes.filter(lane => lane.id === focus) : lanes;
  return (
    <section className="at-live" aria-label="Live browsers">
      {!connected && active && <p className="at-live-status"><WifiOff size={16} aria-hidden="true" /> Reconnecting to the live view…</p>}
      <div className={`at-grid lanes-${focus ? 1 : Math.min(lanes.length, 4)}`}>
        {shown.map(lane => {
          const test = (lane.currentTestId ? byId.get(lane.currentTestId) : undefined) ?? [...tests].reverse().find(entry => entry.laneId === lane.id);
          return <LiveTile key={lane.id} lane={lane} test={test} view={views[lane.id] ?? EMPTY} focused={focus === lane.id} onToggleFocus={() => setFocus(focus === lane.id ? null : lane.id)} />;
        })}
      </div>
    </section>
  );
}
