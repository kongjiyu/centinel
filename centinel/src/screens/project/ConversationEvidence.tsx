import { Fragment } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Icon } from '../../components/Icon';
import type { SavedConversationExplanation } from '../../check/conversationTypes';
import { InlineText } from '../check/CheckScreen';
import { RunTimeline } from '../check/RunTimeline';
import { SavedProjectProblem } from './ProjectOverview';

export function ConversationEvidence({ explanation, projectId, onOpenProblem }: {
  explanation: SavedConversationExplanation; projectId: string; onOpenProblem?: (evidenceId: string, browserRunId?: string) => void;
}) {
  const renderSavedProblem = (section: SavedConversationExplanation['sections'][number]) => section.problem
    ? <SavedProjectProblem problem={section.problem} projectId={projectId} initiallyOpen
      onOpenOriginal={onOpenProblem && section.evidenceId ? () => onOpenProblem(section.evidenceId!, section.originalBrowserRunId) : undefined}
      limitations={section.limitations} /> : null;

  const renderSavedCheck = (section: SavedConversationExplanation['sections'][number], index: number) => {
    const check = section.check;
    if (!check) return null;
    const code = check.code;
    const browser = check.browser;
    const modules = code?.modules ?? [];
    const moduleFiles = new Set(modules.flatMap(item => item.files));
    const affectedFiles = code?.affectedFiles ?? [];
    const resultLabel = (value: string) => ({ pending_approval: 'Completed', completed: 'Completed', done: 'Completed', success: 'Completed',
      passed: 'Passed', failed: 'Failed', uncertain: 'Unclear', blocked: 'Could not finish', not_tested: 'Not run', cancelled: 'Stopped' }[value] ?? value.replaceAll('_', ' '));
    const mode = check.mode === 'both' ? 'Code and browser' : check.mode === 'code' ? 'Code' : 'Browser';
    const detailLimitations = (section.limitations ?? []).filter(limit => !['Some Code coverage is incomplete.', 'Some Code coverage remains unchecked.',
      'The Browser test list is partial.', 'The Browser Check stopped before it finished. Remaining behavior is unchecked.',
      'Some Browser behavior remains unchecked.', 'Some Browser results are incomplete. Remaining behavior is unchecked.'].includes(limit));
    const browserCoverageNote = browser?.testCountPartial
      ? ['failed', 'cancelled'].includes(browser.status ?? '') ? 'The Browser Check stopped before it finished. Remaining behavior is unchecked.' : 'Some Browser behavior remains unchecked.'
      : browser?.assertionCountPartial || (browser?.testsWithoutVerdict ?? 0) > 0 ? 'Some Browser results are incomplete. Remaining behavior is unchecked.' : '';
    return <section key={section.evidenceId ?? index} className="pc-card pc-check-card pc-saved-check" aria-label={`Check ${section.title}`}>
      <header className="pc-check-card-heading">
        <div className="pc-check-card-title">
          <div className="pc-check-card-name"><h2>{section.title}</h2></div>
          <p>{mode}{check.mode !== 'both' && (code?.status || browser?.status) && <> · {resultLabel((code?.status || browser?.status)!)}</>}</p>
        </div>
        {onOpenProblem && section.evidenceId && <button type="button" className="ck-button is-small pc-saved-open-original"
          aria-label="Open original Check" title="Open original Check" onClick={() => onOpenProblem(section.evidenceId!)}><Icon icon={ArrowUpRight} /></button>}
      </header>
      <dl className="pc-check-card-counts">
        {code && <div><dt>Found in code</dt><dd>{code.problemCount ?? 'Unavailable'}</dd></div>}
        {browser && <div><dt>Proven in the browser</dt><dd>{browser.provenProblemCount
          ?? (browser.testCountPartial || browser.assertionCountPartial || (browser.testsWithoutVerdict ?? 0) > 0 ? 'Not confirmed' : 'Unavailable')}</dd></div>}
        {code?.requirementsUnavailable ? <div><dt>Requirements</dt><dd>Unavailable</dd></div>
          : code?.requirements && !code.requirements.length ? <div><dt>Requirements</dt><dd>No requirements provided</dd></div> : null}
      </dl>
      {(code?.coverageIncomplete || section.limitations?.includes('Some Code coverage is incomplete.') || section.limitations?.includes('Some Code coverage remains unchecked.')) && <p className="pc-label">Some Code coverage remains unchecked.</p>}
      {browserCoverageNote && <p className="pc-label">{browserCoverageNote}</p>}
      <div className="pc-check-details">
      {section.summary && section.summary !== code?.summary && <p><InlineText text={section.summary} /></p>}
      {(check.objective || code?.objective || browser?.objective) && <div className="pc-table-scroll">
        <table aria-label={`Saved objectives for ${section.title}`}><tbody>
          {check.objective ? <tr><th scope="row">Objective</th><td><InlineText text={check.objective} /></td></tr> : <>
            {code?.objective && <tr><th scope="row">Code objective</th><td><InlineText text={code.objective} /></td></tr>}
            {browser?.objective && <tr><th scope="row">Browser objective</th><td><InlineText text={browser.objective} /></td></tr>}
          </>}
        </tbody></table>
      </div>}

      {code && <section className="pc-saved-group" aria-label="Found in code">
        <h3>Code findings</h3>
        {!!code.scopeMode && <p className="pc-ov-meta"><span>Requested scope mode: {code.scopeMode === 'full' ? 'Full' : 'Focused'}</span>
          {code.sourceCount !== null && code.sourceCount !== undefined && <span>Files in saved manifest: {code.sourceCount}</span>}</p>}
        {check.mode === 'both' && code.status && <p className="pc-ov-meta">{resultLabel(code.status)}</p>}
        {code.summary && <p><InlineText text={code.summary} /></p>}
        {!!code.problems?.length && <div className="pc-ov-issues">
          {code.problems.map((problem, problemIndex) => <SavedProjectProblem key={problem.findingId ?? problemIndex} problem={problem} projectId={projectId} initiallyOpen={false} />)}
        </div>}
        {code.problemCount === 0 && <p>No Code problems were recorded.</p>}
        {code.problemCount === null && <p>The Code problem count is unavailable.</p>}
        {!!code.moreProblems && <p className="pc-label">{code.moreProblems} more Code problems are in the saved Review.</p>}
        {!!code.sourceScope?.length && <details className="pc-saved-scope">
          <summary>Saved manifest paths {code.sourceCount !== null && code.sourceCount !== undefined ? `(${code.sourceCount})` : ''}</summary>
          <ul>{code.sourceScope.map((path, pathIndex) => <li key={pathIndex}><code title={path}>{path}</code></li>)}</ul>
        </details>}
        {!!code.coverage?.length && <div className="pc-saved-coverage" aria-label="Requirement coverage">
          <h5>Requirement coverage</h5><ul>{code.coverage.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
        </div>}
        {code.requirementsUnavailable ? <p role="status">Requirement coverage is unavailable for this Review.</p>
          : code.requirements?.length ? <div className="pc-table-scroll" tabIndex={0} role="region" aria-label="Saved requirements and coverage">
            <table className="pc-requirements-table" aria-label="Saved requirements and coverage"><thead><tr><th scope="col">Requirement</th><th scope="col">Review mapping status</th></tr></thead>
              <tbody>{code.requirements.map(requirement => <tr key={requirement.id}><th scope="row">{requirement.title || requirement.id}</th><td>{resultLabel(requirement.state)}</td></tr>)}</tbody>
            </table>
          </div> : <p>No requirements were saved for this Review.</p>}
        {!!(modules.length || affectedFiles.length) && <div className="pc-table-scroll" tabIndex={0} role="region" aria-label="Saved module and affected-file evidence">
          <table className="pc-module-table" aria-label="Saved module and affected-file evidence">
            <thead><tr>{modules.length > 0 && <th scope="col">Module</th>}<th scope="col">Affected files</th></tr></thead>
            <tbody>
              {modules.flatMap(module => module.files.map(path => <tr key={`${module.module}:${path}`}>
                {modules.length > 0 && <th scope="row">{module.module} <small>Inferred</small></th>}<td><code title={path}>{path}</code></td>
              </tr>))}
              {affectedFiles.filter(path => !moduleFiles.has(path)).map(path => <tr key={`file:${path}`}>
                {modules.length > 0 && <th scope="row">—</th>}<td><code title={path}>{path}</code></td>
              </tr>)}
            </tbody>
          </table>
        </div>}
        {!!code.qualityEvidence?.length && <div className="pc-saved-quality">
          <h5>Saved quality examples</h5><ul>{code.qualityEvidence.map((item, itemIndex) => <li key={itemIndex}>
            <strong>{item.quality}</strong>{item.path && <> · <code title={item.path}>{item.path}</code></>} · <InlineText text={item.impact} />
          </li>)}</ul>
        </div>}
      </section>}

      {browser && <section className="pc-saved-group" aria-label="Proven in the browser">
        <h3>Browser tests</h3>
        {check.mode === 'both' && browser.status && <p className="pc-ov-meta">{resultLabel(browser.status)}</p>}
        <div className="pc-table-scroll"><table aria-label="Saved Browser measurements"><tbody>
          <tr><th scope="row">Failed Browser assertions</th><td>{browser.failedAssertionCount === null || browser.failedAssertionCount === undefined ? 'Unavailable' : `${browser.failedAssertionCount}${browser.assertionCountPartial ? ' · partial count' : ''}`}</td></tr>
          {browser.passedTestCount !== null && browser.passedTestCount !== undefined && <tr><th scope="row">Passed Browser tests</th><td>{browser.passedTestCount}</td></tr>}
          {browser.testsWithoutVerdict !== null && browser.testsWithoutVerdict !== undefined && <tr><th scope="row">Browser tests without a verdict</th><td>{browser.testsWithoutVerdict}</td></tr>}
          {browser.testCount !== null && browser.testCount !== undefined && <tr><th scope="row">Browser tests saved</th><td>{browser.testCount}{browser.testCountPartial ? ' so far' : ''}</td></tr>}
        </tbody></table></div>
        {!!browser.sourceScope?.length && <div className="pc-saved-scope"><h5>Browser source paths</h5><ul>{browser.sourceScope.map((path, pathIndex) => <li key={pathIndex}><code title={path}>{path}</code></li>)}</ul></div>}
        {!!browser.tests?.length && <div className="pc-table-scroll" tabIndex={0} role="region" aria-label="Saved Browser test evidence">
          <table className="pc-browser-tests" aria-label="Saved Browser test evidence"><thead><tr><th scope="col">Test</th><th scope="col">Result</th><th scope="col">Assertion results</th></tr></thead>
            <tbody>{browser.tests.map(test => <tr key={test.id}><th scope="row">{test.name}</th><td>{resultLabel(test.state)}</td><td>
              {(test.checks.length > 0 || test.runId || test.earlierAttempt?.runId) ? <details open={['failed', 'blocked'].includes(test.state)}>
                <summary>{test.checks.length ? `${test.checks.length} saved ${test.checks.length === 1 ? 'assertion' : 'assertions'}` : 'No assertion results saved'}</summary>
                {test.evidenceAttempt === 'earlier' && <p>Saved observations and steps are from an earlier Browser attempt.</p>}
                {!!test.checks.length && <ul>{test.checks.map((item, itemIndex) => <li key={itemIndex}>
                  <strong>{item.check}</strong>{item.expected && <span>Expected: {item.expected}</span>}{item.observed && <span>Observed: {item.observed}</span>}{item.verdict && <span>{resultLabel(item.verdict)}</span>}
                </li>)}</ul>}
                {test.explanation && <p><strong>{test.explanationFromEarlier ? 'Possible cause from an earlier Browser attempt (AI explanation).' : 'Possible cause (AI explanation).'}</strong> <InlineText text={test.explanation} /></p>}
                {test.runId && <RunTimeline projectId={projectId} runId={test.runId} checkFailed={test.browserProof === true}
                  checkSummary={test.checks.find(assertion => assertion.verdict === 'failed')?.expected ?? null} />}
                {test.earlierAttempt && <details className="pc-prior-attempt">
                  <summary>Earlier Browser attempt</summary>
                  {!!test.earlierAttempt.checks.length && <ul>{test.earlierAttempt.checks.map((item, itemIndex) => <li key={itemIndex}>
                    <strong>{item.check}</strong>{item.expected && <span>Expected: {item.expected}</span>}{item.observed && <span>Observed: {item.observed}</span>}{item.verdict && <span>{resultLabel(item.verdict)}</span>}
                  </li>)}</ul>}
                  {test.earlierAttempt.runId && <RunTimeline projectId={projectId} runId={test.earlierAttempt.runId}
                    checkFailed={test.earlierAttempt.checks.some(assertion => assertion.verdict === 'failed')}
                    checkSummary={test.earlierAttempt.checks.find(assertion => assertion.verdict === 'failed')?.expected ?? null} />}
                  {test.earlierAttempt.explanation && <p><strong>Possible cause from an earlier Browser attempt (AI explanation).</strong> <InlineText text={test.earlierAttempt.explanation} /></p>}
                </details>}
              </details> : 'No assertion results saved.'}
            </td></tr>)}</tbody>
          </table>
        </div>}
        {!!browser.moreTests && <p className="pc-label">{browser.moreTests} more Browser tests are in the saved run.</p>}
      </section>}
      {!!detailLimitations.length && <ul>{detailLimitations.map((limit, limitIndex) => <li key={limitIndex}>{limit}</li>)}</ul>}
      </div>
    </section>;
  };

  return <div className="pc-inline-evidence">
    {explanation.sections.map((section, index) => (section.presentation === 'problem' || !section.presentation) && section.problem
      ? <Fragment key={section.evidenceId ?? index}>{renderSavedProblem(section)}</Fragment>
      : (section.presentation === 'check' || !section.presentation) && section.check ? renderSavedCheck(section, index)
      : <section key={section.evidenceId ?? index} className="pc-evidence-section" aria-label={section.title}>
      <header className="pc-evidence-section-heading"><h3>{section.title}</h3>
        {onOpenProblem && section.evidenceId && /^(finding|check|review|browser):/.test(section.evidenceId) && <button type="button" className="ck-button is-small pc-saved-open-original"
          aria-label={section.evidenceId.startsWith('finding:') ? 'Open original problem' : 'Open original Check'}
          title={section.evidenceId.startsWith('finding:') ? 'Open original problem' : 'Open original Check'}
          onClick={() => onOpenProblem(section.evidenceId!, section.originalBrowserRunId)}><Icon icon={ArrowUpRight} /></button>}
      </header>
      {section.summary && <p><InlineText text={section.summary} /></p>}
      {!!section.facts?.length && <div className="pc-table-scroll"><table aria-label={`Saved facts for ${section.title}`}><tbody>
        {section.facts.map(({ label, value }, index) => <tr key={index}><th scope="row">{label}</th><td>{value}</td></tr>)}
      </tbody></table></div>}
      {section.excerpt && <figure><figcaption>Saved source excerpt</figcaption><pre><code>{section.excerpt}</code></pre></figure>}
      {section.sourceWindow && <figure><figcaption>Frozen source near recorded line {section.sourceWindow.citedLine} · starts at line {section.sourceWindow.firstLine}</figcaption>
        <pre><code>{section.sourceWindow.text}</code></pre></figure>}
      {!!section.points?.length && <ul>{section.points.map((point, index) => <li key={index}><InlineText text={point} /></li>)}</ul>}
      {!!section.checks?.length && <>
        <div className="pc-table-scroll" tabIndex={0} role="region" aria-label={`Saved Browser assertions for ${section.title}`}>
          <table className="pc-assertion-table" aria-label={`Saved Browser assertions for ${section.title}`}>
          <thead><tr>{['Test', 'Assertion', 'Expected', 'Observed', 'Verdict'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{section.checks.map((check, index) => <tr key={index}><th scope="row">{check.test}</th><td>{check.check}</td>
            <td>{check.expected || 'Unavailable'}</td><td>{check.observed || 'Unavailable'}</td><td>{check.verdict}</td></tr>)}</tbody>
        </table></div>
        {[...new Map(section.checks.flatMap(check => check.runId ? [[check.runId, check.test]] : [])).entries()]
          .map(([runId, test]) => <RunTimeline key={runId} projectId={projectId} runId={runId} />)}
      </>}
      {!!section.limitations?.length && <ul>{section.limitations.map((limit, index) => <li key={index}>{limit}</li>)}</ul>}
    </section>)}
    {explanation.hasMore && <p>Select an individual attachment for more detail.</p>}
  </div>;
}
