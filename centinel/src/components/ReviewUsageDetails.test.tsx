import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import type { ReviewModelUsage, ReviewUsagePhase, ReviewUsageProjection } from '../types';
import { ReviewUsageDetails } from './ReviewUsageDetails';

vi.mock('../api/client', () => ({ api: { getReviewModelUsage: vi.fn() } }));

const file: ReviewUsageProjection['sourceInventory']['files'][number] = {
  artifactId: 'artifact-4',
  artifactVersionId: 'version-frozen-9',
  contentHash: 'sha256:abc123',
  filePath: 'src/payments/checkout.ts',
  appearances: 1,
  stages: ['model_analysis'],
  phases: ['initial_analysis'] as ReviewUsagePhase[],
  ranges: [{ lineStart: 12, lineEnd: 24 }],
};

function stage(id: string, overrides: Partial<ReviewUsageProjection['byStage'][number]> = {}): ReviewUsageProjection['byStage'][number] {
  return {
    stage: id,
    operations: [`${id}:operation-1`],
    state: 'completed',
    calls: 1,
    successfulCalls: 1,
    failedCalls: 0,
    cancelledCalls: 0,
    inProgressCalls: 0,
    repairCalls: 0,
    phases: [{ phase: 'initial_analysis', calls: 1, repairCalls: 0 }],
    inputTokens: 100,
    unknownInputCalls: 0,
    outputTokens: 20,
    unknownOutputCalls: 0,
    cacheReadTokens: 40,
    unknownCacheReadCalls: 0,
    cacheCreationTokens: 10,
    unknownCacheCreationCalls: 0,
    providerReportedTotalTokens: 120,
    providerReportedTotalCalls: 1,
    unknownProviderTotalCalls: 0,
    canonicalTotalTokens: 120,
    unknownCanonicalTotalCalls: 0,
    requestContext: {
      callsWithContext: 1,
      callsWithoutContext: 0,
      estimatedInputTokens: 95,
      estimatedCalls: 1,
      componentsCharacters: { system: 100 },
    },
    aiFileCount: 0,
    aiFileAppearances: 0,
    aiFiles: [],
    physicalReadAttempts: 0,
    physicalReadFileCount: 0,
    physicalFiles: [],
    ...overrides,
  };
}

function usage(reviewUsage?: ReviewUsageProjection): ReviewModelUsage {
  return {
    totals: {
      input: 200,
      output: 40,
      cacheRead: 80,
      cacheCreation: 20,
      calls: 3,
      totalTokens: 240,
      providerReportedTotalTokens: 240,
      providerReportedCalls: 2,
      unknownTotalCalls: 1,
    },
    byGroup: [{
      provider: 'codex',
      apiFormat: 'codex-app-server',
      model: 'gpt-6.1-sol',
      totalInput: 200,
      totalOutput: 40,
      totalCacheRead: 80,
      totalCacheCreation: 20,
      totalCalls: 3,
      totalTokens: 240,
      providerReportedTotalTokens: 240,
      providerReportedCalls: 2,
      unknownTotalCalls: 1,
    }],
    recent: [],
    ...(reviewUsage ? { reviewUsage } : {}),
  };
}

function projection(overrides: Partial<ReviewUsageProjection> = {}): ReviewUsageProjection {
  return {
    status: 'partial',
    totalProviderReportedTokens: 240,
    providerReportedCalls: 2,
    unknownProviderTotalCalls: 1,
    canonicalTotalTokens: 240,
    unknownCanonicalTotalCalls: 1,
    byStage: [
      stage('model_analysis:batch-1', { aiFileCount: 1, aiFileAppearances: 1, aiFiles: [file] }),
      stage('model_analysis:batch-2', { aiFileCount: 1, aiFileAppearances: 1, aiFiles: [{ ...file, appearances: 1 }] }),
    ],
    sourceInventory: {
      status: 'partial',
      totalUniqueFiles: null,
      knownUniqueFiles: 1,
      aiFileAppearances: null,
      repeatedFileAppearances: null,
      unknownAiFileAttempts: 1,
      files: [{ ...file, stages: ['model_analysis'] }],
      physical: {
        status: 'partial',
        readAttempts: 3,
        uniqueFiles: 1,
        unknownReadAttempts: 0,
        byStage: [{ stage: 'freezing_sources', readAttempts: 3, uniqueFiles: 1, files: [{
          artifactId: 'artifact-4', artifactVersionId: 'version-frozen-9', contentHash: 'sha256:abc123', filePath: 'src/payments/checkout.ts', readAttempts: 3, successfulReads: 2, failedReads: 1, lines: 40, characters: 1200,
        }] }],
      },
    },
    ...overrides,
  };
}

describe('ReviewUsageDetails', () => {
  it('distinguishes reused validated evidence from new model calls and costs', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getReviewModelUsage).mockResolvedValue(usage(projection({ reusedAssessments: {
      status: 'available', batchCount: 3, minimumCallsAvoided: 6, originReviewIds: ['parent'], uniqueFileCount: 12, files: [],
    } })));
    render(<ReviewUsageDetails projectId="project-1" sessionId="review-7" />);
    await user.click(screen.getByText('Model usage'));
    expect(await screen.findByText(/3 validated batches reused from earlier Reviews, covering 12 files/)).toHaveTextContent('At least 6 new model calls avoided');
    expect(screen.getByText(/Earlier Review costs remain with those Reviews/)).toHaveTextContent('AI source inventory here count new requests only');
  });
  it('does not display an all-unknown provider group as measured zero tokens', async () => {
    const user = userEvent.setup(); const report = usage(projection());
    report.byGroup = [{ provider: 'codex', apiFormat: 'codex-app-server', model: 'gpt-6.1-sol', totalCalls: 1,
      totalInput: 0, totalOutput: 0, totalCacheRead: 0, totalCacheCreation: 0, totalTokens: 0,
      unknownInputCalls: 1, unknownOutputCalls: 1, unknownCacheReadCalls: 1, unknownCacheCreationCalls: 1, unknownTotalCalls: 1 }];
    vi.mocked(api.getReviewModelUsage).mockResolvedValue(report);
    render(<ReviewUsageDetails projectId="project-1" sessionId="review-7" />);
    await user.click(screen.getByText('Model usage'));
    await screen.findByRole('table', { name: 'Usage by Review pipeline stage' });
    await user.click(screen.getByText('Provider and model breakdown (1 groups)'));
    const row = within(screen.getByRole('table', { name: 'Provider and model usage' })).getAllByRole('row')[1];
    expect(within(row).getAllByRole('cell').filter(cell => cell.textContent?.startsWith('—'))).toHaveLength(5);
    expect(within(row).getAllByText('1 calls unknown')).toHaveLength(5);
  });
  it('shows no-response zero assumptions separately from unknown actual usage at every level', async () => {
    const user = userEvent.setup();
    const report = usage(projection({ assumedZeroNoResponseCalls: 1, assumedZeroNoResponseTokens: 0, accountedTokens: 240,
      byStage: [stage('model_analysis', { calls: 3, unknownCanonicalTotalCalls: 1, canonicalTotalTokens: 240,
        assumedZeroNoResponseCalls: 1, assumedZeroNoResponseTokens: 0, accountedTokens: 240,
        phases: [{ phase: 'initial_analysis', calls: 3, repairCalls: 0, canonicalTotalTokens: 240, unknownCanonicalTotalCalls: 1,
          assumedZeroNoResponseCalls: 1, assumedZeroNoResponseTokens: 0, accountedTokens: 240 }] })] }));
    vi.mocked(api.getReviewModelUsage).mockResolvedValue(report);
    render(<ReviewUsageDetails projectId="project-1" sessionId="review-7" />);
    await user.click(screen.getByText('Model usage'));
    await screen.findByRole('table', { name: 'Usage by Review pipeline stage' });
    expect(screen.getAllByText(/No-response accounting: 1 failed call counted as 0 tokens/)).toHaveLength(3);
    expect(within(screen.getByLabelText('Recorded Review usage totals')).getByText('1 call has no exact total')).toBeInTheDocument();
    expect(screen.getAllByText(/actual provider consumption remains unknown/)).toHaveLength(3);
  });
  it('shows unreported cache values as unknown rather than a measured zero', async () => {
    const user = userEvent.setup();
    const report = usage(projection({byStage:[stage('model_analysis',{calls:3,cacheCreationTokens:0,unknownCacheCreationCalls:3})]}));
    report.totals.cacheCreation = 0;
    vi.mocked(api.getReviewModelUsage).mockResolvedValue(report);
    render(<ReviewUsageDetails projectId="project-1" sessionId="review-7" />);
    await user.click(screen.getByText('Model usage'));
    await screen.findByRole('table',{name:'Usage by Review pipeline stage'});
    const metric=within(screen.getByLabelText('Recorded Review usage totals')).getByText('Cache creation tokens').parentElement;
    expect(metric).toHaveTextContent('—3 calls unknown');
  });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.getReviewModelUsage).mockResolvedValue(usage(projection()));
  });

  it('does not request saved usage until the disclosure is opened', async () => {
    const user = userEvent.setup();
    render(<ReviewUsageDetails projectId="project-1" sessionId="review-7" />);
    expect(api.getReviewModelUsage).not.toHaveBeenCalled();

    await user.click(screen.getByText('Model usage'));
    expect(await screen.findByRole('heading', { name: 'Review model usage' })).toBeInTheDocument();
    expect(api.getReviewModelUsage).toHaveBeenCalledOnce();
    expect(api.getReviewModelUsage).toHaveBeenCalledWith('project-1', 'review-7');
  });

  it('shows separate token/cache fields, unknown totals, and five-stage summaries without double-counting cache', async () => {
    const user = userEvent.setup();
    render(<ReviewUsageDetails projectId="project-1" sessionId="review-7" />);
    await user.click(screen.getByText('Model usage'));

    expect(await screen.findByText('240', { selector: 'dd' })).toBeInTheDocument();
    expect(within(screen.getByLabelText('Recorded Review usage totals')).getByText('Cache read tokens')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Recorded Review usage totals')).getByText('Cache creation tokens')).toBeInTheDocument();
    expect(screen.getByText('240 provider-reported total tokens across 2 calls')).toBeInTheDocument();
    expect(screen.getByText('1 call without provider-reported totals')).toBeInTheDocument();
    const stageTable = screen.getByRole('table', { name: 'Usage by Review pipeline stage' });
    expect(within(stageTable).getAllByRole('row')).toHaveLength(2);
    expect(within(stageTable).getByRole('row', { name: /Analyze with models Completed 2 240 1/ })).toBeInTheDocument();
    expect(stageTable).not.toHaveTextContent('batch-1');
    expect(stageTable).not.toHaveTextContent('Not reached');

    const metrics = screen.getByLabelText('Recorded Review usage totals');
    expect(within(metrics).getByText('Known total tokens')).toBeInTheDocument();
    expect(within(metrics).getByText('1 call has no exact total')).toBeInTheDocument();
  });

  it('deduplicates grouped stage files, and reveals exact file/version metadata only on expansion', async () => {
    const user = userEvent.setup();
    render(<ReviewUsageDetails projectId="project-1" sessionId="review-7" />);
    await user.click(screen.getByText('Model usage'));
    await screen.findByRole('table', { name: 'Usage by Review pipeline stage' });

    const versionsBeforeExpand = screen.getAllByText('version-frozen-9');
    expect(versionsBeforeExpand.every(item => item.closest('details')?.open !== true)).toBe(true);
    await user.click(screen.getByText('View 1 identified AI-referenced files'));
    expect(screen.getAllByText('src/payments/checkout.ts').filter(item => item.closest('details')?.open === true)).toHaveLength(1);
    expect(screen.getAllByText('version-frozen-9').filter(item => item.closest('details')?.open === true)).toHaveLength(1);
    expect(screen.getAllByText('sha256:abc123').filter(item => item.closest('details')?.open === true)).toHaveLength(1);
    expect(screen.getByText('12–24')).toBeInTheDocument();
    expect(screen.queryByText(/raw source body/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Exact unique-file total unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/3 recorded read attempts · 1 unique source file/)).toBeInTheDocument();
  });

  it('marks legacy accounting unavailable instead of showing missing totals as zero, and supports manual retry', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getReviewModelUsage).mockResolvedValueOnce(usage()).mockResolvedValueOnce(usage(projection({ status: 'available' })));
    render(<ReviewUsageDetails projectId="project-1" sessionId="review-7" />);
    await user.click(screen.getByText('Model usage'));
    expect(await screen.findByText(/Detailed pipeline and frozen-source accounting was not captured/)).toBeInTheDocument();
    const metrics = screen.getByLabelText('Recorded Review usage totals');
    expect(within(metrics).getByText('Known total tokens').parentElement).toHaveTextContent('240');
    await user.click(screen.getByRole('button', { name: 'Refresh usage' }));
    expect(await screen.findByText('Available')).toBeInTheDocument();
    expect(api.getReviewModelUsage).toHaveBeenCalledTimes(2);
  });

  it('shows a safe error and lets the reviewer retry a failed read', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getReviewModelUsage).mockRejectedValueOnce(new Error('Failed to fetch'));
    render(<ReviewUsageDetails projectId="project-1" sessionId="review-7" />);
    await user.click(screen.getByText('Model usage'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Centinel could not reach the local service');
    vi.mocked(api.getReviewModelUsage).mockResolvedValueOnce(usage(projection()));
    await user.click(screen.getByRole('button', { name: 'Retry loading' }));
    expect(await screen.findByRole('table', { name: 'Usage by Review pipeline stage' })).toBeInTheDocument();
  });

  it('keeps loading state while a manual usage read is pending', async () => {
    const user = userEvent.setup();
    let resolveUsage!: (result: ReviewModelUsage) => void;
    vi.mocked(api.getReviewModelUsage).mockImplementationOnce(() => new Promise(resolve => { resolveUsage = resolve; }));
    render(<ReviewUsageDetails projectId="project-1" sessionId="review-7" />);
    await user.click(screen.getByText('Model usage'));
    expect(screen.getByRole('status')).toHaveTextContent('Loading saved Review usage');
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
    await act(async () => resolveUsage(usage(projection())));
    await waitFor(() => expect(screen.getByRole('table', { name: 'Usage by Review pipeline stage' })).toBeInTheDocument());
  });
});
