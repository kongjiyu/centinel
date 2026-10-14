export const SHARED_EVIDENCE_BUCKET = 'dynamic-evidence';
export const MAX_SHARED_EVIDENCE_BYTES = 4 * 1024 * 1024;
export type EvidenceCopy = {
    id: string;
    projectId: string;
    runId: string;
    evidenceId: string;
    kind: 'screenshot' | 'checks' | 'file_manifest';
    sha256: string;
    bytes: number;
    mimeType: 'image/png' | 'application/json';
    availability: 'pending' | 'available' | 'failed' | 'expired' | 'deleting' | 'deleted';
    expiresAt: string;
    executorId: string;
    syncedBy: string | null; deletedBy?:string|null;
    createdAt: string;
    updatedAt: string;
};
export type EvidenceTransfer = {
    copy: EvidenceCopy;
    objectPath: string;
    token: string | null;
};
