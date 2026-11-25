import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DynamicContractError } from '../types.js';
import { normalizeActionPolicy } from '../browser/actionPolicy.js';
import { validateEnvironment } from './validation.js';
import type { DataEvent, EnvironmentData, EnvironmentProfile, EnvironmentSnapshot } from './types.js';
import type { DynamicUnitRun, UnitDataEvent } from '../unit/types.js';
import { requireNoLocalUnitWork } from '../unit/localRepository.js';
import type { CleanupSource, HookOperation } from '../workspace/operations.js';
import { requireNoLocalCapture } from './localCaptureRepository.js';
import { containsLocalValue } from './secrets.js';

export type EnvironmentHistorySnapshot = { profiles: EnvironmentProfile[]; data: EnvironmentData[] };

export const localEnvironmentSchema = `
  CREATE TABLE IF NOT EXISTS local_dynamic_environment (
    owner TEXT NOT NULL, project TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL,
    updated TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (owner, project, id),
    FOREIGN KEY (owner, project) REFERENCES project(owner, id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_dynamic_environment_recent ON local_dynamic_environment (owner, project, updated DESC, id);
  CREATE TABLE IF NOT EXISTS local_dynamic_environment_data (
    owner TEXT NOT NULL, project TEXT NOT NULL, profile TEXT NOT NULL, resource TEXT NOT NULL,
    reserved INTEGER NOT NULL CHECK (reserved IN (0, 1)), payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, profile),
    FOREIGN KEY (owner, project, profile) REFERENCES local_dynamic_environment(owner, project, id)
  ) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS local_dynamic_resource_owner
    ON local_dynamic_environment_data (owner, project, resource) WHERE reserved = 1;
`;

type SavedData = Omit<EnvironmentData, 'resource'>;
const resourceKey = (profile: Pick<EnvironmentProfile, 'id' | 'dataResourceKey'>) =>
  profile.dataResourceKey ? 'shared:' + profile.dataResourceKey.toLowerCase() : 'profile:' + profile.id;
const freshData = (profileId: string): SavedData =>
  ({ profileId, state: 'unprepared', preparedVersion: null, preparation: null, runId: null, events: [] });
const decode = <T>(row: { payload?: unknown }): T => JSON.parse(String(row.payload)) as T;
const busyStates = ['in_use', 'preparing', 'cleaning'];
const versionIsValid = (version: number) => Number.isInteger(version) && version > 0 && version <= 2147483647;

export class LocalEnvironmentRepository {
  constructor(private readonly db: DatabaseSync, private readonly owner: string) {}

  async list(project: string): Promise<EnvironmentProfile[]> {
    return this.db.prepare('SELECT payload FROM local_dynamic_environment WHERE owner = ? AND project = ? ORDER BY updated DESC, id')
      .all(this.owner, project).map(decode<EnvironmentProfile>);
  }

  async get(project: string, id: string): Promise<EnvironmentProfile> {
    return this.readProfile(project, id);
  }

  async data(project: string, id: string): Promise<EnvironmentData> {
    const profile = this.readProfile(project, id);
    return this.projectData(project, profile);
  }

  eventsForRun(project: string, profile: string, run: string): DataEvent[] {
    const row = this.db.prepare('SELECT payload FROM local_dynamic_environment_data WHERE owner = ? AND project = ? AND profile = ?')
      .get(this.owner, project, profile);
    return row ? decode<SavedData>(row).events.filter(event => event.runId === run)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) : [];
  }

  async save(project: string, value: unknown, id?: string): Promise<EnvironmentProfile> {
    const input = validateEnvironment(value);
    const expected = (value as { version?: number }).version;
    if (id && expected !== undefined && !versionIsValid(expected)) throw new DynamicContractError(400, 'Refresh the saved environment before editing its version.');
    return this.transaction(() => {
      requireNoLocalUnitWork(this.db, this.owner, project);
      requireNoLocalCapture(this.db, this.owner, project);
      const existing = id ? this.readProfile(project, id) : null;
      if (existing && expected !== undefined && existing.version !== expected) throw new DynamicContractError(409, 'Environment changed. Refresh it before saving.');
      if (existing) {
        const data = this.projectData(project, existing);
        if (busyStates.includes(data.state)) throw new DynamicContractError(409, 'Finish the active work before editing this environment.');
        if (data.resource?.reserved && data.resource.key !== resourceKey({ id: existing.id, dataResourceKey: input.dataResourceKey })) {
          throw new DynamicContractError(409, 'Clean the original data resource before changing its key.');
        }
      }
      const profile = { ...input, id: existing?.id ?? randomUUID(), projectId: project,
        version: (existing?.version ?? 0) + 1, updatedBy: this.owner, updatedAt: new Date().toISOString() };
      this.db.prepare(`INSERT INTO local_dynamic_environment VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (owner, project, id) DO UPDATE SET version = excluded.version, updated = excluded.updated, payload = excluded.payload`)
        .run(this.owner, project, profile.id, profile.version, profile.updatedAt, JSON.stringify(profile));
      return profile;
    });
  }

  async savePrivateInputs(project: string, id: string, version: number, grants: unknown): Promise<EnvironmentProfile> {
    if (!versionIsValid(version)) throw new DynamicContractError(400, 'Refresh the environment before editing private input permissions.');
    const profile = this.readProfile(project, id);
    const policy = normalizeActionPolicy({ schemaVersion: 1, interactions: [], allowCoordinates: false, privateInputs: grants });
    return this.save(project, { ...profile, version, actionPolicy: { ...profile.actionPolicy, schemaVersion: 1,
      interactions: profile.actionPolicy?.interactions ?? [], allowCoordinates: profile.actionPolicy?.allowCoordinates ?? false,
      privateInputs: policy.privateInputs } }, id);
  }

  async saveUploadPermissions(project: string, id: string, version: number, grants: unknown): Promise<EnvironmentProfile> {
    const policy = normalizeActionPolicy({ schemaVersion: 1, interactions: [], allowCoordinates: false, uploads: grants });
    return this.saveFilePermissions(project, id, version, { uploads: policy.uploads });
  }

  async saveDownloadPermissions(project: string, id: string, version: number, grants: unknown,
    secrets: readonly string[] = []): Promise<EnvironmentProfile> {
    const policy = normalizeActionPolicy({ schemaVersion: 1, interactions: [], allowCoordinates: false, downloads: grants });
    if (containsLocalValue(policy, [...secrets])) throw new DynamicContractError(400, 'Keep private values out of download permissions.');
    return this.saveFilePermissions(project, id, version, { downloads: policy.downloads });
  }

  private async saveFilePermissions(project: string, id: string, version: number,
    changes: Pick<NonNullable<EnvironmentProfile['actionPolicy']>, 'uploads' | 'downloads'>) {
    if (!versionIsValid(version)) throw new DynamicContractError(400, 'Refresh the saved environment before changing file permissions.');
    const profile = this.readProfile(project, id);
    const current = profile.actionPolicy ?? { schemaVersion: 1, interactions: [], allowCoordinates: false };
    return this.save(project, { ...profile, version, actionPolicy: { ...current, ...changes } }, id);
  }

  async recordData(project: string, id: string, kind: DataEvent['kind'], outcome: DataEvent['outcome'], note: string): Promise<EnvironmentData> {
    if (!['preparation', 'cleanup'].includes(kind) || !['completed', 'failed'].includes(outcome)
      || typeof note !== 'string' || note.trim().length < 3 || note.length > 2000) {
      throw new DynamicContractError(400, 'Record what was prepared or cleaned up (3–2000 characters).');
    }
    return this.transaction(() => {
      requireNoLocalUnitWork(this.db, this.owner, project);
      requireNoLocalCapture(this.db, this.owner, project);
      const profile = this.readProfile(project, id);
      const { resource, ...saved } = this.projectData(project, profile);
      if (!resource?.available || busyStates.includes(saved.state)) throw new DynamicContractError(409, 'Finish active work or cleanup before changing the data state.');
      if (kind === 'preparation' && saved.state === 'cleanup_required') throw new DynamicContractError(409, 'Complete cleanup before preparing test data.');
      if (kind === 'cleanup' && !resource.reserved) throw new DynamicContractError(409, 'No data reservation needs cleanup.');
      if (kind === 'preparation' && resource.reserved && resource.key !== resourceKey(profile)) {
        throw new DynamicContractError(409, 'Clean the original data resource before preparing a new baseline.');
      }
      const event: DataEvent = { id: randomUUID(), runId: kind === 'cleanup' ? saved.runId : null, kind, outcome,
        note: note.trim(), actorId: this.owner, createdAt: new Date().toISOString() };
      this.recordUnitCleanup(project, profile.id, saved.unitRunId, event);
      const events = [event, ...saved.events];
      const release = kind === 'cleanup' && outcome === 'completed';
      const next: SavedData = kind === 'preparation' ? {
        profileId: id, state: outcome === 'completed' ? 'ready' : 'cleanup_required', preparedVersion: profile.version,
        preparation: { note: event.note, actorId: this.owner, at: event.createdAt, profileVersion: profile.version }, runId: null, events,
      } : release ? { ...freshData(id), events } : { ...saved, state: 'cleanup_required', events };
      this.writeData(project, next, resource.key, !release);
      return this.projectData(project, profile);
    });
  }

  reserveHook(project: string, profileId: string, kind: HookOperation['kind'], id: string, source?: CleanupSource): EnvironmentProfile {
    const profile = this.readProfile(project, profileId);
    const { resource, ...data } = this.projectData(project, profile);
    const permitted = kind === 'setup' ? ['unprepared', 'ready'].includes(data.state) : data.state === 'cleanup_required';
    const matchingSource = !source || (source.kind === 'browser' ? data.runId : source.kind === 'unit' ? data.unitRunId : data.operationId) === source.id;
    if (!resource?.available || !permitted || !matchingSource || (kind === 'cleanup' && !resource.reserved)) {
      throw new DynamicContractError(409, 'The environment state does not permit this setup or cleanup.');
    }
    this.writeData(project, { ...data, operationId: id, state: kind === 'setup' ? 'preparing' : 'cleaning' }, resource.key, true);
    return profile;
  }

  requireCaptureProfile(project: string, profileId: string, version?: number): EnvironmentProfile {
    const profile = this.readProfile(project, profileId);
    if (version !== undefined && version !== profile.version) {
      throw new DynamicContractError(409, 'The environment changed. Refresh it before changing its sign-in session.');
    }
    if (!profile.sessionReference || !profile.sessionReadySelector) {
      throw new DynamicContractError(400, 'Save a session reference and signed-in readiness selector first.');
    }
    return profile;
  }

  reserveCapture(project: string, profileId: string, id: string, version?: number) {
    const profile = this.requireCaptureProfile(project, profileId, version);
    const { resource, ...data } = this.projectData(project, profile);
    if (!resource?.available || !['unprepared', 'ready'].includes(data.state)) {
      throw new DynamicContractError(409, 'Finish active work and cleanup before signing in.');
    }
    this.writeData(project, { ...data, state: 'preparing', operationId: id, preparedVersion: null, preparation: null }, resource.key, true);
  }

  finishCapture(project: string, profileId: string, id: string, success: boolean) {
    const { resource, ...data } = this.projectData(project, this.readProfile(project, profileId));
    if (!resource?.reserved || data.operationId !== id || data.state !== 'preparing') return;
    this.writeData(project, { ...data, state: success ? 'unprepared' : 'cleanup_required', operationId: null }, resource.key, true);
  }

  finishHook(operation: HookOperation): void {
    const { projectId: project, environmentId: profile, id, kind } = operation;
    const { resource, ...data } = this.projectData(project, this.readProfile(project, profile));
    if (!resource?.reserved || data.operationId !== id) return;
    const successful = operation.verdict === 'passed';
    const event: DataEvent = { id: randomUUID(), runId: kind === 'cleanup' ? data.runId : null,
      kind: kind === 'setup' ? 'preparation' : 'cleanup', outcome: successful ? 'completed' : 'failed',
      note: 'Approved ' + kind + ' ended: ' + (operation.result?.outcome ?? operation.state) + '.',
      actorId: operation.createdBy, createdAt: operation.updatedAt };
    const events = [event, ...data.events];
    this.recordUnitCleanup(project, profile, data.unitRunId, event, id);
    if (successful && kind === 'cleanup') {
      this.writeData(project, { ...freshData(profile), events }, resource.key, false);
      return;
    }
    const version = operation.environment.version;
    this.writeData(project, { ...data, events, state: successful ? 'ready' : 'cleanup_required',
      operationId: successful ? null : id, preparedVersion: successful ? version : null,
      preparation: successful ? { note: event.note, actorId: event.actorId, at: event.createdAt, profileVersion: version } : null },
    resource.key, true);
  }

  private recordUnitCleanup(project: string, profile: string, unit: string | null | undefined, event: DataEvent, operationId?: string) {
    if (event.kind !== 'cleanup' || !unit || !this.db.prepare(
      'SELECT 1 FROM local_dynamic_unit_run WHERE owner = ? AND project = ? AND id = ? AND profile = ?',
    ).get(this.owner, project, unit, profile)) return;
    const { kind, outcome, note, actorId, createdAt } = event;
    const row: UnitDataEvent = { kind, outcome, note, actorId, createdAt, ...(operationId && { operationId }) };
    this.db.prepare('INSERT INTO local_dynamic_unit_event VALUES (?, ?, ?, ?, ?, ?)')
      .run(this.owner, project, unit, event.id, createdAt, JSON.stringify(row));
  }

  /** Read and reserve prepared data inside the Unit Run admission transaction. */
  unitEnvironment(project: string, profileId: string, runId?: string): DynamicUnitRun['environment'] {
    const profile = this.readProfile(project, profileId);
    const { resource, ...data } = this.projectData(project, profile);
    if (!resource) throw new DynamicContractError(409, 'The environment data resource is unavailable.');
    if (runId) {
      if (!resource.available || !resource.reserved || data.state !== 'ready' || data.preparedVersion !== profile.version) {
        throw new DynamicContractError(409, 'Prepare clean data for the current environment before unit execution.');
      }
      this.writeData(project, { ...data, state: 'in_use', runId: null, unitRunId: runId }, resource.key, true);
    }
    return { ...profile, preparation: data.preparation, resourceKey: resource.key };
  }

  /** Terminal Unit Run and its cleanup obligation commit together. */
  finishUnitRun(project: string, profileId: string, runId: string): void {
    const { resource, ...data } = this.projectData(project, this.readProfile(project, profileId));
    if (resource?.reserved && data.state === 'in_use' && data.unitRunId === runId) {
      this.writeData(project, { ...data, state: 'cleanup_required' }, resource.key, true);
    }
  }

  /** Run admission calls this inside the transaction that inserts the Run. */
  reserveForRun(project: string, runId: string, targetUrl: string, snapshot: EnvironmentSnapshot, now: number): EnvironmentSnapshot {
    const profile = this.readProfile(project, snapshot.id);
    if (profile.version !== snapshot.version) throw new DynamicContractError(409, 'Environment changed. Repeat preflight.');
    if (new URL(profile.targetUrl).origin !== new URL(targetUrl).origin) {
      throw new DynamicContractError(400, 'Environment and test must use the same website origin.');
    }
    const { resource, ...data } = this.projectData(project, profile);
    if (!resource) throw new DynamicContractError(409, 'The environment data resource is unavailable.');
    const session = snapshot.sessionSnapshot;
    if (session) {
      const expires = Date.parse(session.expiresAt);
      if (session.reference !== profile.sessionReference || !Number.isFinite(expires)
        || expires <= now || expires > now + 7 * 24 * 60 * 60_000) {
        throw new DynamicContractError(409, 'The saved sign-in session changed or expired. Repeat preflight.');
      }
    }
    if (snapshot.preflight.length && snapshot.preflight.every(check => check.ready)) {
      if (profile.sessionReference && !session) throw new DynamicContractError(409, 'Repeat preflight with a current sign-in session.');
      if (!resource.available || !resource.reserved || data.state !== 'ready' || data.preparedVersion !== profile.version) {
        throw new DynamicContractError(409, 'Prepare clean data for the current environment before execution.');
      }
      this.writeData(project, { ...data, state: 'in_use', runId, unitRunId: null }, resource.key, true);
    }
    return { ...profile, preflight: snapshot.preflight, variableNames: snapshot.variableNames, checkedAt: snapshot.checkedAt,
      preparation: data.preparation, resourceKey: resource.key,
      ...(session ? { sessionSnapshot: { reference: session.reference, version: session.version, expiresAt: session.expiresAt } } : {}) };
  }

  /** Recheck reserved targets at Run insertion to cover concurrent preparation. */
  requireUnreservedOrigin(project: string, targetUrl: string): void {
    const origin = new URL(targetUrl).origin;
    const rows = this.db.prepare(`SELECT e.payload FROM local_dynamic_environment_data d
      JOIN local_dynamic_environment e ON e.owner = d.owner AND e.project = d.project AND e.id = d.profile
      WHERE d.owner = ? AND d.project = ? AND d.reserved = 1 AND d.resource LIKE 'shared:%'`).all(this.owner, project);
    if (rows.some(row => new URL(decode<EnvironmentProfile>(row).targetUrl).origin === origin)) {
      throw new DynamicContractError(409, 'Choose a saved environment for this reserved target data. Finish the owning environment cleanup first.');
    }
  }

  /** Terminal state and cleanup obligation commit together. */
  finishRun(project: string, profileId: string, runId: string): void {
    const { resource, ...data } = this.projectData(project, this.readProfile(project, profileId));
    if (resource?.reserved && data.state === 'in_use' && data.runId === runId) {
      this.writeData(project, { ...data, state: 'cleanup_required' }, resource.key, true);
    }
  }

  /** Called inside the workspace staging transaction. */
  seed(project: string, snapshot: EnvironmentHistorySnapshot): void {
    if (!Array.isArray(snapshot.profiles) || !Array.isArray(snapshot.data)) throw new Error('Invalid environment snapshot.');
    for (const profile of snapshot.profiles) {
      if (!profile || profile.projectId !== project || !/^[a-f0-9-]{36}$/i.test(profile.id) || !versionIsValid(profile.version)
        || typeof profile.updatedBy !== 'string' || !Number.isFinite(Date.parse(profile.updatedAt))) throw new Error('Invalid environment identity.');
      validateEnvironment(profile);
      this.db.prepare('INSERT INTO local_dynamic_environment VALUES (?, ?, ?, ?, ?, ?)')
        .run(this.owner, project, profile.id, profile.version, profile.updatedAt, JSON.stringify(profile));
    }
    const seen = new Set<string>();
    for (const data of snapshot.data) {
      if (!data || seen.has(data.profileId) || !Array.isArray(data.events)
        || !['unprepared', 'ready', 'cleanup_required', ...busyStates].includes(data.state)
        || data.preparedVersion !== null && !versionIsValid(data.preparedVersion)
        || data.events.some(event => !event || typeof event.note !== 'string' || !['preparation', 'cleanup'].includes(event.kind)
          || !['completed', 'failed'].includes(event.outcome) || !Number.isFinite(Date.parse(event.createdAt)))) {
        throw new Error('Invalid environment data history.');
      }
      seen.add(data.profileId);
      const profile = this.readProfile(project, data.profileId);
      const { resource, ...saved } = data;
      if (resource && (typeof resource.reserved !== 'boolean'
        || resource.key !== 'profile:' + profile.id && !/^shared:[a-z0-9][a-z0-9_.:-]{0,99}$/.test(resource.key))) throw new Error('Invalid reserved environment resource.');
      const interrupted = busyStates.includes(data.state);
      this.writeData(project, interrupted ? { ...saved, state: 'cleanup_required', operationId: null } : saved,
        resource?.key ?? resourceKey(profile), interrupted || data.state === 'cleanup_required' || data.state === 'ready' || resource?.reserved === true);
    }
  }

  private readProfile(project: string, id: string): EnvironmentProfile {
    const row = this.db.prepare('SELECT payload FROM local_dynamic_environment WHERE owner = ? AND project = ? AND id = ?')
      .get(this.owner, project, id);
    if (!row) throw new DynamicContractError(404, 'Environment not found in this project.');
    return decode<EnvironmentProfile>(row);
  }

  private projectData(project: string, profile: EnvironmentProfile): EnvironmentData {
    const row = this.db.prepare('SELECT payload, resource, reserved FROM local_dynamic_environment_data WHERE owner = ? AND project = ? AND profile = ?')
      .get(this.owner, project, profile.id);
    const data = row ? decode<SavedData>(row) : freshData(profile.id);
    const state = data.state === 'ready' && data.preparedVersion !== profile.version ? 'unprepared' : data.state;
    const reserved = row?.reserved === 1;
    const key = reserved ? String(row?.resource) : resourceKey(profile);
    const owner = this.db.prepare(`SELECT d.profile, d.payload, e.payload AS profile_payload
      FROM local_dynamic_environment_data d JOIN local_dynamic_environment e
      ON e.owner = d.owner AND e.project = d.project AND e.id = d.profile
      WHERE d.owner = ? AND d.project = ? AND d.resource = ? AND d.reserved = 1`).get(this.owner, project, key);
    const ownerProfile = owner ? JSON.parse(String(owner.profile_payload)) as EnvironmentProfile : null;
    const ownerData = owner ? decode<SavedData>(owner) : null;
    const ownerState = ownerData?.state === 'ready' && ownerData.preparedVersion !== ownerProfile?.version ? 'unprepared' : ownerData?.state ?? null;
    return { ...data, state, resource: { key, reserved, available: !owner || owner.profile === profile.id,
      ownerProfileId: ownerProfile?.id ?? null, ownerName: ownerProfile?.name ?? null, ownerState } };
  }

  private writeData(project: string, data: SavedData, key: string, reserved: boolean): void {
    this.db.prepare(`INSERT INTO local_dynamic_environment_data VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner, project, profile) DO UPDATE SET resource = excluded.resource, reserved = excluded.reserved, payload = excluded.payload`)
      .run(this.owner, project, data.profileId, key, reserved ? 1 : 0, JSON.stringify(data));
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
