import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { ConversationAttachment, type ConversationAttachmentKind } from './ConversationAttachment';

afterEach(cleanup);

it.each([
  ['check', 'Cypress checkout and account recovery'],
  ['problem', 'Checkout fails when the saved address is empty'],
  ['document', '2026 requirements and account recovery acceptance criteria.pdf'],
  ['library', 'src/features/checkout/recovery/submit-address.ts'],
] as const)('keeps the complete %s attachment name available to keyboard users', async (kind, label) => {
  const user = userEvent.setup();
  render(<ul><ConversationAttachment kind={kind as ConversationAttachmentKind} label={label} /></ul>);
  const attachment = screen.getByRole('listitem', { name: label });

  await user.tab();

  expect(attachment).toHaveFocus();
  expect(attachment).toHaveAttribute('data-full-label', label);
});
