import { describe, expect, it } from 'vitest';
import { displayPath } from './displayPath';

describe('displayPath', () => {
  it('shows the original name of an uploaded file and leaves repository paths alone', () => {
    expect(displayPath('uploads/02eee232-05de-4a1b-9c3d-1234567890ab-todo-app.html')).toBe('todo-app.html');
    expect(displayPath('src/uploads/handler.ts')).toBe('src/uploads/handler.ts');
  });
});
