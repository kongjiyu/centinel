import { useState } from 'react';
import { api } from '../api/client';
import { userFacingError } from '../utils/userFacingError';

export function UseModelProviderButton({ slot, model, active, saved, disabled, onRefresh }: {
  slot: 'api' | 'codex' | 'gemini';
  model: string;
  active: boolean;
  saved: boolean;
  disabled?: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const useProvider = async () => {
    setBusy(true);
    setError('');
    try {
      await api.useSavedAiProvider(slot, model);
      await onRefresh();
    } catch (cause) {
      setError(userFacingError(cause, 'Could not activate the saved provider.'));
    } finally { setBusy(false); }
  };
  return <>
    <button type="button" className="btn-primary" disabled={active || !saved || disabled || busy}
      onClick={() => void useProvider()}>{active ? 'In use' : busy ? 'Activating…' : 'Use'}</button>
    {error && <span role="alert" className="form-error">{error}</span>}
  </>;
}
