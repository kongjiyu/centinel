import { useState } from 'react';
import { Play, Globe, Target, Hash, SlidersHorizontal, Route, Zap, ShieldCheck } from 'lucide-react';
import './DynamicTestForm.css';

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

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();
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
    <form className="dynamic-test-form" onSubmit={handleSubmit}>
      <div className="dynamic-automation-note">
        <span className="dynamic-automation-icon"><ShieldCheck size={18} aria-hidden="true" /></span>
        <div>
          <strong>Automatic browser test</strong>
          <p>Centinel will navigate the website, capture visual evidence, and produce a result without pausing for approval at each step.</p>
        </div>
      </div>

      <div className="form-field dynamic-primary-field">
        <label className="field-label-with-icon" htmlFor="dynamic-target-url">
          <Globe size={16} /> Website address
        </label>
        <input id="dynamic-target-url" type="url" value={targetUrl} onChange={e => setTargetUrl(e.target.value)} placeholder="https://your-website.example" autoComplete="url" />
        <p className="field-help">Enter the page where the autonomous test should begin.</p>
      </div>

      <div className="form-field dynamic-primary-field">
        <label className="field-label-with-icon" htmlFor="dynamic-test-goal">
          <Target size={16} /> Test goal
        </label>
        <textarea
          id="dynamic-test-goal"
          value={goal}
          onChange={e => setGoal(e.target.value)}
          placeholder="For example: Verify that a new user can create an account and reach the dashboard"
          rows={2}
        />
        <p className="field-help">Describe the outcome a real user should be able to achieve.</p>
      </div>

      <fieldset className="dynamic-test-type">
        <legend>Test type</legend>
        <div className="dynamic-type-options">
          <label className="dynamic-type-option">
            <input
              type="radio"
              name="dynamic-test-type"
              value="user_journey"
              checked={missionType === 'user_journey'}
              onChange={() => setMissionType('user_journey')}
            />
            <span className="dynamic-type-icon"><Route size={18} aria-hidden="true" /></span>
            <span>
              <strong>User journey</strong>
              <small>Follow one goal across multiple pages and interactions.</small>
            </span>
          </label>
          <label className="dynamic-type-option">
            <input
              type="radio"
              name="dynamic-test-type"
              value="smoke"
              checked={missionType === 'smoke'}
              onChange={() => setMissionType('smoke')}
            />
            <span className="dynamic-type-icon"><Zap size={18} aria-hidden="true" /></span>
            <span>
              <strong>Smoke test</strong>
              <small>Check that the starting page and its critical controls work.</small>
            </span>
          </label>
        </div>
      </fieldset>

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

      <div className="form-actions dynamic-form-actions">
        <button type="submit" className="btn-primary" disabled={submitting}>
          <Play size={16} /> {submitting ? 'Starting…' : 'Run test'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
