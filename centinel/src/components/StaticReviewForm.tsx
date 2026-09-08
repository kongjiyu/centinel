import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, GitBranch } from 'lucide-react';
import type { ReactNode } from 'react';

const MAX_INSTRUCTIONS_CHARS = 1000;

export type StaticReviewFormData = {
  name: string;
  /** Kept as `instructions` for the existing create-session contract. */
  instructions: string;
  reviewMode: 'regular' | 'pull-request';
  reviewer: string;
  pullRequest?: string;
  baseRef?: string;
  headRef?: string;
};

type Props = {
  projectId: string;
  onSubmit: (data: StaticReviewFormData) => Promise<void>;
  onCancel: () => void;
  staleSourceCount?: number;
  beforeObjective?: ReactNode;
  afterName?: ReactNode;
  projectContext?: ReactNode;
  submitDisabled?: boolean;
  submitDisabledReason?: ReactNode;
};

export function StaticReviewForm({
  projectId,
  onSubmit,
  onCancel,
  staleSourceCount = 0,
  beforeObjective,
  afterName,
  projectContext,
  submitDisabled = false,
  submitDisabledReason,
}: Props) {
  void projectId;
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [baseRef, setBaseRef] = useState('');
  const [headRef, setHeadRef] = useState('');
  const [scopeEnabled, setScopeEnabled] = useState(false);
  const [reviewMode, setReviewMode] = useState<'regular' | 'pull-request'>('regular');
  const [pullRequest, setPullRequest] = useState('');
  const [reviewer, setReviewer] = useState('Project owner');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  const charCount = objective.length;
  const overLimit = charCount > MAX_INSTRUCTIONS_CHARS;
  const scopeIncomplete = (scopeEnabled || reviewMode === 'pull-request') && (!baseRef.trim() || !headRef.trim());

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Review name is required.');
      return;
    }
    if (!objective.trim()) {
      setError('Review objective is required.');
      return;
    }
    if (overLimit) {
      setError(`Review objective must be ${MAX_INSTRUCTIONS_CHARS} characters or fewer (currently ${charCount}).`);
      return;
    }
    if (scopeIncomplete) {
      setError('Both base and head refs are required for a pull request or changed-file scope.');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        // The API still calls this field `instructions`; the UI deliberately
        // uses the user-facing term objective.
        instructions: objective.trim(),
        reviewMode,
        reviewer,
        pullRequest: reviewMode === 'pull-request' ? pullRequest.trim() : undefined,
        baseRef: (scopeEnabled || reviewMode === 'pull-request') ? baseRef.trim() : undefined,
        headRef: (scopeEnabled || reviewMode === 'pull-request') ? headRef.trim() : undefined,
      });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="form-card static-review-form" aria-label="Start review" onSubmit={event => { void handleSubmit(event); }}>
      <section className="review-form-section" aria-labelledby="review-details-heading">
        <div className="review-form-section-heading">
          <h3 id="review-details-heading">Review details</h3>
          <p>Give this review a recognizable name.</p>
        </div>

        <div className="form-field">
          <label htmlFor="static-review-name">Review name <span className="field-required" aria-hidden="true">*</span></label>
          <input
            id="static-review-name"
            aria-label="Review name"
            data-autofocus
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="For example, Sprint 3 review"
            maxLength={120}
            aria-invalid={Boolean(error && !name.trim())}
            aria-describedby={error && !name.trim() ? 'static-review-error' : undefined}
          />
        </div>

        <fieldset className="review-type-fieldset">
          <legend>Review type <span className="field-required" aria-hidden="true">*</span></legend>
          <div className="review-type-options">
            <label className="review-type-option">
              <input type="radio" name="review-mode" value="regular" checked={reviewMode === 'regular'} onChange={() => setReviewMode('regular')} />
              <span><strong>Regular review</strong><small>Review the selected project or a manual changed-file scope.</small></span>
            </label>
            <label className="review-type-option">
              <input type="radio" name="review-mode" value="pull-request" checked={reviewMode === 'pull-request'} onChange={() => setReviewMode('pull-request')} />
              <span><strong>Pull request review</strong><small>Record a pull request and compare its base and head refs.</small></span>
            </label>
          </div>
        </fieldset>

        {reviewMode === 'pull-request' && (
          <div className="review-pr-details">
            <div className="form-field">
              <label htmlFor="review-pull-request">Pull request</label>
              <input id="review-pull-request" value={pullRequest} onChange={event => setPullRequest(event.target.value)} placeholder="For example, #184 or a pull request URL" />
            </div>
            <div className="scope-inputs review-required-scope">
              <GitBranch size={14} aria-hidden="true" />
              <label className="visually-hidden" htmlFor="scope-base">Base ref</label>
              <input id="scope-base" value={baseRef} onChange={event => setBaseRef(event.target.value)} placeholder="Base ref, for example main" aria-label="Base ref" className="input-mono" />
              <span className="scope-separator" aria-hidden="true">→</span>
              <label className="visually-hidden" htmlFor="scope-head">Head ref</label>
              <input id="scope-head" value={headRef} onChange={event => setHeadRef(event.target.value)} placeholder="Head ref, for example feature/checkout" aria-label="Head ref" className="input-mono" />
            </div>
          </div>
        )}
      </section>

      {beforeObjective}

      <section className="review-form-section" aria-labelledby="review-objective-heading">
        <div className="review-form-section-heading">
          <h3 id="review-objective-heading">Objective</h3>
          <p>Describe the evidence Centinel should examine and the question this review should answer.</p>
        </div>
        <div className="form-field">
          <label htmlFor="static-review-instructions">Review objective <span className="field-required" aria-hidden="true">*</span></label>
          <div className="textarea-wrapper">
            <textarea
              id="static-review-instructions"
              aria-label="Review objective"
              value={objective}
              onChange={event => setObjective(event.target.value)}
              placeholder="For example, confirm that the implemented checkout flow matches the requirements and coding standards."
              rows={6}
              maxLength={MAX_INSTRUCTIONS_CHARS}
              aria-required="true"
              aria-invalid={Boolean(error && !objective.trim()) || overLimit}
              aria-describedby={`static-review-objective-help static-review-objective-count${error && (!objective.trim() || overLimit) ? ' static-review-error' : ''}`}
            />
            <span id="static-review-objective-count" className={`textarea-char-count${overLimit ? ' over-limit' : ''}`}>
              {charCount}/{MAX_INSTRUCTIONS_CHARS}
            </span>
          </div>
          <p id="static-review-objective-help" className="field-help">Centinel uses the objective to determine review emphasis. Keep it specific enough to guide the evidence review.</p>
        </div>
      </section>

      {afterName}
      {projectContext}

      <section className="review-form-section review-scope-section" aria-labelledby="review-scope-heading">
        <div className="review-form-section-heading">
          <h3 id="review-scope-heading">Code scope</h3>
          <p>Review the full project by default. A manual ref pair can limit the review to changed files.</p>
        </div>

        <div className="review-default-scope">
          <strong>Full project scope</strong>
          <span>Active project sources are included by default. A manual ref pair is a requested scope, not a persisted immutable snapshot.</span>
        </div>

        {staleSourceCount > 0 && (
          <div className="review-source-currency-warning" role="note">
            <AlertCircle size={17} aria-hidden="true" />
            <div>
              <strong>Review source age</strong>
              <p>{staleSourceCount} document source{staleSourceCount === 1 ? '' : 's'} have stored timestamps older than 90 days. This is not a separate currency confirmation; review applicability in the Sources tab before you start.</p>
            </div>
          </div>
        )}

        {reviewMode === 'regular' && <details className="advanced-options static-review-advanced">
          <summary>Advanced options</summary>
          <div className="advanced-options-content">
            <div className="form-field form-field-scope">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={scopeEnabled}
                  onChange={event => setScopeEnabled(event.target.checked)}
                  data-testid="scope-toggle"
                />
                <span className="checkbox-box" aria-hidden="true" />
                <span>Review changed files only</span>
              </label>
              <p className="field-help">The sidecar validates these refs when the review starts. Centinel does not claim an immutable commit until the service returns one.</p>
              {scopeEnabled && (
                <div className="scope-inputs">
                  <GitBranch size={14} aria-hidden="true" />
                  <label className="visually-hidden" htmlFor="scope-base">Base ref</label>
                  <input
                    id="scope-base"
                    value={baseRef}
                    onChange={event => setBaseRef(event.target.value)}
                    placeholder="Base ref, for example main"
                    aria-label="Base ref"
                    data-testid="scope-base"
                    className="input-mono"
                  />
                  <span className="scope-separator" aria-hidden="true">→</span>
                  <label className="visually-hidden" htmlFor="scope-head">Head ref</label>
                  <input
                    id="scope-head"
                    value={headRef}
                    onChange={event => setHeadRef(event.target.value)}
                    placeholder="Head ref, for example HEAD"
                    aria-label="Head ref"
                    data-testid="scope-head"
                    className="input-mono"
                  />
                </div>
              )}
            </div>
          </div>
        </details>}
      </section>

      <section className="review-form-section review-human-review" aria-labelledby="human-review-heading">
        <div className="review-form-section-heading">
          <h3 id="human-review-heading">Human review</h3>
          <p>The reviewer owns the final activity decision; approval does not automatically resolve findings.</p>
        </div>
        <div className="form-field">
          <label htmlFor="reviewer-assignment">Assigned reviewer</label>
          <select id="reviewer-assignment" value={reviewer} onChange={event => setReviewer(event.target.value)}>
            <option value="Project owner">Project owner (default)</option>
          </select>
          <p className="field-help">No reviewer-role collaborator is registered for this project, so the project owner is assigned by default.</p>
        </div>
      </section>

      {error && (
        <div id="static-review-error" ref={errorRef} className="form-error review-form-error-summary" role="alert" tabIndex={-1}>
          {error}
        </div>
      )}
      {submitDisabledReason && <p className="form-hint review-submit-hint" role="status">{submitDisabledReason}</p>}

      <div className="form-actions review-form-actions">
        <button type="submit" className="btn-primary review-start-button" disabled={submitting || submitDisabled}>
          {submitting ? 'Starting review…' : 'Start review'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>Cancel</button>
      </div>
    </form>
  );
}
