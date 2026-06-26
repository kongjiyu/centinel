import { useState } from 'react';
import { GitBranch } from 'lucide-react';

const MAX_INSTRUCTIONS_CHARS = 1000;

type Props = {
  projectId: string;
  onSubmit: (data: { name: string; instructions: string; baseRef?: string; headRef?: string }) => Promise<void>;
  onCancel: () => void;
};

export function StaticReviewForm({ projectId, onSubmit, onCancel }: Props) {
  void projectId;
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  // P0-4: diff scope. Both empty = full-tree review (the previous default).
  // Setting both = the review is scoped to the files changed between refs.
  const [baseRef, setBaseRef] = useState('');
  const [headRef, setHeadRef] = useState('');
  const [scopeEnabled, setScopeEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const charCount = instructions.length;
  const overLimit = charCount > MAX_INSTRUCTIONS_CHARS;
  const scopeIncomplete = scopeEnabled && (!baseRef.trim() || !headRef.trim());

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Session name is required');
      return;
    }
    if (overLimit) {
      setError(`Instructions must be ${MAX_INSTRUCTIONS_CHARS} characters or fewer (currently ${charCount})`);
      return;
    }
    if (scopeIncomplete) {
      setError('Both base and head refs are required when scope is enabled');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        instructions: instructions.trim(),
        baseRef: scopeEnabled ? baseRef.trim() : undefined,
        headRef: scopeEnabled ? headRef.trim() : undefined,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="form-card static-review-form">
      <h3>New Static Review</h3>

      <div className="form-field">
        <label>Session Name</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Sprint 3 Requirement Review"
          maxLength={120}
        />
      </div>

      <div className="form-field">
        <label>Instructions for the Agent</label>
        <div className="textarea-wrapper">
          <textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            placeholder="What to focus on, or any extra context. Leave blank for a full review."
            rows={6}
            maxLength={MAX_INSTRUCTIONS_CHARS}
          />
          <span className={`textarea-char-count${overLimit ? ' over-limit' : ''}`}>
            {charCount}/{MAX_INSTRUCTIONS_CHARS}
          </span>
        </div>
      </div>

      {/* P0-4: optional diff-scope. Collapsed by default to keep the form
          focused on the common case; reviewers who want PR-scoped reviews
          opt in. */}
      <div className="form-field form-field-scope">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={scopeEnabled}
            onChange={e => setScopeEnabled(e.target.checked)}
            data-testid="scope-toggle"
          />
          <span className="checkbox-box" aria-hidden="true" />
          <span>Limit to changed files (git diff)</span>
        </label>
        {scopeEnabled && (
          <div className="scope-inputs">
            <GitBranch size={12} />
            <input
              value={baseRef}
              onChange={e => setBaseRef(e.target.value)}
              placeholder="base ref (e.g. main)"
              data-testid="scope-base"
              className="input-mono"
            />
            <span className="scope-separator">→</span>
            <input
              value={headRef}
              onChange={e => setHeadRef(e.target.value)}
              placeholder="head ref (e.g. HEAD)"
              data-testid="scope-head"
              className="input-mono"
            />
          </div>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Starting...' : 'Run Review'}
        </button>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
