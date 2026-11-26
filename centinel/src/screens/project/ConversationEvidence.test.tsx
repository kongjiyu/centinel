import { render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { api } from '../../api/client';
import { ConversationEvidence } from './ConversationEvidence';

afterEach(() => vi.restoreAllMocks());

it('renders one expanded saved Check card with separate code and Browser evidence', async () => {
  const longPath = `src/features/catalogue/${'nested/'.repeat(12)}controller.ts`;
  const onOpenProblem = vi.fn();
  render(<ConversationEvidence projectId="project" onOpenProblem={onOpenProblem} explanation={{ sections: [{
    evidenceId: 'check:sample', presentation: 'check', title: 'Catalogue Check',
    check: {
      mode: 'both', objectiveUnavailable: true,
      code: {
        status: 'completed', problemCount: 1, moreProblems: 0, sourceCount: 2, scopeMode: 'full',
        problems: [{ kind: 'code', title: 'Ownership guard is missing', category: 'security', risk: 'high',
          reviewId: 'review', originalStatus: 'new', currentStatus: 'Resolved', description: 'Another account can read this order.',
          recommendation: 'Check order ownership before returning the record.', evidenceUnavailable: true }],
        affectedFiles: ['src/orders/handler.ts', longPath],
        requirements: [{ id: 'REQ-1', title: 'Orders are private to their owner', state: 'incomplete' }],
      },
      browser: {
        status: 'completed', testCount: 2, testCountPartial: false, provenProblemCount: 1,
        failedAssertionCount: 2, assertionCountPartial: false, passedTestCount: 1, testsWithoutVerdict: 0,
        tests: [{ id: 'cart', name: 'Cart total', state: 'failed', checks: [
          { check: 'Total matches selected items', expected: '$18.00', observed: '$0.00', verdict: 'failed' },
        ] }],
      },
    },
  }] }} />);

  const card = screen.getByRole('region', { name: 'Check Catalogue Check' });
  expect(within(card).getByRole('heading', { name: 'Catalogue Check' })).toBeInTheDocument();
  expect(within(card).getByText('Code and browser')).toBeInTheDocument();
  expect(within(card).queryByRole('button', { name: 'Show Detail' })).not.toBeInTheDocument();
  expect(within(card).getByRole('button', { name: 'Open original Check' })).toBeInTheDocument();
  await userEvent.click(within(card).getByRole('button', { name: 'Open original Check' }));
  expect(onOpenProblem).toHaveBeenCalledWith('check:sample');
  expect(within(card).getByRole('region', { name: 'Found in code' })).toBeInTheDocument();
  expect(within(card).getByRole('region', { name: 'Proven in the browser' })).toBeInTheDocument();
  expect(within(card).queryByRole('row', { name: /Objective/ })).not.toBeInTheDocument();
  await userEvent.click(within(card).getByText('Ownership guard is missing'));
  expect(within(card).getByText('Issue overview.')).toBeInTheDocument();
  expect(within(card).getByText('What to do.')).toBeInTheDocument();
  expect(within(card).getByText('Current status: Resolved')).toBeInTheDocument();
  expect(within(card).getByText('The original source excerpt is unavailable.')).toBeInTheDocument();
  expect(within(card).getByRole('table', { name: 'Saved requirements and coverage' })).toHaveTextContent('incomplete');
  const files = within(card).getByRole('table', { name: 'Saved module and affected-file evidence' });
  expect(files).toHaveTextContent('src/orders/handler.ts');
  expect(files).toHaveTextContent(longPath);
  expect(within(card).getByRole('table', { name: 'Saved Browser measurements' })).toHaveTextContent('Failed Browser assertions');
  expect(within(card).getByRole('table', { name: 'Saved Browser test evidence' })).toHaveTextContent('$18.00');
  expect(within(card).getByRole('table', { name: 'Saved Browser test evidence' })).toHaveTextContent('$0.00');
});

it('reuses the original standalone Problem renderer for a historical code occurrence', async () => {
  vi.spyOn(api, 'getReviewArtifactContent').mockResolvedValue({
    versionId: 'version', content: '', contentHash: 'hash', mimeType: 'text/typescript', textContent: 'const owner = order.ownerId;',
  });
  render(<ConversationEvidence projectId="project" onOpenProblem={vi.fn()} explanation={{ sections: [{
    evidenceId: 'finding:historical', presentation: 'problem', title: 'Old source problem',
    problem: { kind: 'code', title: 'Old source problem', reviewId: 'review', findingId: 'finding',
      originalStatus: 'new', currentStatus: 'Resolved', category: 'security', risk: 'high',
      description: 'The saved code path allowed access without checking ownership.',
      recommendation: 'Compare the current user with the order owner.', evidenceUnavailable: true,
      sourceReferences: [{ artifactId: 'artifact', filePath: 'src/orders/handler.ts', lineNumber: 1,
        sourceVersion: 'hash', excerpt: 'const owner = order.ownerId;', relation: 'code' }] },
    limitations: ['Current source has changed since this occurrence.'],
  }] }} />);

  const problem = screen.getByRole('group', { name: 'Old source problem' });
  expect(problem.closest('.pc-evidence-section')).toBeNull();
  expect(within(problem).getByRole('button', { name: 'Open original problem' })).toBeInTheDocument();
  expect(within(problem).getByText('Highlighted: where the problem is')).toBeInTheDocument();
  expect(within(problem).getByText('Issue overview.')).toBeInTheDocument();
  expect(within(problem).getByText('What to do.')).toBeInTheDocument();
  expect(within(problem).getByText('Saved status: Open')).toBeInTheDocument();
  expect(within(problem).getByText('Current status: Resolved')).toBeInTheDocument();
  expect(await within(problem).findByRole('region', { name: 'Saved source from src/orders/handler.ts' })).toHaveTextContent('const owner = order.ownerId;');
});

it('keeps a stopped Browser problem explanation as a possible cause without a Browser proof mark', async () => {
  vi.spyOn(api, 'dynamicRunSteps').mockResolvedValue({ runId: 'run', state: 'blocked', verdict: 'not_tested', reason: 'The run stopped.', truncated: false, steps: [] } as never);
  const onOpenProblem = vi.fn();
  render(<ConversationEvidence projectId="project" onOpenProblem={onOpenProblem} explanation={{ sections: [{
    evidenceId: 'browser:auto:test', originalBrowserRunId: 'run', presentation: 'problem', title: 'Save order',
    problem: { kind: 'browser', title: 'Save order', originalStatus: 'failed', browserProof: false, browserCoverage: 'stopped',
      browserEvidenceAttempt: 'earlier', aiExplanationFromEarlier: true,
      browserChecks: [{ expected: 'Order confirmation appears', observed: 'The page stayed on the form.' }],
      aiExplanation: 'The save response may not update the order view.', runId: 'run', testId: 'test' },
  }] }} />);

  const problem = screen.getByRole('group', { name: 'Save order' });
  expect(problem.closest('.pc-evidence-section')).toBeNull();
  expect(within(problem).getByText('Possible cause from an earlier attempt (AI explanation).')).toBeInTheDocument();
  expect(within(problem).getByText('The Browser Check stopped before it finished. Remaining behavior is unchecked.')).toBeInTheDocument();
  expect(within(problem).queryByText('Browser', { selector: '.pc-ov-mark' })).not.toBeInTheDocument();
  expect(within(problem).queryByRole('button', { name: /Show snapshot/ })).not.toBeInTheDocument();
  await userEvent.click(within(problem).getByRole('button', { name: 'Open original problem' }));
  expect(onOpenProblem).toHaveBeenCalledWith('browser:auto:test', 'run');
});
