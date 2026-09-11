import { GitBranch, UserRound } from 'lucide-react';
import { CommandPageHeader } from '../components/CommandUI';

const MOCK_PROFILE = {
  name: 'Avery Chen',
  username: '@centinel-demo',
};

/** A clearly labelled local placeholder until account identity is persisted. */
export function ProfileScreen() {
  return (
    <div className="screen profile-screen">
      <CommandPageHeader
        eyebrow="Profile"
        title="Your profile"
        description="Your connected account details appear here."
      />
      <section className="profile-card" aria-labelledby="profile-account-title">
        <div className="profile-avatar" aria-hidden="true"><UserRound size={28} strokeWidth={1.6} /></div>
        <div className="profile-account-copy">
          <h2 id="profile-account-title">{MOCK_PROFILE.name}</h2>
          <p><GitBranch size={16} aria-hidden="true" /> {MOCK_PROFILE.username}</p>
        </div>
        <span className="profile-mock-badge">Mock profile</span>
      </section>
    </div>
  );
}
