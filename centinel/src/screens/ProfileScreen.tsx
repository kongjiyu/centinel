import { useState } from 'react';
import { ExternalLink, GitBranch, Mail, UserRound } from 'lucide-react';
import { CommandPageHeader, StatusBadge } from '../components/CommandUI';
import { openExternalUrl } from '../utils/openExternalUrl';

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
    </div>
  );
}
