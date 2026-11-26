import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { listChecks, resetCheckStore, saveCheck } from '../../check/store';
import type { AiProviderSetting, Artifact, Screen, StaticSession } from '../../types';
import { CheckProjectHeader } from './CheckProjectWorkspace';
import { useCheckLibrary } from './CheckSourceLibrary';
import { CheckScreen } from './CheckScreen';
import { StartScreen } from './StartScreen';

vi.mock('../../api/client', () => ({ api: {
  listArtifacts: vi.fn(), listConnectedSources: vi.fn(), listStaticSessions: vi.fn(), autoTests: vi.fn(),
  listRequirements: vi.fn(), createStaticSession: vi.fn(), getStaticSession: vi.fn(),
  listStaticFindings: vi.fn(), getReviewHarness: vi.fn(), startAutoTest: vi.fn(), uploadArtifact: vi.fn(),
  importConnectedSource: vi.fn(), browseConnectedSources: vi.fn(),
} }));

const project = { id: 'shop', name: 'Fixture shop', description: '', workspacePath: '', createdAt: '', updatedAt: '' };
const projects = [project];
const settings = [{ id: 'text', provider: 'codex', model: 'gpt-5', hasApiKey: false }] as AiProviderSetting[];
const artifacts = ['orders', 'catalog'].map(id => ({
  id, projectId: project.id, fileName: id + '.js', filePath: 'src/' + id + '.js', type: 'source_code',
} as Artifact));

function Workspace() {
  const [route, navigate] = useState<Screen>({ name: 'new-check' });
  return route.name === 'check'
    ? <CheckScreen key={route.checkId} checkId={route.checkId} projects={projects} onNavigate={navigate} />
    : <StartScreen projects={projects} aiSettings={settings} onNavigate={navigate} onProjectCreated={vi.fn()} onCreateProject={vi.fn()} />;
}

function ProjectSourcesFixture() {
  const library = useCheckLibrary(project.id);
  return <CheckProjectHeader project={project} check={{ projectId: project.id, projectName: project.name }}
    onNavigate={vi.fn()} library={library} projectAction={<button type="button">Run a full check</button>} />;
}

beforeEach(() => {
  sessionStorage.clear();
  resetCheckStore();
  vi.resetAllMocks();
  vi.mocked(api.listArtifacts).mockResolvedValue(artifacts);
  vi.mocked(api.listConnectedSources).mockResolvedValue([]);
  vi.mocked(api.listStaticSessions).mockResolvedValue([]);
  vi.mocked(api.autoTests).mockResolvedValue([]);
  vi.mocked(api.listRequirements).mockResolvedValue([]);
  vi.mocked(api.listStaticFindings).mockResolvedValue([]);
  vi.mocked(api.getReviewHarness).mockResolvedValue(null as never);
  vi.mocked(api.getStaticSession).mockImplementation(async (projectId, id) => ({
    id, projectId, status: 'completed', progressJson: '{}', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }) as StaticSession);
});

it('carries a recent-check reference into a result and a library selection into its follow-up Review', async () => {
  saveCheck({
    id: 'prior', projectId: project.id, projectName: project.name, title: 'Catalog Navigation', createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z',
    mode: 'code', phase: 'done', focus: '', documents: [], notes: [],
  });
  vi.mocked(api.createStaticSession).mockResolvedValueOnce({ id: 'first' } as StaticSession).mockResolvedValueOnce({ id: 'second' } as StaticSession);
  const user = userEvent.setup();
  render(<Workspace />);
  await user.type(screen.getByRole('textbox'), 'Review checkout @Fixture');
  const recent = within(screen.getByRole('region', { name: 'Recent Checks' }));
  await user.click(recent.getByRole('button', { name: 'Catalog Navigation' }));
  await user.click(screen.getByRole('combobox', { name: 'Check mode' }));
  await user.click(screen.getByRole('option', { name: 'Code' }));
  await user.click(screen.getByRole('button', { name: 'Conduct the Check' }));

  await waitFor(() => expect(listChecks()[0]).toMatchObject({ reviewId: 'first', phase: 'done', referenceCheckIds: ['prior'] }));
  expect(screen.queryByRole('navigation', { name: 'Referenced checks' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'History' }));
  const history = within(screen.getByRole('dialog', { name: 'History' }));
  expect(history.getByRole('button', { name: 'Catalog Navigation' })).toBeInTheDocument();
  expect(history.queryByText(/01 Oct/)).not.toBeInTheDocument();
  const firstCheck = listChecks()[0].id;
  expect(api.createStaticSession).toHaveBeenNthCalledWith(1, project.id, expect.objectContaining({
    instructions: 'Review checkout', artifactIds: ['orders', 'catalog'], scopeMode: 'full',
  }));

  await user.click(screen.getByRole('button', { name: 'Add to check' }));
  const add = within(screen.getByRole('dialog', { name: 'Add to check' }));
  await user.click(await add.findByRole('button', { name: 'src/orders.js' }));
  expect(screen.getByRole('button', { name: 'Remove source orders.js' })).toBeInTheDocument();
  const followUp = screen.getByRole('textbox', { name: 'Follow-up check' });
  await user.type(followUp, 'Review order totals @Fixture');
  const mentions = within(screen.getByRole('region', { name: 'Recent Checks' }));
  await user.click(mentions.getByRole('button', { name: 'Catalog Navigation' }));
  expect(followUp).toHaveValue('Review order totals ');
  expect(screen.getByRole('button', { name: 'Remove check Catalog Navigation' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Send follow-up' }));

  await waitFor(() => expect(listChecks()[0]).toMatchObject({ reviewId: 'second', phase: 'done', referenceCheckIds: [firstCheck, 'prior'], sourceArtifactIds: ['orders'] }));
  expect(api.createStaticSession).toHaveBeenNthCalledWith(2, project.id, expect.objectContaining({
    instructions: 'Review order totals', artifactIds: ['orders'], scopeMode: 'focused',
  }));
  expect(api.startAutoTest).not.toHaveBeenCalled();
});

it('offers document and repository actions on source hover and keyboard activation', async () => {
  saveCheck({ id: 'prior', projectId: project.id, projectName: project.name, createdAt: '', updatedAt: '',
    mode: 'code', phase: 'done', focus: '', documents: [], notes: [] });
  const user = userEvent.setup();
  render(<ProjectSourcesFixture />);
  await user.click(screen.getByRole('button', { name: 'Project sources for Fixture shop' }));
  const add = screen.getByRole('button', { name: 'Add source' });
  await user.hover(add);
  let actions = within(screen.getByRole('group', { name: 'Source actions' }));
  expect(actions.getByRole('button', { name: 'Add repository' })).toBeInTheDocument();
  await user.unhover(add);
  expect(screen.queryByRole('group', { name: 'Source actions' })).not.toBeInTheDocument();
  add.focus();
  await user.keyboard('{Enter}');
  actions = within(screen.getByRole('group', { name: 'Source actions' }));
  await user.click(actions.getByRole('button', { name: 'Add documents' }));
  const documentDialog = screen.getByRole('dialog', { name: 'Add Document' });
  expect(documentDialog.parentElement).toHaveClass('modal-overlay-app-blur');
  expect(documentDialog.parentElement?.parentElement).toBe(document.body);
  const picker = within(documentDialog);
  const file = new File(['release scope'], 'notes.md');
  const entry = { isFile: true, fullPath: '/release/notes.md', file: (resolve: (file: File) => void) => resolve(file) };
  const readEntries = vi.fn().mockImplementationOnce(resolve => resolve([entry])).mockImplementation(resolve => resolve([]));
  const folder = { isDirectory: true, fullPath: '/release', createReader: () => ({ readEntries }) };
  const saved = { id: 'notes', projectId: project.id, fileName: 'release/notes.md', filePath: 'release/notes.md', source: 'documents' } as Artifact;
  vi.mocked(api.uploadArtifact).mockResolvedValueOnce(saved);
  vi.mocked(api.listArtifacts).mockResolvedValue([...artifacts, saved]);
  fireEvent.drop(picker.getByText('Drop files or a folder here').parentElement!, {
    dataTransfer: { types: ['Files'], items: [{ kind: 'file', webkitGetAsEntry: () => folder }], files: [] },
  });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add Document' })).not.toBeInTheDocument());
  expect(api.uploadArtifact).toHaveBeenCalledWith(project.id, { fileName: 'release/notes.md', content: 'cmVsZWFzZSBzY29wZQ==', type: 'other' });
  await user.click(screen.getByRole('button', { name: 'Project sources for Fixture shop' }));
  const library = within(screen.getByRole('region', { name: 'Library' }));
  expect(await library.findByText('notes.md')).toBeInTheDocument();
  expect(library.queryByText('release')).not.toBeInTheDocument();
});

it('closes the source flow on repository cancel and still imports a selection', async () => {
  saveCheck({ id: 'prior', projectId: project.id, projectName: project.name, createdAt: '', updatedAt: '',
    mode: 'code', phase: 'done', focus: '', documents: [], notes: [] });
  const user = userEvent.setup();
  render(<ProjectSourcesFixture />);
  const openRepository = async () => {
    const sources = screen.getByRole('button', { name: 'Project sources for Fixture shop' });
    if (sources.getAttribute('aria-expanded') === 'false') await user.click(sources);
    within(screen.getByRole('dialog', { name: 'Project sources' })).getByRole('button', { name: 'Add source' }).focus();
    await user.keyboard('{Enter}');
    screen.getByRole('button', { name: 'Add repository' }).focus();
    await user.keyboard('{Enter}');
    const repositoryDialog = screen.getByRole('dialog', { name: 'Add Repository' });
    expect(repositoryDialog.parentElement).toHaveClass('modal-overlay-app-blur');
    expect(repositoryDialog.parentElement?.parentElement).toBe(document.body);
    return within(repositoryDialog);
  };

  const picker = await openRepository();
  await user.click(picker.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog', { name: /^(Add Repository|Add source)$/i })).not.toBeInTheDocument();
  expect(api.importConnectedSource).not.toHaveBeenCalled();

  vi.mocked(api.browseConnectedSources).mockImplementation(async (_, options) => ({
    items: [{
      id: options?.query ? 'example/shop' : 'example/catalog',
      name: options?.query ? 'example/shop' : 'example/catalog',
      kind: 'repository',
      metadata: { private: Boolean(options?.query) },
    }],
    nextCursor: null,
  }));
  const reopened = await openRepository();
  await user.click(reopened.getByRole('button', { name: 'GitHub' }));
  const addRepository = reopened.getByRole('button', { name: 'Add repository' });
  expect(addRepository).toBeDisabled();
  await reopened.findByRole('button', { name: 'example/catalog' });
  await user.type(reopened.getByRole('searchbox', { name: 'Filter your repositories' }), 'shop');
  await user.click(await reopened.findByRole('button', { name: 'example/shop (private)' }));
  expect(api.importConnectedSource).not.toHaveBeenCalled();
  await user.click(reopened.getByRole('button', { name: 'Refresh repositories' }));
  const repo = await reopened.findByRole('button', { name: 'example/shop (private)' });
  expect(repo).toHaveAttribute('aria-pressed', 'false');
  expect(addRepository).toBeDisabled();
  await user.click(repo);
  await user.click(addRepository);
  expect(await screen.findByText(/GitHub import requested/)).toBeInTheDocument();
  expect(api.importConnectedSource).toHaveBeenCalledExactlyOnceWith(project.id, expect.objectContaining({ remoteId: 'example/shop' }));
});

it('preserves the draft and library selection when switching to an incompatible mode', async () => {
  const localProject = { ...project, workspacePath: '/fixture/shop' };
  saveCheck({
    id: 'prior', projectId: project.id, projectName: project.name, createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z',
    mode: 'both', phase: 'done', focus: '', documents: [], notes: [],
  });
  const user = userEvent.setup();
  const navigate = vi.fn();
  render(<CheckScreen checkId="prior" projects={[localProject]} onNavigate={navigate} />);
  await user.click(screen.getByRole('button', { name: 'Add to check' }));
  await user.click(await within(screen.getByRole('dialog', { name: 'Add to check' })).findByRole('button', { name: 'src/orders.js' }));
  const draft = screen.getByRole('textbox', { name: 'Follow-up check' });
  await user.type(draft, 'Review order totals');
  await user.click(screen.getByRole('combobox', { name: 'Check mode' }));
  await user.click(screen.getByRole('option', { name: 'Browser' }));

  const send = screen.getByRole('button', { name: 'Send follow-up' });
  expect(send).toBeDisabled();
  expect(draft).toHaveValue('Review order totals');
  expect(screen.getByText(/remove the attached library files/)).toBeInTheDocument();
  expect(api.createStaticSession).not.toHaveBeenCalled();
  expect(api.startAutoTest).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Remove source orders.js' }));
  expect(send).toBeEnabled();
  expect(draft).toHaveValue('Review order totals');
});

it('starts a fresh draft for another project selected from a follow-up mention', async () => {
  const otherProject = { ...project, id: 'other', name: 'Other shop' };
  saveCheck({
    id: 'current', projectId: project.id, projectName: project.name, createdAt: '2026-10-01T12:00:00Z',
    updatedAt: '2026-10-01T12:00:00Z', mode: 'code', phase: 'done', focus: '', documents: [], notes: [],
  });
  const navigate = vi.fn();
  const user = userEvent.setup();
  render(<CheckScreen checkId="current" projects={[project, otherProject]} onNavigate={navigate} />);

  const prompt = screen.getByRole('textbox', { name: 'Follow-up check' });
  await user.type(prompt, 'Check checkout @');
  const menu = screen.getByRole('dialog', { name: 'Add to check' });
  expect(within(menu).getByRole('button', { name: 'Add Document' })).toHaveAttribute('data-mention-active');
  expect(prompt).toHaveFocus();
  await user.keyboard('Other{Enter}');
  expect(navigate).toHaveBeenCalledWith({ name: 'new-check', draft: {
    projectId: 'other', focus: 'Check checkout ', mode: 'code', documents: [],
  } });
  expect(api.createStaticSession).not.toHaveBeenCalled();
});
