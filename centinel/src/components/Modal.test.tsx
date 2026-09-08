import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

describe('Modal', () => {
  it('provides dialog semantics, focuses the first field, closes on Escape, and restores focus', () => {
    const onClose = vi.fn();
    const trigger = document.createElement('button');
    trigger.textContent = 'Open dialog';
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <Modal isOpen onClose={onClose} title="New review">
        <label htmlFor="review-name">Review name</label>
        <input id="review-name" />
        <button type="button">Save</button>
      </Modal>
    );

    const dialog = screen.getByRole('dialog', { name: 'New review' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Review name')).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
