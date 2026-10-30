import { useCallback, useEffect, useState } from 'react';
import { UserMinus, UserPlus } from 'lucide-react';
import { api } from '../api/client';
import { ConfirmDialog } from './ConfirmDialog';
import { Select } from './Select';
import { StatusBadge } from './CommandUI';
import type { ProjectMember, ProjectMemberList } from '../types';
import { userFacingError } from '../utils/userFacingError';
import './ProjectMembersPanel.css';

const ROLE_LABEL: Record<ProjectMember['role'], string> = { owner: 'Owner', member: 'Member', viewer: 'Viewer' };

/**
 * Centinel account members of one project. Membership controls who can read
 * and run project work; only the owner can add or remove people.
 */
export function ProjectMembersPanel({ projectId }: { projectId: string }) {
  const [list, setList] = useState<ProjectMemberList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'viewer'>('member');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ProjectMember | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api.listProjectMembers(projectId));
      setLoadError(null);
    } catch (error) {
      setLoadError(userFacingError(error, 'Project members could not be loaded.'));
    }
  }, [projectId]);

  useEffect(() => { setList(null); void load(); }, [load]);

  const isOwner = Boolean(list?.members.some(member => member.role === 'owner' && member.userId === list.viewerUserId));

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy(true); setActionError(null); setNotice(null);
    try {
      const added = await api.addProjectMember(projectId, email.trim(), role);
      setEmail('');
      setNotice(`${added.email} can now ${added.role === 'viewer' ? 'view' : 'view and run'} this project's work.`);
      await load();
    } catch (error) {
      setActionError(userFacingError(error, 'The member could not be added.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true); setActionError(null); setNotice(null);
    try {
      await api.removeProjectMember(projectId, removing.userId);
      setNotice(`${removing.email} no longer has access to this project.`);
      setRemoving(null);
      await load();
    } catch (error) {
      setActionError(userFacingError(error, 'The member could not be removed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="project-members" aria-labelledby="project-members-heading">
      <div className="project-members-heading">
        <h3 id="project-members-heading">Project members</h3>
        <p>People with a Centinel account who can open this project's sources, Reviews, tests and evidence.</p>
      </div>
      {loadError && <p className="command-inline-alert" role="alert">{loadError} <button type="button" className="btn-link" onClick={() => void load()}>Retry</button></p>}
      {!list && !loadError && <p className="project-members-status" role="status">Loading members…</p>}
      {list && <ul className="project-members-list" aria-label="Project members">
        {list.members.map(member => <li key={member.userId} className="project-members-row">
          <span className="project-members-identity"><strong>{member.email || 'Account e-mail unavailable'}</strong>{member.userId === list.viewerUserId && <small>You</small>}</span>
          <StatusBadge label={ROLE_LABEL[member.role] ?? member.role} tone={member.role === 'owner' ? 'success' : 'neutral'} />
          {isOwner && member.role !== 'owner' && <button type="button" className="btn-secondary project-members-remove" disabled={busy} onClick={() => setRemoving(member)} aria-label={`Remove ${member.email}`}><UserMinus size={15} aria-hidden="true" /> Remove</button>}
        </li>)}
      </ul>}
      {list && isOwner && <form className="project-members-form" onSubmit={event => void add(event)} aria-label="Add a project member">
        <div className="form-field"><label htmlFor="project-member-email">E-mail of a Centinel account</label><input id="project-member-email" type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" autoComplete="off" /></div>
        <div className="form-field"><label htmlFor="project-member-role">Access</label><Select id="project-member-role" value={role} onChange={value => setRole(value === 'viewer' ? 'viewer' : 'member')} options={[{ value: 'member', label: 'Member: view and run' }, { value: 'viewer', label: 'Viewer: view only' }]} /></div>
        <button type="submit" className="btn-primary" disabled={busy || !email.trim()}><UserPlus size={15} aria-hidden="true" /> {busy ? 'Saving…' : 'Add member'}</button>
      </form>}
      {list && !isOwner && <p className="project-members-status">Only the project owner can add or remove members.</p>}
      {actionError && <p className="command-inline-alert" role="alert">{actionError}</p>}
      {notice && <p className="project-members-notice" role="status">{notice}</p>}
      <ConfirmDialog
        isOpen={removing !== null}
        title="Remove member?"
        description={`${removing?.email ?? 'This person'} will immediately lose access to this project's sources, Reviews, tests and shared evidence. Their earlier decisions stay in the history.`}
        confirmLabel="Remove member"
        onConfirm={() => void remove()}
        onClose={() => setRemoving(null)}
        busy={busy}
      />
    </section>
  );
}
