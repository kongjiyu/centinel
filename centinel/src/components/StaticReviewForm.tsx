import { useEffect, useRef, useState } from 'react';
import { AlertCircle, GitBranch } from 'lucide-react';
import type { ReactNode } from 'react';

const MAX_INSTRUCTIONS_CHARS = 1000;

export type StaticReviewFormData = {
  name: string;
  /** Kept as `instructions` for the existing create-session contract. */
  instructions: string;
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  const charCount = objective.length;
  const overLimit = charCount > MAX_INSTRUCTIONS_CHARS;
  const scopeIncomplete = scopeEnabled && (!baseRef.trim() || !headRef.trim());

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const handleSubmit = async () => {
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
      setError('Both base and head refs are required when changed-file scope is enabled.');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        // The API still calls this field `instructions`; the UI deliberately
        // uses the user-facing term objective.
        instructions: objective.trim(),
        baseRef: scopeEnabled ? baseRef.trim() : undefined,
        headRef: scopeEnabled ? headRef.trim() : undefined,
      });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="form-card static-review-form">
      <section className="review-form-section" aria-labelledby="review-details-heading">
        <div className="review-form-section-heading">
          <h3 id="review-details-heading">Review details</h3>
          <p>Describe the evidence Centinel should examine and the question this review should answer.</p>
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

        {beforeObjective}

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

        <details className="advanced-options static-review-advanced">
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
        </details>
      </section>

      <section className="review-form-section review-human-review" aria-labelledby="human-review-heading">
        <div className="review-form-section-heading">
          <h3 id="human-review-heading">Human review</h3>
          <p>The reviewer owns the final activity decision; approval does not automatically resolve findings.</p>
        </div>
        <p className="review-unavailable-note">Reviewer assignment is not available in local single-user mode. The final reviewer identity will be shown only when the service supplies it.</p>
      </section>

      {error && (
        <div id="static-review-error" ref={errorRef} className="form-error review-form-error-summary" role="alert" tabIndex={-1}>
          {error}
        </div>
      )}
      {submitDisabledReason && <p className="form-hint review-submit-hint" role="status">{submitDisabledReason}</p>}

      <div className="form-actions review-form-actions">
        <button className="btn-primary review-start-button" onClick={() => void handleSubmit()} disabled={submitting || submitDisabled}>
          {submitting ? 'Starting review…' : 'Start review'}
        </button>
        <button className="btn-secondary" onClick={onCancel} disabled={submitting}>Cancel</button>
      </div>
    </div>
  );
}
