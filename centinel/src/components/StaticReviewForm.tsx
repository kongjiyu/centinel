import { useState } from 'react';

const MAX_INSTRUCTIONS_CHARS = 1000;

type Props = {
  projectId: string;
  onSubmit: (data: { name: string; instructions: string }) => Promise<void>;
  onCancel: () => void;
};

export function StaticReviewForm({ projectId, onSubmit, onCancel }: Props) {
  void projectId;
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const charCount = instructions.length;
  const overLimit = charCount > MAX_INSTRUCTIONS_CHARS;

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

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        instructions: instructions.trim(),
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
            placeholder="Tell the agent what to focus on, what to look for, or any extra context for this review. The agent will choose which artifacts to inspect and what kind of review to run."
            rows={6}
            maxLength={MAX_INSTRUCTIONS_CHARS}
          />
          <span className={`textarea-char-count${overLimit ? ' over-limit' : ''}`}>
            {charCount}/{MAX_INSTRUCTIONS_CHARS}
          </span>
        </div>
        <p className="form-hint">Leave blank to let the agent decide its own focus. All project artifacts will be made available.</p>
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
