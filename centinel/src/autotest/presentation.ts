import type { AutoTestSession, AutoTestStage, AutoTestState, LiveActionEvent } from './types';

/** Lane cursor colours from the existing palette (forest, teal, amber, stone); text labels always accompany them. */
export const LANE_COLORS = ['var(--color-primary)', 'var(--color-info)', 'var(--color-warning)', 'var(--color-text-muted)'];
export const laneColor = (laneId: string) => LANE_COLORS[(Number(laneId.replace(/\D/g, '')) - 1) % LANE_COLORS.length] ?? LANE_COLORS[0];
export const laneNumber = (laneId: string) => Number(laneId.replace(/\D/g, '')) || 1;

export const STAGES: Array<{ stage: AutoTestStage; label: string }> = [
  { stage: 'reading', label: 'Read the code' },
  { stage: 'starting', label: 'Start the app' },
  { stage: 'exploring', label: 'Explore pages' },
  { stage: 'planning', label: 'Write tests' },
  { stage: 'testing', label: 'Run tests' },
  { stage: 'summarizing', label: 'Results' },
];

export function stageStatus(session: AutoTestSession, stage: AutoTestStage): 'done' | 'current' | 'upcoming' | 'failed' {
  const order = STAGES.map(entry => entry.stage);
  if (session.stage === 'completed') return 'done';
  const reached = order.indexOf(session.stage);
  const index = order.indexOf(stage);
  if (session.stage === 'failed' || session.stage === 'cancelled') {
    const lastReached = lastActiveStage(session);
    const last = order.indexOf(lastReached);
    return index < last ? 'done' : index === last ? 'failed' : 'upcoming';
  }
  return index < reached ? 'done' : index === reached ? 'current' : 'upcoming';
}

/** For a stopped session, the stage it was in when it stopped (inferred from what was recorded). */
export function lastActiveStage(session: AutoTestSession): AutoTestStage {
  if (session.summary) return 'summarizing';
  if (session.tests.some(test => test.runId)) return 'testing';
  if (session.exploration) return 'planning';
  if (session.launch?.url) return 'exploring';
  if (session.repository) return 'starting';
  return 'reading';
}

export const STATE_LABEL: Record<AutoTestState, string> = {
  queued: 'Waiting', running: 'Testing', passed: 'Passed', failed: 'Failed', uncertain: 'Uncertain',
  blocked: 'Blocked', not_tested: 'Not tested', cancelled: 'Cancelled',
};
export const STATE_TONE: Record<AutoTestState, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  queued: 'neutral', running: 'info', passed: 'success', failed: 'danger', uncertain: 'warning',
  blocked: 'warning', not_tested: 'neutral', cancelled: 'neutral',
};

const ACTION_VERB: Record<string, string> = {
  click: 'Clicking', click_visual: 'Clicking', type: 'Typing into', type_secret: 'Typing a private value into',
  select_option: 'Choosing an option in', set_checked: 'Ticking', upload_file: 'Uploading a file to', download_file: 'Downloading from',
};
export function actionCaption(event: LiveActionEvent | null): string {
  if (!event) return 'Waiting for the first action';
  const verb = ACTION_VERB[event.action] ?? 'Using';
  const target = event.targetLabel?.trim() || 'the page';
  return `${verb} ${target}`;
}

/** Centre of the target in percentages of the frame, so the overlay scales with the image. */
export function cursorPoint(event: LiveActionEvent | null): { x: number; y: number } | null {
  if (!event?.box || !event.viewport.width || !event.viewport.height) return null;
  const x = ((event.box.x + event.box.width / 2) / event.viewport.width) * 100;
  const y = ((event.box.y + event.box.height / 2) / event.viewport.height) * 100;
  return { x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) };
}

export function boxRect(event: LiveActionEvent | null): { left: number; top: number; width: number; height: number } | null {
  if (!event?.box || !event.viewport.width || !event.viewport.height) return null;
  const { box, viewport } = event;
  return { left: (box.x / viewport.width) * 100, top: (box.y / viewport.height) * 100, width: (box.width / viewport.width) * 100, height: (box.height / viewport.height) * 100 };
}

export function stageHeadline(session: AutoTestSession): string {
  switch (session.stage) {
    case 'reading': return 'Reading the code';
    case 'starting': return session.launch?.installing ? 'Installing the app’s dependencies' : 'Starting the app';
    case 'exploring': return 'Exploring the running app';
    case 'planning': return 'Writing tests from the code and requirements';
    case 'testing': {
      const done = session.tests.filter(test => !['queued', 'running'].includes(test.state)).length;
      return `Testing · ${done} of ${session.tests.length} finished`;
    }
    case 'summarizing': return 'Writing the results';
    case 'completed': return 'Auto test finished';
    case 'cancelled': return 'Auto test cancelled';
    case 'failed': return 'Auto test stopped';
  }
}
