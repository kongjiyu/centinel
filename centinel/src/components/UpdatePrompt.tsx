import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { checkForAppUpdate, installUpdateAndRestart, type AppUpdate } from '../utils/appUpdate';
import { userFacingError } from '../utils/userFacingError';
import './UpdatePrompt.css';

const FIRST_CHECK_MS = 10_000;
const RECHECK_MS = 6 * 60 * 60_000;

/**
 * Non-blocking "Update available → Restart" prompt. The update is downloaded
 * and its signature verified only after the user chooses Restart.
 */
export function UpdatePrompt({ check = checkForAppUpdate, install = installUpdateAndRestart }: { check?: () => Promise<AppUpdate | null>; install?: () => Promise<void> }) {
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const run = () => { void check().then(next => { if (active && next) setUpdate(next); }); };
    const first = setTimeout(run, FIRST_CHECK_MS);
    const later = setInterval(run, RECHECK_MS);
    return () => { active = false; clearTimeout(first); clearInterval(later); };
  }, [check]);

  if (!update || dismissed === update.version) return null;

  const restart = async () => {
    setInstalling(true); setError('');
    try { await install(); }
    catch (cause) { setError(userFacingError(cause, 'The update could not be installed. Your current version still works; try again later.')); setInstalling(false); }
  };

  return (
    <aside className="update-prompt" aria-labelledby="update-prompt-title">
      <span className="update-prompt-icon" aria-hidden="true"><RefreshCw size={18} /></span>
      <div className="update-prompt-copy">
        <h2 id="update-prompt-title">Update available</h2>
        <p role="status">{installing ? `Downloading Centinel ${update.version}… Centinel restarts when it is ready.` : `Centinel ${update.version} is ready to install. Restart to update.`}</p>
        {error && <p className="update-prompt-error" role="alert">{error}</p>}
        <div className="update-prompt-actions">
          <button type="button" className="btn-primary" disabled={installing} onClick={() => void restart()}>{installing ? 'Updating…' : 'Restart'}</button>
          <button type="button" className="btn-secondary" disabled={installing} onClick={() => setDismissed(update.version)}>Later</button>
        </div>
      </div>
      <button type="button" className="update-prompt-close" disabled={installing} aria-label="Dismiss update" onClick={() => setDismissed(update.version)}><X size={16} aria-hidden="true" /></button>
    </aside>
  );
}
