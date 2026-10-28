import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const directory = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw Error('Pass one saved evaluation directory.');
const names = (await fs.readdir(directory)).filter(name => /^\d+-.*\.json$/.test(name)).sort();
const events = await Promise.all(names.map(async name => JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'))));
const last = kind => events.findLast(item => item.kind === kind);
const latestStart = events.findLastIndex(item => item.kind === 'optimized-started');
const candidateEvents = latestStart < 0 ? [] : events.slice(latestStart);
const candidate = kind => candidateEvents.findLast(item => item.kind === `optimized-${kind}`);
const session = candidateEvents.findLast(item => ['optimized-session', 'optimized-progress'].includes(item.kind))?.data;
const usage = candidate('usage')?.data;
const manifest = candidate('manifest')?.data;
const normalizedManifest = value => value?.artifacts?.map(item => ({path:item.filePath.replaceAll('\\','/'),versionId:item.artifactVersionId,contentHash:item.contentHash})).sort((left,right)=>left.path<right.path?-1:left.path>right.path?1:0);
const digest = value => value ? crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex') : null;
const baselineManifest = normalizedManifest(last('baseline-manifest')?.data);
const candidateManifest = normalizedManifest(manifest);
const progress = session?.progressJson ? JSON.parse(session.progressJson) : {};
const executionComplete = session?.modelStatus === 'succeeded' && progress.stage === 'complete';
const completedAt = Date.parse(progress.updatedAt ?? session?.completedAt ?? '');
const usageSavedAt = Date.parse(candidate('usage')?.recordedAt ?? '');
const complete = executionComplete && Number.isFinite(completedAt) && usageSavedAt >= completedAt;
const stages = usage?.reviewUsage?.byStage?.map(row => ({stage:row.stage,state:row.state,calls:row.calls,
  successfulCalls:row.successfulCalls,failedCalls:row.failedCalls,inputTokens:row.unknownInputCalls ? null : row.inputTokens,
  outputTokens:row.unknownOutputCalls ? null : row.outputTokens,
  providerReportedTotalTokens:row.unknownProviderTotalCalls ? null : row.providerReportedTotalTokens,
  cacheReadTokens:row.unknownCacheReadCalls ? null : row.cacheReadTokens,
  uniqueAiFiles:row.aiFileCount,fileAppearances:row.aiFileAppearances,physicalReadAttempts:row.physicalReadAttempts,
  physicalFiles:row.physicalReadFileCount,phases:row.phases,contextCharacterDiagnostics:row.requestContext?.componentsCharacters}));
const result = {schemaVersion:'centinel-live-index-usage-summary-v1',reviewId:session?.id??null,
  savedAt:candidate('usage')?.recordedAt??null,executionStatus:session?.status??null,stage:progress.stage??null,
  complete,manifest:{baselineSha256:digest(baselineManifest),candidateSha256:digest(candidateManifest),
  same:baselineManifest&&candidateManifest?JSON.stringify(baselineManifest)===JSON.stringify(candidateManifest):null,
  baselineFiles:baselineManifest?.length??null,candidateFiles:candidateManifest?.length??null},
  usage:{status:complete?'completed_execution':'partial_execution',totals:usage?.totals??null,stages:stages??null,
  sourceInventory:usage?.reviewUsage?.sourceInventory ? {status:usage.reviewUsage.sourceInventory.status,
    totalUniqueFiles:usage.reviewUsage.sourceInventory.totalUniqueFiles,knownUniqueFiles:usage.reviewUsage.sourceInventory.knownUniqueFiles,
    unknownAiFileAttempts:usage.reviewUsage.sourceInventory.unknownAiFileAttempts}:null},
  comparison:{historicalReviewTokens:973421,candidateReviewTokens:complete?stages?.find(row=>row.stage==='model_analysis')?.providerReportedTotalTokens??null:null,
    quality:'requires independent adjudication',causalSavings:'unavailable: model and policy changed',
    partialRunSavings:null}};
process.stdout.write(JSON.stringify(result,null,2)+'\n');
