import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { WindowHeader } from '../components/WindowHeader';
import { isSupabaseAuthConfigured, requestPasswordReset, signInWithPassword, signUpWithPassword, startGithubSignIn, startGoogleSignIn } from '../auth/supabaseAuth';
import './AuthScreen.css';

type Props = {
  onSignIn: (email: string | null, accessToken?: string | null, userId?: string | null) => void | Promise<void>;
  onBackToWorkspace?: () => void;
};

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_IPC__' in window;
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285f4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.38a4.6 4.6 0 0 1-2 3.02v2.53h3.24c1.9-1.75 2.98-4.33 2.98-7.39Z" />
      <path fill="#34a853" d="M12 22c2.7 0 4.98-.9 6.63-2.38l-3.24-2.53c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.77-5.61-4.14H3.04v2.61A10 10 0 0 0 12 22Z" />
      <path fill="#fbbc05" d="M6.39 13.91A6 6 0 0 1 6.08 12c0-.66.11-1.31.31-1.91V7.48H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.52l3.35-2.61Z" />
      <path fill="#ea4335" d="M12 5.95c1.47 0 2.79.51 3.82 1.5l2.88-2.88A9.68 9.68 0 0 0 12 2a10 10 0 0 0-8.96 5.48l3.35 2.61C7.18 7.72 9.39 5.95 12 5.95Z" />
    </svg>
  );
}

function GithubMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18a10.98 10.98 0 0 1 5.76 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.71 5.38-5.29 5.67.42.36.79 1.06.79 2.14v3.25c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
    </svg>
  );
}

export function AuthScreen({ onSignIn, onBackToWorkspace }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [activeProvider, setActiveProvider] = useState<'google' | 'github' | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [mode, setMode] = useState<'sign-in' | 'sign-up' | 'reset'>('sign-in');
  const [notice, setNotice] = useState<string | null>(null);
  const switchMode = (next: typeof mode) => { setMode(next); setAuthError(null); setNotice(null); setPassword(''); };
  const nativeWindowChrome = isTauriRuntime();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError(null);
    setNotice(null);
    const trimmedEmail = email.trim();
    if (!isSupabaseAuthConfigured()) {
      await onSignIn(trimmedEmail || null);
      return;
    }
    if (!trimmedEmail || (mode !== 'reset' && !password)) {
      setAuthError(mode === 'reset' ? 'Enter the email address of your account.' : 'Enter your email address and password to continue.');
      return;
    }
    if (mode === 'sign-up' && password.length < 8) {
      setAuthError('Use a password with at least 8 characters.');
      return;
    }
    setAuthBusy(true);
    try {
      if (mode === 'reset') {
        await requestPasswordReset(trimmedEmail);
        setNotice('If an account uses this address, a reset link is on its way. Open it, then choose a new password in Profile.');
        return;
      }
      if (mode === 'sign-up') {
        const { session } = await signUpWithPassword(trimmedEmail, password);
        if (session) await onSignIn(session.user.email ?? trimmedEmail, session.access_token, session.user.id);
        else { setNotice('Account created. Confirm it from the email we sent, then sign in.'); setMode('sign-in'); setPassword(''); }
        return;
      }
      const session = await signInWithPassword(trimmedEmail, password);
      await onSignIn(session.user.email ?? trimmedEmail, session.access_token, session.user.id);
    } catch (cause) {
      const fallback = mode === 'sign-up' ? 'The account could not be created. Try again.' : mode === 'reset' ? 'The reset link could not be sent. Try again.' : 'Sign-in failed. Check your email address and password.';
      setAuthError(cause instanceof Error && cause.message ? cause.message : fallback);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSocialSignIn = async (provider: 'google' | 'github') => {
    setAuthError(null);
    if (!isSupabaseAuthConfigured()) {
      await onSignIn(null);
      return;
    }
    setActiveProvider(provider);
    setAuthBusy(true);
    try {
      await (provider === 'google' ? startGoogleSignIn() : startGithubSignIn());
    } catch (cause) {
      const providerLabel = provider === 'google' ? 'Google' : 'GitHub';
      setAuthError(cause instanceof Error ? cause.message : `${providerLabel} sign-in could not be started.`);
      setAuthBusy(false);
      setActiveProvider(null);
    }
  };

  return (
    <div className={`auth-shell app-shell has-window-chrome ${nativeWindowChrome ? 'native-window-chrome' : 'browser-window-chrome'}`}>
      {!nativeWindowChrome && <WindowHeader />}
      <main className="auth-layout">
        <section className="auth-panel" aria-labelledby="auth-title">
          <div className="auth-product-row">
            <div className="auth-product"><img src="/assets/centinel-shield.svg" alt="" aria-hidden="true" /><span>Centinel</span></div>
            {onBackToWorkspace && <button type="button" className="auth-back-button" onClick={onBackToWorkspace}>Back to workspace</button>}
          </div>
          <header className="auth-panel-heading"><h1 id="auth-title">{mode === 'sign-up' ? 'Create your Centinel account' : mode === 'reset' ? 'Reset your password' : 'Sign in to Centinel'}</h1><p>{mode === 'reset' ? 'We will email you a link to choose a new password.' : 'Access your review and testing workspace.'}</p></header>

          {mode !== 'reset' && <><div className="auth-providers" role="group" aria-label="Social sign-in options">
            <button type="button" className="auth-provider" onClick={() => void handleSocialSignIn('google')} disabled={authBusy}>
              <GoogleMark />
              <span>{activeProvider === 'google' ? 'Opening Google…' : 'Continue with Google'}</span>
            </button>
            <button type="button" className="auth-provider" onClick={() => void handleSocialSignIn('github')} disabled={authBusy}>
              <GithubMark />
              <span>{activeProvider === 'github' ? 'Opening GitHub…' : 'Continue with GitHub'}</span>
            </button>
          </div>

          <div className="auth-divider"><span>or continue with email</span></div></>}

          {authError && <p className="form-error" role="alert">{authError}</p>}
          {notice && <p className="auth-notice" role="status">{notice}</p>}
          <form onSubmit={event => { void submit(event); }} noValidate>
            <label htmlFor="auth-email"><span>Email address</span><input id="auth-email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="name@organisation.com" /></label>
            {mode !== 'reset' && <label htmlFor="auth-password"><span>Password</span><span className="auth-password-control"><input id="auth-password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>}
            <button type="submit" className="btn-primary auth-submit" disabled={authBusy}>{authBusy ? 'Working…' : mode === 'sign-up' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}</button>
          </form>
          <div className="auth-mode-links">
            {mode === 'sign-in' && <><button type="button" className="btn-link" onClick={() => switchMode('reset')}>Forgot password?</button><button type="button" className="btn-link" onClick={() => switchMode('sign-up')}>Create an account</button></>}
            {mode !== 'sign-in' && <button type="button" className="btn-link" onClick={() => switchMode('sign-in')}>Back to sign in</button>}
          </div>
        </section>
        <footer className="auth-footer">Centinel Desktop</footer>
      </main>
    </div>
  );
}
