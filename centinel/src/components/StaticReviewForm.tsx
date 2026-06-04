import { useState } from 'react';
import type { ReviewType } from '../types';

const REVIEW_TYPES: { value: ReviewType; label: string; description: string }[] = [
  {
    value: 'requirement_review',
    label: 'Requirement Review',
    description: 'Analyze requirement documents for unclear, incomplete, or ambiguous requirements.',
  },
  {
    value: 'code_review',
    label: 'Code Inspection',
    description: 'Analyze source code for potential defects, maintainability issues, and risky logic.',
  },
  {
    value: 'requirement_to_code_traceability',
    label: 'Requirement-to-Code Traceability',
    description: 'Map requirements to code implementations and identify missing coverage.',
  },
  {
    value: 'cross_artifact_consistency',
    label: 'Cross-Artifact Consistency',
    description: 'Compare all artifacts for terminology mismatches, missing entities, and conflicting behavior.',
  },
];

const MAX_REMARKS_CHARS = 300;

type Props = {
  projectId: string;
  onSubmit: (data: { name: string; reviewType: ReviewType; artifactIds: string[]; remarks: string }) => Promise<void>;
  onCancel: () => void;
};

export function StaticReviewForm({ projectId, onSubmit, onCancel }: Props) {
  const [name, setName] = useState('');
  const [reviewType, setReviewType] = useState<ReviewType>('requirement_review');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const currentConfig = REVIEW_TYPES.find(r => r.value === reviewType)!;

  const charCount = remarks.length;
  const overLimit = charCount > MAX_REMARKS_CHARS;

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Session name is required');
      return;
    }
    if (overLimit) {
      setError(`Remarks must be ${MAX_REMARKS_CHARS} characters or fewer (currently ${charCount})`);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        reviewType,
        artifactIds: [], // Empty — the AI agent decides which artifacts to use
        remarks: remarks.trim(),
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
        <label>Review Type</label>
        <select value={reviewType} onChange={e => setReviewType(e.target.value as ReviewType)}>
          {REVIEW_TYPES.map(rt => (
            <option key={rt.value} value={rt.value}>{rt.label}</option>
          ))}
        </select>
        <p className="form-hint">{currentConfig.description}</p>
      </div>

      <div className="form-field">
        <label>Remarks (optional)</label>
        <div className="textarea-wrapper">
          <textarea
            value={remarks}
            onChange={e => setRemarks(e.target.value)}
            placeholder="Any additional notes or context for this review..."
            rows={4}
            maxLength={MAX_REMARKS_CHARS}
          />
          <span className={`textarea-char-count${overLimit ? ' over-limit' : ''}`}>
            {charCount}/{MAX_REMARKS_CHARS}
          </span>
        </div>
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
