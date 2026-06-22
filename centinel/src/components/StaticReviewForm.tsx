import { useState } from 'react';
import type { Artifact, ReviewType } from '../types';

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
const TYPE_ORDER: Artifact['type'][] = ['requirement', 'source_code', 'design', 'coding_standard', 'other'];
const TYPE_LABELS: Record<Artifact['type'], string> = {
  requirement: 'Requirements',
  design: 'Design Documents',
  source_code: 'Source Code',
  coding_standard: 'Coding Standards',
  other: 'Other',
};

type Props = {
  projectId: string;
  artifacts: Artifact[];
  onSubmit: (data: { name: string; reviewType: ReviewType; artifactIds: string[]; remarks: string }) => Promise<void>;
  onCancel: () => void;
};

export function StaticReviewForm({ projectId, artifacts, onSubmit, onCancel }: Props) {
  const [name, setName] = useState('');
  const [reviewType, setReviewType] = useState<ReviewType>('requirement_review');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(artifacts.map(a => a.id)));
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggle = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(artifacts.map(a => a.id)));
  const selectNone = () => setSelectedIds(new Set());

  const currentConfig = REVIEW_TYPES.find(r => r.value === reviewType)!;

  const charCount = remarks.length;
  const overLimit = charCount > MAX_REMARKS_CHARS;

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Session name is required');
      return;
    }
    if (selectedIds.size === 0) {
      setError('Select at least one artifact to review');
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
        artifactIds: Array.from(selectedIds),
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
        <div className="artifact-selector-header">
          <label>Artifacts to Review ({selectedIds.size}/{artifacts.length})</label>
          <div className="artifact-selector-actions">
            <button type="button" className="btn-link" onClick={selectAll}>Select all</button>
            <button type="button" className="btn-link" onClick={selectNone}>Clear</button>
          </div>
        </div>
        <div className="artifact-selector">
          {TYPE_ORDER.map(type => {
            const group = artifacts.filter(a => a.type === type);
            if (group.length === 0) return null;
            return (
              <fieldset key={type} className="artifact-group">
                <legend>{TYPE_LABELS[type]} ({group.length})</legend>
                {group.map(a => (
                  <label key={a.id} className="artifact-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(a.id)}
                      onChange={() => toggle(a.id)}
                    />
                    <span className="artifact-filename">{a.fileName}</span>
                  </label>
                ))}
              </fieldset>
            );
          })}
          {artifacts.length === 0 && <p className="form-hint">No artifacts uploaded yet.</p>}
        </div>
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
