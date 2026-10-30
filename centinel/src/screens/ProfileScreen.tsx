import { useState } from 'react';
import { ExternalLink, GitBranch, Mail, UserRound } from 'lucide-react';
import { CommandPageHeader, StatusBadge } from '../components/CommandUI';
import { openExternalUrl } from '../utils/openExternalUrl';
import { updatePassword } from '../auth/supabaseAuth';

type AuthProvider = 'email' | 'google' | 'github' | null;

type Props = {
  accountEmail?: string | null;
  authProvider?: AuthProvider;
};

const PROVIDER_DETAILS: Record<Exclude<AuthProvider, null>, {
  label: string;
  description: string;
  accountUrl?: string;
  manageLabel?: string;
}> = {
  email: {
    label: 'Email and password',
    description: 'This Centinel account uses your email address and password to sign in.',
  },
  google: {
    label: 'Google',
    description: 'You signed in with Google. Manage your account and security settings through Google.',
    accountUrl: 'https://myaccount.google.com/security',
    manageLabel: 'Manage Google account',
  },
  github: {
    label: 'GitHub',
    description: 'You signed in with GitHub. Manage your account and security settings through GitHub.',
    accountUrl: 'https://github.com/settings/profile',
    manageLabel: 'Manage GitHub account',
  },
};

function providerIcon(provider: AuthProvider) {
  if (provider === 'github') return GitBranch;
  return Mail;
}

/** A concise account summary for the identity used by the current session. */
export function ProfileScreen({ accountEmail = null, authProvider = null }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const provider = authProvider ? PROVIDER_DETAILS[authProvider] : null;
  const ProviderIcon = providerIcon(authProvider);

  const openProviderAccount = async () => {
    if (!provider?.accountUrl) return;
    const opened = await openExternalUrl(provider.accountUrl);
    setMessage(opened ? null : 'Centinel could not open the provider account page. Check your default browser and try again.');
  };

  return (
    <div className="screen profile-screen">
      <CommandPageHeader
        eyebrow="Account"
        title="Manage account"
        description="Your Centinel account is associated with the service you used to sign in."
      />

      <section className="profile-card" aria-labelledby="profile-account-title">
        <div className="profile-avatar" aria-hidden="true"><UserRound size={24} strokeWidth={1.6} /></div>
        <div className="profile-account-copy">
          <h2 id="profile-account-title">{accountEmail || 'Account email unavailable'}</h2>
          <p>Centinel account</p>
        </div>
        <StatusBadge label={authProvider ? `Signed in with ${provider!.label}` : 'Provider unavailable'} tone={authProvider ? 'success' : 'neutral'} />
      </section>

      <section className="profile-provider-section" aria-labelledby="profile-provider-title">
        <div className="profile-section-heading">
          <div>
            <h2 id="profile-provider-title">Account access</h2>
            <p>Use the same account you used to connect to Centinel. This page does not add or remove sign-in options.</p>
          </div>
        </div>

        {provider ? (
          <div className="profile-provider-row">
            <span className="profile-provider-icon" aria-hidden="true"><ProviderIcon size={18} strokeWidth={1.8} /></span>
            <div className="profile-provider-copy">
              <strong>{provider.label}</strong>
              <span>{provider.description}</span>
              {authProvider === 'github' && <small>GitHub repository access is managed separately in Settings › Connections.</small>}
            </div>
            {provider.manageLabel && <button type="button" className="btn-secondary profile-provider-action" onClick={() => void openProviderAccount()}>
              <ExternalLink size={14} aria-hidden="true" /> {provider.manageLabel}
            </button>}
          </div>
        ) : (
          <p className="profile-provider-unavailable" role="status">Centinel could not determine which provider opened this session. Your current account remains signed in.</p>
        )}
        {message && <p className="profile-provider-error" role="alert">{message}</p>}
      </section>

      {authProvider === 'email' && <PasswordSection />}
    </div>
  );
}

/** Change the password of an e-mail account, including after a reset link. */
function PasswordSection() {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8) { setResult({ tone: 'error', text: 'Use a password with at least 8 characters.' }); return; }
    if (password !== confirmation) { setResult({ tone: 'error', text: 'The two passwords do not match.' }); return; }
    setBusy(true); setResult(null);
    try {
      await updatePassword(password);
      setPassword(''); setConfirmation('');
      setResult({ tone: 'success', text: 'Your password has been changed.' });
    } catch (cause) {
      setResult({ tone: 'error', text: cause instanceof Error && cause.message ? cause.message : 'The password could not be changed. Try again.' });
    } finally { setBusy(false); }
  };
  return (
    <section className="profile-provider-section" aria-labelledby="profile-password-title">
      <div className="profile-section-heading"><div><h2 id="profile-password-title">Password</h2><p>Choose a new password for signing in with your e-mail address.</p></div></div>
      <form className="profile-password-form" onSubmit={event => void submit(event)}>
        <div className="form-field"><label htmlFor="profile-new-password">New password</label><input id="profile-new-password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></div>
        <div className="form-field"><label htmlFor="profile-confirm-password">Confirm new password</label><input id="profile-confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></div>
        <button type="submit" className="btn-primary" disabled={busy || !password}>{busy ? 'Saving…' : 'Change password'}</button>
      </form>
      {result && <p className={result.tone === 'error' ? 'profile-provider-error' : 'profile-password-success'} role={result.tone === 'error' ? 'alert' : 'status'}>{result.text}</p>}
    </section>
  );
}
