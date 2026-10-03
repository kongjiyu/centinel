import fs from 'node:fs/promises';
import type { Artifact } from '../artifacts.js';
import { ReviewCancelledError } from './retry.js';

/** Convert every stage's cancellation check to one error shape understood by
 * the orchestrator. DOMException remains the native provider-facing shape,
 * while ReviewCancelledError is used for local work and retry waits. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ReviewCancelledError();
}

export function isAbortError(error: unknown): boolean {
  return error instanceof ReviewCancelledError
    || (error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && error.name === 'AbortError');
}

/** Read a local artifact through Node's AbortSignal-aware file API. This is a
 * rebuildable-cache/legacy-import helper; durable Supabase Storage callers can
 * implement the same contract with their fetch/read method. */
export async function readTextFileWithCancellation(filePath: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  try {
    const content = await fs.readFile(filePath, { encoding: 'utf8', signal });
    throwIfAborted(signal);
    return content;
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw new ReviewCancelledError();
    throw error;
  }
}

export type ArtifactContentReader = (artifact: Artifact, signal?: AbortSignal) => Promise<string>;

/** Read a sequence with a check before and after every item. Keeping this as a
 * standalone seam lets Supabase Storage ingestion and local artifact ingestion
 * share cancellation semantics without making either source authoritative. */
export async function ingestArtifacts<T>(
  artifacts: readonly Artifact[],
  reader: ArtifactContentReader,
  onArtifact: (artifact: Artifact, content: string, index: number) => Promise<T> | T,
  signal?: AbortSignal,
): Promise<T[]> {
  const values: T[] = [];
  for (let index = 0; index < artifacts.length; index++) {
    throwIfAborted(signal);
    const artifact = artifacts[index];
    const content = await reader(artifact, signal);
    throwIfAborted(signal);
    values.push(await onArtifact(artifact, content, index));
    throwIfAborted(signal);
  }
  return values;
}

/** Run a stage while ensuring a provider/local implementation that resolves
 * after abort cannot publish a success value. */
export async function runAbortAware<T>(stage: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const controller = signal ? null : new AbortController();
  const effective = signal ?? controller!.signal;
  throwIfAborted(effective);
  const value = await stage(effective);
  throwIfAborted(effective);
  return value;
}
