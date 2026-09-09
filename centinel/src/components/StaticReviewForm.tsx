import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, Folder, GitBranch } from 'lucide-react';
import { open } from '@tauri-apps/api/dialog';
import { Select } from './Select';

const MAX_INSTRUCTIONS_CHARS = 1000;

export type StaticReviewFormData = {
  name: string;
  instructions: string;
  reviewMode: 'regular' | 'pull-request';
  reviewer: string;
  pullRequest?: string;
  baseRef?: string;
  headRef?: string;
  scopeMode?: 'ai' | 'changed' | 'directories';
  selectedDirectories?: string[];
};

type Props = {
  projectId: string;
  onSubmit: (data: StaticReviewFormData) => Promise<void>;
  onCancel: () => void;
  staleSourceCount?: number;
  projectContext?: ReactNode;
  submitDisabled?: boolean;
  submitDisabledReason?: ReactNode;
};

export function StaticReviewForm({ projectId, onSubmit, onCancel, staleSourceCount = 0, projectContext, submitDisabled = false, submitDisabledReason }: Props) {
  void projectId;
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [baseRef, setBaseRef] = useState('');
  const [headRef, setHeadRef] = useState('');
  const [reviewMode, setReviewMode] = useState<'regular' | 'pull-request'>('regular');
  const [pullRequest, setPullRequest] = useState('');
  const [reviewer, setReviewer] = useState('Project owner');
  const [scopeMode, setScopeMode] = useState<'ai' | 'changed' | 'directories'>('ai');
  const [selectedDirectories, setSelectedDirectories] = useState<string[]>([]);
  const [showDiffSummary, setShowDiffSummary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  const charCount = objective.length;
  const overLimit = charCount > MAX_INSTRUCTIONS_CHARS;
  const changedScope = scopeMode === 'changed' || reviewMode === 'pull-request';

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  const chooseDirectories = async () => {
    try {
      const selected = await open({ directory: true, multiple: true, title: 'Choose review directories' });
      if (!selected) return;
      setSelectedDirectories(Array.isArray(selected) ? selected : [selected]);
      setError(null);
    } catch {
      setError('The directory picker could not open. Try again in the desktop app.');
    }
  };

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Review name is required.');
    if (!objective.trim()) return setError('Review objective is required.');
    if (overLimit) return setError(`Review objective must be ${MAX_INSTRUCTIONS_CHARS} characters or fewer (currently ${charCount}).`);
    if (changedScope && (!baseRef.trim() || !headRef.trim())) return setError('Both base and head refs are required for a pull request or changed-file scope.');
    if (scopeMode === 'directories' && selectedDirectories.length === 0) return setError('Choose at least one directory for the selected-directory scope.');

    const directoryInstruction = scopeMode === 'directories' ? `Limit the review to these selected directories: ${selectedDirectories.join(', ')}.` : '';
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        instructions: [objective.trim(), directoryInstruction].filter(Boolean).join('\n\n'),
        reviewMode,
        reviewer,
        pullRequest: reviewMode === 'pull-request' ? pullRequest.trim() : undefined,
        baseRef: changedScope ? baseRef.trim() : undefined,
        headRef: changedScope ? headRef.trim() : undefined,
        scopeMode,
        selectedDirectories: scopeMode === 'directories' ? selectedDirectories : undefined,
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
        <div className="review-form-section-heading"><h3 id="review-details-heading">Review details</h3></div>
        <div className="form-field">
          <label htmlFor="static-review-name">Review name <span className="field-required" aria-hidden="true">*</span></label>
          <input id="static-review-name" aria-label="Review name" data-autofocus value={name} onChange={event => setName(event.target.value)} placeholder="For example, Sprint 3 review" maxLength={120} aria-invalid={Boolean(error && !name.trim())} />
        </div>

        <fieldset className="review-type-fieldset">
          <legend>Review type <span className="field-required" aria-hidden="true">*</span></legend>
          <div className="review-type-options">
            <label className="review-type-option"><input type="radio" name="review-mode" value="regular" checked={reviewMode === 'regular'} onChange={() => setReviewMode('regular')} /><span><strong>Regular review</strong><small>Review project sources using the code scope below.</small></span></label>
            <label className="review-type-option"><input type="radio" name="review-mode" value="pull-request" checked={reviewMode === 'pull-request'} onChange={() => { setReviewMode('pull-request'); setScopeMode('changed'); }} /><span><strong>Pull request review</strong><small>Record a pull request and compare its base and head refs.</small></span></label>
          </div>
        </fieldset>

        {reviewMode === 'pull-request' && <div className="review-pr-details"><div className="form-field"><label htmlFor="review-pull-request">Pull request</label><input id="review-pull-request" value={pullRequest} onChange={event => setPullRequest(event.target.value)} placeholder="For example, #184 or a pull request URL" /></div></div>}

        <div className="form-field review-objective-field">
          <label htmlFor="static-review-instructions">Objective <span className="field-required" aria-hidden="true">*</span></label>
          <div className="textarea-wrapper">
            <textarea id="static-review-instructions" aria-label="Review objective" value={objective} onChange={event => setObjective(event.target.value)} placeholder="For example, confirm the checkout flow matches the requirements." rows={5} maxLength={MAX_INSTRUCTIONS_CHARS} aria-required="true" />
            <span className={`textarea-char-count${overLimit ? ' over-limit' : ''}`}>{charCount}/{MAX_INSTRUCTIONS_CHARS}</span>
          </div>
        </div>

        <div className="form-field review-reviewer-field">
          <label htmlFor="reviewer-assignment">Assigned reviewer</label>
          <Select id="reviewer-assignment" value={reviewer} onChange={setReviewer} options={[{ value: 'Project owner', label: 'Project owner (default)' }]} />
          <p className="field-help">The project owner is assigned while collaboration roles are unavailable.</p>
        </div>
      </section>

      {projectContext}

      <section className="review-form-section review-scope-section" aria-labelledby="review-advanced-heading">
        <div className="review-form-section-heading"><h3 id="review-advanced-heading">Advanced</h3></div>
        <fieldset className="review-scope-fieldset">
          <legend>Code scope</legend>
          <div className="review-scope-options">
            <label className="review-scope-option"><input type="radio" name="scope-mode" checked={scopeMode === 'ai'} onChange={() => setScopeMode('ai')} disabled={reviewMode === 'pull-request'} /><span><strong>Let AI decide</strong><small>Default. Select the relevant code from active project sources.</small></span></label>
            <label className="review-scope-option"><input type="radio" name="scope-mode" checked={scopeMode === 'changed'} onChange={() => setScopeMode('changed')} /><span><strong>Review changed files only</strong><small>Compare a base ref with a head ref.</small></span></label>
            <label className="review-scope-option"><input type="radio" name="scope-mode" checked={scopeMode === 'directories'} onChange={() => setScopeMode('directories')} disabled={reviewMode === 'pull-request'} /><span><strong>Review selected directories</strong><small>Choose one or more folders to focus the review.</small></span></label>
          </div>
        </fieldset>

        {changedScope && <div className="review-changed-scope">
          <div className="scope-inputs"><GitBranch size={14} aria-hidden="true" /><input id="scope-base" value={baseRef} onChange={event => setBaseRef(event.target.value)} placeholder="Base ref, for example main" aria-label="Base ref" className="input-mono" /><span className="scope-separator" aria-hidden="true">→</span><input id="scope-head" value={headRef} onChange={event => setHeadRef(event.target.value)} placeholder="Head ref, for example HEAD" aria-label="Head ref" className="input-mono" /></div>
          <button type="button" className="btn-secondary review-diff-toggle" onClick={() => setShowDiffSummary(value => !value)} aria-expanded={showDiffSummary}>Show Git diff</button>
          {showDiffSummary && <p className="review-unavailable-note" role="note">The exact changed-file list is calculated and saved when the review starts. A pre-run diff preview is not available in the current service.</p>}
        </div>}

        {scopeMode === 'directories' && <div className="review-directory-scope"><button type="button" className="btn-secondary" onClick={() => void chooseDirectories()}><Folder size={15} aria-hidden="true" /> Choose directories</button><p className="field-help">{selectedDirectories.length > 0 ? selectedDirectories.join(', ') : 'No directories selected.'}</p></div>}
        {staleSourceCount > 0 && <div className="review-source-currency-warning" role="note"><AlertCircle size={17} aria-hidden="true" /><div><strong>Review source age</strong><p>{staleSourceCount} document source{staleSourceCount === 1 ? '' : 's'} have timestamps older than 90 days.</p></div></div>}
      </section>

      {error && <div id="static-review-error" ref={errorRef} className="form-error review-form-error-summary" role="alert" tabIndex={-1}>{error}</div>}
      {submitDisabledReason && <p className="form-hint review-submit-hint" role="status">{submitDisabledReason}</p>}
      <div className="form-actions review-form-actions"><button type="submit" className="btn-primary review-start-button" disabled={submitting || submitDisabled}>{submitting ? 'Starting review…' : 'Start review'}</button><button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>Cancel</button></div>
    </form>
  );
}
