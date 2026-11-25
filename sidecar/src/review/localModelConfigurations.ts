import type { DatabaseSync } from 'node:sqlite';
import type { ModelConfigurationRecord, ModelConfigurationRepository, ModelConfigurationScope } from './modelProviderResolver.js';
import { mapModelConfigurationRow } from './modelProviderResolver.js';
import type { LocalModelSettingRows, ModelRow } from '../modelSettings.js';
import { decryptModelSecret } from '../tokenVault.js';

export const localModelConfigurationSchema = `
  CREATE TABLE IF NOT EXISTS local_model_configuration (
    owner TEXT NOT NULL, project TEXT NOT NULL, purpose TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, purpose),
    FOREIGN KEY (owner, project) REFERENCES project(owner, id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS local_owner_model_configuration (
    owner TEXT NOT NULL, purpose TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, purpose)
  ) STRICT;
`;

const ciphertext = /^(?:device-v1\.)?(?:[\w-]+\.){2}[\w-]+$/;
export const ownerModelPurposes: readonly string[] = ['static_review', 'vision', 'embedding', 'provider_draft_api', 'provider_draft_codex', 'provider_draft_gemini'];

function validPortableCredential(value: string): boolean {
  if (!ciphertext.test(value)) return false;
  const encoded = value.startsWith('device-v1.') ? value.slice('device-v1.'.length) : value;
  const [iv, tag, body] = encoded.split('.').map(part => Buffer.from(part, 'base64url'));
  return iv.length === 12 && tag.length === 16 && body.length > 0;
}

export function portableModelSetting(row: ModelRow): ModelRow {
  const record = mapModelConfigurationRow(row);
  if (!record || !record.id || !record.ownerId || !record.purpose || !record.provider || !record.model
    || !ownerModelPurposes.includes(record.purpose)
    || [record.secretCiphertext, record.fallbackSecretCiphertext].some(value => value != null && !validPortableCredential(value))) {
    throw new Error('A saved Model Provider configuration lacks valid metadata or encrypted credentials.');
  }
  const metadata = record.metadata ?? {};
  return {
    id: record.id, owner_id: record.ownerId, project_id: record.projectId, purpose: record.purpose,
    provider: record.provider, api_format: record.apiFormat, model: record.model, base_url: record.baseUrl,
    secret_ciphertext: record.secretCiphertext, fallback_provider: record.fallbackProvider, fallback_api_format: record.fallbackApiFormat,
    fallback_model: record.fallbackModel, fallback_base_url: record.fallbackBaseUrl, fallback_secret_ciphertext: record.fallbackSecretCiphertext,
    enabled: record.enabled, created_at: row.created_at, updated_at: row.updated_at,
    metadata: {
      ...(typeof metadata.geminiOAuthProject === 'string' ? { geminiOAuthProject: metadata.geminiOAuthProject } : {}),
      ...(typeof metadata.codexScreenshots === 'boolean' ? { codexScreenshots: metadata.codexScreenshots } : {}),
      ...(metadata.embeddingProvider === 'custom' || metadata.embeddingProvider === 'voyage' ? { embeddingProvider: metadata.embeddingProvider } : {}),
      ...(metadata.embeddingProtocol === 'openai-compatible' || metadata.embeddingProtocol === 'voyage'
        ? { embeddingProtocol: metadata.embeddingProtocol } : {}),
      ...(Number.isSafeInteger(metadata.embeddingDimensions) ? { embeddingDimensions: metadata.embeddingDimensions } : {}),
    },
  };
}

export class LocalModelConfigurations implements ModelConfigurationRepository, LocalModelSettingRows {
  constructor(private readonly db: DatabaseSync, private readonly owner: string) {}

  openCredential(ciphertext: string): string {
    return decryptModelSecret(this.owner, ciphertext);
  }

  seed(project: string, records: ModelConfigurationRecord[]) {
    const write = this.db.prepare('INSERT INTO local_model_configuration VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING');
    for (const record of records) {
      if (record.ownerId !== this.owner || record.projectId !== project || !record.purpose
        || !['static_review', 'vision', 'embedding'].includes(record.purpose)
        || !record.provider || !record.model
        || [record.secretCiphertext, record.fallbackSecretCiphertext].some(value => value != null
          && (typeof value !== 'string' || !ciphertext.test(value)))) {
        throw new Error('Local Model Provider configuration is invalid or out of scope.');
      }
      // Keep only the fields used by the resolver. Credential export must supply ciphertext.
      const { id, ownerId, projectId, purpose, provider, apiFormat, model, baseUrl, secretCiphertext, fallbackProvider,
        fallbackApiFormat, fallbackModel, fallbackBaseUrl, fallbackSecretCiphertext, enabled } = record;
      const metadata = {
        ...(typeof record.metadata?.geminiOAuthProject === 'string' ? { geminiOAuthProject: record.metadata.geminiOAuthProject } : {}),
        codexScreenshots: record.metadata?.codexScreenshots === true,
        ...(record.metadata?.embeddingProvider === 'custom' || record.metadata?.embeddingProvider === 'voyage'
          ? { embeddingProvider: record.metadata.embeddingProvider } : {}),
        ...(Number.isSafeInteger(record.metadata?.embeddingDimensions) ? { embeddingDimensions: record.metadata?.embeddingDimensions } : {}),
      };
      write.run(this.owner, project, purpose, JSON.stringify({ id, ownerId, projectId, purpose, provider, apiFormat, model,
        baseUrl, secretCiphertext, fallbackProvider, fallbackApiFormat, fallbackModel, fallbackBaseUrl, fallbackSecretCiphertext, enabled, metadata }));
    }
  }

  /** Shares the staging transaction and preserves settings already saved on the device. */
  seedOwner(rows: ModelRow[]): void {
    if (!Array.isArray(rows)) throw new Error('Invalid owner Model Provider settings.');
    const write = this.db.prepare('INSERT INTO local_owner_model_configuration VALUES (?, ?, ?) ON CONFLICT DO NOTHING');
    const purposes = new Set<string>();
    for (const row of rows) {
      if (!row || row.owner_id !== this.owner || row.project_id !== null) throw new Error('Invalid owner Model Provider scope.');
      const setting = portableModelSetting(row);
      const purpose = String(setting.purpose);
      if (purposes.has(purpose)) throw new Error('Duplicate owner Model Provider setting.');
      purposes.add(purpose);
      write.run(this.owner, purpose, JSON.stringify(setting));
    }
  }

  async getModelConfiguration(scope: ModelConfigurationScope, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (scope.ownerId !== this.owner) return null;
    const purpose = scope.purpose ?? 'static_review';
    const row = scope.projectId ? this.db.prepare('SELECT payload FROM local_model_configuration WHERE owner = ? AND project = ? AND purpose = ?')
      .get(this.owner, scope.projectId, purpose) : undefined;
    const project = row ? JSON.parse(String(row.payload)) as ModelConfigurationRecord : null;
    if (project && project.enabled !== false) return project;
    const global = mapModelConfigurationRow(this.readModelSetting(this.owner, purpose));
    return global?.enabled ? global : null;
  }

  readModelSetting(owner: string, purpose: string): ModelRow | null {
    if (owner !== this.owner) return null;
    const row = this.db.prepare('SELECT payload FROM local_owner_model_configuration WHERE owner = ? AND purpose = ?').get(owner, purpose);
    return row ? JSON.parse(String(row.payload)) as ModelRow : null;
  }

  writeModelSettings(owner: string, rows: ModelRow[], preserveExisting = false) {
    if (owner !== this.owner || rows.some(row => row.owner_id !== owner || row.project_id !== null
      || typeof row.purpose !== 'string' || !ownerModelPurposes.includes(row.purpose)
      || [row.secret_ciphertext, row.fallback_secret_ciphertext].some(value => value != null
        && (typeof value !== 'string' || !ciphertext.test(value))))) throw new Error('Invalid owner Model Provider settings.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const write = this.db.prepare(`INSERT INTO local_owner_model_configuration VALUES (?, ?, ?) ON CONFLICT (owner, purpose)
        ${preserveExisting ? 'DO NOTHING' : 'DO UPDATE SET payload = excluded.payload'}`);
      for (const row of rows) write.run(owner, String(row.purpose), JSON.stringify(row));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
