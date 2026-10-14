import fs from 'node:fs';
import path from 'node:path';
import type { UsabilityConfig, UsabilityObservation } from './types.js';
export type UsabilityProgress = {
    schemaVersion: 1;
    criterionProof: false;
    phase: 'rules_running' | 'rules_finished' | 'advisory_pending' | 'advisory_finished' | 'stopped';
    config: UsabilityConfig;
    observations: UsabilityObservation[];
    keyboardActions: number;
    updatedAt: string;
    stopReason?: 'execution_stopped' | 'assessment_unavailable';
};
/** Local diagnostic checkpoint, never a terminal check or shared permission bypass. */
export function writeUsabilityProgress(directory: string, progress: UsabilityProgress): void {
    const content = JSON.stringify(progress, null, 2);
    if (Buffer.byteLength(content) > 400000)
        throw Error('Usability progress limit exceeded');
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, 'usability-progress.json'), temporary = target + '.tmp';
    fs.writeFileSync(temporary, content, { mode: 0o600 });
    fs.renameSync(temporary, target);
}
