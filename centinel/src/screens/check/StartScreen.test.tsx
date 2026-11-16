import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiProviderSetting } from '../../types';
import { StartScreen } from './StartScreen';

vi.mock('../../api/client', () => ({ api: { prepareSampleShop: vi.fn().mockResolvedValue({ path: '/apps/sample-shop', url: 'http://127.0.0.1:4100', server: 'started' }) } }));
const startCheck = vi.fn((_input: unknown) => ({ id: 'check-1' }));
vi.mock('../../check/runner', async importOriginal => ({ ...(await importOriginal<typeof import('../../check/runner')>()), startCheck: (input: unknown) => startCheck(input) }));

const ready: AiProviderSetting[] = [
  { id: 'text', provider: 'codex', model: 'gpt-5', hasApiKey: false } as AiProviderSetting,
  { id: 'vision', provider: 'codex', model: 'gpt-5', hasApiKey: false, codexScreenshots: true } as AiProviderSetting,
];

function renderStart(settings = ready) {
  const onNavigate = vi.fn();
  render(<StartScreen projects={[]} aiSettings={settings} onNavigate={onNavigate} onProjectCreated={vi.fn()} />);
  return { onNavigate };
}

describe('Start screen', () => {
  beforeEach(() => { startCheck.mockClear(); Reflect.deleteProperty(window, '__TAURI_IPC__'); });

  it('asks for the project before starting instead of starting an empty check', async () => {
    const { onNavigate } = renderStart();
    expect(screen.getByRole('heading', { name: 'What should Centinel check?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start check' }));
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
    await user.click(screen.getByRole('radio', { name: 'Code only' }));
    await user.click(screen.getByRole('button', { name: 'Start check' }));
    expect(startCheck).toHaveBeenCalledWith({ folder: '/Users/me/work/shop', documents: [], focus: 'checkout totals', mode: 'code' });
    expect(onNavigate).toHaveBeenCalledWith({ name: 'check', checkId: 'check-1' });
  });

  it('accepts a GitHub link from the add menu and explains that browser tests need a folder', async () => {
    const user = userEvent.setup();
    renderStart();
    await user.click(screen.getByRole('button', { name: 'Add a folder, GitHub link or documents' }));
    await user.click(screen.getByRole('menuitem', { name: 'Paste a GitHub link' }));
    await user.type(screen.getByLabelText('GitHub repository link'), 'https://github.com/acme/shop{Enter}');
    expect(screen.getByText('acme/shop')).toBeInTheDocument();
    expect(screen.getByText(/Browser tests need the project folder on this computer/)).toBeInTheDocument();
  });

  it('rejects a link that is not a GitHub repository', async () => {
    const user = userEvent.setup();
    renderStart();
    await user.click(screen.getByRole('button', { name: 'Add a folder, GitHub link or documents' }));
    await user.click(screen.getByRole('menuitem', { name: 'Paste a GitHub link' }));
    await user.type(screen.getByLabelText('GitHub repository link'), 'https://example.com/shop{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('That is not a GitHub repository link');
  });

  it('shows the one missing setup step in place when no AI provider is connected', async () => {
    const { onNavigate } = renderStart([]);
    expect(screen.getByText('Connect an AI provider for the code review and the browser tests first.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open AI settings' }));
    expect(onNavigate).toHaveBeenCalledWith({ name: 'settings' });
  });

  it('attaches the bundled Sample Shop', async () => {
    renderStart();
    await userEvent.click(screen.getByRole('button', { name: 'Try the Sample Shop' }));
    expect(await screen.findByRole('button', { name: 'Remove sample-shop' })).toBeInTheDocument();
  });
});
