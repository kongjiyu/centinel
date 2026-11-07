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
import type * as SidecarFindings from '../../../sidecar/src/dynamic/findings/types';
import type * as SidecarReports from '../../../sidecar/src/dynamic/reports/types';
import type * as SidecarUnit from '../../../sidecar/src/dynamic/unit/types';
import type * as SidecarUnitReports from '../../../sidecar/src/dynamic/unit/reports';
import type * as SidecarEvidence from '../../../sidecar/src/dynamic/sharedEvidence/types';
import type * as SidecarArtifacts from '../../../sidecar/src/dynamic/sharedEvidence/artifacts';
import type * as SidecarFileTypes from '../../../sidecar/src/dynamic/browser/fileTypes';
import type * as SidecarActionPolicy from '../../../sidecar/src/dynamic/browser/actionPolicy';
import type * as SidecarPrivateInputs from '../../../sidecar/src/dynamic/browser/privateInputs';
import type * as SidecarDownloadVault from '../../../sidecar/src/dynamic/environment/downloadVault';
import type * as SidecarDiscovery from '../../../sidecar/src/dynamic/environment/controlDiscovery';
import type * as SidecarStub from '../../../sidecar/src/dynamic/testing/staticContextStub';
import type * as SidecarCoverage from '../../../sidecar/src/dynamic/coverage';
import type * as SidecarRegression from '../../../sidecar/src/dynamic/regression';
import type * as FrontendStub from '../dynamic/staticContextStub';
import type * as FrontendCoverage from '../dynamic/coverage';
import type * as FrontendRegression from '../dynamic/regression';
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
      same<Dynamic.DynamicFinding, SidecarFindings.DynamicFinding>(true),
      same<Dynamic.FindingDetail, SidecarFindings.FindingDetail>(true),
      same<Dynamic.ReviewFindingInput, SidecarFindings.ReviewFindingInput>(true),
      same<Dynamic.RemediationInput, SidecarFindings.RemediationInput>(true),
      same<Dynamic.VerificationDecision, SidecarFindings.VerificationDecision>(true),
      same<Dynamic.DynamicReportSnapshot, SidecarReports.DynamicReportSnapshot>(true),
      same<Dynamic.DynamicReportSummary, SidecarReports.DynamicReportSummary>(true),
      same<Dynamic.DynamicUnitRun, SidecarUnit.DynamicUnitRun>(true),
      same<Dynamic.UnitReportSnapshot, SidecarUnitReports.UnitReportSnapshot>(true),
      same<Dynamic.EvidenceCopy, SidecarEvidence.EvidenceCopy>(true),
      same<Dynamic.RunArtifact, SidecarArtifacts.RunArtifact>(true),
      same<Dynamic.UploadGrant, SidecarFileTypes.UploadGrant>(true),
      same<Dynamic.DownloadGrant, SidecarFileTypes.DownloadGrant>(true),
      same<Dynamic.LocalUploadFixture, SidecarFileTypes.LocalUploadFixture>(true),
      same<Dynamic.BrowserActionPolicy, SidecarActionPolicy.BrowserActionPolicy>(true),
      same<Dynamic.InteractionAction, SidecarActionPolicy.InteractionAction>(true),
      same<Dynamic.PrivateInputGrant, SidecarPrivateInputs.PrivateInputGrant>(true),
      same<Dynamic.LocalDownload, SidecarDownloadVault.LocalDownload>(true),
      same<Dynamic.DiscoveryResult, SidecarDiscovery.DiscoveryResult>(true),
      same<Dynamic.DiscoveredControl, SidecarDiscovery.DiscoveredControl>(true),
      same<Dynamic.DiscoveryPage, SidecarDiscovery.DiscoveryPage>(true),
      same<Dynamic.StaticContextFixture, SidecarStub.StaticContextFixture>(true),
      same<FrontendStub.StubScenario, SidecarStub.StubScenario>(true),
      same<FrontendStub.IncomingContextSource, SidecarStub.IncomingContextSource>(true),
      same<FrontendCoverage.RunCoverage, SidecarCoverage.RunCoverage>(true),
      same<FrontendRegression.RegressionComparison, SidecarRegression.RegressionComparison>(true),
      same<Dynamic.RegressionBaseline, SidecarRegression.RegressionBaseline>(true),
    ];
    expect(proofs.every(Boolean)).toBe(true);
  });

  it('copy the usability rule list and personas exactly', () => {
    expect(Usability.USABILITY_RULES).toEqual(SidecarUsability.USABILITY_RULES);
    expect(Usability.PERSONAS).toEqual(SidecarUsability.PERSONAS);
  });
});
