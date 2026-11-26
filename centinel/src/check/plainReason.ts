/**
 * Browser safety stops are written for developers ("The approved interaction target must be unique.").
 * People reading a Result need to know what happened in plain words (19 Nov 2026, user feedback).
 * Unknown messages are shown as they are, never guessed at.
 */
const PLAIN: Array<[RegExp, string]> = [
  [/Model returned invalid response|not an executable browser action|No valid JSON action/i, 'ORIN could not read the AI’s next browser step.'],
  [/target must be unique/i, 'ORIN could not tell which control the AI meant, so it did not press it.'],
  [/target is not on the page|element reference is (unavailable|absent)|unique visible and enabled (target|private input|upload input|download control) is unavailable|target is absent|target is unavailable/i,
    'The AI pointed at a control that was not on the page at that moment, so ORIN did not press it.'],
  [/already activated in this Run|Repetition is not approved/i, 'This control had already been pressed once, and pressing it again could change saved data, so ORIN stopped.'],
  [/not approved in the frozen environment|must match one frozen control|not approved by the frozen/i, 'The AI tried to use a control this test is not allowed to use, so ORIN stopped it.'],
  [/Navigation is outside|outside the frozen allowed origins/i, 'The AI tried to open a page outside the app being tested, so ORIN stopped it.'],
  [/Coordinate|coordinates/i, 'The AI tried to click a spot on the screen instead of a named control, which this test does not allow.'],
  [/Proposed visible text was not observed/i, 'The AI looked for text that was not on the page.'],
  [/This key can activate or submit/i, 'The AI tried to submit with a key press instead of pressing the button, which this test does not allow.'],
  [/private (input|variable)|variable is not approved/i, 'The test needed a saved private value that is not set up on this device.'],
];

export function plainReason(message: string | null | undefined): string | null {
  const text = message?.trim();
  if (!text) return null;
  for (const [pattern, plain] of PLAIN) if (pattern.test(text)) return plain;
  return text;
}
