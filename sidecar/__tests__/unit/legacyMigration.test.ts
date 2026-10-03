import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateLegacy, stableMigrationId, type LegacyRecord, type LegacySnapshot, type MigrationEntity, type MigrationTarget } from '../../src/migration/legacy.js';

function fakeTarget() {
  const rows = new Map<MigrationEntity, Map<string, LegacyRecord>>();
  const objects = new Map<string, Buffer>();
  const target: MigrationTarget = {
    async upsert(entity, row) {
      const table = rows.get(entity) ?? new Map<string, LegacyRecord>();
      table.set(String(row.id), structuredClone(row));
      rows.set(entity, table);
    },
    async uploadObject(object, safePath) { objects.set(`${object.bucket}:${safePath}`, Buffer.from(object.content)); },
    async count(entity) { return rows.get(entity)?.size ?? 0; },
    async checksum(entity) { return ''; },
  };
  return { target, rows, objects };
}

describe('legacy Supabase migration', () => {
  it('is dry-run safe, resumable, idempotent, and reconciles counts', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const snapshot: LegacySnapshot = {
      projects: [{ id: 'legacy-project', ownerId: 'user-1', name: 'Legacy', description: '', workspacePath: 'C:/repo' }],
      requirements: [{ id: 'legacy-requirement', projectId: 'legacy-project', title: 'Keep auth safe', description: '' }],
      objects: [{ bucket: 'project-artifacts', projectId, path: 'src/index.ts', content: 'export const ok = true;', contentType: 'text/typescript' }],
    };
    // Dry-run validates planning without mutating the target.
    const dry = fakeTarget();
    const dryResult = await migrateLegacy(snapshot, dry.target, { dryRun: true });
    expect(dryResult.dryRun).toBe(true);
    expect(dryResult.planned).toBe(3);
    expect(dry.rows.size).toBe(0);

    const first = fakeTarget();
    const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-migration-')), 'state.json');
    const firstResult = await migrateLegacy(snapshot, first.target, { statePath, reconcile: true });
    expect(firstResult.migrated).toBe(2);
    expect(firstResult.uploaded).toBe(1);
    expect(firstResult.failures).toEqual([]);
    expect(first.objects.size).toBe(1);
    expect(fs.existsSync(statePath)).toBe(true);

    const secondResult = await migrateLegacy(snapshot, first.target, { statePath, reconcile: true });
    expect(secondResult.migrated).toBe(0);
    expect(secondResult.skipped).toBe(3);
    expect(stableMigrationId('projects', 'legacy-project')).toBe(stableMigrationId('projects', 'legacy-project'));
  });

  it('reruns a changed row while retaining the deterministic target id', async () => {
    const fake = fakeTarget();
    const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'centinel-migration-')), 'state.json');
    const before: LegacySnapshot = { projects: [{ id: 'legacy-project', ownerId: 'user-1', name: 'Before' }] };
    const after: LegacySnapshot = { projects: [{ id: 'legacy-project', ownerId: 'user-1', name: 'After' }] };
    await migrateLegacy(before, fake.target, { statePath });
    const beforeId = [...fake.rows.get('projects')!.keys()][0];
    const result = await migrateLegacy(after, fake.target, { statePath });
    expect(result.migrated).toBe(1);
    expect([...fake.rows.get('projects')!.keys()]).toEqual([beforeId]);
    expect(fake.rows.get('projects')!.get(beforeId)?.name).toBe('After');
  });
});
