import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronRight, Code, Info, MonitorCheck, Minus, OctagonAlert, RotateCcw, Sparkles, TriangleAlert, X } from 'lucide-react';
import { api } from '../../api/client';
import { Icon, type IconShape } from '../../components/Icon';
import { IssueSourceContext, REVIEW_ISSUE_CATEGORIES, reviewIssueCategory, shortReviewIssueTitle, type ReviewIssueCategory } from '../../components/ReviewIssues';
import type { CheckProblem, StuckTest } from '../../check/result';
import type { LatestResult } from '../../check/latestResult';
import { TEST_KIND_LABEL } from '../../autotest/types';
import { UnitTestsSummary } from '../check/UnitTestsSummary';
import { RunTimeline } from '../check/RunTimeline';
import { GapNotes } from '../check/CheckScreen';
import { findingSourceReferences } from '../../findingGroups';
import { featureDisplayName, groupReviewFeatures } from '../../reviewFeatures';
import type { ReviewHarnessTrace } from '../../reviewHarness';
import { buildReviewNarrative, plainReviewText } from '../../reviewNarrative';
import { parseReviewProgress, reviewLifecycleState } from '../../reviewViewModel';
import type { Finding, FindingSourceReference } from '../../types';

export const RISK_ICON: Record<string, { icon: typeof Check; shape?: IconShape; className: string }> = {
  critical: { icon: OctagonAlert, className: 'pc-risk-critical' },
  high: { icon: TriangleAlert, shape: 'triangle', className: 'pc-risk-high' },
  medium: { icon: TriangleAlert, shape: 'triangle', className: 'pc-risk-medium' },
  low: { icon: Info, className: 'pc-risk-low' },
};

export function problemLook(problem: CheckProblem) {
  return RISK_ICON[problem.risk ?? ''] ?? (problem.marks.includes('browser') ? { icon: MonitorCheck, className: 'pc-risk-browser' } : RISK_ICON.low);
}

/** Shows `backticked` names as code, as the Result page does. */
function withCode(text: string) {
  return text.split(/`([^`]+)`/).map((part, index) => index % 2 ? <code key={index}>{part}</code> : part);
}

const RISK_ORDER = ['critical', 'high', 'medium', 'low'] as const;

/** The review's harness record, read once the panel is expanded (coverage and duration). */
export function useReviewTrace(projectId: string, reviewId: string | null) {
  const [trace, setTrace] = useState<ReviewHarnessTrace | null>(null);
  useEffect(() => {
    if (!reviewId || typeof api.getReviewHarness !== 'function') return;
    let active = true;
    api.getReviewHarness(projectId, reviewId).then(value => { if (active) setTrace(value); }).catch(() => { /* coverage stays unknown */ });
    return () => { active = false; };
  }, [projectId, reviewId]);
  return trace;
}

/**
 * The main column of the expanded project panel (DESIGN.md §4.4, 16 Nov 2026):
 * built from what the Review page shows — summary, coverage and issues by
 * category — plus the browser's proof. Each problem starts as one title row and
 * opens to its code, overview and browser evidence. Read-only; decisions and
 * feedback stay on the Review page.
 */
export function ProjectOverviewMain({ projectId, latest, trace, onReplay }: { projectId: string; latest: LatestResult; trace: ReviewHarnessTrace | null; onReplay?(problem: CheckProblem): void }) {
  const { result, review, findings, autoTest } = latest;
  const byId = useMemo(() => new Map(findings.map(finding => [finding.id, finding])), [findings]);
  const progress = review ? parseReviewProgress(review.progressJson) : null;
  const behaviorOf = useMemo(() => {
    const names = new Map<string, string>();
    if (trace?.analysisMap) for (const { feature, operations } of groupReviewFeatures(trace.analysisMap, findings)) operations.forEach(operation => names.set(operation.id, featureDisplayName(feature.label)));
    return (finding: Finding) => names.get(finding.location?.sourceLocator?.analysis?.featureId ?? '') ?? finding.affectedFeature ?? null;
  }, [trace, findings]);
  if (!result) return null;

  const code = result.foundInCode.map(problem => ({ problem, finding: problem.findingId ? byId.get(problem.findingId) : undefined }));
  const groups = REVIEW_ISSUE_CATEGORIES.map(category => ({
    category,
    items: code.filter(item => (item.finding ? reviewIssueCategory(item.finding) : 'Behavior') === category),
  })).filter(group => group.items.length);
  const tests = (autoTest?.tests ?? []).filter(test => test.kind !== 'unit');
  const failed = tests.filter(test => test.state === 'failed').length;
  const summary = progress?.providerSummary?.trim();

  return <>
    {summary && <p className="pc-ov-card pc-ov-summary" aria-label="Review summary">{summary}</p>}
    {/* Risk counts lead the expanded panel (user decision, 17 Nov 2026), in place of the earlier verdict, numbers and coverage card. */}
    <div className="pc-latest-numbers pc-ov-risks" aria-label="Problems by risk">
      {RISK_ORDER.map(level => (
        <div key={level}><small className={`pc-risk-${level}`}>{level[0].toUpperCase() + level.slice(1)}</small><b>{[...result.proven, ...result.foundInCode].filter(problem => problem.risk === level).length}</b></div>
      ))}
    </div>
    {result.proven.length > 0 && (
      <IssueGroup title="Proven in the browser" count={result.proven.length}>
        {result.proven.map(problem => <BrowserIssue key={problem.key} problem={problem} onReplay={onReplay} projectId={projectId} />)}
      </IssueGroup>
    )}
    {result.codeGaps.length > 0 && <div className="pc-ov-gaps"><GapNotes items={result.codeGaps} /></div>}
    {groups.map(group => (
      <IssueGroup key={group.category} title={`${group.category} issues`} count={group.items.length}>
        {group.items.map(({ problem, finding }) => <CodeIssue key={problem.key} problem={problem} finding={finding} behavior={finding ? behaviorOf(finding) : null} projectId={projectId} category={group.category} />)}
      </IssueGroup>
    ))}

    {(result.stuckTests.length > 0 || result.browserGaps.length > 0) && (
      <IssueGroup title="Browser tests that could not finish" count={result.stuckTests.length}>
        <GapNotes items={result.browserGaps} />
        {result.stuckTests.map(item => <StuckIssue key={item.key} item={item} projectId={projectId} />)}
      </IssueGroup>
    )}
    {result.unitTests && (
      <section className="pc-ov-tests" aria-label="Project unit tests">
        <h3>Unit tests</h3>
        <UnitTestsSummary result={result.unitTests} className="pc-ov-unit" />
      </section>
    )}
    {tests.length > 0 && (
      <section className="pc-ov-tests" aria-label="Browser tests">
        <h3>Browser tests · {failed ? `${failed} of ${tests.length} failed` : `${tests.length} ran`}</h3>
        <ul>
          {tests.map(test => (
            <li key={test.id}>
              {test.state === 'failed' ? <Icon icon={X} className="pc-bad" /> : test.state === 'passed' ? <Icon icon={Check} /> : <Icon icon={Minus} />}
              <span title={`${test.name}: ${test.state === 'failed' ? 'failed' : test.state === 'passed' ? 'passed' : 'not finished'}`}>{test.name}</span>
              {test.kind && <small className="pc-ov-kind">{TEST_KIND_LABEL[test.kind]}</small>}
            </li>
          ))}
        </ul>
      </section>
    )}
    {result.notes.length > 0 && (
      <details className="ck-about pc-ov-about">
        <summary className="ci-pair"><Icon icon={Info} /><span className="ci-text">How this was tested</span></summary>
        <ul className="ck-method-notes">{result.notes.map(note => <li key={note}>{note}</li>)}</ul>
      </details>
    )}
  </>;
}

function StuckIssue({ item, projectId }: { item: StuckTest; projectId: string }) {
  const problem: CheckProblem = { key: item.key, kind: 'browser', title: item.name, location: null, risk: null, marks: ['browser'] };
  return (
    <IssueRow problem={problem} mark={<span className="pc-ov-mark is-stuck"><Icon icon={TriangleAlert} shape="triangle" />Could not finish</span>}>
      {open => <>
        <p className="pc-ov-prose">{item.why}{item.reason ? `: ${item.reason}` : '.'}</p>
        {open && <div className="pc-ov-steps"><small>Steps in the browser</small><RunTimeline projectId={projectId} runId={item.runId} shownReason={item.reason} /></div>}
      </>}
    </IssueRow>
  );
}

function IssueGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="pc-ov-group" aria-label={title}>
      <h3>{title} <span>{count}</span></h3>
      <div className="pc-ov-issues">{children}</div>
    </section>
  );
}

/** One problem: a title row that opens to its detail. Source is read only when opened. */
function IssueRow({ problem, mark, children }: { problem: CheckProblem; mark: ReactNode; children: (open: boolean) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const look = problemLook(problem);
  return (
    <details className="pc-ov-issue" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>
        <Icon icon={ChevronRight} className="pc-ov-chevron" />
        <Icon icon={look.icon} shape={look.shape} className={look.className} />
        <span className="pc-ov-title" title={problem.title}>{problem.title}</span>
        {mark}
      </summary>
      <div className="pc-ov-detail">{children(open)}</div>
    </details>
  );
}

function BrowserIssue({ problem, onReplay, projectId }: { problem: CheckProblem; onReplay?(problem: CheckProblem): void; projectId: string }) {
  return (
    <IssueRow problem={problem} mark={<span className="pc-ov-mark is-browser"><Icon icon={MonitorCheck} />Browser</span>}>
      {open => <>
        {problem.location && <p className="pc-ov-meta">{problem.location}</p>}
        {(problem.browserChecks ?? []).map((item, index) => (
          <div key={index} className="pc-ov-expect">
            <div><small>Expected</small>{item.expected}</div>
            <div><small>The page showed</small>{item.observed}</div>
          </div>
        ))}
        {open && problem.runId && <div className="pc-ov-steps"><small>Steps in the browser</small><RunTimeline projectId={projectId} runId={problem.runId} checkFailed checkSummary={problem.browserChecks?.[0]?.expected ?? null} /></div>}
        {problem.aiExplanation && <p className="pc-ov-prose"><b><Icon icon={Sparkles} /> AI explanation.</b> {withCode(problem.aiExplanation)}</p>}
        {/* Runs it again from the conversation, where the user sends it. */}
        {onReplay && <div><button type="button" className="ck-button is-small" onClick={() => onReplay(problem)}><Icon icon={RotateCcw} />Run it again</button></div>}
      </>}
    </IssueRow>
  );
}

function CodeIssue({ problem, finding, behavior, projectId, category }: { problem: CheckProblem; finding?: Finding; behavior: string | null; projectId: string; category: ReviewIssueCategory }) {
  const risk = problem.risk;
  return (
    <IssueRow problem={{ ...problem, title: finding ? shortReviewIssueTitle(finding.title) : problem.title }}
      mark={risk ? <span className={`pc-ov-risk pc-risk-${risk}`}>{risk[0].toUpperCase() + risk.slice(1)}</span> : null}>
      {open => {
        const files = new Map<string, FindingSourceReference[]>();
        if (finding) for (const ref of findingSourceReferences(finding)) {
          const path = ref.filePath.replaceAll('\\', '/');
          files.set(path, [...(files.get(path) ?? []), ref]);
        }
        const overview = plainReviewText(finding?.description ?? problem.codeSummary ?? '');
        const next = plainReviewText(finding?.recommendation ?? problem.recommendation ?? '');
        return <>
          <p className="pc-ov-meta">
            <span>{category} issue</span>
            {behavior && <span>Behavior: {behavior}</span>}
            {!finding && problem.location && <span>{problem.location}</span>}
          </p>
          {open && [...files].map(([path, refs]) => (
            <div key={path} className="pc-ov-code">
              <p className="pc-ov-file"><Icon icon={Code} /><span>{path}</span><small>Highlighted: where the problem is</small></p>
              <IssueSourceContext projectId={projectId} reviewId={finding?.latestOccurrence?.reviewId ?? finding?.sessionId ?? null} referencesJson={JSON.stringify(refs)} />
            </div>
          ))}
          {overview && <p className="pc-ov-prose"><b>Issue overview.</b> {withCode(overview)}</p>}
          {next && <p className="pc-ov-prose"><b>What to do.</b> {withCode(next)}</p>}
        </>;
      }}
    </IssueRow>
  );
}

/**
 * The right column of the expanded panel: the review's state, risk counts and
 * details from the Review page, then what this project holds.
 */
/** The review's state for the panel title. Reviews are not held for approval (user decision, 16 Nov 2026), so a finished one reads as Completed. */
export function ReviewState({ review }: { review: LatestResult['review'] }) {
  if (!review) return null;
  const lifecycle = reviewLifecycleState(review);
  const state = lifecycle === 'Need Approval' ? 'Completed' : lifecycle;
  return <span className={`pc-ov-state${state === 'Completed' ? ' is-done' : ''}`} aria-label={`Code review: ${state}`}>{state}</span>;
}

export function ProjectOverviewRail({ latest, trace, children }: { latest: LatestResult; trace: ReviewHarnessTrace | null; children: ReactNode }) {
  const { review, findings } = latest;
  const narrative = useMemo(() => {
    if (!review) return null;
    // An incomplete saved record shows dashes rather than breaking the panel.
    try { return buildReviewNarrative({ session: review, trace, findings }); } catch { return null; }
  }, [review, trace, findings]);
  const scope = (() => { try { return review ? (JSON.parse(review.configJson || '{}') as { scopeMode?: string }).scopeMode : undefined; } catch { return undefined; } })();
  return (
    <div className="pc-ov-rail">
      {review && (
        <section aria-label="Review">
          <h3>Review</h3>
          <dl>
            <div><dt>Scope</dt><dd>{scope === 'focused' ? 'Focused review' : 'Full review'}</dd></div>
            <div><dt>Duration</dt><dd>{narrative?.timing.duration || '–'}</dd></div>
            <div><dt>Source reviewed</dt><dd>{narrative?.reviewedSourceCount != null ? `${narrative.reviewedSourceCount} files` : '–'}</dd></div>
            <div><dt>Reviewed</dt><dd>{new Date(review.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</dd></div>
          </dl>
        </section>
      )}
      {children}
    </div>
  );
}

