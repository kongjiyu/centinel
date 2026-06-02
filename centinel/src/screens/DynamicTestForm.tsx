import { useState } from 'react';

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
    <div className="form-card">
      <h3>New Dynamic Test</h3>
      <div className="form-field">
        <label>Target URL</label>
        <input
          value={targetUrl}
          onChange={e => setTargetUrl(e.target.value)}
          placeholder="https://example.com"
        />
      </div>
      <div className="form-field">
        <label>Testing Goal</label>
        <textarea
          value={goal}
          onChange={e => setGoal(e.target.value)}
          placeholder="Describe what you want to test, e.g. 'Verify invalid login shows error message'"
          rows={3}
        />
      </div>
      <div className="form-row">
        <div className="form-field">
          <label>Mission Type</label>
          <select value={missionType} onChange={e => setMissionType(e.target.value as 'user_journey' | 'smoke')}>
            <option value="user_journey">User Journey</option>
            <option value="smoke">Smoke Test</option>
          </select>
        </div>
        <div className="form-field">
          <label>Max Steps</label>
          <input
            type="number"
            value={maxSteps}
            onChange={e => setMaxSteps(Number(e.target.value))}
            min={1}
            max={50}
          />
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Starting...' : 'Run Test'}
        </button>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
