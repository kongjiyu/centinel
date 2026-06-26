/**
 * ActiveSessionComplete.test.tsx — Tests for the file:line location
 * rendering in the completed-session review page.
 *
 * The review page (the "test findings N" page) used to render only
 * each finding's title. After the static-review p0 batch, findings
 * with `filePath` and `lineNumber` get an inline location pill so the
 * reviewer can see at a glance where the issue is.
 *
 * The location element uses `data-testid="finding-location"` so the
 * tests can find it independently of the visual layout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ActiveSessionComplete } from './ActiveSessionComplete';
import { api } from '../api/client';
import type { Finding, StaticSession } from '../types';

vi.mock('../api/client', () => ({
  api: {
    getStaticSession: vi.fn(),
    getStaticFindings: vi.fn(),
    submitReviewDecision: vi.fn(),
    listReviewDecisions: vi.fn(),
  },
}));

// Minimal session record — the component fetches it for the current
// decision on mount, but tests only need the success status so the
// decision bar doesn't error.
const baseSession: StaticSession = {
  id: 'sess-1',
  projectId: 'proj-1',
  name: 'Test session',
  reviewType: 'code_review',
  status: 'success',
  configJson: '{}',
  progressJson: '{}',
  remarks: '',
  finalSummary: '',
  failureReason: '',
  createdAt: '2026-06-25T10:00:00.000Z',
  updatedAt: '2026-06-25T10:00:00.000Z',
  baseRef: '',
  headRef: '',
  changedFilesJson: '[]',
  parentSessionId: '',
  reviewDiffJson: '',
};

const baseFinding = (overrides: Partial<Finding> = {}): Finding => ({
  id: 'f-1',
  projectId: 'proj-1',
  sessionId: 'sess-1',
  source: 'static',
  severity: 'critical',
  title: 'Auth guard missing',
  description: 'No auth check on the route.',
  status: 'new',
  createdAt: '2026-06-25T10:00:00.000Z',
  artifactId: null,
  category: 'security_concern',
  evidenceText: '',
  recommendation: '',
  confidence: 'high',
  fromRemarks: false,
  filePath: '',
  lineNumber: null,
  ...overrides,
});

describe('ActiveSessionComplete — file:line location rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getStaticSession).mockResolvedValue(baseSession);
  });

  it('renders the file:line location when both filePath and lineNumber are set', () => {
    render(
      <ActiveSessionComplete
        projectId="proj-1"
        sessionId="sess-1"
        findings={[baseFinding({
          id: 'f-1',
          filePath: 'src/auth.ts',
          lineNumber: 42,
        })]}
      />
    );

    // The critical group is open by default, so the location pill
    // should be visible.
    const locations = screen.getAllByTestId('finding-location');
    expect(locations).toHaveLength(1);
    const loc = locations[0];
    expect(within(loc).getByText('src/auth.ts')).toBeInTheDocument();
    expect(within(loc).getByText(':42')).toBeInTheDocument();
  });

  it('omits the location element when both filePath and lineNumber are missing', () => {
    render(
      <ActiveSessionComplete
        projectId="proj-1"
        sessionId="sess-1"
        findings={[baseFinding({ id: 'f-1' })]}
      />
    );

    expect(screen.queryByTestId('finding-location')).not.toBeInTheDocument();
  });

  it('renders location when only filePath is set (line number optional)', () => {
    // Models sometimes emit a file but no line number. We still
    // want the file shown — the line is the optional bit.
    render(
      <ActiveSessionComplete
        projectId="proj-1"
        sessionId="sess-1"
        findings={[baseFinding({
          id: 'f-1',
          filePath: 'src/handler.ts',
          lineNumber: null,
        })]}
      />
    );

    const loc = screen.getByTestId('finding-location');
    expect(within(loc).getByText('src/handler.ts')).toBeInTheDocument();
    // No ":N" should appear when lineNumber is null.
    expect(loc.textContent).not.toMatch(/:\d/);
  });
});
