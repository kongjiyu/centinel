import { ApplicationRepositoryError } from '../applicationRepository.js';
import type { ReadinessSourceIssue } from './types.js';

/** Fixed public guidance only; upstream error text and source bodies never enter findings. */
export const SOURCE_ISSUES: Record<ReadinessSourceIssue, { detail: string; action: string }> = {
  authorization_required: { detail: 'The last source sync could not use the saved provider authorization, so its contents were not fully imported.', action: 'Check the provider connection in Settings, reconnect if needed, then sync the source again.' },
  sync_failed: { detail: 'The last source import or sync failed or could not finish.', action: 'Open Source and inspect its sync history, fix the reported problem, then sync again.' },
  partial_import: { detail: 'The source import skipped files or did not import all selected content.', action: 'Complete the import or supply supported copies of the omitted material.' },
  unsupported_format: { detail: 'Some selected content has no supported text extraction.', action: 'Provide a supported text copy of that content.' },
  content_unavailable: { detail: 'Some selected saved source content could not be loaded.', action: 'Check source access and its saved versions, then refresh or re-import it.' },
  content_changed: { detail: 'Some loaded content did not match its saved version hash.', action: 'Refresh or re-import the source before assessing it again.' },
  version_missing: { detail: 'Some selected sources do not have an available saved content version.', action: 'Sync or re-import those sources to save their contents.' },
};

export function sourceSyncIssue(code: unknown, partial = false): ReadinessSourceIssue {
  if (typeof code === 'string' && ['http_401', 'token_expired', 'invalid_credentials', 'integration_disconnected', 'missing_scopes', 'reauthorization_required', 'slack_invalid_auth', 'slack_token_revoked', 'slack_token_expired'].includes(code)) return 'authorization_required';
  return partial ? 'partial_import' : 'sync_failed';
}

export function sourceReadIssue(error: unknown): ReadinessSourceIssue {
  if (error instanceof ApplicationRepositoryError) {
    if (['artifact_storage_missing', 'artifact_version_not_found'].includes(error.code)) return 'version_missing';
    if (error.code === 'artifact_hash_mismatch') return 'content_changed';
  }
  return 'content_unavailable';
}
