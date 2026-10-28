import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const docs = path.dirname(fileURLToPath(import.meta.url));
const gold = JSON.parse(fs.readFileSync(path.join(docs, 'manifest.json'), 'utf8'));
const inputFiles = JSON.parse(fs.readFileSync(path.join(docs, 'input-files.json'), 'utf8'));
const ratio = (numerator, denominator) => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
export function precision(claims) {
  for (const claim of claims) if (!claim.claimKey || !['true','false','unknown'].includes(claim.verdict)) throw Error('Each adjudicated claim needs a stable key and explicit verdict.');
  for (const claim of claims) if (claims.some(other => other.claimKey === claim.claimKey && other.verdict !== claim.verdict)) throw Error(`Conflicting duplicate verdict: ${claim.claimKey}`);
  const unique = [...new Map(claims.map(claim => [claim.claimKey, claim])).values()];
  const count = verdict => unique.filter(claim => claim.verdict === verdict).length;
  const tp = count('true'), fp = count('false'), unknown = count('unknown');
  return { tp, fp, unknown, ...ratio(tp, tp + fp), lowerBound: ratio(tp, unique.length).value,
    upperBound: ratio(tp + unknown, unique.length).value };
}
export function score(runDirectory, adjudication = { claims: [], goldMatches: [] }) {
  const freeze = JSON.parse(fs.readFileSync(path.join(docs, 'FREEZE.json'), 'utf8'));
  for (const item of freeze.files) {
    if (crypto.createHash('sha256').update(fs.readFileSync(path.join(docs, item.path))).digest('hex') !== item.sha256) throw Error(`Frozen file changed: ${item.path}`);
  }
  const events = fs.readdirSync(runDirectory).filter(file => /^\d{4}-.+\.json$/.test(file)).sort().map(file => JSON.parse(fs.readFileSync(path.join(runDirectory, file), 'utf8')));
  const last = (id, kind) => events.filter(event => event.instanceId === id && event.kind === kind).at(-1)?.data;
  const cases = gold.cases.map(item => {
    const imported = last(item.instanceId, 'imported-artifacts') ?? [];
    const files = inputFiles.filter(file => file.alias === item.alias && file.expectedImported);
    const sourceFiles = files.filter(file => /\.[cm]?[jt]sx?$/.test(file.relativePath));
    const importValid = imported.length === files.length && files.every(file => imported.some(artifact => artifact.filePath === file.relativePath && artifact.contentHash.replace(/^sha256:/, '') === file.sha256 && artifact.versionId));
    const readiness = last(item.instanceId, 'readiness-result');
    const review = last(item.instanceId, 'review-session') ?? last(item.instanceId, 'review-result');
    const findings = last(item.instanceId, 'review-findings');
    const harness = last(item.instanceId, 'review-harness');
    const starts = new Map((harness?.events ?? []).filter(event => event.event === 'harness_step_started').map(event => [event.detail?.executionId, event.detail]));
    const inspected = new Set((harness?.events ?? []).filter(event => event.event === 'harness_step_completed' && event.detail?.step === 'read_source' && event.detail?.output?.hashChecked === true).map(event => starts.get(event.detail.executionId)?.input?.artifactId));
    const inspectedFiles = sourceFiles.filter(file => imported.some(artifact => artifact.filePath === file.relativePath && inspected.has(artifact.id))).map(file => file.relativePath);
    const map = harness?.analysisMap;
    const pairCount = (map?.features?.length ?? 0) * 4;
    const rows = (map?.features ?? []).flatMap(feature => feature.assessments ?? []);
    const sourceById = new Map(imported.map(artifact => [artifact.id, artifact]));
    const checkReference = ref => {
      const artifact = sourceById.get(ref.artifactId) ?? imported.find(artifact => artifact.filePath === (ref.filePath ?? ref.path));
      if (!artifact) return false;
      const source = files.find(file => file.relativePath === artifact.filePath);
      if (!source) return false;
      if (ref.sourceVersion && ![artifact.versionId, artifact.contentHash].includes(ref.sourceVersion)) return false;
      if (ref.contentHash && ref.contentHash.replace(/^sha256:/, '') !== source.sha256) return false;
      const content = fs.readFileSync(path.join(item.inputDirectory, source.relativePath), 'utf8').replaceAll('\r\n', '\n');
      const excerpt = ref.evidence ?? ref.excerpt;
      const line = ref.lineNumber;
      if (excerpt != null) {
        const normalized = excerpt.replaceAll('\r\n', '\n');
        if (!normalized.trim()) return false;
        return line ? content.split('\n').slice(line - 1, line - 1 + normalized.split('\n').length).join('\n').includes(normalized) : content.includes(normalized);
      }
      return Number.isInteger(line) && line > 0 && line <= content.split('\n').length && Boolean(ref.sourceVersion);
    };
    const references = [];
    for (const finding of findings ?? []) {
      references.push({ artifactId:finding.artifactId, filePath:finding.filePath, lineNumber:finding.lineNumber, sourceVersion:finding.location?.sourceVersion, evidence:finding.evidenceText ?? finding.evidence });
      references.push(...(finding.location?.relatedLocations ?? []));
    }
    for (const row of rows.filter(row => row.status === 'assessed')) references.push(...(row.evidence ?? []));
    const snapshot = readiness?.snapshot;
    for (const category of snapshot?.categories ?? []) for (const criterion of category.criteria ?? []) references.push(...(criterion.references ?? []));
    for (const finding of snapshot?.findings ?? []) references.push(...(finding.references ?? []));
    const completedReview = Boolean(review && ['success','pending_approval','completed','approved'].includes(review.status) && review.modelStatus === 'succeeded');
    return { alias:item.alias, instanceId:item.instanceId, projectId:last(item.instanceId,'project-created')?.id,
      import:{valid:importValid, actual:imported.length, expected:files.length},
      readiness:{status:readiness?.status ?? 'unattempted', errorCode:readiness?.errorCode ?? null, assessmentId:snapshot?.id ?? null, categories:snapshot?.categories?.map(category => ({id:category.id, state:category.state})) ?? []},
      review:{id:review?.id ?? null, status:review?.status ?? 'unattempted', modelStatus:review?.modelStatus ?? null, failureReason:review?.failureReason ?? null, findingCount:findings?.length ?? null},
      modelExecution:{providerSucceeded:(harness?.events ?? []).some(event => event.event === 'model_attempt' && event.detail?.outcome === 'success'),
        validatedAssessment:(harness?.events ?? []).some(event => event.event === 'review_assessment_validated'),
        attempts:(harness?.events ?? []).filter(event => event.event === 'model_attempt').map(event => ({outcome:event.detail?.outcome,code:event.detail?.errorCode,durationMs:event.detail?.durationMs})),
        capturedPolicy:review?.configJson ? JSON.parse(review.configJson).modelPolicyVersion : null},
      eligible:importValid && readiness?.status === 'completed' && !readiness.stale && completedReview,
      selectedFileInspection:{...ratio(inspectedFiles.length,sourceFiles.length), files:inspectedFiles},
      goldAffectedFilesInspected:item.review.affectedFiles.every(file => inspectedFiles.includes(file)),
      domainDisclosure:ratio(rows.filter(row => ['assessed','unverified'].includes(row.status)).length,pairCount),
      supportedClaimCoverage:ratio(rows.filter(row => row.status === 'assessed' && !['not_applicable','unverified'].includes(row.outcome)).length,pairCount),
      evidenceValidity:ratio(references.filter(checkReference).length,references.length),
      invalidReferences:references.filter(ref => !checkReference(ref)).map(ref => ({ artifactId:ref.artifactId, path:ref.filePath ?? ref.path,
        lineNumber:ref.lineNumber, excerptSha256:crypto.createHash('sha256').update(ref.evidence ?? ref.excerpt ?? '').digest('hex') })),
    };
  });
  const predictions = gold.cases.flatMap(item => (last(item.instanceId, 'review-findings') ?? []).map(finding => ({ instanceId:item.instanceId, ...finding })));
  const claims = [...adjudication.claims];
  for (const claim of claims) {
    const prediction = predictions.find(finding => finding.id === claim.findingId);
    if (!prediction) throw Error('Adjudication references an unavailable prediction.');
    if (!['model','deterministic'].includes(claim.origin)) throw Error('Adjudication needs explicit origin.');
    if (claim.origin !== (prediction.verifier === 'model' ? 'model' : 'deterministic')) throw Error('Adjudication origin conflicts with the saved finding.');
  }
  for (const finding of predictions) if (!claims.some(claim => claim.findingId === finding.id)) claims.push({
    claimKey:finding.id, findingId:finding.id, origin:finding.verifier === 'model' ? 'model' : 'deterministic', verdict:'unknown', reason:'Not independently adjudicated.',
  });
  const matches = adjudication.goldMatches.filter(match => match.matched && match.origin === 'model');
  for (const match of matches) {
    const item = gold.cases.find(item => item.review.goldIssueId === match.issueId);
    if (!item || !predictions.some(finding => finding.id === match.findingId && finding.instanceId === item.instanceId && finding.verifier === 'model')) throw Error('Gold hit has no corresponding model prediction.');
    if (!Array.isArray(match.occurrenceIds) || new Set(match.occurrenceIds).size !== match.occurrenceIds.length || match.occurrenceIds.length > item.review.goldOccurrenceCount) throw Error('Gold occurrence count exceeds the frozen oracle.');
  }
  const matchedIssues = new Set(matches.map(match => match.issueId));
  const matchedOccurrences = new Set(matches.flatMap(match => match.occurrenceIds.map(id => `${match.issueId}:${id}`)));
  const semanticCases = cases.filter(item => item.eligible);
  const providerCompletedCases = cases.filter(item => item.modelExecution.providerSucceeded);
  const providerGold = gold.cases.filter(item => providerCompletedCases.some(result => result.instanceId === item.instanceId));
  const anyPredictions = cases.some(item => item.review.findingCount != null);
  const total = key => cases.reduce((sum,item) => sum + item[key].denominator,0);
  const passed = key => cases.reduce((sum,item) => sum + item[key].numerator,0);
  return { generatedAt:new Date().toISOString(), source:'actual-production-workflow', cases,
    executionEligibility:ratio(semanticCases.length,5),
    providerResponseCompletion:ratio(providerCompletedCases.length,5),
    successfulWorkflowRecall:ratio(new Set(matches.filter(match => semanticCases.some(item => item.instanceId === predictions.find(finding => finding.id === match.findingId)?.instanceId)).map(match => match.issueId)).size,semanticCases.length),
    providerCompletedKnownIssueRecall:ratio(providerGold.filter(item => matchedIssues.has(item.review.goldIssueId)).length,providerGold.length),
    providerCompletedKnownOccurrenceRecall:ratio([...matchedOccurrences].filter(id => providerGold.some(item => id.startsWith(`${item.review.goldIssueId}:`))).length,providerGold.reduce((count,item) => count + item.review.goldOccurrenceCount,0)),
    modelPrecision:precision(claims.filter(claim => claim.origin === 'model')),
    deterministicPrecision:precision(claims.filter(claim => claim.origin === 'deterministic')),
    aggregatePrecision:precision(claims),
    knownIssueRecall:{...ratio(matchedIssues.size,5), status:anyPredictions ? 'end_to_end_baseline' : 'no_assessment_outputs_not_model_accuracy'},
    knownOccurrenceRecall:{...ratio(matchedOccurrences.size,7), status:anyPredictions ? 'end_to_end_baseline' : 'no_assessment_outputs_not_model_accuracy'},
    evidenceValidity:ratio(passed('evidenceValidity'),total('evidenceValidity')),
    selectedFileInspection:ratio(passed('selectedFileInspection'),total('selectedFileInspection')),
    domainDisclosure:ratio(passed('domainDisclosure'),total('domainDisclosure')),
    supportedClaimCoverage:ratio(passed('supportedClaimCoverage'),total('supportedClaimCoverage')),
    acceptance:cases.every(item => item.eligible) && claims.every(claim => claim.verdict !== 'unknown')
      && precision(claims).value >= gold.acceptanceThresholds.reviewAdjudicatedUniquePrecisionMin
      && matchedIssues.size >= 4 && matchedOccurrences.size >= 6
      && passed('evidenceValidity') === total('evidenceValidity') && total('evidenceValidity') > 0
      && passed('selectedFileInspection') / total('selectedFileInspection') >= 0.9
      && cases.every(item => item.goldAffectedFilesInspected)
      && passed('domainDisclosure') === total('domainDisclosure')
      && adjudication.readinessAssertionAgreement === 1
      ? 'ACCEPTED' : 'NOT_ACCEPTED',
    caveats:['Known gold is five issues, not exhaustive defect truth.','Imported file count does not establish inspection.','No raw Readiness classification is exposed by production snapshots.','Acceptance is never inferred from empty predictions or missing runs.'] };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const run = process.argv[2]; if (!run) throw Error('Provide the actual run directory.');
  const adjudication = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3],'utf8')) : undefined;
  console.log(JSON.stringify(score(run,adjudication),null,2));
}
