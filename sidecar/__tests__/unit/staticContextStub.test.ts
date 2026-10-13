import { describe, expect, it } from 'vitest';
import { createStaticContextFixture, createStaticContextStub } from '../../src/dynamic/testing/staticContextStub';

describe('incoming Static context stub', () => {
  it('returns explicitly synthetic, serializable context with consistent references', async () => {
    const value = await createStaticContextStub().load('project-a');
    expect(value?.provenance).toBe('mock-static');
    expect(value?.projectId).toBe('project-a');
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
    for (const requirement of value!.requirements) {
      expect(value!.sources.some(source => source.id === requirement.sourceId)).toBe(true);
      expect(requirement.criteria.length).toBeGreaterThan(0);
    }
    for (const risk of value!.risks) {
      expect(value!.requirements.some(requirement => requirement.id === risk.requirementId)).toBe(true);
    }
    expect(value!.target.deploymentVersion).toBeNull();
  });
  it('does not share mutable snapshots between loads or projects', async () => {
    const source = createStaticContextStub();
    const first = await source.load('project-a');
    first!.requirements[0].criteria.length = 0;
    expect((await source.load('project-a'))!.requirements[0].criteria).toHaveLength(2);
    expect((await source.load('project-b'))!.projectId).toBe('project-b');
  });
  it.each(['stale', 'conflicting', 'unapproved', 'incomplete'] as const)('exposes %s without fabricating a runtime verdict', scenario => {
    const value = createStaticContextFixture('project-a', scenario)!;
    if (scenario === 'stale') expect(value.sources[0].currency).toBe('stale');
    if (scenario === 'conflicting') expect(value.conflicts).toHaveLength(1);
    if (scenario === 'unapproved') expect(value.approvalState).toBe('pending');
    if (scenario === 'incomplete') expect(value.requirements[1].criteria).toHaveLength(0);
    expect(value).not.toHaveProperty('verdict');
  });
  it('represents absent context as absent and rejects an empty project ID', async () => {
    expect(await createStaticContextStub('absent').load('project-a')).toBeNull();
    await expect(createStaticContextStub().load(' ')).rejects.toThrow('project ID');
  });
});
