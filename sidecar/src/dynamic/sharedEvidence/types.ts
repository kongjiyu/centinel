export const SHARED_EVIDENCE_BUCKET = 'dynamic-evidence';
export const MAX_SHARED_EVIDENCE_BYTES = 4 * 1024 * 1024;
export type EvidenceCopy = {
    id: string;
    projectId: string;
    runId: string;
    evidenceId: string;
    kind: 'screenshot' | 'checks' | 'file_manifest' | 'usability' | import('./artifacts.js').ArtifactKind;
    sha256: string;
    bytes: number;
    mimeType: string;
    criterionProof?: false;
    sourceSha256?: string;
    privacyVersion?: 1;
    availability: 'pending' | 'available' | 'failed' | 'expired' | 'deleting' | 'deleted';
    expiresAt: string;
    executorId: string;
    syncedBy: string | null;
    deletedBy?: string | null;
    createdAt: string;
    updatedAt: string;
};
export type EvidenceTransfer = {
    copy: EvidenceCopy;
    objectPath: string;
    token: string | null;
};
