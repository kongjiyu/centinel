import { useState } from 'react';
import { Play, Globe, Target, Hash, SlidersHorizontal } from 'lucide-react';
import { Select } from '../components/Select';

type Props = {
  onSubmit: (data: {
    targetUrl: string;
    goal: string;
    missionType: 'user_journey' | 'smoke';
    maxSteps: number;
  }) => Promise<void>;
  onCancel: () => void;
};

export function DynamicTestForm({ onSubmit, onCancel }: Props) {
  const [targetUrl, setTargetUrl] = useState('');
  const [goal, setGoal] = useState('');
  const [missionType, setMissionType] = useState<'user_journey' | 'smoke'>('user_journey');
  const [maxSteps, setMaxSteps] = useState(15);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    if (!targetUrl.trim()) { setError('Target URL is required'); return; }
    try { new URL(targetUrl); } catch { setError('Invalid URL'); return; }
    if (!goal.trim()) { setError('Goal is required'); return; }

    setSubmitting(true);
    try {
      await onSubmit({ targetUrl: targetUrl.trim(), goal: goal.trim(), missionType, maxSteps });
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dynamic-test-form">
      <div className="form-field">
        <label className="field-label-with-icon" htmlFor="dynamic-target-url">
          <Globe size={16} /> Website address
        </label>
        <input id="dynamic-target-url" type="url" value={targetUrl} onChange={e => setTargetUrl(e.target.value)} placeholder="https://example.com" />
      </div>

      <div className="form-field">
        <label className="field-label-with-icon" htmlFor="dynamic-test-goal">
          <Target size={16} /> Test goal
        </label>
        <textarea
          id="dynamic-test-goal"
          value={goal}
          onChange={e => setGoal(e.target.value)}
          placeholder="Describe what you want to test, e.g. 'Verify invalid login shows error message'"
          rows={3}
        />
      </div>

      <div className="form-field">
        <label htmlFor="dynamic-test-type">Test type</label>
        <Select
          id="dynamic-test-type"
          value={missionType}
          onChange={value => setMissionType(value as 'user_journey' | 'smoke')}
          options={[
            { value: 'user_journey', label: 'User journey' },
            { value: 'smoke', label: 'Smoke test' },
          ]}
        />
        <p className="field-help">
          {missionType === 'user_journey'
            ? 'Follow a goal across several pages and interactions.'
            : 'Check that the main page and critical controls work.'}
        </p>
      </div>

      <details className="advanced-options">
        <summary><SlidersHorizontal size={16} /> Advanced options</summary>
        <div className="advanced-options-content">
          <div className="form-field">
            <label className="field-label-with-icon" htmlFor="dynamic-step-limit">
              <Hash size={16} /> Step limit
            </label>
            <input id="dynamic-step-limit" type="number" value={maxSteps} onChange={e => setMaxSteps(Number(e.target.value))} min={1} max={25} />
            <p className="field-help">Stop the test after this many browser actions.</p>
          </div>
        </div>
      </details>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="form-actions">
        <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
          <Play size={16} /> {submitting ? 'Starting…' : 'Run test'}
        </button>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
