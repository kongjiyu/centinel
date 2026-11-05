import type { UserEvent } from '@testing-library/user-event';
import userEvent from '@testing-library/user-event';

/**
 * Focuses a field the way a user would and enters text as one input event.
 *
 * `user.type` replays every character as a separate key sequence, and each one
 * re-renders the whole screen under test. On large screens that costs seconds
 * per field and makes tests time out when the suite runs under load. These tests
 * check what is saved, not keystroke handling, so one paste-sized input keeps the
 * same React change path at a fraction of the cost.
 */
export async function enterText(user: UserEvent | typeof userEvent, element: HTMLElement, text: string) {
  await user.click(element);
  await user.paste(text);
}
