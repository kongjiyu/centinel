import { useState } from 'react';
import { Play, X, Globe, Target, Hash } from 'lucide-react';

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
    <div className="panel dynamic-test-form animate-slide-up">
      <div className="panel-header">
        <h3>
          <Play size={14} />
          New Dynamic Test
        </h3>
        <button className="command-icon-button" onClick={onCancel} title="Close test form" aria-label="Close test form">
          <X size={14} />
        </button>
      </div>

      <div className="form-field">
        <label className="field-label-with-icon">
          <Globe size={13} /> Target URL
        </label>
        <input value={targetUrl} onChange={e => setTargetUrl(e.target.value)} placeholder="http://localhost:3000" />
      </div>

      <div className="form-field">
        <label className="field-label-with-icon">
          <Target size={13} /> Testing Goal
        </label>
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
          <label className="field-label-with-icon">
            <Hash size={13} /> Max Steps
          </label>
          <input type="number" value={maxSteps} onChange={e => setMaxSteps(Number(e.target.value))} min={1} max={50} />
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
          <Play size={14} /> {submitting ? 'Starting...' : 'Run Test'}
        </button>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
