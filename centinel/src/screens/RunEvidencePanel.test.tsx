import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunEvidencePanel } from './RunEvidencePanel';
import { api } from '../api/client';
import type { DynamicRun } from '../dynamic/types';
import type { EvidenceCopy } from '../../../sidecar/src/dynamic/sharedEvidence/types';
vi.mock('../api/client', () => ({ api: { dynamicEvidenceCopies: vi.fn(), dynamicRecordedEvidenceBlob: vi.fn(), syncDynamicEvidence: vi.fn(), deleteDynamicEvidenceCopy: vi.fn(),shareDynamicRunArtifacts:vi.fn() } }));
const run = { id: 'r',createdBy:'owner', state: 'completed', evidence: [{ id: 'proof', kind: 'screenshot' }] } as DynamicRun;
const copy = { id: 'copy', runId: 'r', projectId: 'p', evidenceId: 'proof', kind: 'screenshot', sha256: 'a'.repeat(64), bytes: 100, mimeType: 'image/png', availability: 'available', expiresAt: '2026-10-21T00:00:00Z', executorId: 'executor', syncedBy: 'sync-actor', createdAt: '', updatedAt: '' } as EvidenceCopy;
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.dynamicEvidenceCopies).mockResolvedValue([copy]); vi.mocked(api.dynamicRecordedEvidenceBlob).mockResolvedValue(new Blob(['PNG'], { type: 'image/png' })); URL.createObjectURL = vi.fn().mockReturnValue('blob:verified'); URL.revokeObjectURL = vi.fn();sessionStorage.setItem('centinel:supabase-user-id','owner'); });
describe('Private Run evidence availability', () => {
    it('reads a shared screenshot by project/Run/copy ID without exposing a signed URL or local path', async () => { render(<RunEvidencePanel projectId="p" run={run}/>); expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:verified'); expect(api.dynamicRecordedEvidenceBlob).toHaveBeenCalledWith('p', 'r', 'copy', 'shared'); expect(screen.getByText('Shared copy verified for this account.')).toBeInTheDocument(); });
    it('falls back to a verified local file when the cloud transfer is unavailable', async () => { vi.mocked(api.dynamicRecordedEvidenceBlob).mockRejectedValueOnce(Error('Offline')).mockResolvedValueOnce(new Blob(['PNG'])); render(<RunEvidencePanel projectId="p" run={run}/>); await screen.findByRole('img'); expect(api.dynamicRecordedEvidenceBlob).toHaveBeenNthCalledWith(2, 'p', 'r', 'proof', 'local'); expect(screen.getByText('Shared copy unavailable; verified local copy shown.')).toBeInTheDocument(); });
    it('does not fetch expired shared bytes and shows a missing local file honestly', async () => { vi.mocked(api.dynamicEvidenceCopies).mockResolvedValue([{ ...copy, availability: 'expired' }]); vi.mocked(api.dynamicRecordedEvidenceBlob).mockRejectedValue(Error('No local file')); render(<RunEvidencePanel projectId="p" run={run}/>); expect(await screen.findByText(/Screenshot unavailable here/)).toBeInTheDocument(); expect(api.dynamicRecordedEvidenceBlob).toHaveBeenCalledWith('p', 'r', 'proof', 'local'); expect(screen.queryByRole('img')).not.toBeInTheDocument(); });
    it('requires concrete deletion confirmation and preserves metadata after removal', async () => { vi.mocked(api.deleteDynamicEvidenceCopy).mockResolvedValue({ ...copy, availability: 'deleted' }); const user = userEvent.setup(); render(<RunEvidencePanel projectId="p" run={run}/>); await screen.findByRole('img'); await user.click(screen.getByRole('button', { name: 'Delete shared copy' })); expect(api.deleteDynamicEvidenceCopy).not.toHaveBeenCalled(); expect(screen.getByRole('group', { name: 'Confirm shared-copy deletion' })).toBeInTheDocument(); vi.mocked(api.dynamicEvidenceCopies).mockResolvedValue([{ ...copy, availability: 'deleted' }]); await user.click(screen.getByRole('button', { name: 'Confirm deletion' })); await waitFor(() => expect(api.deleteDynamicEvidenceCopy).toHaveBeenCalledWith('p', 'r', 'copy')); expect(await screen.findByText(/Deleted · 100 bytes/)).toBeInTheDocument(); });
    it('retains honest pending state after a failed sync so the operator can retry', async () => { vi.mocked(api.dynamicEvidenceCopies).mockResolvedValue([{ ...copy, availability: 'pending' }]); vi.mocked(api.syncDynamicEvidence).mockRejectedValue(Error('Transfer failed')); render(<RunEvidencePanel projectId="p" run={run}/>); await screen.findByRole('img'); await userEvent.click(screen.getByRole('button', { name: 'Sync independent evidence' })); expect(await screen.findByRole('alert')).toBeInTheDocument(); expect(screen.getByText(/Pending · 100 bytes/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Sync independent evidence' })).toBeEnabled(); });
});

it('keeps partial diagnostics distinct from criteria and discloses missing final budget',async()=>{
 const stopped={...run,state:'interrupted' as const,evidence:[]};
 const partial={...copy,kind:'partial_trace' as const,criterionProof:false as const,sourceSha256:'b'.repeat(64),privacyVersion:1 as const,mimeType:'application/json'};
 vi.mocked(api.dynamicEvidenceCopies).mockResolvedValue([]);vi.mocked(api.shareDynamicRunArtifacts).mockResolvedValue({artifacts:[],copies:[partial],omitted:[{slot:'budget',reason:'Unavailable after worker loss'}]});
 render(<RunEvidencePanel projectId="p" run={stopped}/>);
 await screen.findByText('No independent screenshot was recorded.');
 vi.mocked(api.dynamicEvidenceCopies).mockResolvedValue([partial]);
 await userEvent.click(screen.getByRole('button',{name:'Share diagnostics and captured files'}));
 expect(await screen.findByText('Partial action trace')).toBeInTheDocument();
 expect(screen.getByText(/does not independently verify a criterion/)).toBeInTheDocument();
 expect(screen.getByText('budget: Unavailable after worker loss')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Sync independent evidence'})).toBeDisabled();
});
it('prevents a different account from publishing private diagnostic/captured artifacts',async()=>{
 sessionStorage.setItem('centinel:supabase-user-id','other');render(<RunEvidencePanel projectId="p" run={run}/>);await screen.findByRole('img');expect(screen.getByRole('button',{name:'Share diagnostics and captured files'})).toBeDisabled();expect(api.shareDynamicRunArtifacts).not.toHaveBeenCalled();
});

it('loads missing artifact availability from a shared manifest on another account',async()=>{
 sessionStorage.setItem('centinel:supabase-user-id','reader');
 const text=JSON.stringify({schemaVersion:1,criterionProof:false,privacyVersion:1,omitted:[{slot:'budget',reason:'Unavailable after interruption'}]});
 const manifest={...copy,id:'manifest',kind:'partial_manifest' as const,mimeType:'application/json',bytes:text.length,criterionProof:false as const};
 vi.mocked(api.dynamicEvidenceCopies).mockResolvedValue([manifest]);
 vi.mocked(api.dynamicRecordedEvidenceBlob).mockResolvedValue({size:text.length,text:async()=>text} as Blob);
 render(<RunEvidencePanel projectId="p" run={{...run,state:'interrupted',evidence:[]}}/>);
 expect(await screen.findByText('budget: Unavailable after interruption')).toBeInTheDocument();
 expect(screen.getByText('Partial artifact availability manifest')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Share diagnostics and captured files'})).toBeDisabled();
});
