import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DynamicContractError, type DynamicRun, type EvidenceReference } from '../types.js';
import { MAX_SHARED_EVIDENCE_BYTES } from './types.js';
const names = { screenshot: 'criterion-page.png', checks: 'checks.json', file_manifest: 'file-manifest.json', usability:'usability.json' };
/** Clients provide Run IDs only. Local filenames come from verified artifact kinds. */
export function readBoundedArtifactSlot(workspace: string, run: DynamicRun, name: string): Buffer {
    if (!run.legacySessionId || !(/^[a-f0-9-]{36}$/i.test(run.legacySessionId)) || !(/^[a-z0-9-]+\.(json|png)$/.test(name)))
        throw new DynamicContractError(409, 'Recorded artifact slot is unavailable.');
    const file = path.join(workspace, 'sessions', run.legacySessionId, 'logs', name);
    let data: Buffer;
    let fd: number | undefined;
    try {
        const root = fs.realpathSync(workspace);
        const real = fs.realpathSync(file);
        if (!real.startsWith(root + path.sep) || fs.lstatSync(file).isSymbolicLink())
            throw Error('Outside workspace');
        fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.size < 1 || stat.size > MAX_SHARED_EVIDENCE_BYTES)
            throw Error('Bound exceeded');
        const buffer = Buffer.alloc(stat.size + 1);
        let count = 0;
        while (count < buffer.length) {
            const n = fs.readSync(fd, buffer, count, buffer.length - count, null);
            if (!n)
                break;
            count += n;
        }
        if (count !== stat.size)
            throw Error('File changed');
        data = buffer.subarray(0, count);
    }
    catch {
        throw new DynamicContractError(409, 'Independent evidence is missing or exceeds its shared-copy limit.');
    }
    finally {
        if (fd !== undefined)
            fs.closeSync(fd);
    }
    return data;
}
export function loadIndependentEvidence(workspace: string, run: DynamicRun, ref: EvidenceReference): Buffer {
    if (!run.legacySessionId || !(/^[a-f0-9-]{36}$/i.test(run.legacySessionId)) || !Object.hasOwn(names, ref.kind))
        throw new DynamicContractError(409, 'Independent evidence is unavailable on this device.');
    const data = readBoundedArtifactSlot(workspace, run, names[ref.kind]);
    if (crypto.createHash('sha256').update(data).digest('hex') !== ref.sha256)
        throw new DynamicContractError(409, 'Local evidence no longer matches the immutable Run checksum.');
    if (ref.kind === 'screenshot') {
        if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
            throw new DynamicContractError(409, 'Recorded screenshot is not a PNG.');
    }
    else
        try {
            JSON.parse(data.toString('utf8'));
        }
        catch {
            throw new DynamicContractError(409, 'Recorded evidence JSON is unreadable.');
        }
    return data;
}
