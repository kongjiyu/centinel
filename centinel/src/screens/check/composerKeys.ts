import type { KeyboardEvent } from 'react';

export function handleComposerEnter(event: KeyboardEvent<HTMLTextAreaElement>, expanded: boolean, send: () => void, change: (value: string, caret: number) => void) {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
  const modified = event.ctrlKey || event.metaKey;
  if (expanded && !modified) return;
  event.preventDefault();
  if (expanded === modified) {
    if (!event.repeat) send();
  } else {
    const field = event.currentTarget;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    if (field.value.length - (end - start) >= field.maxLength && field.maxLength >= 0) return;
    field.setRangeText('\n', start, end, 'end');
    change(field.value, start + 1);
  }
}
