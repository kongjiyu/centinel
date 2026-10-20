import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReadinessJob } from '../../src/readiness/service.js';
import { SupabaseReadinessStore } from '../../src/readiness/repository.js';
import { emptyReadiness } from '../../src/readiness/service.js';

type AuditEvent = Record<string, any>;
type QueryTrace = {
  table: string;
  selected?: string;
  filters: Array<[string, string, unknown]>;
  orders: Array<{ column: string; ascending: boolean }>;
  rowLimit?: number;
  upsert?: unknown;
  onConflict?: string;
};

class ReadinessQuery implements PromiseLike<{ data: any; error: any }> {
  readonly trace: QueryTrace;

  constructor(private readonly db: ReadinessDb, table: string) {
    this.trace = { table, filters: [], orders: [] };
    db.queries.push(this.trace);
  }

  select(columns: string) {
    this.trace.selected = columns;
    return this;
  }

  eq(column: string, value: unknown) {
    this.trace.filters.push(['eq', column, value]);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.trace.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(value: number) {
    this.trace.rowLimit = value;
    return this;
  }

  upsert(value: unknown, options?: { onConflict?: string }) {
    this.trace.upsert = value;
    this.trace.onConflict = options?.onConflict;
    return this;
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  private async execute(): Promise<{ data: any; error: any }> {
    if (this.trace.upsert !== undefined) {
      if (this.db.writeError) return { data: null, error: this.db.writeError };
      const incoming = Array.isArray(this.trace.upsert) ? this.trace.upsert : [this.trace.upsert];
      for (const row of incoming as AuditEvent[]) {
        const existing = this.db.rows.find(item => item.id === row.id);
        if (existing) Object.assign(existing, row);
        else this.db.rows.push({ ...row });
      }
      return { data: incoming, error: null };
    }

    if (this.db.readError) return { data: null, error: this.db.readError };
    if (this.db.readOverride) return { data: this.db.readOverride, error: null };

    let rows = this.db.rows.filter(row => this.trace.filters.every(([operator, column, value]) =>
      operator !== 'eq' || row[column] === value));
    for (const order of [...this.trace.orders].reverse()) {
      const direction = order.ascending ? 1 : -1;
      rows = [...rows].sort((left, right) => direction * String(left[order.column] ?? '').localeCompare(String(right[order.column] ?? '')));
    }
    if (this.trace.rowLimit !== undefined) rows = rows.slice(0, this.trace.rowLimit);
    return { data: rows, error: null };
  }
}

class ReadinessDb {
  readonly rows: AuditEvent[] = [];
  readonly queries: QueryTrace[] = [];
  readError: unknown = null;
  writeError: unknown = null;
  readOverride: AuditEvent[] | null = null;

  from(table: string) {
    return new ReadinessQuery(this, table);
  }
}

function makeJob(requestId: string, requestedAt: string, snapshotId: string): ReadinessJob {
  return {
    ...emptyReadiness('project-1'),
    requestId,
    status: 'completed',
    trigger: 'manual',
    requestedAt,
    startedAt: requestedAt,
    completedAt: requestedAt,
    sourceFingerprint: `fingerprint-${snapshotId}`,
    snapshot: {
      id: snapshotId,
      projectId: 'project-1',
      sourceFingerprint: `fingerprint-${snapshotId}`,
      assessedAt: requestedAt,
      categories: [],
      findings: [],
    },
    stale: false,
  };
}

function store(db: ReadinessDb) {
  return new SupabaseReadinessStore(db as unknown as SupabaseClient, 'user-1');
}

describe('SupabaseReadinessStore', () => {
  it('scopes readiness history to the project, entity, and event and fetches only the newest row', async () => {
    const db = new ReadinessDb();
    db.rows.push(
      { id: 'wrong-project', project_id: 'project-2', entity_type: 'project_readiness', event_type: 'project_readiness_job', created_at: '2026-10-19T03:00:00.000Z', payload: { job: makeJob('wrong-project', '2026-10-19T03:00:00.000Z', 'wrong') } },
      { id: 'wrong-entity', project_id: 'project-1', entity_type: 'project', event_type: 'project_readiness_job', created_at: '2026-10-19T04:00:00.000Z', payload: { job: makeJob('wrong-entity', '2026-10-19T04:00:00.000Z', 'wrong-entity') } },
      { id: 'wrong-event', project_id: 'project-1', entity_type: 'project_readiness', event_type: 'project_updated', created_at: '2026-10-19T05:00:00.000Z', payload: { job: makeJob('wrong-event', '2026-10-19T05:00:00.000Z', 'wrong-event') } },
      { id: 'request-old', project_id: 'project-1', entity_type: 'project_readiness', event_type: 'project_readiness_job', created_at: '2026-10-19T01:00:00.000Z', payload: { version: 1, job: makeJob('request-old', '2026-10-19T01:00:00.000Z', 'old') } },
      { id: 'request-new', project_id: 'project-1', entity_type: 'project_readiness', event_type: 'project_readiness_job', created_at: '2026-10-19T02:00:00.000Z', payload: { version: 1, job: makeJob('request-new', '2026-10-19T02:00:00.000Z', 'new') } },
    );

    const result = await store(db).latest('project-1');

    expect(result?.requestId).toBe('request-new');
    expect(result?.snapshot?.id).toBe('new');
    expect(db.queries).toHaveLength(1);
    expect(db.queries[0]).toMatchObject({
      table: 'audit_events',
      selected: 'payload',
      filters: [
        ['eq', 'project_id', 'project-1'],
        ['eq', 'entity_type', 'project_readiness'],
        ['eq', 'event_type', 'project_readiness_job'],
      ],
      orders: [
        { column: 'created_at', ascending: false },
        { column: 'id', ascending: false },
      ],
      rowLimit: 1,
    });
  });

  it('keeps retry request IDs and immutable assessment snapshots as separate history rows', async () => {
    const db = new ReadinessDb();
    const readinessStore = store(db);
    const priorRequest = makeJob('request-1', '2026-10-19T01:00:00.000Z', 'snapshot-1');
    const retryQueued = { ...makeJob('request-2', '2026-10-19T02:00:00.000Z', 'snapshot-1'), status: 'queued' as const, completedAt: null, stale: true };
    const retryCompleted = makeJob('request-2', '2026-10-19T02:00:00.000Z', 'snapshot-2');

    await readinessStore.save(priorRequest);
    await readinessStore.save(retryQueued);
    await readinessStore.save(retryCompleted);

    expect(db.rows).toHaveLength(2);
    expect(db.rows.map(row => row.id).sort()).toEqual(['request-1', 'request-2']);
    expect(db.rows.find(row => row.id === 'request-1')?.payload.job.snapshot.id).toBe('snapshot-1');
    expect(db.rows.find(row => row.id === 'request-2')?.payload.job).toMatchObject({
      requestId: 'request-2', status: 'completed', snapshot: { id: 'snapshot-2' },
    });
    expect(db.rows.find(row => row.id === 'request-2')).toMatchObject({
      project_id: 'project-1',
      actor_id: 'user-1',
      entity_type: 'project_readiness',
      entity_id: 'project-1',
      event_type: 'project_readiness_job',
      idempotency_key: 'readiness:request-2',
    });
    expect(db.queries.slice(0, 3).map(query => query.onConflict)).toEqual(['id', 'id', 'id']);
    expect(await readinessStore.latest('project-1')).toMatchObject({ requestId: 'request-2', snapshot: { id: 'snapshot-2' } });
  });

  it('returns generic history and save errors without exposing provider or bearer secrets', async () => {
    const secret = 'Bearer provider-secret-should-not-leak';
    const readDb = new ReadinessDb();
    readDb.readError = { message: secret };
    await expect(store(readDb).latest('project-1')).rejects.toThrow('Readiness history is unavailable');
    await expect(store(readDb).latest('project-1')).rejects.not.toThrow(secret);

    const writeDb = new ReadinessDb();
    writeDb.writeError = { message: secret };
    await expect(store(writeDb).save(makeJob('request-1', '2026-10-19T01:00:00.000Z', 'snapshot-1')))
      .rejects.toThrow('Readiness progress could not be saved');
    await expect(store(writeDb).save(makeJob('request-1', '2026-10-19T01:00:00.000Z', 'snapshot-1')))
      .rejects.not.toThrow(secret);
  });

  it('rejects a history row whose embedded job belongs to another project', async () => {
    const db = new ReadinessDb();
    db.readOverride = [{ payload: { version: 1, job: { ...makeJob('request-foreign', '2026-10-19T01:00:00.000Z', 'foreign'), projectId: 'project-2' } } }];

    await expect(store(db).latest('project-1')).rejects.toThrow('Readiness history scope mismatch');
  });
});
