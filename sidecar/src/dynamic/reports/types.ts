import type {DynamicRun} from '../types.js';
import type {FindingDetail} from '../findings/types.js';
import type {EvidenceCopy} from '../sharedEvidence/types.js';
import type {RunArtifact} from '../sharedEvidence/artifacts.js';
import type {DataEvent} from '../environment/types.js';
export type DynamicReportSnapshot={
 metadata:{schemaVersion:'centinel-dynamic-report-v1';generatorVersion:'dynamic-report-1';reportId:string;projectId:string;runId:string;actorId:string;generatedAt:string};
 run:Omit<DynamicRun,'lease'|'idempotencyKey'|'legacySessionId'|'actionPolicy'>;
 findings:FindingDetail[];evidenceCopies:EvidenceCopy[];artifacts:RunArtifact[];dataEvents:DataEvent[];
 modelUsage:{status:'available'|'unavailable';calls:Array<{id:string;stage:string;provider:string;model:string;outcome:string;input:number|null;output:number|null;cacheRead:number|null;cacheCreation:number|null;durationMs:number|null;createdAt:string}>};
 limitations:string[];
};
export type DynamicReportSummary=DynamicReportSnapshot['metadata'];
