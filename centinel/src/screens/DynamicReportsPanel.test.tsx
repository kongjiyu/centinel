import {beforeEach,describe,it,expect,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {api} from '../api/client';
import {DynamicReportsPanel} from './DynamicReportsPanel';
import {saveDynamicReport} from '../dynamic/saveReport';
vi.mock('../api/client',()=>({api:{dynamicReports:vi.fn(),captureDynamicReport:vi.fn(),dynamicReportExport:vi.fn()}}));
vi.mock('../dynamic/saveReport',()=>({saveDynamicReport:vi.fn().mockResolvedValue('saved')}));
const metadata={reportId:'report-one',projectId:'project',runId:'run',actorId:'reader',generatedAt:'2026-10-15T00:00:00Z',schemaVersion:'centinel-dynamic-report-v1',generatorVersion:'dynamic-report-1'} as const;
beforeEach(()=>{vi.clearAllMocks();vi.mocked(api.dynamicReports).mockResolvedValue([]);});
describe('Dynamic report snapshots',()=>{
 it('reuses the capture identity after transport uncertainty and exports only a recorded report',async()=>{vi.mocked(api.captureDynamicReport).mockRejectedValueOnce(Error('Connection lost')).mockResolvedValueOnce({metadata} as any);vi.mocked(api.dynamicReportExport).mockResolvedValue({bytes:new Uint8Array(),sha256:'hash',filename:'report.pdf',mimeType:'application/pdf'});render(<DynamicReportsPanel projectId="project" runId="run"/>);await screen.findByText('No report snapshots recorded for this Run.');fireEvent.click(screen.getByRole('button',{name:'Capture report snapshot'}));await screen.findByRole('alert');await waitFor(()=>expect(screen.getByRole('button',{name:'Capture report snapshot'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Capture report snapshot'}));await screen.findByRole('button',{name:'PDF'});expect(vi.mocked(api.captureDynamicReport).mock.calls[0][2]).toBe(vi.mocked(api.captureDynamicReport).mock.calls[1][2]);fireEvent.click(screen.getByRole('button',{name:'PDF'}));await waitFor(()=>expect(saveDynamicReport).toHaveBeenCalledOnce());expect(api.dynamicReportExport).toHaveBeenCalledWith('project','report-one','pdf');});
 it('ignores an old Run history response after selection changes',async()=>{let resolve!:(x:any)=>void;vi.mocked(api.dynamicReports).mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValueOnce([]);const view=render(<DynamicReportsPanel projectId="project" runId="old"/>);view.rerender(<DynamicReportsPanel projectId="project" runId="new"/>);await screen.findByText('No report snapshots recorded for this Run.');resolve([metadata]);await waitFor(()=>expect(screen.queryByRole('button',{name:'PDF'})).not.toBeInTheDocument());});
});
