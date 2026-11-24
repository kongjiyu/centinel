import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiProviderSetting, Artifact, Project } from '../../types';
import { api } from '../../api/client';
import { StartScreen } from './StartScreen';
import { resetCheckStore, saveCheck } from '../../check/store';

vi.mock('../../api/client', () => ({ api: {
  prepareSampleShop: vi.fn().mockResolvedValue({ path: '/apps/sample-shop', url: 'http://127.0.0.1:4100', server: 'started' }),
  listConnectedSources: vi.fn().mockResolvedValue([]),
  listStaticSessions: vi.fn().mockResolvedValue([]),
  autoTests: vi.fn().mockResolvedValue([]),
  listArtifacts: vi.fn().mockResolvedValue([]),
  uploadArtifact: vi.fn(),
} }));
const startCheck = vi.fn((_input: unknown) => ({ id: 'check-1' }));
vi.mock('../../check/runner', async importOriginal => ({ ...(await importOriginal<typeof import('../../check/runner')>()), startCheck: (input: unknown) => startCheck(input) }));

const ready: AiProviderSetting[] = [
  { id: 'text', provider: 'codex', model: 'gpt-5', hasApiKey: false } as AiProviderSetting,
  { id: 'vision', provider: 'codex', model: 'gpt-5', hasApiKey: false, codexScreenshots: true } as AiProviderSetting,
];

function renderStart(settings = ready, projects: Project[] = []) {
  const onNavigate = vi.fn();
  render(<main><StartScreen projects={projects} aiSettings={settings} onNavigate={onNavigate} onProjectCreated={vi.fn()} onCreateProject={vi.fn()} /></main>);
  return { onNavigate };
}

describe('Start screen', () => {
  beforeEach(() => { startCheck.mockClear(); resetCheckStore(); window.localStorage.clear(); Reflect.deleteProperty(window, '__TAURI_IPC__'); });

  it('adds a dropped document to the selected project library and carries its saved ID into the check', async () => {
    const project = { id: 'shop', name: 'Storefront', description: '', workspacePath: '/apps/shop', createdAt: '', updatedAt: '' };
    const artifact = { id: 'document-1', projectId: 'shop', fileName: 'requirements.md' } as Artifact;
    vi.mocked(api.uploadArtifact).mockResolvedValueOnce(artifact);
    vi.mocked(api.listArtifacts).mockResolvedValue([artifact]);
    const user = userEvent.setup();
    renderStart(ready, [project]);
    await user.click(screen.getByRole('button', { name: 'Choose project' }));
    await user.click(screen.getByRole('button', { name: 'Storefront' }));
    await user.click(screen.getByRole('button', { name: 'Add to check' }));
    expect(await screen.findByRole('button', { name: 'requirements.md' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add Document' }));
    expect(screen.queryByRole('dialog', { name: 'Add Document' })).not.toBeInTheDocument();
    const main = screen.getByRole('main');
    const dataTransfer = { types: ['Files'], files: [new File(['requirement'], 'requirements.md')], items: [] };
    fireEvent.dragOver(main, { dataTransfer });
    expect(screen.getByText('Drop documents anywhere on this page')).toBeInTheDocument();
    fireEvent.drop(main, { dataTransfer });
    expect(screen.queryByText('Drop documents anywhere on this page')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Remove requirements.md' })).toBeInTheDocument();
    expect(api.uploadArtifact).toHaveBeenCalledWith('shop', { fileName: 'requirements.md', content: 'cmVxdWlyZW1lbnQ=', type: 'requirement' });
    await user.click(screen.getByRole('button', { name: 'Conduct the Check' }));
    expect(startCheck).toHaveBeenCalledWith(expect.objectContaining({ documents: [{
      name: 'requirements.md', base64: 'cmVxdWlyZW1lbnQ=', saved: { projectId: 'shop', artifactId: 'document-1' },
    }] }));
    vi.mocked(api.listArtifacts).mockResolvedValue([]);
  });

  it('replaces the project, mode and draft from an unseen result without starting a check', async () => {
    const user = userEvent.setup();
    saveCheck({ id: 'prior', projectId: 'shop', projectName: 'Storefront', title: 'Checkout pricing', createdAt: '2026-11-17T08:00:00Z', updatedAt: '2026-11-17T08:00:00Z',
      documents: [], focus: 'Checkout totals', mode: 'code', phase: 'done', notes: [] });
    renderStart(ready, ['Current project', 'Storefront'].map((name, index) => ({
      id: index ? 'shop' : 'current', name, description: '', workspacePath: '/apps/' + index, createdAt: '', updatedAt: '',
    })));
    await user.click(screen.getByRole('button', { name: 'Choose project' }));
    await user.click(screen.getByRole('button', { name: /^Current project$/ }));
    const draft = screen.getByRole('textbox');
    await user.type(draft, 'Review release changes');
    await user.click(screen.getByRole('button', { name: 'Revisit the latest check for Storefront.' }));
    expect(draft).toHaveValue('Recheck the areas flagged in the last result.');
    expect(draft).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Choose project: Storefront' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Check mode' })).toHaveTextContent('Code');
    expect(screen.getByRole('button', { name: 'Remove check Checkout pricing' })).toBeInTheDocument();
    expect(startCheck).not.toHaveBeenCalled();
  });

  it('keeps recommendations out of the add menu', async () => {
    const user = userEvent.setup();
    renderStart();
    await user.click(screen.getByRole('button', { name: 'Add to check' }));
    expect(screen.getByRole('dialog', { name: 'Add to check' })).not.toHaveTextContent('Recommendations');
  });

  it('shows Auto with no project selected and expands the composer on demand', async () => {
    const user = userEvent.setup();
    renderStart();
    expect(screen.getByRole('combobox', { name: 'Project conversation permission' })).toHaveTextContent('Auto');
    await user.click(screen.getByRole('button', { name: 'Expand composer' }));
    expect(screen.getByRole('button', { name: 'Collapse composer' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('uses Enter to send compact drafts and Ctrl+Enter to send expanded drafts', async () => {
    const user = userEvent.setup();
    renderStart(ready, [{ id: 'shop', name: 'Shop', description: '', workspacePath: '/apps/shop', createdAt: '', updatedAt: '' }]);
    await user.click(screen.getByRole('button', { name: 'Choose project' }));
    await user.click(screen.getByRole('button', { name: 'Shop' }));
    const input = screen.getByRole('textbox');
    await user.type(input, 'First');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(input).toHaveValue('First\n');
    expect(startCheck).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Expand composer' }));
    await user.type(input, 'Second{Enter}Third');
    expect(input).toHaveValue('First\nSecond\nThird');
    expect(startCheck).not.toHaveBeenCalled();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(startCheck).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'shop', focus: 'First\nSecond\nThird' }));
  });

  it('uses a different scenario after two first-check recommendations', async () => {
    saveCheck({ id: 'old', projectId: 'Stale', projectName: 'Stale', createdAt: '2020-01-01', updatedAt: '2020-01-01',
      viewedAt: '2020-01-01', documents: [], focus: '', mode: 'code', phase: 'done', notes: [] });
    renderStart(ready, ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Stale'].map(name => ({
      id: name, name, description: '', workspacePath: '/app', createdAt: '2020-01-01', updatedAt: '',
    })));
    await screen.findByRole('button', { name: 'Check Stale again for regressions.' });
    const rows = Array.from(screen.getByRole('group', { name: 'Recommendations' }).querySelectorAll('button'), row => row.textContent);
    expect(rows).toEqual(['Run your first check on Alpha.', 'Run your first check on Bravo.', 'Check Stale again for regressions.', 'Try the Sample Shop']);
  });

  it('asks for the project before starting instead of starting an empty check', async () => {
    const { onNavigate } = renderStart();
    expect(screen.getByRole('heading', { name: 'What should ORIN check?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Conduct the Check' }));
    expect(screen.getByRole('status')).toHaveTextContent('Add your project first');
    expect(startCheck).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('turns a pasted folder path into the project chip and starts a check in the chosen mode', async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderStart();
    const box = screen.getByLabelText('Project folder path or GitHub link');
    await user.click(box);
    await user.paste('/Users/me/work/shop');
    expect(screen.getByRole('button', { name: 'Remove shop' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Anything to focus on (optional)'), 'checkout totals');
    expect(screen.getByRole('button', { name: 'Conduct the Check' })).toHaveClass('is-icon');
    await user.click(screen.getByRole('combobox', { name: 'Check mode' }));
    await user.click(screen.getByRole('option', { name: 'Code' }));
    await user.click(screen.getByRole('button', { name: 'Conduct the Check' }));
    expect(startCheck).toHaveBeenCalledWith({ folder: '/Users/me/work/shop', documents: [], focus: 'checkout totals', mode: 'code' });
    expect(onNavigate).toHaveBeenCalledWith({ name: 'check', checkId: 'check-1' });
  });

  it('submits a saved project by ID in browser-only mode', async () => {
    const user = userEvent.setup();
    renderStart(ready, [{ id: 'saved-1', name: 'Shop', description: '', workspacePath: '/apps/shop', createdAt: '', updatedAt: '' }]);
    await user.click(screen.getByRole('button', { name: /^Choose project$/ }));
    await user.click(screen.getByRole('button', { name: 'Shop' }));
    expect(screen.getByRole('button', { name: 'Remove Shop' })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Check mode' }));
    await user.click(screen.getByRole('option', { name: 'Browser' }));
    await user.click(screen.getByRole('button', { name: 'Conduct the Check' }));
    expect(startCheck).toHaveBeenCalledWith({ projectId: 'saved-1', documents: [], focus: '', mode: 'browser', startupPermission: 'auto' });
  });

  it('opens project creation from the project dropdown without losing the draft', async () => {
    const user = userEvent.setup();
    renderStart(ready, [{ id: 'saved-1', name: 'Shop', description: '', workspacePath: '/apps/shop', createdAt: '', updatedAt: '' }]);
    const draft = screen.getByLabelText('Project folder path or GitHub link');
    await user.type(draft, 'review checkout');
    await user.click(screen.getByRole('button', { name: /^Choose project$/ }));
    const list = screen.getByRole('group', { name: 'Saved projects' });
    const create = screen.getByRole('button', { name: 'Add a project' });
    expect(list).not.toContainElement(create);
    await user.click(create);
    expect(screen.getByRole('dialog', { name: 'Add Project' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(draft).toHaveValue('review checkout');
  });

  it('accepts a GitHub link from the add menu and explains that browser tests need a folder', async () => {
    const user = userEvent.setup();
    renderStart();
    await user.click(screen.getByRole('button', { name: 'Add to check' }));
    await user.click(screen.getByRole('button', { name: /Add Repository/ }));
    await user.click(screen.getByRole('button', { name: 'Link' }));
    await user.type(screen.getByLabelText('GitHub repository URL'), 'https://github.com/acme/shop{Enter}');
    expect(screen.getByRole('button', { name: 'Choose project: acme/shop' })).toBeInTheDocument();
    expect(screen.getByText(/Choose a project with a local folder to run browser tests/)).toBeInTheDocument();
  });

  it('rejects a link that is not a GitHub repository', async () => {
    const user = userEvent.setup();
    renderStart();
    await user.click(screen.getByRole('button', { name: 'Add to check' }));
    await user.click(screen.getByRole('button', { name: /Add Repository/ }));
    await user.click(screen.getByRole('button', { name: 'Link' }));
    await user.type(screen.getByLabelText('GitHub repository URL'), 'https://example.com/shop{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid GitHub repository URL');
  });

  it('shows the one missing setup step in place when no AI provider is connected', async () => {
    const { onNavigate } = renderStart([]);
    expect(screen.getByText('Connect an AI provider for code and browser checks.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open AI settings' }));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'settings' });
  });

  it('attaches the bundled Sample Shop', async () => {
    renderStart();
    const rows = screen.getByRole('group', { name: 'Recommendations' }).querySelectorAll('button');
    expect(rows).toHaveLength(4);
    expect(rows[3]).toHaveTextContent('Try the Sample Shop');
    await userEvent.click(rows[3]);
    expect(await screen.findByRole('button', { name: 'Remove sample-shop' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Check that shoppers can browse products, add items to their cart, and complete checkout.');
  });

  it('filters check mentions, selects their project, and carries the reference into the new check', async () => {
    const user = userEvent.setup();
    saveCheck({ id: 'earlier', projectId: 'shop', projectName: 'Storefront', title: 'Storefront smoke test', createdAt: '2026-11-17T08:00:00Z', updatedAt: '2026-11-17T08:00:00Z', documents: [], focus: '', mode: 'both', phase: 'done', notes: [] });
    renderStart(ready, [{ id: 'shop', name: 'Storefront', description: '', workspacePath: '/apps/shop', createdAt: '', updatedAt: '' }]);
    await user.type(screen.getByRole('textbox'), 'checkout @absent');
    expect(screen.getByText('No matching checks')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox'), '{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}store');
    expect(within(screen.getByRole('region', { name: 'Recent Checks' })).getByRole('button', { name: 'Storefront smoke test' })).toHaveAttribute('data-mention-active');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Choose project: Storefront' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Conduct the Check' }));
    expect(startCheck).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'shop', focus: 'checkout ', referenceCheckIds: ['earlier'] }));
  });

  it('filters saved projects by mention and lets the keyboard select one without a matching check', async () => {
    const user = userEvent.setup();
    renderStart(ready, [
      { id: 'shop', name: 'Storefront', description: '', workspacePath: '/apps/shop', createdAt: '', updatedAt: '' },
      { id: 'cargo', name: 'CargoChain', description: '', workspacePath: '/apps/cargo', createdAt: '', updatedAt: '' },
    ]);
    await user.type(screen.getByRole('textbox'), 'review @CARGO');
    expect(screen.queryByRole('button', { name: 'Storefront' })).not.toBeInTheDocument();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'CargoChain' })).toHaveAttribute('data-mention-active');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Choose project: CargoChain' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('review ');
    expect(screen.queryByRole('dialog', { name: 'Add to check' })).not.toBeInTheDocument();
  });
});
