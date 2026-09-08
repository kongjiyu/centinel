import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowHeader } from './WindowHeader';

const tauriWindow = vi.hoisted(() => ({
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
  startDragging: vi.fn(),
  isMaximized: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({ appWindow: tauriWindow }));

describe('WindowHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriWindow.isMaximized.mockResolvedValue(false);
    tauriWindow.minimize.mockResolvedValue(undefined);
    tauriWindow.toggleMaximize.mockResolvedValue(undefined);
    tauriWindow.close.mockResolvedValue(undefined);
    tauriWindow.startDragging.mockResolvedValue(undefined);
  });

  it('exposes functional menu labels and window controls', async () => {
    const user = userEvent.setup();
    const { container } = render(<WindowHeader />);

    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Minimize window' }));
    expect(tauriWindow.minimize).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Maximize window' }));
    expect(tauriWindow.toggleMaximize).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Close window' }));
    expect(tauriWindow.close).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'File' }));
    expect(screen.getByRole('menu', { name: 'File menu' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Close window' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'File' })).toHaveFocus());

    fireEvent.mouseDown(container.querySelector('.window-header-drag-region')!, { button: 0 });
    expect(tauriWindow.startDragging).toHaveBeenCalledTimes(1);
    fireEvent.doubleClick(container.querySelector('.window-header-brand')!);
    expect(tauriWindow.toggleMaximize).toHaveBeenCalledTimes(2);
  });

  it('provides keyboard-safe Help/About focus restoration', async () => {
    const user = userEvent.setup();
    render(<WindowHeader />);

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(screen.getByRole('menuitem', { name: 'About Centinel' }));
    const dialog = await screen.findByRole('dialog', { name: 'About Centinel' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'About Centinel' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Help' })).toHaveFocus();
  });

  it('uses square maximize and overlapping-square restore icons', async () => {
    const user = userEvent.setup();
    render(<WindowHeader />);
    expect(screen.getByTestId('maximize-window-icon')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Maximize window' }));
    await waitFor(() => expect(screen.getByTestId('restore-window-icon')).toBeInTheDocument());
  });
});
