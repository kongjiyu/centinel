import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { WindowHeader } from '../components/WindowHeader';
import './AuthScreen.css';

type Props = {
  onSignIn: () => void;
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

export function AuthScreen({ onSignIn }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const nativeWindowChrome = isTauriRuntime();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onSignIn();
  };

  return (
    <div className={`auth-shell app-shell has-window-chrome ${nativeWindowChrome ? 'native-window-chrome' : 'browser-window-chrome'}`}>
      {!nativeWindowChrome && <WindowHeader />}
      <main className="auth-layout">
        <section className="auth-panel" aria-labelledby="auth-title">
          <div className="auth-product"><img src="/assets/centinel-shield.svg" alt="" aria-hidden="true" /><span>Centinel</span></div>
          <header className="auth-panel-heading"><h1 id="auth-title">Sign in to Centinel</h1><p>Access your review and testing workspace.</p></header>

          <button type="button" className="auth-google" onClick={onSignIn}>
            <GoogleMark />
            <span>Continue with Google</span>
          </button>

          <div className="auth-divider"><span>or continue with email</span></div>

          <form onSubmit={submit} noValidate>
            <label htmlFor="auth-email"><span>Email address</span><input id="auth-email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="name@organisation.com" /></label>
            <label htmlFor="auth-password"><span>Password</span><span className="auth-password-control"><input id="auth-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
            <button type="submit" className="btn-primary auth-submit">Sign in</button>
          </form>
        </section>
        <footer className="auth-footer">Centinel Desktop</footer>
      </main>
    </div>
  );
}
