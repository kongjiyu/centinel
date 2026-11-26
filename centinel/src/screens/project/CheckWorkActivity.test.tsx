import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import type { CheckData } from '../../check/useCheckData';
import { CodeWorkSection } from './CheckWorkActivity';

it('uses saved Review stages and separates working notes from recorded findings', async () => {
  const event = (name: string, detail: Record<string, unknown>) => ({ event: name, reviewId: 'review', detail, createdAt: '' });
  const data = { review: { id: 'review' }, autoTest: null, findings: [], result: { codeState: 'done' },
    live: { problems: [{ key: 'f', title: 'Missing currency label', location: 'src/cart.ts:7' }] },
    trace: { review: { progress: { completedStages: ['freezing_sources', 'indexing_context', 'deterministic_analysis'] } }, events: [
      event('review_assessment_batch_started', { batchId: 'cart', filePath: 'src/cart.ts' }),
      event('review_batch_cache_reused', { batchId: 'catalogue' }),
      event('review_analysis_batch_unverified', { batchId: 'checkout' }),
    ] } } as unknown as CheckData;
  render(<CodeWorkSection data={data} />);
  const branch = screen.getByText('Started the Code Review').closest('details');
  expect(branch).not.toHaveAttribute('open');
  await userEvent.click(screen.getByText('Started the Code Review'));
  expect(branch).toHaveAttribute('open');
  expect(branch).toContainElement(screen.getByText('I saved the exact source versions, prepared the source index, and ran the rule checks.'));
  expect(await screen.findByText('Saved the exact source versions')).toBeInTheDocument();
  expect(screen.getByText('Indexing the repo')).toBeInTheDocument();
  expect(screen.getByText('Running rule check')).toBeInTheDocument();
  expect(screen.getByText(/Referenced the previously validated batch/).tagName).toBe('P');
  expect(screen.getByText('checkout').closest('p')).toHaveTextContent('Recorded a coverage gap');
  expect(screen.getByText('Missing currency label').closest('li')).toHaveTextContent('Recorded finding Missing currency label · src/cart.ts:7');
});
