import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { api } from '../api/client';
import { Select } from './Select';
import { userFacingError } from '../utils/userFacingError';

const MAX_INSTRUCTIONS_CHARS = 1000;

export type StaticReviewFormData = {
  name: string;
  instructions: string;
  reviewMode: 'regular' | 'pull-request' | 'changed-files';
  reviewer: string;
  pullRequest?: string;
};

type Props = {
  projectId: string;
  onSubmit: (data: StaticReviewFormData) => Promise<void>;
  onCancel: () => void;
  staleSourceCount?: number;
  projectContext?: ReactNode;
  supportiveDocuments?: ReactNode;
  submitDisabled?: boolean;
  submitDisabledReason?: ReactNode;
};

export function StaticReviewForm({ projectId, onSubmit, onCancel, staleSourceCount = 0, projectContext, supportiveDocuments, submitDisabled = false, submitDisabledReason }: Props) {
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [reviewMode, setReviewMode] = useState<'regular' | 'pull-request' | 'changed-files'>('regular');
  const [pullRequest, setPullRequest] = useState('');
  const [pullRequests, setPullRequests] = useState<Array<{ number: number; title: string; state: 'open' | 'closed'; htmlUrl: string; headRef: string; baseRef: string }>>([]);
  const [pullRequestLoading, setPullRequestLoading] = useState(false);
  const [pullRequestError, setPullRequestError] = useState<string | null>(null);
  const [reviewer, setReviewer] = useState('Project owner');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  const charCount = objective.length;
  const overLimit = charCount > MAX_INSTRUCTIONS_CHARS;

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  useEffect(() => {
    if (reviewMode !== 'pull-request') {
      setPullRequests([]);
      setPullRequest('');
      setPullRequestError(null);
      return;
    }
    let cancelled = false;
    setPullRequestLoading(true);
    setPullRequestError(null);
    if (typeof api.listGithubPullRequests !== 'function') {
      setPullRequestError('Pull request lookup is unavailable in the current sidecar.');
      setPullRequestLoading(false);
      return () => { cancelled = true; };
    }
    void api.listGithubPullRequests(projectId)
      .then(result => { if (!cancelled) setPullRequests(result.pullRequests); })
      .catch(cause => { if (!cancelled) setPullRequestError(userFacingError(cause, 'Pull requests could not be loaded.')); })
      .finally(() => { if (!cancelled) setPullRequestLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, reviewMode]);

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Review name is required.');
    if (!objective.trim()) return setError('Review objective is required.');
    if (overLimit) return setError(`Review objective must be ${MAX_INSTRUCTIONS_CHARS} characters or fewer (currently ${charCount}).`);
    if (reviewMode === 'pull-request' && !pullRequest) return setError('Select a pull request before starting a PR review.');
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        instructions: objective.trim(),
        reviewMode,
        reviewer,
        pullRequest: reviewMode === 'pull-request' ? pullRequest.trim() : undefined,
      });
    } catch (cause) {
      setError(userFacingError(cause, 'The review could not be started. Try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="form-card static-review-form" aria-label="Start review" onSubmit={event => { void handleSubmit(event); }}>
      <section className="review-form-section" aria-labelledby="review-details-heading">
        <div className="review-form-section-heading"><h3 id="review-details-heading">Review details</h3></div>
        <div className="form-field">
          <label htmlFor="static-review-name">Review name <span className="field-required" aria-hidden="true">*</span></label>
          <input id="static-review-name" aria-label="Review name" data-autofocus value={name} onChange={event => setName(event.target.value)} placeholder="For example, Sprint 3 review" maxLength={120} aria-invalid={Boolean(error && !name.trim())} />
        </div>

        {projectContext}

        <fieldset className="review-type-fieldset">
          <legend>Review scope <span className="field-required" aria-hidden="true">*</span></legend>
          <div className="review-type-options">
            <label className="review-type-option"><input type="radio" name="review-mode" value="regular" checked={reviewMode === 'regular'} onChange={() => setReviewMode('regular')} /><span><strong>Full Scope Review</strong><small>Review all active project sources.</small></span></label>
            <label className="review-type-option"><input type="radio" name="review-mode" value="pull-request" checked={reviewMode === 'pull-request'} onChange={() => setReviewMode('pull-request')} /><span><strong>Pull Request (PR Review)</strong><small>Review the selected pull request.</small></span></label>
            <label className="review-type-option"><input type="radio" name="review-mode" value="changed-files" checked={reviewMode === 'changed-files'} onChange={() => setReviewMode('changed-files')} /><span><strong>Change File Review</strong><small>Review changed files from the active project.</small></span></label>
          </div>
        </fieldset>

        {reviewMode === 'pull-request' && <div className="review-pr-details"><div className="form-field"><label htmlFor="review-pull-request">Pull request</label><Select id="review-pull-request" value={pullRequest} onChange={setPullRequest} placeholder={pullRequestLoading ? 'Loading pull requests…' : 'Select a pull request'} options={pullRequests.map(item => ({ value: String(item.number), label: `#${item.number} ${item.title}` }))} />{pullRequestError && <p className="field-help" role="status">{pullRequestError}</p>}{!pullRequestLoading && !pullRequestError && pullRequests.length === 0 && <p className="field-help" role="status">No pull requests are available for this repository.</p>}</div></div>}

        <div className="form-field review-objective-field">
          <label htmlFor="static-review-instructions">Objective <span className="field-required" aria-hidden="true">*</span></label>
          <div className="textarea-wrapper">
            <textarea id="static-review-instructions" aria-label="Review objective" value={objective} onChange={event => setObjective(event.target.value)} placeholder="For example, confirm the checkout flow matches the requirements." rows={5} maxLength={MAX_INSTRUCTIONS_CHARS} aria-required="true" />
            <span className={`textarea-char-count${overLimit ? ' over-limit' : ''}`}>{charCount}/{MAX_INSTRUCTIONS_CHARS}</span>
          </div>
        </div>

        {supportiveDocuments}

        <div className="form-field review-reviewer-field">
          <label htmlFor="reviewer-assignment">Assigned reviewer</label>
          <Select id="reviewer-assignment" value={reviewer} onChange={setReviewer} options={[{ value: 'Project owner', label: 'Project owner (default)' }]} />
          <p className="field-help">The project owner is assigned while collaboration roles are unavailable.</p>
        </div>
      </section>

      <section className="review-form-section review-scope-section">
        {staleSourceCount > 0 && <div className="review-source-currency-warning" role="note"><AlertCircle size={17} aria-hidden="true" /><div><strong>Review source age</strong><p>{staleSourceCount} document source{staleSourceCount === 1 ? '' : 's'} have timestamps older than 90 days.</p></div></div>}
      </section>

      {error && <div id="static-review-error" ref={errorRef} className="form-error review-form-error-summary" role="alert" tabIndex={-1}>{error}</div>}
      {submitDisabledReason && <p className="form-hint review-submit-hint" role="status">{submitDisabledReason}</p>}
      <div className="form-actions review-form-actions"><button type="submit" className="btn-primary review-start-button" disabled={submitting || submitDisabled}>{submitting ? 'Starting review…' : 'Start review'}</button><button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>Cancel</button></div>
    </form>
  );
}
