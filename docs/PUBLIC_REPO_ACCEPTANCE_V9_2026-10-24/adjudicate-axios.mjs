import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from '../../sidecar/node_modules/typescript/lib/typescript.js';
import {precision, score} from '../PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22/score.mjs';
import {validateGoldMatches} from '../PUBLIC_REPO_ACCEPTANCE_V7_2026-10-23/score.mjs';

// Trusted evaluator only: upstream files are read as bytes/text/AST, never executed.
const out='docs/PUBLIC_REPO_ACCEPTANCE_V9_2026-10-24';
const run='evidence/public-repo-outcomes-2026-10-22/run-2026-10-24T10-27-46-162Z';
const source='evidence/public-repo-outcomes-2026-10-22/assessed-inputs/axios';
const frozen='docs/PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const norm=s=>s.replaceAll('\r\n','\n');
const load=name=>read(`${run}/${name}.json`).data;
const findings=load('0070-review-findings');
const session=load('0069-review-session');
const manifest=load('0071-review-manifest');
const harness=load('0074-review-harness');
const caseGold=read(`${frozen}/manifest.json`).cases.find(x=>x.alias==='axios');
const inputs=read(`${frozen}/input-files.json`).filter(x=>x.alias==='axios'&&x.expectedImported);
const texts=new Map(inputs.map(x=>[x.relativePath,norm(fs.readFileSync(`${source}/${x.relativePath}`,'utf8'))]));
const ev=(file,start,end=start)=>({filePath:`${source}/${file}`,lineNumber:start,excerpt:texts.get(file).split('\n').slice(start-1,end).join('\n')});
const claims=[];
function add(i,key,verdict,claim,reason,ranges) {
 const f=findings[i];
 claims.push({instanceId:caseGold.instanceId,findingId:f.id,origin:f.verifier,claimKey:`axios:${key}`,verdict,claim,reason,
   sourceEvidence:ranges.map(x=>ev(...x))});
}
for(const i of [0,3]) add(i,'extend-prototype-mutation','true',
 'An own enumerable __proto__ property with an object value can change an ordinary extend target prototype.',
 'forEach enumerates own keys without key filtering; extend uses ordinary assignment. A parsed own __proto__ data property therefore reaches the inherited setter on an ordinary target. This is local target mutation, not a demonstrated public request exploit or global Object.prototype pollution. The selected createInstance callers use Axios.prototype/context, so external attacker reach is not established.',
 [['lib/utils.js',257,280],['lib/utils.js',328,337],['lib/axios.js',15,23]]);
add(1,'toarray-invalid-length','true','A numeric non-integer, negative or non-finite array-like length can throw RangeError in toArray.',
 'Only typeof number is checked before new Array(length); negative/fractional/NaN/infinite numeric lengths violate the Array length contract. Public toFormData reaches this helper for a top-level []-suffixed field with an array-like object. This verifies the stated malformed-length failure, without certifying arbitrary invalid payloads as supported.',
 [['lib/utils.js',424,434],['lib/utils.js',95,103],['lib/helpers/toFormData.js',102,128],['lib/axios.js',43,44]]);
add(1,'toarray-preloop-allocation-exhaustion','unknown','A very large valid array length causes excessive allocation before the copy loop runs.',
 'The source constructs Array(i), but JavaScript arrays may be sparse. Source inspection does not establish allocation size, engine limits or exhaustion before iteration. No engine/resource reproduction is authorized. This claim is distinct from the supported malformed-length RangeError.',
 [['lib/utils.js',424,434]]);
add(2,'matchall-no-progress','true','matchAll can loop forever with a matching non-global or zero-width expression.',
 'exec is repeated with no global/progress guard. A matching non-global pattern repeats the same result; a global zero-width match also need not advance lastIndex. This is a conditional helper-level behavior, not a demonstrated application attack.',
 [['lib/utils.js',457,467],['lib/utils.js',504,509]]);
add(2,'matchall-attacker-reach-exhaustion','unknown','Caller-controlled patterns/strings can cause application CPU and memory exhaustion through matchAll.',
 'The only selected call site supplies a constant global expression whose alternatives consume at least a word or bracket pair. Caller-controlled field names do not control that expression or make it match an empty string. A direct internal-helper consumer could supply a bad regex, but the actual application trust boundary/exhaustion allegation remains unverified.',
 [['lib/helpers/formDataToJSON.js',5,13],['lib/utils.js',457,467]]);
add(4,'merge-result-prototype-mutation','true','An own __proto__ input key can change the merged result prototype and inject inherited properties.',
 'merge allocates an ordinary result and enumerates own input keys without filtering. Object-valued __proto__ enters the plain-object branch and ultimately assigns a merged object through the inherited setter; non-plain object values can reach the cited direct assignment. This changes the returned object prototype, not global Object.prototype. headers and config merging are selected consumers.',
 [['lib/utils.js',300,318],['lib/utils.js',115,124],['lib/core/mergeConfig.js',18,26],['lib/core/dispatchRequest.js',41,49]]);
add(5,'isfunction-tag-mismatch','true','The generic isFunction helper returns false for callable async and generator functions.',
 'The documented generic function predicate accepts only the intrinsic Function tag; async and generator callables have different standard tags. The mismatch is supported as a predicate defect. It does not establish that every synchronous visitor or stream API accepts these callable kinds.',
 [['lib/utils.js',162,171],['lib/utils.js',492,498]]);
add(5,'isfunction-valid-consumer-bypass','unknown','Actual consumers reject or bypass valid async/generator callbacks because of isFunction.',
 'Selected call sites use this predicate for stream methods, FormData methods and a synchronously interpreted visitor. No concrete async/generator callback meeting those consumer contracts is supplied, and returned Promise/generator values do not meet the visitor true/false recursion protocol. A public behavior regression beyond the generic predicate needs more evidence.',
 [['lib/utils.js',177,196],['lib/helpers/toFormData.js',69,79],['lib/helpers/toFormData.js',157,165]]);
for(const i of [6,7,10,16]) add(i,'readme-request-config-separators','true','The README request configuration object omits separators between decompress, insecureHTTPParser and transitional.',
 'Both property boundaries lack commas; comments/newlines cannot separate JavaScript object properties. A copied full configuration cannot parse. Multiple domains/locations for this same malformed example share one common-cause claim key; both missing separator occurrences are retained in evidence.',
 [['README.md',484,499]]);
add(8,'formdata-classifier-invokes-input-method','true','FormData detection can run an input toString method and propagate its exception during request transformation.',
 'After intrinsic checks, the classifier directly invokes thing.toString() when isFunction accepts it. A supplied ordinary object with a throwing method reaches this branch in transformRequest before JSON serialization. This establishes classification side effects/failure, without treating a supplied function as remote-code injection.',
 [['lib/utils.js',189,196],['lib/defaults/index.js',55,75]]);
add(8,'formdata-classifier-attacker-code-execution','unknown','Untrusted caller-controlled objects create a security boundary allowing arbitrary code execution through FormData detection.',
 'The method invocation is real, but the frozen code does not establish how a remote attacker supplies an executable method instead of JSON data, or crosses an authorization boundary. The input already contains JavaScript code. A source-level method call alone does not demonstrate the security allegation.',
 [['lib/utils.js',189,196],['lib/defaults/index.js',55,75]]);
add(9,'formdata-recursion-resource-exhaustion','unknown','Deep or broad acyclic untrusted inputs exhaust stack/CPU and block request serialization.',
 'Recursive build has a circular-reference stack but no depth/work budget. This identifies a potential resource limit; an actual engine threshold, attacker-controlled input path and demonstrated blocking/exhaustion are absent. The frozen acceptance requires runtime-dependent allegations to remain Unknown without authorized reproduction. Mere recursive traversal proportional to supplied input does not independently prove a security defect.',
 [['lib/helpers/toFormData.js',6,8],['lib/helpers/toFormData.js',130,175],['lib/defaults/index.js',95,106]]);
add(11,'formdata-global-prototype-pollution','true','FormData field __proto__[marker] can write to Object.prototype during conversion to JSON.',
 'The property-path regex preserves __proto__; the initial ordinary target inherits Object.prototype. The intermediate object check accepts that inherited object and recurses into it. A final previously absent marker is assigned there. The public formToJSON export and JSON-content-type FormData request path reach this converter. No dependency execution is needed to establish this direct property-write mechanism.',
 [['lib/helpers/formDataToJSON.js',5,13],['lib/helpers/formDataToJSON.js',28,64],['lib/utils.js',109,111],['lib/axios.js',61,63],['lib/defaults/index.js',68,76]]);
add(12,'cookie-name-regex-metacharacters','true','A configured cookie name containing regex syntax can match another name or throw during XSRF cookie lookup.',
 'xsrfCookieName is passed to cookies.read without escaping. The name a.b can also match axb; an unmatched opening bracket can invalidate the constructed regex. These are valid configured strings and direct RegExp semantics. No theft or attacker-controlled configuration is claimed as verified.',
 [['lib/helpers/cookies.js',34,37],['lib/adapters/xhr.js',146,150],['index.d.ts',140,147]]);
add(13,'readme-formdata-override-example','true','The documented FormData override example never assigns the imported class to env.FormData.',
 'The prose specifies env.FormData, but the adjacent example only imports a local variable and sets a content-type header. transformRequest chooses this.env.FormData; importing a variable cannot replace it. This is a documentation mismatch even when the default happens to be the same form-data implementation.',
 [['README.md',973,986],['lib/defaults/index.js',99,106],['lib/defaults/index.js',154,157]]);
add(14,'readme-urlencoded-postform-wrong-serialization','false','The README automatic URL-encoded example selects multipart serialization because it uses postForm.',
 'The finding omits the next line specifying lowercase content-type: application/x-www-form-urlencoded. postForm adds Content-Type: multipart/form-data as a separate case-sensitive key; merge retains the lowercase caller key. transformRequest normalizes it, overwriting the preset canonical key, and then chooses the URL-encoded branch. The full selected local call chain contradicts the alleged wrong serialization.',
 [['README.md',890,893],['lib/core/Axios.js',149,173],['lib/core/mergeConfig.js',18,26],['lib/helpers/normalizeHeaderName.js',5,12],['lib/defaults/index.js',55,63],['lib/defaults/index.js',93,106]]);
for(const i of [15,17]) add(i,'sync-interceptor-missing-reject-handler','true','A throwing synchronous interceptor with omitted/null rejection handler produces a new TypeError that masks the original exception.',
 'InterceptorManager stores rejected unchanged and allows the documented null rejection handler. Axios calls it in the fulfillment catch with no callable guard, outside its later dispatchRequest catch. A fulfillment exception therefore leads to a new call-of-null/undefined error. Both findings describe the same cause.',
 [['lib/core/Axios.js',96,113],['lib/core/InterceptorManager.js',17,24],['README.md',673,677]]);
for(const i of [18,20]) add(i,'xhr-cancellation-undefined-req','true','AbortSignal cancellation evaluates an undeclared req before cancellation rejection and request abort/cleanup.',
 'The selected XHR file declares request, not req. The signal path invokes onCanceled without an argument or with an abort event, selecting the CanceledError constructor branch and evaluating req first. This raises ReferenceError in an ordinary environment without such a global, bypassing subsequent abort/cleanup. Already-aborted signals can reject the promise executor with ReferenceError; later events can throw through dispatch. CancelToken objects that choose the alternate branch are a control and are not generalized as broken.',
 [['lib/adapters/xhr.js',17,36],['lib/adapters/xhr.js',190,207]]);
add(19,'http-aborted-response-misclassified-size','true','A non-size response aborted event is reported as maxContentLength exceeded.',
 'When the callback is reached with rejected false, it always emits the size-limit text and ERR_BAD_RESPONSE, with no cause check. The size branch sets rejected true first and is therefore a distinct suppressed path. A premature response abort can thus be mislabeled, including a default -1 configuration. The source determines handler behavior; no transport timing or prevalence is inferred.',
 [['lib/adapters/http.js',337,362],['lib/defaults/index.js',137,143]]);
add(21,'upload-stream-error-factory-arguments','true','Upload stream errors can receive a config object as error code and lose their request configuration.',
 'The upload handler passes config in the code position and null in the config position. AxiosError.from forwards these positions, and the constructor assigns a truthy code but only truthy config. For an ordinary stream Error with no preexisting config, the result gets object-valued code and no config. Both symptoms have the same argument-order cause.',
 [['lib/adapters/http.js',451,455],['lib/core/AxiosError.js',16,30],['lib/core/AxiosError.js',83,101],['lib/adapters/http.js',364,367]]);
add(22,'data-uri-discarded-bom-normalization','true','Text data-URI responses can retain a BOM because normalization writes the unused data variable.',
 'The decoded text is assigned to convertedData; the stripped value is assigned to data; settle returns convertedData. stripBOM removes an initial FEFF from its argument, but that returned value is discarded on this path. The normal HTTP body path assigns the stripped value back and is a separate control.',
 [['lib/adapters/http.js',127,153],['lib/utils.js',345,350],['lib/adapters/http.js',371,383]]);

const deterministicSpanChecks=[];
for(let i=23;i<29;i++) {
 const f=findings[i], file=f.filePath, text=texts.get(file), line=f.lineNumber;
 if(i===28) {
  add(i,'deterministic-http-todo','true','The HTTP adapter contains the reported TODO maintenance note.',
   'The exact comment exists at the cited line. This confirms a maintenance-note observation, not unresolved defect severity or a mandatory project policy violation.',[[file,line,line+2]]);
  continue;
 }
 const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const spans=[];
 const visit=node=>{if(ts.isFunctionLike(node)&&node.body){const start=ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1;const end=ast.getLineAndCharacterOfPosition(node.end).line+1;spans.push({start,end,physicalLength:end-start+1,name:node.name?.getText(ast)??null});} ts.forEachChild(node,visit);};visit(ast);
 const span=spans.find(x=>x.start===line);
 const length=Number(f.description.match(/is (\d+) lines/)?.[1]);
 const valid=span?.physicalLength===length;
 deterministicSpanChecks.push({findingId:f.id,filePath:file,savedLine:line,reportedLength:length,ast:span,valid});
 if(!valid) throw Error('Unexpected deterministic span');
 const key=file.includes('xhr')?'deterministic-xhr-adapter-length':file.includes('http')?'deterministic-http-adapter-length':'deterministic-toformdata-length';
 add(i,key,'true',`${span.name} spans ${length} physical source lines.`,
  'The trusted workspace TypeScript parser independently confirms the stated physical span. Nested adapter and Promise callback warnings share one maintainability cause per adapter. This is a factual size observation, not proof of a behavioral defect or evidence that splitting is required.',[[file,span.start,span.end]]);
}

const goldMisses=[{issueId:caseGold.review.goldIssueId,creditedIssueHits:0,creditedOccurrenceHits:0,
 reason:'None of the 23 newly retained model findings identifies the Node HTTP timeout callback ignoring config.timeoutErrorMessage. Cancellation, aborted-response classification, upload stream errors and data-URI BOM handling are different causes and receive no gold credit. The bug is present in the frozen Node callback; XHR honors the option and is the paired control. This quota-blocked partial run is ineligible; the zero is retained-prediction credit against fixed gold, not completed-review semantic recall.',
 sourceEvidence:[ev('lib/adapters/http.js',421,430),ev('lib/adapters/xhr.js',127,138)]}];
const adjudication={schemaVersion:'public-repo-review-independent-adjudication-v1',instanceId:caseGold.instanceId,reviewId:session.id,
 runDirectory:run,policyVersion:JSON.parse(session.configJson).modelPolicyVersion,workflowStatus:session.status,modelStatus:session.modelStatus,
 workflowAcceptance:'NOT_ACCEPTED',claims,goldMatches:[],goldMisses,limitations:[
 'Every new v9 retained finding was independently adjudicated against the frozen source; earlier v8 judgments were used only to inspect output format.',
 'Helper-local semantic defects do not establish external attacker reach or whole-application exploitability. Distinct runtime/trust-boundary extrapolations remain Unknown.',
 'Resource-exhaustion and unsupported consumer-contract allegations remain Unknown without authorized reproduction; upstream code and dependencies were not executed.',
 'The follow-up authenticated harness was read after the partial-batch reader patch. It has 19 saved batch deltas, no unverified delta and an interrupted final batch. Captured map status assessed is not final successful Review completion.',
 'Quota exhaustion blocked the Review. No model calls, retries or fallback were performed, and this cannot be accepted as a completed five-project benchmark.'
 ]};
adjudication.mitigationSuggestions=[
 {claimKeys:['axios:readme-urlencoded-postform-wrong-serialization'],status:'proposed-not-implemented',
  evidence:'README890-893 includes the lowercase explicit header; Axios149-173, mergeConfig18-26, normalizeHeaderName5-12 and defaults55-63/93-106 provide the contradictory selected call chain.',
  action:'Before claiming an example selects the wrong serializer, include the complete invocation and selected config-merge/header-normalization/serialization path in adjudication or grounding. Add a regression fixture for lowercase explicit content-type plus postForm. Require an evidence-backed contradiction check or abstention when downstream header normalization is outside the assessed batch. Prompt wording alone does not validate dataflow.'},
 {claimKeys:['axios:toarray-preloop-allocation-exhaustion','axios:formdata-recursion-resource-exhaustion'],status:'proposed-not-implemented',
  evidence:'utils424-434 constructs an array; toFormData149-175 traverses recursively with cycle detection. Neither establishes an engine memory/stack threshold or attacker entry point.',
  action:'Keep resource-exhaustion allegations unverified until an explicit resource-budget contract and authorized controlled reproduction establish reachability and measurable effect. Separate malformed-length RangeError from sparse-array allocation claims. Add negative evaluation controls for source-level absence-of-limit claims, without running imported untrusted code in the product evaluator.'},
 {claimKeys:['axios:matchall-attacker-reach-exhaustion'],status:'proposed-not-implemented',
  evidence:'formDataToJSON5-13 is the only selected matchAll caller and fixes a global, non-empty-matching regex; utils457-467 has no generic progress guard.',
  action:'Ground generic-helper security allegations in selected call sites and argument provenance. Preserve the helper-local no-progress defect but withhold application exploit credit when all selected callers supply a safe fixed regex. Add paired safe-caller/bad-direct-pattern evidence cases and distinguish private helper exposure from public API reach.'},
 {claimKeys:['axios:isfunction-valid-consumer-bypass'],status:'proposed-not-implemented',
  evidence:'utils162-171 proves tag mismatch; toFormData69-79/157-165 expects a synchronous visitor result, so callability alone does not prove consumer validity.',
  action:'Require the alleged callback to satisfy the receiving API return/timing contract before calling rejection a public behavioral defect. Ground supported callable kinds from the actual consumer and retain Unknown when only generic callability is shown. Add consumer-contract counterexamples rather than assuming all function kinds are interchangeable.'},
 {claimKeys:['axios:formdata-classifier-attacker-code-execution'],status:'proposed-not-implemented',
  evidence:'utils189-196 invokes a supplied method; defaults55-75 reaches classification, but no selected source proves remote input can supply executable methods.',
  action:'Record a concrete attacker entry, serialization boundary and executable-value provenance before security exploit credit. Retain the verified classifier side-effect/exception behavior separately. Add evaluation controls where executable callbacks are already held by the caller, so ordinary invocation is not mistaken for newly acquired remote execution.'}
];

const sourceChecks=inputs.map(x=>{const bytes=fs.readFileSync(`${source}/${x.relativePath}`);const hash=sha(bytes);const artifact=manifest.artifacts.find(a=>a.filePath===x.relativePath);return {filePath:x.relativePath,bytes:bytes.length,sha256:hash,gitBlobSha:shaGit(bytes),gitBlobMatches:shaGit(bytes)===x.gitBlobSha,frozenHashMatches:hash===x.sha256,frozenLengthMatches:bytes.length===x.bytes,manifestMatches:artifact?.contentHash===hash,artifactId:artifact?.id,artifactVersionId:artifact?.artifactVersionId};});
function shaGit(b){return crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${b.length}\0`),b])).digest('hex');}
if(sourceChecks.some(x=>!x.gitBlobMatches||!x.frozenHashMatches||!x.frozenLengthMatches||!x.manifestMatches))throw Error('Frozen source mismatch');
const frozenBundleChecks=read(`${frozen}/FREEZE.json`).files.map(x=>({path:x.path,sha256:sha(fs.readFileSync(`${frozen}/${x.path}`)),valid:sha(fs.readFileSync(`${frozen}/${x.path}`))===x.sha256}));
if(frozenBundleChecks.some(x=>!x.valid))throw Error('Frozen bundle mismatch');
const references=[];
function check(ref,kind,extra={}) {
 let file=ref.filePath??ref.path;
 if(file?.startsWith(source+'/'))file=file.slice(source.length+1);
 const artifact=manifest.artifacts.find(a=>a.id===ref.artifactId)??manifest.artifacts.find(a=>a.filePath===file);
 const identityValid=Boolean(artifact&&artifact.filePath===file&&(!ref.artifactId||ref.artifactId===artifact.id));
 const versionValid=Boolean(artifact&&(!ref.sourceVersion||[artifact.contentHash,artifact.artifactVersionId].includes(ref.sourceVersion)));
 const text=texts.get(file);const excerpt=ref.evidence??ref.excerpt;const line=ref.lineNumber;
 const present=Boolean(text&&Number.isInteger(line)&&line>0&&line<=text.split('\n').length);
 const exact=excerpt==null?present:present&&Boolean(excerpt.trim())&&text.split('\n').slice(line-1,line-1+norm(excerpt).split('\n').length).join('\n').includes(norm(excerpt));
 const valid=identityValid&&versionValid&&exact&&(excerpt!=null||Boolean(ref.sourceVersion));
 return {kind,...extra,artifactId:artifact?.id,filePath:file,lineNumber:line,sourceVersion:ref.sourceVersion??null,
  excerptSha256:excerpt==null?null:sha(norm(excerpt)),valid,identityValid,versionValid,exact};
}
for(const f of findings) {
 references.push(check({artifactId:f.artifactId,filePath:f.filePath,lineNumber:f.lineNumber,sourceVersion:f.location.sourceVersion,evidence:f.evidenceText},'finding-primary',{findingId:f.id}));
 for(const ref of f.location.relatedLocations??[])references.push(check(ref,'finding-related',{findingId:f.id}));
}
const map=harness.analysisMap;
const rows=map.features.flatMap(f=>(f.assessments??[]).map(r=>({...r,featureId:f.id})));
for(const row of rows.filter(x=>x.status==='assessed')) for(const ref of row.evidence??[])references.push(check(ref,'captured-assessed-domain',{featureId:row.featureId,domain:row.domain}));
const claimChecks=claims.flatMap(c=>c.sourceEvidence.map(ref=>check(ref,'adjudication-claim',{findingId:c.findingId,claimKey:c.claimKey})));
const goldChecks=goldMisses.flatMap(g=>g.sourceEvidence.map(ref=>check(ref,'adjudication-gold-miss',{issueId:g.issueId})));
if([...claimChecks,...goldChecks].some(x=>!x.valid))throw Error('Independent adjudication excerpt mismatch');
const topology=[];
for(const f of map.features) {
 for(const ref of f.entryPoints??[])topology.push(check(ref,'map-entry-point',{featureId:f.id}));
 for(const p of f.paths??[])for(const ref of p.evidence??[])topology.push(check(ref,'map-path',{featureId:f.id,pathId:p.id}));
 for(const u of f.unresolved??[])for(const ref of u.evidence??[])topology.push(check(ref,'map-unresolved',{featureId:f.id}));
}
const starts=new Map(harness.events.filter(e=>e.event==='harness_step_started').map(e=>[e.detail.executionId,e.detail]));
const inspected=new Set(harness.events.filter(e=>e.event==='harness_step_completed'&&e.detail.step==='read_source'&&e.detail.output?.hashChecked===true).map(e=>starts.get(e.detail.executionId)?.input?.artifactId));
const sourceFiles=inputs.filter(x=>/\.[cm]?[jt]sx?$/.test(x.relativePath));
const inspectedFiles=sourceFiles.filter(x=>manifest.artifacts.some(a=>a.filePath===x.relativePath&&inspected.has(a.id))).map(x=>x.relativePath);
const pairCount=map.features.length*4;
const modelAttempts=harness.events.filter(x=>x.event==='model_attempt');
const sourceArtifacts=['0059-review-result','0061-review-session','0062-review-findings','0063-review-manifest','0065-review-evidence','0066-review-harness','0069-review-session','0070-review-findings','0071-review-manifest','0073-review-evidence','0074-review-harness','runtime-code-manifest','reader-runtime-code-manifest','run-provenance'].map(n=>({path:`${run}/${n}.json`,sha256:sha(fs.readFileSync(`${run}/${n}.json`))}));
const verification={schemaVersion:'public-repo-review-independent-verification-v1',instanceId:caseGold.instanceId,reviewId:session.id,runDirectory:run,
 sourceArtifacts,frozenBundleChecks,sourceChecks,sourceFileCount:sourceChecks.length,sourceByteCount:sourceChecks.reduce((s,x)=>s+x.bytes,0),retainedFindingCount:findings.length,
 originFindingCounts:{model:findings.filter(x=>x.verifier==='model').length,deterministic:findings.filter(x=>x.verifier==='deterministic').length},atomicClaimRowCount:claims.length,
 modelPrecision:precision(claims.filter(x=>x.origin==='model')),deterministicPrecision:precision(claims.filter(x=>x.origin==='deterministic')),aggregatePrecision:precision(claims),
 referenceCount:references.length,referenceValidity:{numerator:references.filter(x=>x.valid).length,denominator:references.length,value:references.length?references.filter(x=>x.valid).length/references.length:null},referenceChecks:references,
 coverage:{capturedMapStatus:map.status,final:false,limitations:'Authenticated follow-up snapshot captured after reader partial-batch reconstruction fix; 19 saved batch deltas, no unverified delta, quota on final batch. Map status assessed is partial coverage and must never count as final workflow completion.',
  selectedCodeInspection:{numerator:inspectedFiles.length,denominator:sourceFiles.length,files:inspectedFiles},goldAffectedFilesInspected:caseGold.review.affectedFiles.every(x=>inspectedFiles.includes(x)),
  capturedInferredFeatureCount:map.features.length,capturedDomainPairCount:pairCount,capturedDomainDisclosure:{numerator:rows.filter(x=>['assessed','unverified'].includes(x.status)).length,denominator:pairCount},
  capturedSupportedClaimCoverage:{numerator:rows.filter(x=>x.status==='assessed'&&!['not_applicable','unverified'].includes(x.outcome)).length,denominator:pairCount},capturedOutcomes:rows.reduce((a,x)=>(a[`${x.status}:${x.outcome}`]=(a[`${x.status}:${x.outcome}`]??0)+1,a),{})},
 modelAttemptOutcomes:modelAttempts.reduce((a,x)=>(a[x.detail.outcome]=(a[x.detail.outcome]??0)+1,a),{}),modelAttemptCount:modelAttempts.length,
 repairs:harness.events.filter(x=>x.event==='review_assessment_repair_scheduled').map(x=>x.detail),rejections:harness.events.filter(x=>/rejected|unverified/.test(x.event)).map(x=>({event:x.event,detail:x.detail})),
 workflow:{status:session.status,modelStatus:session.modelStatus,progress:JSON.parse(session.progressJson),completedAt:session.completedAt,failureReason:session.failureReason,eligible:false,benchmarkAcceptance:'NOT_ACCEPTED'},
 claimEvidenceVerification:{referenceCount:claimChecks.length+goldChecks.length,invalidCount:[...claimChecks,...goldChecks].filter(x=>!x.valid).length,checks:[...claimChecks,...goldChecks]},
 execution:'read-only frozen-source/data analysis; trusted workspace TypeScript parser and scorer imports only; no upstream code/dependencies executed, installs, network, provider calls, retries or fallback',
 deterministicSpanChecks,mapTopologyAndPlannedRangeReferences:{count:topology.length,validCount:topology.filter(x=>x.valid).length,checks:topology},
 findingAdjudicationCoverage:{returnedFindingIds:findings.map(x=>x.id),adjudicatedFindingIds:[...new Set(claims.map(x=>x.findingId))],complete:findings.every(x=>claims.some(c=>c.findingId===x.id)),findingGroups:[...new Set(claims.map(x=>x.claimKey))].map(key=>({claimKey:key,verdict:claims.find(x=>x.claimKey===key).verdict,findingIds:[...new Set(claims.filter(x=>x.claimKey===key).map(x=>x.findingId))]}))},
 goldCredit:{issueId:caseGold.review.goldIssueId,issueHits:0,occurrenceHits:0,matchedClaimKeys:[],eligible:false},
 independence:'New v9 outputs read and compared with original frozen source. Earlier v8 files supplied schema examples only; no v8 verdicts or source-check results were copied.'};
const modelRuntime=read(`${run}/runtime-code-manifest.json`);
const readerRuntime=read(`${run}/reader-runtime-code-manifest.json`);
verification.runtimeProvenance={
 modelRuntimeManifest:{path:`${run}/runtime-code-manifest.json`,capturedAt:modelRuntime.capturedAt,sha256:sha(fs.readFileSync(`${run}/runtime-code-manifest.json`))},
 readerRuntimeManifest:{path:`${run}/reader-runtime-code-manifest.json`,capturedAt:readerRuntime.capturedAt,sha256:sha(fs.readFileSync(`${run}/reader-runtime-code-manifest.json`)),globalModelHold:readerRuntime.globalModelHold,semanticAssessmentCodeUnchanged:readerRuntime.semanticAssessmentCodeUnchanged},
 changedReaderProductionPaths:readerRuntime.files.filter(x=>modelRuntime.files.some(y=>y.path===x.path&&y.sha256!==x.sha256)).map(x=>x.path),
 payloadComparisons:[['0061-review-session','0069-review-session'],['0062-review-findings','0070-review-findings'],['0063-review-manifest','0071-review-manifest'],['0065-review-evidence','0073-review-evidence'],['0066-review-harness','0074-review-harness']].map(([before,after])=>({before:`${run}/${before}.json`,after:`${run}/${after}.json`,equalDataPayload:JSON.stringify(load(before))===JSON.stringify(load(after))})),
 trustedParser:{version:ts.version,source:'sidecar/node_modules/typescript/lib/typescript.js',usage:'Parse only; imported Axios modules never executed.'},
 interpretation:'Model outputs are attributed to the original model-runtime manifest. The later reader patch changes supabaseRepository reconstruction only and ran under a global model hold; its saved payloads are independently compared, not relabeled as a new model run.'};
validateGoldMatches(adjudication.goldMatches,claims);
const scored=score(run,adjudication);
const axiosScored=scored.cases.find(x=>x.instanceId===caseGold.instanceId);
verification.scorerContractCheck={passed:true,precision:scored.precision,axiosCase:axiosScored,acceptance:scored.acceptance};
fs.writeFileSync(`${out}/review-axios-adjudication.json`,JSON.stringify(adjudication,null,2)+'\n');
fs.writeFileSync(`${out}/review-axios-verification.json`,JSON.stringify(verification,null,2)+'\n');
console.log(JSON.stringify({findings:findings.length,claims:claims.length,modelPrecision:verification.modelPrecision,deterministicPrecision:verification.deterministicPrecision,references:verification.referenceValidity,claimReferenceCount:claimChecks.length+goldChecks.length,topologyReferences:topology.length,invalidReferences:references.filter(x=>!x.valid),coverage:verification.coverage,workflow:verification.workflow,scorerAccepted:scored.acceptance},null,2));
