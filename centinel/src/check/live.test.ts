import { describe, expect, it } from 'vitest';
import type { ReviewHarnessTrace } from '../reviewHarness';
import type { StaticSession } from '../types';
import { reviewLiveView } from './live';

const review = (status: string, stage = 'model_analysis') => ({ id: 'r1', status, progressJson: JSON.stringify({ stage }) } as unknown as StaticSession);

const trace = (events: ReviewHarnessTrace['events']): ReviewHarnessTrace => ({
  workflow: { version: '1', reference: '', stages: [] },
  review: { id: 'r1', name: '', status: 'running', progress: null, modelStatus: '', updatedAt: '' },
  events,
  analysisMap: {
    schemaVersion: 1, status: 'partial',
    coverage: { sourceArtifacts: 2, parsedArtifacts: 2, exhaustive: false, unresolvedEdgeCount: 0, limitations: [], unsupportedArtifacts: [] },
    features: [
      { id: 'f1', label: 'Orders', provisional: true, entryPoints: [{ artifactId: 'a', filePath: 'src/orders.js', lineNumber: 1, sourceVersion: null }], paths: [], assessments: [], unresolved: [] },
      { id: 'f2', label: 'Login', provisional: true, entryPoints: [{ artifactId: 'b', filePath: 'server.js', lineNumber: 40, sourceVersion: null }], paths: [], assessments: [], unresolved: [] },
    ],
  },
});

describe('review live view', () => {
  it('names the entry file of the next unfinished batch and counts finished batches', () => {
    const view = reviewLiveView(review('running'), trace([
      { reviewId: 'r1', event: 'review_batches_planned', detail: { batches: [{ id: 'b1', featureIds: ['f1'] }, { id: 'b2', featureIds: ['f2'] }] }, createdAt: '' },
      { reviewId: 'r1', event: 'review_analysis_batch_saved', detail: { batchId: 'b1' }, createdAt: '' },
      { reviewId: 'r1', event: 'review_live_finding_titles', detail: { titles: ['Order Ownership Bypass', 'Order Ownership Bypass', ' '] }, createdAt: '' },
    ]));
    expect(view).toMatchObject({ stageLabel: 'Reading the code', currentFiles: ['server.js'], batchesDone: 1, batchesTotal: 2, problems: [{ title: 'Order Ownership Bypass', location: null }] });
    expect(view.problems).toHaveLength(1);
  });

  it('shows no current file once the review has stopped running', () => {
    const view = reviewLiveView(review('completed', 'complete'), trace([
      { reviewId: 'r1', event: 'review_batches_planned', detail: { batches: [{ id: 'b1', featureIds: ['f1'] }] }, createdAt: '' },
    ]));
    expect(view.currentFiles).toEqual([]);
    expect(view.stageLabel).toBe('Finished');
  });

  it('uses the saved stage before any batch is planned', () => {
    expect(reviewLiveView(review('running', 'freezing_sources'), null)).toMatchObject({ stageLabel: 'Saving a copy of the files', batchesTotal: null, problems: [] });
    expect(reviewLiveView(review('queued'), null).stageLabel).toBe('Waiting to start');
  });
  it('prefers the file of the batch the Review reported starting, including document batches', () => {
    const view = reviewLiveView(review('running'), trace([
      { reviewId: 'r1', event: 'review_batches_planned', detail: { batches: [{ id: 'd1', featureIds: [] }, { id: 'b1', featureIds: ['f1'] }] }, createdAt: '' },
      { reviewId: 'r1', event: 'review_assessment_batch_started', detail: { batchId: 'd1', phase: 'documents', filePath: 'docs/requirements.md' }, createdAt: '' },
    ]));
    expect(view.currentFiles).toEqual(['docs/requirements.md']);
    const after = reviewLiveView(review('running'), trace([
      { reviewId: 'r1', event: 'review_batches_planned', detail: { batches: [{ id: 'd1', featureIds: [] }, { id: 'b1', featureIds: ['f1'] }] }, createdAt: '' },
      { reviewId: 'r1', event: 'review_assessment_batch_started', detail: { batchId: 'd1', phase: 'documents', filePath: 'docs/requirements.md' }, createdAt: '' },
      { reviewId: 'r1', event: 'review_analysis_batch_saved', detail: { batchId: 'd1' }, createdAt: '' },
    ]));
    expect(after.currentFiles).toEqual(['src/orders.js']);
  });

  it('names the analysis phase the Review saved', () => {
    const phased = (assessmentPhase: string) => ({ id: 'r1', status: 'running', progressJson: JSON.stringify({ stage: 'model_analysis', assessmentPhase }) } as unknown as StaticSession);
    expect(reviewLiveView(phased('documents'), null).stageLabel).toBe('Reading the documents');
    expect(reviewLiveView(phased('behaviors'), null).stageLabel).toBe('Reading the code');
    expect(reviewLiveView(phased('environment'), null).stageLabel).toBe('Checking settings and other files');
  });
});

