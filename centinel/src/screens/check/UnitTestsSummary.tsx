import { Check, FlaskConical, Minus, X } from 'lucide-react';
import { Icon } from '../../components/Icon';
import type { UnitTestsResult } from '../../check/result';

/**
 * The project's own unit tests in a check (18 Nov 2026). Results come only from the
 * Vitest report; they are shown apart from Code and Browser problems.
 */
export function UnitTestsSummary({ result, className = '' }: { result: UnitTestsResult; className?: string }) {
  const icon = result.state === 'passed' ? Check : result.state === 'failed' ? X : result.state === 'running' ? FlaskConical : Minus;
  return (
    <section className={`ck-unit ${className}`.trim()} aria-label="Unit tests">
      <p className={`ci-pair${result.state === 'failed' ? ' is-failed' : ''}`}><Icon icon={icon} /><span className="ci-text">{result.line}</span></p>
      {result.failures.length > 0 && (
        <ul className="ck-unit-failures">
          {result.failures.map((failure, index) => (
            <li key={`${failure.file}:${failure.name}:${index}`}>
              <span className="ck-unit-name">{failure.name}</span>
              <span className="ck-mono ck-unit-file">{failure.file}</span>
              {failure.message && <span className="ck-unit-message">{failure.message}</span>}
            </li>
          ))}
          {result.failureTotal > result.failures.length && <li className="ck-unit-more">{result.failureTotal - result.failures.length} more failed unit tests are not listed.</li>}
        </ul>
      )}
    </section>
  );
}
