import { ExternalLink, GitBranch } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api/client';
import { userFacingError } from '../utils/userFacingError';
import { openExternalUrl } from '../utils/openExternalUrl';
import { Modal } from './Modal';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

/**
 * GitHub account sign-in proves identity only. This optional follow-up asks
 * before requesting the separate repository-access permission.
 */
export function GithubConnectionPrompt({ isOpen, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { authorizeUrl } = await api.startIntegration('github');
      const opened = await openExternalUrl(authorizeUrl);
      setMessage(opened
        ? 'GitHub authorization is open in your browser. Complete it, then return to Centinel.'
        : 'Centinel could not open GitHub. You can try again from Settings.');
    } catch (cause) {
      setMessage(userFacingError(cause, 'GitHub repository access is not configured yet. You can try again from Settings.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Connect GitHub repositories" descriptionId="github-connection-description" width={480}>
      <div className="github-connection-prompt">
        <span className="github-connection-prompt-icon" aria-hidden="true"><GitBranch size={20} strokeWidth={1.7} /></span>
        <p id="github-connection-description">You are signed in with GitHub. Connect repository access if you want to import repositories or use pull-request context in Centinel.</p>
        <p className="github-connection-prompt-note">This is optional and requests repository access separately from signing in.</p>
        {message && <p className="github-connection-prompt-message" role="status">{message}</p>}
        <div className="github-connection-prompt-actions">
          <button type="button" className="btn-primary connection-primary-button" data-autofocus onClick={() => void connect()} disabled={busy}>
            <ExternalLink size={16} aria-hidden="true" />{busy ? 'Opening GitHub…' : 'Connect GitHub'}
          </button>
          <button type="button" className="btn-secondary connection-secondary-button" onClick={onClose} disabled={busy}>Not now</button>
        </div>
      </div>
    </Modal>
  );
}
