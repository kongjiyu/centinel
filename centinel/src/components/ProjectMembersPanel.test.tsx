import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { ProjectMembersPanel } from './ProjectMembersPanel';

vi.mock('../api/client', () => ({ api: { listProjectMembers: vi.fn(), addProjectMember: vi.fn(), removeProjectMember: vi.fn() } }));

const owner = { userId: 'owner-1', email: 'owner@example.com', role: 'owner' as const, addedAt: '' };
const member = { userId: 'member-1', email: 'tester@example.com', role: 'member' as const, addedAt: '' };

describe('ProjectMembersPanel', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lets the owner add a member by e-mail and remove them again', async () => {
    vi.mocked(api.listProjectMembers).mockResolvedValueOnce({ viewerUserId: 'owner-1', members: [owner] })
      .mockResolvedValueOnce({ viewerUserId: 'owner-1', members: [owner, member] })
      .mockResolvedValueOnce({ viewerUserId: 'owner-1', members: [owner] });
    vi.mocked(api.addProjectMember).mockResolvedValue(member);
    vi.mocked(api.removeProjectMember).mockResolvedValue({ removed: true });
    const user = userEvent.setup();
    render(<ProjectMembersPanel projectId="project-1" />);
    await user.type(await screen.findByRole('textbox', { name: 'E-mail of a Centinel account' }), 'tester@example.com');
    await user.click(screen.getByRole('button', { name: 'Add member' }));
    await waitFor(() => expect(api.addProjectMember).toHaveBeenCalledWith('project-1', 'tester@example.com', 'member'));
    expect(await screen.findByText(/tester@example.com can now view and run/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove tester@example.com' }));
    await user.click(screen.getByRole('button', { name: 'Remove member' }));
    await waitFor(() => expect(api.removeProjectMember).toHaveBeenCalledWith('project-1', 'member-1'));
    expect(await screen.findByText(/no longer has access/)).toBeInTheDocument();
  });

  it('shows members read-only to a non-owner', async () => {
    vi.mocked(api.listProjectMembers).mockResolvedValue({ viewerUserId: 'member-1', members: [owner, member] });
    render(<ProjectMembersPanel projectId="project-1" />);
    expect(await screen.findByText('Only the project owner can add or remove members.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Add a project member' })).not.toBeInTheDocument();
  });
});
