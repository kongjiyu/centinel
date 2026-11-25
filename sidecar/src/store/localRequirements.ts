import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DynamicContractError } from '../dynamic/types.js';
import type { StoreRequirement, StoreRequirementMapping } from './types.js';
import type { ConfirmedRequirement, RequirementCandidate, StandardRule } from '../review/grounding.js';

type RequirementFields = Pick<StoreRequirement, 'title' | 'description' | 'category' | 'priority'>;
export type RequirementSnapshot = {
  requirements: Array<StoreRequirement & Partial<ConfirmedRequirement>>;
  mappings: StoreRequirementMapping[];
  candidates?: RequirementCandidate[];
  standardRules?: StandardRule[];
};

export const localRequirementSchema = `
  CREATE TABLE IF NOT EXISTS requirement_snapshot (
    owner TEXT NOT NULL, project TEXT NOT NULL, PRIMARY KEY (owner, project),
    FOREIGN KEY (owner, project) REFERENCES project(owner, id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS requirement (
    owner TEXT NOT NULL, project TEXT NOT NULL, id TEXT NOT NULL,
    created TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (owner, project, id),
    FOREIGN KEY (owner, project) REFERENCES requirement_snapshot(owner, project)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS requirement_mapping (
    owner TEXT NOT NULL, project TEXT NOT NULL, requirement TEXT NOT NULL, id TEXT NOT NULL,
    created TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (owner, project, requirement, id),
    FOREIGN KEY (owner, project, requirement) REFERENCES requirement(owner, project, id) ON DELETE CASCADE
  ) STRICT;
  CREATE TABLE IF NOT EXISTS local_grounding_import (
    owner TEXT NOT NULL, project TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
    PRIMARY KEY (owner, project, kind), FOREIGN KEY (owner, project) REFERENCES requirement_snapshot(owner, project)
  ) STRICT;`;

const decode = <T>(row: Record<string, unknown>): T => JSON.parse(String(row.payload)) as T;

export class LocalRequirements {
  constructor(private readonly db: DatabaseSync, private readonly owner: string, private readonly project: string) {}

  /** Called inside the workspace import transaction. Once seeded, this dataset is device-owned. */
  seed(snapshot: RequirementSnapshot) {
    if ([...snapshot.requirements, ...snapshot.mappings, ...(snapshot.candidates ?? []), ...(snapshot.standardRules ?? [])]
      .some(item => item.projectId !== this.project)) {
      throw new Error('The requirement snapshot contains records from another project.');
    }
    const inserted = this.db.prepare('INSERT INTO requirement_snapshot VALUES (?, ?) ON CONFLICT DO NOTHING')
      .run(this.owner, this.project);
    if (inserted.changes) {
      const requirement = this.db.prepare('INSERT INTO requirement VALUES (?, ?, ?, ?, ?)');
      const mapping = this.db.prepare('INSERT INTO requirement_mapping VALUES (?, ?, ?, ?, ?, ?)');
      for (const item of snapshot.requirements) requirement.run(this.owner, this.project, item.id, item.createdAt, JSON.stringify(item));
      for (const item of snapshot.mappings) mapping.run(this.owner, this.project, item.requirementId, item.id, item.createdAt, JSON.stringify(item));
    }
    const grounding = this.db.prepare('INSERT INTO local_grounding_import VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING');
    if (snapshot.candidates) grounding.run(this.owner, this.project, 'candidates', JSON.stringify(snapshot.candidates));
    if (snapshot.standardRules) grounding.run(this.owner, this.project, 'rules', JSON.stringify(snapshot.standardRules));
  }

  requireImported() {
    if (!this.db.prepare('SELECT 1 FROM requirement_snapshot WHERE owner = ? AND project = ?').get(this.owner, this.project)) {
      throw new DynamicContractError(503, 'Requirements have not been imported for this local project.');
    }
  }

  list(): StoreRequirement[] {
    return this.db.prepare('SELECT payload FROM requirement WHERE owner = ? AND project = ? ORDER BY created, id')
      .all(this.owner, this.project).map(decode<StoreRequirement>);
  }

  confirmed(): ConfirmedRequirement[] {
    this.requireImported();
    const requirements: RequirementSnapshot['requirements'] = this.list();
    return requirements.map(item => ({ ...item, sourceCandidateId: item.sourceCandidateId ?? null,
      sourceLocator: item.sourceLocator ?? null, sourceVersion: item.sourceVersion ?? null, confidence: item.confidence ?? null }));
  }

  candidates(): RequirementCandidate[] {
    return this.grounding('candidates');
  }

  rules(): StandardRule[] {
    return this.grounding('rules');
  }

  private grounding<T>(kind: string): T[] {
    const row = this.db.prepare('SELECT payload FROM local_grounding_import WHERE owner = ? AND project = ? AND kind = ?')
      .get(this.owner, this.project, kind);
    if (!row) throw new DynamicContractError(503, 'Review grounding has not been fully imported for this local project.');
    return decode<T[]>(row);
  }

  get(id: string): StoreRequirement | null {
    const row = this.db.prepare('SELECT payload FROM requirement WHERE owner = ? AND project = ? AND id = ?')
      .get(this.owner, this.project, id);
    return row ? decode<StoreRequirement>(row) : null;
  }

  create(fields: RequirementFields): StoreRequirement {
    const now = new Date().toISOString();
    const record = { ...fields, id: randomUUID(), projectId: this.project, createdAt: now, updatedAt: now };
    this.db.prepare('INSERT INTO requirement VALUES (?, ?, ?, ?, ?)')
      .run(this.owner, this.project, record.id, now, JSON.stringify(record));
    return record;
  }

  update(id: string, fields: Partial<RequirementFields>): StoreRequirement | null {
    // Update only the submitted fields in one statement, preserving concurrent edits to other fields.
    const row = this.db.prepare(`UPDATE requirement SET payload = json_patch(payload, ?)
      WHERE owner = ? AND project = ? AND id = ? RETURNING payload`)
      .get(JSON.stringify({ ...fields, updatedAt: new Date().toISOString() }), this.owner, this.project, id);
    return row ? decode<StoreRequirement>(row) : null;
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM requirement WHERE owner = ? AND project = ? AND id = ?')
      .run(this.owner, this.project, id).changes === 1;
  }

  mappings(id: string): StoreRequirementMapping[] {
    return this.db.prepare(`SELECT payload FROM requirement_mapping WHERE owner = ? AND project = ? AND requirement = ?
      ORDER BY created, id`).all(this.owner, this.project, id).map(decode<StoreRequirementMapping>);
  }
}
