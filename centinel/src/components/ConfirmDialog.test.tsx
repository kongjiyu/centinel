import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('starts on the safe action and confirms only after an explicit choice', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        isOpen
        title="Remove project?"
        description="Files in the workspace will be kept."
        confirmLabel="Remove project"
        onClose={onClose}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Remove project' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
