import { describe, expect, it } from 'vitest';
import { detectArtifactType } from '../../src/artifacts.js';

describe('artifact type detection for Supabase uploads', () => {
  it('classifies supported requirement and source files without local persistence', () => {
    expect(detectArtifactType('requirements.md')).toBe('requirement');
    expect(detectArtifactType('service.TSX')).toBe('source_code');
    expect(detectArtifactType('styles.css')).toBe('source_code');
    expect(detectArtifactType('package.json')).toBe('other');
    expect(detectArtifactType('archive.zip')).toBe('other');
  });
});
