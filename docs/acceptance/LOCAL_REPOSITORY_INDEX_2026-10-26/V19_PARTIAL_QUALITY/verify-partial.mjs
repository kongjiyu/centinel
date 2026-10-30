// Evaluator only. Reads frozen artifacts; no app, network, provider or gold mutation.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import zlib from 'node:zlib';
const require = createRequire(import.meta.url);
const root = process.cwd();
const run = path.join(root, 'evidence/repository-index-evaluation-2026-10-26/run-2026-10-27T13-50-39-777Z');
const stage = path.join(root, 'data/repository-index/ef31cddc37b4ee766010f8c252ba45b4bdf4bb337f1dfdb60ffbcc7230f6a77c/stage-537eff79-d773-470c-9313-daa15fc3b0ed');
const data = n => JSON.parse(fs.readFileSync(path.join(run, n), 'utf8')).data;
const findings = data('0175-optimized-findings.json');
const harness = data('0177-optimized-harness.json');
const manifest = data('0173-optimized-manifest.json');
const usage = data('0174-optimized-usage.json');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fileChecks = () => manifest.artifacts.map(a => ({ path: a.filePath, valid: hash(fs.readFileSync(path.join(stage, a.filePath))) === a.contentHash }));
const before = fileChecks();
assert(before.every(x => x.valid));
const artifactByPath = new Map(manifest.artifacts.map(a => [a.filePath, a]));
const refs = findings.flatMap(f => [{ findingId: f.id, filePath: f.filePath, lineNumber: f.lineNumber, evidence: f.evidenceText, artifactId: f.artifactId, sourceVersion: f.location.sourceVersion }, ...f.location.relatedLocations.map(r => ({ findingId: f.id, ...r }))]);
const referenceChecks = refs.map(r => {
  const a = artifactByPath.get(r.filePath);
  const raw = fs.readFileSync(path.join(stage, r.filePath), 'utf8').replace(/\r\n?/g, '\n');
  const quote = r.evidence.replace(/\r\n?/g, '\n');
  const range = raw.split('\n').slice(r.lineNumber - 1, r.lineNumber - 1 + quote.split('\n').length).join('\n');
  return { findingId: r.findingId, filePath: r.filePath, lineNumber: r.lineNumber, valid: !!a && a.id === r.artifactId && a.contentHash === r.sourceVersion && !!quote.trim() && range.includes(quote) };
});
assert(referenceChecks.every(x => x.valid));
const assessmentRefs = harness.analysisMap.features.flatMap(f => f.assessments.flatMap(a => a.evidence));
const assessmentReferenceChecks = assessmentRefs.map(r => {
  const a = artifactByPath.get(r.filePath);
  const lines = fs.readFileSync(path.join(stage, r.filePath), 'utf8').split('\n');
  return { filePath: r.filePath, lineNumber: r.lineNumber, valid: !!a && a.id === r.artifactId && a.contentHash === r.sourceVersion && r.lineNumber >= 1 && r.lineNumber <= lines.length };
});
assert(assessmentReferenceChecks.every(x => x.valid));
const candidateReferenceChecks = findings.flatMap(f => (f.location.sourceLocator?.citationEvidence?.candidates ?? []).map(r => {
  const a = artifactByPath.get(r.filePath);
  const quote = r.excerpt.replace(/\r\n?/g, '\n');
  const lines = fs.readFileSync(path.join(stage, r.filePath), 'utf8').replace(/\r\n?/g, '\n').split('\n');
  return { findingId: f.id, filePath: r.filePath, lineNumber: r.lineNumber, referenceIndex: r.referenceIndex, match: r.match, valid: !!a && a.id === r.artifactId && a.contentHash === r.sourceVersion && lines.slice(r.lineNumber-1,r.lineNumber-1+quote.split('\n').length).join('\n').includes(quote) };
}));
assert(candidateReferenceChecks.every(x=>x.valid));
const mapRefs = [];
function collectMapRefs(value) {
  if (!value || typeof value !== 'object') return;
  if (value.filePath && value.artifactId && Number.isInteger(value.lineNumber) && value.sourceVersion) mapRefs.push(value);
  for (const child of Object.values(value)) collectMapRefs(child);
}
collectMapRefs(harness.analysisMap);
const mapReferenceChecks = mapRefs.map(r => {
  const a = artifactByPath.get(r.filePath);
  return { filePath: r.filePath, lineNumber: r.lineNumber, valid: !!a && a.id === r.artifactId && a.contentHash === r.sourceVersion && r.lineNumber >= 1 && r.lineNumber <= fs.readFileSync(path.join(stage,r.filePath),'utf8').split('\n').length };
});
assert(mapReferenceChecks.every(x=>x.valid));

// Load unchanged CommonJS source in an evaluator process. All transport dependencies
// are inert; no socket or actual browser is created. Globals are restored at exit.
const originalGlobals = Object.fromEntries(['window', 'document', 'XMLHttpRequest', 'Blob', 'Buffer'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
const noNetwork = { request() { throw Error('Evaluator forbids network'); } };
const cache = new Map();
function load(rel) {
  rel = rel.replace(/\\/g, '/');
  if (rel === 'lib/platform' || rel === 'lib/platform/index.js') return { protocols: ['http', 'https', 'data'], classes: { Blob: originalGlobals.Blob?.value, URLSearchParams } };
  if (rel === 'lib/env/classes/FormData' || rel === 'lib/env/classes/FormData.js') return undefined;
  if (rel === 'lib/helpers/isURLSameOrigin' || rel === 'lib/helpers/isURLSameOrigin.js') return () => false;
  let file = path.join(stage, rel);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = fs.existsSync(file + '.js') ? file + '.js' : path.join(file, 'index.js');
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = fs.readFileSync(file, 'utf8');
  const localRequire = id => {
    if (id.startsWith('.')) return load(path.relative(stage, path.resolve(path.dirname(file), id)));
    if (['http', 'https', 'follow-redirects/http', 'follow-redirects/https'].includes(id)) return noNetwork;
    if (id === 'proxy-from-env') return { getProxyForUrl: () => '' };
    if (['url', 'zlib', 'stream'].includes(id)) return require(id);
    throw Error('Evaluator denied dependency ' + id);
  };
  vm.runInThisContext('(function(require,module,exports){\n' + code + '\n})', { filename: file })(localRequire, module, module.exports);
  return module.exports;
}
const probes = [];
async function probe(name, fn) { const evidence = await fn(); probes.push({ name, result: 'passed', evidence }); }
try {
  const toFormData = load('lib/helpers/toFormData');
  class Form { constructor() { this.entries = []; } append(k,v) { this.entries.push([k,v]); } [Symbol.iterator]() { return this.entries[Symbol.iterator](); } get [Symbol.toStringTag]() { return 'FormData'; } }
  await probe('custom_blob_constructor_bypassed', () => {
    let calls = 0; class CustomBlob { constructor() { calls++; } }
    const form = toFormData({ a: new Uint8Array([1]).buffer }, new Form(), { Blob: CustomBlob });
    assert.equal(calls, 0); assert(form.entries[0][1] instanceof Blob);
    const savedBlob = globalThis.Blob, savedBuffer = globalThis.Buffer;
    try { globalThis.Blob = undefined; globalThis.Buffer = undefined; assert.throws(() => toFormData({ a: new Uint8Array([1]).buffer }, new Form(), { Blob: CustomBlob }), TypeError); }
    finally { globalThis.Blob = savedBlob; globalThis.Buffer = savedBuffer; }
    return { customConstructorCalls: calls, defaultGlobalConstructed: true, missingGlobalBlobAndBufferThrows: true };
  });
  await probe('shared_helper_reentrant_wrong_form', () => {
    const outer = new Form(), inner = new Form();
    toFormData({ outer: 'outer-value' }, outer, { visitor(value, key, p, helpers) { toFormData({ inner: 'inner-value' }, inner); return helpers.defaultVisitor(value, key, p); } });
    assert.deepEqual(outer.entries, []); assert.deepEqual(inner.entries, [['inner','inner-value'],['outer','outer-value']]);
    return { outerEntries: outer.entries.length, innerEntries: inner.entries.length, outerFieldAppendedToInner: true };
  });
  await probe('merge_inherited_strategy', () => {
    const merge = load('lib/core/mergeConfig');
    const result = merge({}, { toString: 'wanted' }); assert.equal(result.toString, '[object Undefined]');
    assert.throws(() => merge({}, JSON.parse('{"__proto__":"value"}')), TypeError);
    assert.equal(merge({}, { custom: 'wanted' }).custom, 'wanted');
    return { inheritedToStringReplacesValue: true, ownProtoKeyThrows: true, ordinaryCustomKeyPreserved: true };
  });
  await probe('silent_json_preserves_string', () => {
    const defaults = load('lib/defaults');
    assert.equal(defaults.transformResponse[0].call({ responseType: 'json', transitional: { silentJSONParsing: true } }, '{bad'), '{bad');
    assert.throws(() => defaults.transformResponse[0].call({ responseType: 'json', transitional: { silentJSONParsing: false } }, '{bad'));
    return { malformedSilentResultIsOriginalString: true, strictControlThrows: true };
  });
  await probe('arraybuffer_view_bounds_and_http_payload', async () => {
    const defaults = load('lib/defaults');
    const view = new Uint8Array(new Uint8Array([91,12,13,92]).buffer, 1, 2);
    const transformed = defaults.transformRequest[0].call({}, view, {});
    assert.deepEqual([...new Uint8Array(transformed)], [91,12,13,92]);
    let sent;
    await load('lib/adapters/http')({ method: 'post', url: 'http://example.invalid/', data: transformed, headers: {}, responseType: 'text', transport: { request(options, callback) { const req = new EventEmitter(); req.end = body => { sent = body; queueMicrotask(() => { const res = new PassThrough(); Object.assign(res, { headers: {}, statusCode: 200, statusMessage: 'OK' }); callback(res); res.end('ok'); }); }; return req; } } });
    assert.deepEqual([...sent], [91,12,13,92]);
    return { intendedBytes: 2, transformedBytes: 4, fakeTransportBytes: 4, networkCalls: 0 };
  });
  await probe('cancel_listener_throw_stops_remaining', async () => {
    const source = load('lib/cancel/CancelToken').source(); let firstNotified = false; let rejected;
    const handler = error => { rejected = error.message; }; process.once('unhandledRejection', handler);
    source.token.subscribe(() => { firstNotified = true; }); source.token.subscribe(() => { throw Error('listener-test'); }); source.cancel();
    await new Promise(resolve => setImmediate(resolve));
    process.removeListener('unhandledRejection', handler);
    assert.equal(firstNotified, false); assert.equal(source.token._listeners.length, 2); assert.equal(rejected, 'listener-test');
    return { earlierSubscriberNotified: false, listenerCleanupSkipped: true, ignoredThenRejected: true };
  });
  globalThis.window = {}; globalThis.document = { cookie: 'sessionXid=wrong; session.id=right; XSRF-TOKEN=local-token' };
  await probe('cookie_metacharacter_name', () => {
    const cookies = load('lib/helpers/cookies'); assert.equal(cookies.read('session.id'), 'wrong'); assert.throws(() => cookies.read('[z-a'), SyntaxError); assert.equal(cookies.read('XSRF-TOKEN'), 'local-token');
    return { dottedNameReturnsDifferentCookie: true, invalidRangeNameContainingBracketThrows: true, bareBracketDoesNotByItselfThrow: true, ordinaryNameControlPasses: true };
  });
  const requests = [];
  globalThis.XMLHttpRequest = class {
    constructor() { this.headers = {}; this.onloadend = null; this.upload = { addEventListener() {} }; requests.push(this); }
    open(method, url) { this.url = url; } setRequestHeader(k,v) { this.headers[k] = v; } addEventListener() {} send(body) { this.sent = true; this.body = body; } abort() { this.aborted = true; }
  };
  await probe('xhr_abort_signal_undefined_req', () => {
    let abort; const xhr = load('lib/adapters/xhr');
    xhr({ method: 'get', url: 'https://other.invalid/', headers: {}, signal: { aborted: false, addEventListener(_, fn) { abort = fn; }, removeEventListener() {} } });
    const req = requests.at(-1); assert.equal(req.sent, true); assert.throws(() => abort({ type: 'abort' }), /req is not defined/); assert.notEqual(req.aborted, true);
    return { sentBeforeSignal: true, signalCallbackThrowsReferenceError: true, requestAbortNotReached: true };
  });
  await probe('cross_origin_xsrf_header_condition', () => {
    const xhr = load('lib/adapters/xhr');
    const config = { method: 'get', url: 'https://other.invalid/', headers: {}, withCredentials: true, xsrfCookieName: 'XSRF-TOKEN', xsrfHeaderName: 'X-XSRF-TOKEN' };
    xhr(config); const actual = requests.at(-1); assert.equal(actual.headers['X-XSRF-TOKEN'], 'local-token');
    xhr({ ...config, headers: {}, withCredentials: false }); assert.equal(requests.at(-1).headers['X-XSRF-TOKEN'], undefined);
    return { sameOriginPredicate: false, withCredentialsCopiesLocalTokenToHeader: true, falseControlOmitsHeader: true, actualBrowserCorsNotExecuted: true };
  });
  function fakeHttp(config, respond) {
    return load('lib/adapters/http')({ method: 'post', url: 'http://example.invalid/', headers: {}, responseType: 'arraybuffer', maxContentLength: -1, ...config, transport: { request(options, callback) { const req = new EventEmitter(); req.end = () => queueMicrotask(() => { const res = new PassThrough(); Object.assign(res, { headers: {}, statusCode: 200, statusMessage: 'OK' }); respond(res, callback); }); return req; } } });
  }
  await probe('empty_request_skips_response_decompression', async () => {
    const compressed = zlib.gzipSync('response-body');
    const respond = (res, callback) => { res.headers['content-encoding'] = 'gzip'; callback(res); res.end(compressed); };
    const empty = await fakeHttp({ data: Buffer.alloc(0) }, respond); assert.deepEqual(empty.data, compressed); assert.equal(empty.headers['content-encoding'], undefined);
    const nonempty = await fakeHttp({ data: Buffer.from('request-body') }, respond); assert.equal(nonempty.data.toString(), 'response-body');
    return { emptyRequestReceivesRawCompressedResponse: true, encodingHeaderDeleted: true, nonemptyRequestControlDecompresses: true };
  });
  await probe('stream_abort_reports_disabled_size_limit', async () => {
    await assert.rejects(fakeHttp({ data: Buffer.from('request') }, (res, callback) => { callback(res); res.emit('aborted'); }), /maxContentLength size of -1 exceeded/);
    return { noLimitAndNoBodyStillReportsSizeLimitExceeded: true };
  });
  await probe('data_uri_retains_bom', async () => {
    const result = await load('lib/adapters/http')({ method: 'get', url: 'data:text/plain;base64,77u/aGVsbG8=', responseType: 'text', responseEncoding: 'utf8' });
    assert.equal(result.data.charCodeAt(0), 0xFEFF); assert.equal(result.data.slice(1), 'hello');
    return { responseStartsWithBom: true, requestVariableAssignmentDoesNotUpdateReturnedValue: true };
  });
  await probe('gold_node_timeout_custom_message_missed', async () => {
    const http = load('lib/adapters/http'); let aborted = false;
    await assert.rejects(http({ method: 'get', url: 'http://example.invalid/', headers: {}, timeout: 1, timeoutErrorMessage: 'wanted-custom-message', transport: { request() { const req = new EventEmitter(); req.setTimeout = (_, cb) => queueMicrotask(cb); req.abort = () => { aborted = true; }; req.end = () => {}; return req; } } }), e => e.message === 'timeout of 1ms exceeded' && e.code === 'ECONNABORTED');
    assert(aborted); assert(!findings.some(f => /timeoutErrorMessage/.test(f.description)));
    return { configuredMessageIgnored: true, defaultMessageAndCodePreserved: true, savedFindingHit: false };
  });
  await probe('deterministic_function_spans_and_todo', () => {
    const ts = require(require.resolve('typescript', { paths: [path.join(root, 'sidecar')] }));
    const spans = [];
    for (const filePath of ['lib/helpers/toFormData.js', 'lib/adapters/xhr.js', 'lib/adapters/http.js']) {
      const raw = fs.readFileSync(path.join(stage,filePath),'utf8'); const source = ts.createSourceFile(filePath,raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
      function visit(node) { if ((ts.isFunctionExpression(node)||ts.isFunctionDeclaration(node)) && node.name && ['toFormData','dispatchXhrRequest','xhrAdapter','dispatchHttpRequest','httpAdapter'].includes(node.name.text)) { const start=source.getLineAndCharacterOfPosition(node.getStart(source)).line+1; const end=source.getLineAndCharacterOfPosition(node.end).line+1; spans.push({ name: node.name.text, filePath, start, end, inclusiveLines: end-start+1 }); } ts.forEachChild(node,visit); } visit(source);
    }
    assert.deepEqual(spans.map(s=>s.inclusiveLines),[130,208,206,376,374]);
    assert.equal(fs.readFileSync(path.join(stage,'lib/adapters/http.js'),'utf8').split('\n')[388].trim(),'// @todo remove');
    return { spans, todoAt389: true, maintainabilityImpactOrSeverityNotProvenByLength: true };
  });
} finally {
  for (const [k, descriptor] of Object.entries(originalGlobals)) descriptor ? Object.defineProperty(globalThis,k,descriptor) : delete globalThis[k];
}

const assessmentRows = harness.analysisMap.features.flatMap(f=>f.assessments);
const planned = harness.events.find(e=>e.event==='review_batches_planned').detail.batches;
const completedIds = new Set(harness.events.filter(e=>e.event==='review_analysis_batch_saved').map(e=>e.detail.batchId));
const aiPaths = new Set(usage.reviewUsage.sourceInventory.files.map(f=>f.filePath));
const allCode = manifest.artifacts.filter(a=>/\.[cm]?[jt]sx?$/.test(a.filePath));
const aiGold = usage.reviewUsage.sourceInventory.files.find(f=>f.filePath==='lib/adapters/http.js');
const result = {
  schemaVersion: 'centinel-v19-partial-independent-verification-v1', reviewId: harness.review.id,
  sourceArtifacts: ['0173-optimized-manifest.json','0174-optimized-usage.json','0175-optimized-findings.json','0177-optimized-harness.json'].map(n=>({path:path.relative(root,path.join(run,n)).replace(/\\/g,'/'),sha256:hash(fs.readFileSync(path.join(run,n)))})),
  normalizedManifestSha256: hash(JSON.stringify(manifest.artifacts.map(a=>({path:a.filePath.replace(/\\/g,'/'),versionId:a.artifactVersionId,contentHash:a.contentHash})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0))),
  frozenFilesBefore: before, frozenFilesAfter: fileChecks(),
  findingReferenceChecks: referenceChecks, assessmentReferenceChecks, candidateReferenceChecks, mapReferenceChecks,
  probes,
  coverage: {
    status: harness.review.status, modelStatus: harness.review.modelStatus, stage: harness.review.progress.stage, pauseCode: harness.review.progress.pauseCode,
    selectedFiles: manifest.artifacts.length, physicalReadFiles: usage.reviewUsage.sourceInventory.physical?.uniqueFiles ?? null,
    harnessCompletedSourceInspections: harness.events.filter(e=>e.event==='harness_step_completed'&&e.detail.step==='inspect_source').length,
    selectedCodeFiles: allCode.length, aiContextCodeFiles: allCode.filter(a=>aiPaths.has(a.filePath)).length,
    aiContextFiles: aiPaths.size, missingAiContextFiles: manifest.artifacts.filter(a=>!aiPaths.has(a.filePath)).map(a=>a.filePath),
    savedBatchIds: [...completedIds], plannedBatches: planned.length, completedSourceSweepBatches: planned.filter(b=>!b.featureIds.length&&completedIds.has(b.id)).length, plannedSourceSweepBatches: planned.filter(b=>!b.featureIds.length).length,
    totalFeatures: harness.analysisMap.features.length, assessedFeatures: harness.analysisMap.features.filter(f=>f.assessments.every(a=>a.status==='assessed')).length,
    expectedDomainRows: harness.analysisMap.features.length*4, disclosedDomainRows: assessmentRows.length, assessedDomainRows: assessmentRows.filter(a=>a.status==='assessed').length, unverifiedDomainRows: assessmentRows.filter(a=>a.status==='unverified').length,
    assessedNonNotApplicableRows: assessmentRows.filter(a=>a.status==='assessed'&&a.outcome!=='not_applicable').length,
    explicitUnresolvedEdges: harness.analysisMap.coverage.unresolvedEdgeCount,
    goldSourceRangesInRecordedAiContext: aiGold.ranges.filter(r=>r.lineStart<=421&&r.lineEnd>=430), aiContextFileAppearances: usage.reviewUsage.sourceInventory.aiFileAppearances
  },
  limitations: ['Offline probes execute unchanged selected functions with inert transports and explicit environment stubs, not real network or native browser integration.', 'Assessment reference checks validate identity and line anchors; the harness does not retain excerpts for these rows. They do not independently prove every no-issue summary.', 'Gold outcome is saved-partial-result recall only; missing predictions remain false negatives for this artifact, and final-run recall is unavailable.', 'Diagnostic truths about spans/TODO existence are not evidence of medium-severity defects.', 'No full source sweeps completed; blocked partial execution cannot pass acceptance.']
};
assert(result.frozenFilesAfter.every(x=>x.valid));
const out = path.join(root,'docs/acceptance/LOCAL_REPOSITORY_INDEX_2026-10-26/V19_PARTIAL_QUALITY/verification.json');
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output:path.relative(root,out), findingReferencesValid:referenceChecks.filter(x=>x.valid).length, findingReferences:referenceChecks.length, assessmentAnchorsValid:assessmentReferenceChecks.filter(x=>x.valid).length, candidateReferencesValid:candidateReferenceChecks.filter(x=>x.valid).length, mapAnchorsValid:mapReferenceChecks.filter(x=>x.valid).length, probes:probes.length, coverage:result.coverage},null,2));
