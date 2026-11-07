/**
 * Drift guard for the frontend-owned contract copies. Production frontend code no longer imports
 * these sidecar declarations; this test-only file compares the copies with the sidecar originals.
 * tsc (run by `pnpm --filter centinel build`) fails if any pair stops being identical.
 */
import { describe, expect, it } from 'vitest';
import type * as SidecarDynamic from '../../../sidecar/src/dynamic/types';
import type * as SidecarEnvironment from '../../../sidecar/src/dynamic/environment/types';
import type * as SidecarRegistry from '../../../sidecar/src/dynamic/workspace/registry';
import type * as SidecarOperations from '../../../sidecar/src/dynamic/workspace/operations';
import type * as SidecarSessionBroker from '../../../sidecar/src/dynamic/environment/sessionBroker';
import * as SidecarUsability from '../../../sidecar/src/dynamic/usability/types';
import type * as SidecarEmbedding from '../../../sidecar/src/embeddingSettingsTypes';
import type * as SidecarReadiness from '../../../sidecar/src/readiness/types';
import type * as Dynamic from '../dynamic/contracts';
import * as Usability from '../dynamic/usability';
import type * as Embedding from './embeddingSettings';
import type * as Readiness from './readiness';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const same = <A, B>(proof: Equal<A, B>) => proof;

describe('frontend contract copies', () => {
  it('match the sidecar declarations', () => {
    const proofs: boolean[] = [
      same<Dynamic.CheckDefinition, SidecarDynamic.CheckDefinition>(true),
      same<Dynamic.CheckResult, SidecarDynamic.CheckResult>(true),
      same<Dynamic.CheckVerdict, SidecarDynamic.CheckVerdict>(true),
      same<Dynamic.CriterionExclusion, SidecarDynamic.CriterionExclusion>(true),
      same<Dynamic.DynamicRun, SidecarDynamic.DynamicRun>(true),
      same<Dynamic.Mission, SidecarDynamic.Mission>(true),
      same<Dynamic.MissionInput, SidecarDynamic.MissionInput>(true),
      same<Dynamic.MissionRevision, SidecarDynamic.MissionRevision>(true),
      same<Dynamic.EnvironmentInput, SidecarEnvironment.EnvironmentInput>(true),
      same<Dynamic.EnvironmentProfile, SidecarEnvironment.EnvironmentProfile>(true),
      same<Dynamic.EnvironmentSnapshot, SidecarEnvironment.EnvironmentSnapshot>(true),
      same<Dynamic.EnvironmentData, SidecarEnvironment.EnvironmentData>(true),
      same<Dynamic.WorkspaceAuthorization, SidecarRegistry.WorkspaceAuthorization>(true),
      same<Dynamic.WorkspaceInspection, SidecarRegistry.WorkspaceInspection>(true),
      same<Dynamic.HookOperation, SidecarOperations.HookOperation>(true),
      same<Dynamic.HookKind, SidecarOperations.HookKind>(true),
      same<Dynamic.SessionCaptureStatus, SidecarSessionBroker.SessionCaptureStatus>(true),
      same<Usability.UsabilityConfig, SidecarUsability.UsabilityConfig>(true),
      same<Usability.UsabilityRule, SidecarUsability.UsabilityRule>(true),
      same<Usability.UsabilityAssessment, SidecarUsability.UsabilityAssessment>(true),
      same<Embedding.EmbeddingSettingsCatalog, SidecarEmbedding.EmbeddingSettingsCatalog>(true),
      same<Embedding.EmbeddingModelOption, SidecarEmbedding.EmbeddingModelOption>(true),
      same<Embedding.EmbeddingModelUsage, SidecarEmbedding.EmbeddingModelUsage>(true),
      same<Embedding.EmbeddingProviderId, SidecarEmbedding.EmbeddingProviderId>(true),
      same<Readiness.ReadinessStatus, SidecarReadiness.ReadinessStatus>(true),
      same<Readiness.ReadinessAssessment, SidecarReadiness.ReadinessAssessment>(true),
      same<Readiness.ReadinessCategoryResult, SidecarReadiness.ReadinessCategoryResult>(true),
      same<Readiness.ReadinessGap, SidecarReadiness.ReadinessGap>(true),
    ];
    expect(proofs.every(Boolean)).toBe(true);
  });

  it('copy the usability rule list and personas exactly', () => {
    expect(Usability.USABILITY_RULES).toEqual(SidecarUsability.USABILITY_RULES);
    expect(Usability.PERSONAS).toEqual(SidecarUsability.PERSONAS);
  });
});
