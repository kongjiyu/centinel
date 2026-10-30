import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import ts from '../../../sidecar/node_modules/typescript/lib/typescript.js';
import {precision, score} from '../PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22/score.mjs';
import {validateGoldMatches} from '../PUBLIC_REPO_ACCEPTANCE_V7_2026-10-23/score.mjs';

// Trusted evaluator: frozen upstream modules are read/parsed, never imported or executed.
const out='docs/acceptance/PUBLIC_REPO_ACCEPTANCE_V9_RESUME_2026-10-24';
const run='evidence/public-repo-outcomes-2026-10-22/run-2026-10-24T15-46-37-089Z';
const frozen='docs/acceptance/PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22';
const source='evidence/public-repo-outcomes-2026-10-22/assessed-inputs/axios';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const load=n=>read(run+'/'+n+'.json').data;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const gitSha=b=>crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex');
const norm=s=>s.replaceAll('\r\n','\n');
const gold=read(frozen+'/manifest.json').cases.find(x=>x.alias==='axios');
const inputs=read(frozen+'/input-files.json').filter(x=>x.alias==='axios'&&x.expectedImported);
const texts=new Map(inputs.map(x=>[x.relativePath,norm(fs.readFileSync(source+'/'+x.relativePath,'utf8'))]));
const findings=load('0051-review-findings');
const session=load('0050-review-session');
const manifest=load('0052-review-manifest');
const harness=load('0055-review-harness');
const imported=load('0002-imported-artifacts');
const ev=(file,start,end=start)=>({filePath:file,lineNumber:start,excerpt:texts.get(file).split('\n').slice(start-1,end).join('\n')});
const claims=[];
function add(i,key,verdict,claim,reason,ranges) {
 const f=findings[i];
 claims.push({instanceId:gold.instanceId,findingId:f.id,origin:f.verifier,claimKey:'axios:'+key,verdict,claim,reason,sourceEvidence:ranges.map(x=>ev(...x))});
}
add(0,'interceptor-clear-type-omission','true','The documented runtime interceptor clear method is absent from AxiosInterceptorManager types.',
 'README explicitly calls both clear methods. The runtime manager implements clear, while the complete declared interface contains only use/eject; the request/response interceptor properties are typed by that interface. TypeScript cannot resolve clear on those declared properties. This is a type/API mismatch, not a missing runtime implementation.',
 [['README.md',651,658],['index.d.ts',268,279],['lib/core/InterceptorManager.js',38,45]]);
add(1,'callable-instance-nested-response-type','true','Default callable AxiosInstance overloads wrap the response type twice.',
 'AxiosPromise<T> is Promise<AxiosResponse<T>>. Substituting the callable default R=AxiosResponse<T> into AxiosPromise<R> yields the nested response, whereas Axios.request returns Promise<R>. Runtime createInstance binds request, so callable and method returns share the runtime shape. The declared data type therefore differs from that runtime contract.',
 [['index.d.ts',190,197],['index.d.ts',233,233],['index.d.ts',280,296],['lib/axios.js',15,23],['README.md',532,547]]);
for(const i of [2,6]) add(i,'extend-target-prototype-mutation','true','extend can mutate an ordinary destination prototype through an own enumerable __proto__ source key.',
 'forEach admits own enumerable keys and extend assigns their values without filtering. An object-valued own __proto__ data property reaches the inherited setter on an ordinary destination. This is target-local mutation, not global Object.prototype pollution. Selected createInstance calls copy Axios.prototype and a constructed context, so an external untrusted request exploit is not established and receives no credit.',
 [['lib/utils.js',256,280],['lib/utils.js',328,337],['lib/axios.js',15,23]]);
add(3,'toarray-invalid-length','true','Malformed numeric array-like lengths can throw RangeError rather than return null.',
 'Only numeric type is checked before Array(length); negative, fractional, non-finite or above-maximum array lengths violate the constructor contract. toFormData reaches this helper for an object-valued top-level [] field; the public toFormData export makes that path available. Valid ordinary arrays bypass this allocation. This is the malformed-length failure, not proof of resource exhaustion.',
 [['lib/utils.js',419,434],['lib/helpers/toFormData.js',104,128],['lib/axios.js',40,44]]);
add(3,'toarray-resource-exhaustion','unknown','Large accepted lengths can exhaust memory or other application resources.',
 'Array(length) may allocate sparse storage; source alone does not establish engine allocation strategy, failure threshold or an attacker-controlled application entry. The copy loop scales with length, but no controlled resource reproduction or explicit resource budget is supplied. The invalid-length exception is scored separately.',
 [['lib/utils.js',424,434],['lib/helpers/toFormData.js',104,128]]);
add(4,'matchall-no-progress','true','A matching non-global or non-advancing zero-width regex can make matchAll loop forever.',
 'The helper repeats exec and pushes every match without checking flags or progress. A matching non-global regex repeats the same result; a global zero-width match need not advance lastIndex. This proves the helper-level conditional nontermination under those arguments.',
 [['lib/utils.js',457,465],['lib/utils.js',504,509]]);
add(4,'matchall-application-dos','unknown','Caller-controlled expressions create an application denial-of-service path through matchAll.',
 'The only selected caller fixes a global regex whose alternatives consume at least a word character or bracket pair. User field names cannot change that expression or make it match an empty string. Direct helper use with an unsafe regex is possible, but selected source does not establish the alleged application trust boundary or externally reachable exhaustion.',
 [['lib/helpers/formDataToJSON.js',5,13],['lib/utils.js',457,465]]);
add(5,'toflatobject-prototype-mutation','false','An own __proto__ property passes the merged-name guard and mutates the destination prototype.',
 'Concrete counter-evidence: merged is an ordinary empty object and !merged[prop] is required before assignment. For __proto__, merged[prop] resolves to Object.prototype and is truthy; the branch is skipped. constructor and other inherited names are also skipped. The claimed dangerous name does not pass the actual guard under the stated normal-object conditions.',
 [['lib/utils.js',375,398]]);
add(5,'toflatobject-inherited-key-omission','true','Normal-object merged bookkeeping skips source keys that collide with truthy inherited names.',
 'Because the membership test uses !merged[prop] rather than an own-key check, a source own constructor, toString or __proto__ name is skipped even on first encounter. The helper therefore omits such source properties while flattening; this is distinct from the rejected mutation consequence. No broader exploit is credited.',
 [['lib/utils.js',375,398],['lib/core/AxiosError.js',79,90],['lib/helpers/toFormData.js',57,64]]);
add(7,'merge-result-prototype-mutation','true','merge can replace its result prototype with properties supplied under an own __proto__ key.',
 'The result is an ordinary object. Own input names reach assignValue, whose plain-object, array and direct-value branches all assign result[key]. With an object-valued __proto__ property this invokes the inherited setter and changes only that result prototype. The selected config/header merges show usage but do not establish arbitrary remote control of config or global prototype mutation.',
 [['lib/utils.js',300,317],['lib/utils.js',256,280],['lib/core/mergeConfig.js',18,26],['lib/core/dispatchRequest.js',43,49]]);
for(const i of [8,19]) add(i,'readme-config-missing-commas','true','The request-configuration example omits property separators after decompress and insecureHTTPParser.',
 'Both values are followed by another property without a comma, inside the displayed configuration object. JavaScript object literal grammar cannot accept that copied example. Duplicate domain reports share this one documentation cause.',
 [['README.md',484,510]]);
for(const i of [8,10]) add(i,'readme-formserializer-semicolons','true','The displayed formSerializer object uses invalid semicolon property separators.',
 'The visitor arrow-function value is followed by a semicolon inside the object; dots/metaTokens/indexes also use semicolons. These are not valid JavaScript property separators. The duplicate finding adds no unique numerator.',
 [['README.md',517,524]]);
add(9,'formdata-predicate-side-effects','true','FormData classification can invoke a candidate method and propagate its exception or side effects.',
 'After the native-instance/tag checks fail, isFunction(thing.toString) permits an ordinary function and the predicate directly invokes it without catch. A custom object supplied as request data reaches classification in transformRequest. This establishes invocation of code already supplied by the caller, not newly acquired remote code execution or an authentication bypass.',
 [['lib/utils.js',183,196],['lib/defaults/index.js',55,74]]);
add(11,'null-transitional-native-error','true','A null transitional options value reaches Object.keys(null) and throws native TypeError instead of the intended AxiosError.',
 'The only selected assertOptions caller checks transitional !== undefined, which admits null. mergeConfig preserves a null source value. The validator accepts typeof null as object, then calls Object.keys. No earlier null guard resolves this path. This is invalid-input error classification, not an accepted valid null option.',
 [['lib/helpers/validator.js',60,80],['lib/core/Axios.js',41,60],['lib/core/mergeConfig.js',18,26],['lib/core/mergeConfig.js',29,35]]);
add(12,'formdata-symbol-conditional-failure','true','If Symbol is unavailable and the FormData capability check is reached, direct Symbol access throws.',
 'isSpecCompliant directly reads Symbol.toStringTag. Reach requires a truthy _Blob plus a truthy candidate with a function append method; the _Blob && guard can otherwise skip this function. An explicitly supplied Blob option can make the check reachable. This is a conditional compatibility fact only.',
 [['lib/helpers/toFormData.js',32,34],['lib/helpers/toFormData.js',48,75]]);
add(12,'formdata-symbol-supported-runtime-regression','unknown','The Symbol access breaks a supported unpolyfilled serialization runtime.',
 'README lists IE11 but does not establish exact polyfills, Blob/FormData capabilities, bundling or the deployed environment. _Blob short-circuiting also narrows reachability. No authorized runtime reproduction establishes a supported no-Symbol configuration, so the compatibility-impact allegation remains unresolved.',
 [['README.md',70,76],['lib/helpers/toFormData.js',32,34],['lib/helpers/toFormData.js',68,75]]);
add(13,'parseheaders-inherited-name-collision','true','A constructor response header is combined with an inherited value instead of being preserved.',
 'XHR sends raw response headers to parseHeaders. Lowercasing preserves constructor; parsed={} inherits a truthy constructor, so line 47 concatenates the inherited function representation with the supplied value on its first occurrence. __proto__ is another collision, but this does not prove global pollution or downstream exploitation.',
 [['lib/helpers/parseHeaders.js',27,52],['lib/adapters/xhr.js',52,67]]);
for(const i of [14,26]) {
 add(i,'data-uri-response-limit-bypass','true','Node GET data-URI decoding returns a payload without enforcing the configured finite maxContentLength.',
  'The full data URI is decoded to Buffer in fromDataURI. The HTTP adapter data branch returns before HTTP stream accounting and performs no maxContentLength check. maxContentLength is documented as a Node response-size limit, so a finite limit can be exceeded by decoded data. Both reports share the same unbounded data-URI path and count once. The source establishes the bypass, not process exhaustion.',
  [['lib/helpers/fromDataURI.js',25,47],['lib/adapters/http.js',111,153],['lib/adapters/http.js',335,349],['README.md',414,418]]);
 add(i,'data-uri-application-resource-exhaustion','unknown','An untrusted data URI can exhaust application memory or block execution materially.',
  'Synchronous decoding and Buffer creation scale with input, but the frozen sources do not identify an actual application attacker entry, accepted maximum URL size, engine memory budget or measured blocking/failure threshold. Keep the proven configured response-limit bypass separate from the unresolved operational attack claim. No upstream code was run.',
  [['lib/helpers/fromDataURI.js',25,47],['lib/adapters/http.js',111,153]]);
}
add(15,'formdata-global-prototype-pollution','true','A FormData name __proto__[polluted] can cause formDataToJSON to write Object.prototype.polluted.',
 'The fixed regex accepts __proto__ and polluted as path segments. At the first segment obj.__proto__ is Object.prototype, which is truthy and passes isObject, so no replacement array is created. Recursion writes the final property on that shared prototype. The method is exposed by axios.formToJSON for valid iterable FormData and also used by JSON FormData transformation. A fresh nonexisting polluted key suffices; no remote application entry is inferred.',
 [['lib/helpers/formDataToJSON.js',5,13],['lib/helpers/formDataToJSON.js',28,65],['lib/utils.js',107,116],['lib/utils.js',444,454],['lib/axios.js',61,63],['lib/defaults/index.js',67,74]]);
add(16,'cookie-metadata-attribute-injection','unknown','Untrusted cookie metadata can alter browser cookie scope or security attributes.',
 'write concatenates raw name/path/domain into document.cookie and escapes only the value. This verifies the string construction. However, no selected caller invokes write, and no supplied application trust boundary or authorized browser reproduction establishes interpretation of injected attributes, their precedence, domain acceptance or an actual scope/security change. The complete claimed security consequence remains Unknown; the string-concatenation observation is not separately credited as a defect.',
 [['lib/helpers/cookies.js',5,40],['lib/adapters/xhr.js',143,154]]);
add(17,'cookie-name-regexp-injection','true','An unescaped cookie name can alter matching or throw on malformed regex syntax.',
 'The browser helper concatenates name directly into RegExp. A name containing an unmatched [ makes pattern construction fail; a regex metacharacter such as . broadens lookup. XHR supplies config.xsrfCookieName after the standard-browser and origin/credentials checks. This is a conditional helper/config correctness issue; attacker control of application configuration is not established.',
 [['lib/helpers/cookies.js',34,36],['lib/adapters/xhr.js',143,154],['lib/defaults/index.js',148,149]]);
add(18,'silent-json-null-doc-mismatch','true','Silent malformed-JSON handling returns the original string instead of the documented null.',
 'The README explicitly promises null on parsing failure. With responseType=json and silentJSONParsing=true, the SyntaxError is suppressed because strictJSONParsing is false; transformResponse falls through to return data. The default forced parsing path also retains its original string on failure. No null assignment exists in this transform.',
 [['README.md',498,506],['lib/defaults/index.js',118,140],['lib/defaults/transitional.js',1,7]]);
add(20,'error-json-config-credential-disclosure','true','Logging the documented toJSON result can disclose Authorization values retained in request config.',
 'AxiosError keeps the config and toJSON returns it without redaction. README documents Authorization defaults and directly logging error.toJSON(). On an ordinary error carrying such a header, the logged object therefore includes that header. This conditional documented-flow exposure is supported; it does not prove a specific application logged secrets, remote exfiltration or any particular logging infrastructure.',
 [['lib/core/AxiosError.js',24,29],['lib/core/AxiosError.js',32,50],['README.md',580,583],['README.md',744,751],['lib/adapters/http.js',387,392]]);
for(const i of [21,22]) add(i,'synchronous-interceptor-error-masking','true','A throwing synchronous fulfillment handler with no rejection callback is replaced by TypeError.',
 'use stores the callback as supplied, and README explicitly demonstrates null rejection with synchronous:true. The synchronous catch unconditionally calls onRejected outside a protecting catch. Thus a thrown fulfillment error is replaced by invoking null/undefined. Both returned findings describe the same cause and count once. Asynchronous chains use Promise.then and are a separate control.',
 [['lib/core/InterceptorManager.js',17,25],['lib/core/Axios.js',62,105],['README.md',667,676]]);
for(const i of [23,24]) add(i,'xhr-cancellation-undefined-req','true','The generated XHR cancellation-error branch reads undefined req and interrupts rejection/abort cleanup.',
 'The adapter declares request, never req. A later active-request AbortSignal event with truthy type evaluates new CanceledError(...,req), throwing before reject and request.abort. Public dispatch rejects an initially aborted signal before adapter entry; the later signal event still reaches this defect. A normal CancelToken object without type takes the other branch, so not every cancellation is affected. Both findings share this cause. For asynchronous signal events the exception is not automatically the request promise rejection; the intended rejection can be bypassed and the request may stay active.',
 [['lib/adapters/xhr.js',16,36],['lib/adapters/xhr.js',190,205],['lib/adapters/xhr.js',219,223],['lib/core/dispatchRequest.js',12,31],['lib/cancel/CancelToken.js',54,64]]);
add(25,'http-serialization-continues-after-reject','true','A stateful params serializer failure can reject yet allow request creation and sending to continue.',
 'The reject wrapper sets rejected=true but the construction/send path never checks it. The first buildURL exception is caught without return, then options.path calls it again. This version accepts paramsSerializer as an options object: an encode callback or visitor can throw once and then succeed. buildURL/AxiosURLSearchParams show that concrete selected path, so a function-valued paramsSerializer assumption is unnecessary. transport.request and req.end follow despite the settled rejection. Network activity can begin after rejection has been issued; actual wall-clock delivery order to a catch consumer is not asserted.',
 [['lib/adapters/http.js',96,105],['lib/adapters/http.js',234,292],['lib/adapters/http.js',450,458],['lib/helpers/buildURL.js',24,44],['lib/helpers/AxiosURLSearchParams.js',20,39],['index.d.ts',119,135]]);

const deterministicSpanChecks=[];
for(let i=27;i<33;i++) {
 const f=findings[i],file=f.filePath;
 if(i===32) {add(i,'deterministic-http-todo','true','The reported HTTP TODO maintenance note exists.',
  'The exact note is present. This supports a maintenance observation, not demonstrated defect severity or a required project policy violation.',[[file,f.lineNumber,f.lineNumber+2]]);continue;}
 const ast=ts.createSourceFile(file,texts.get(file),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const spans=[];
 const visit=n=>{if(ts.isFunctionLike(n)&&n.body){const start=ast.getLineAndCharacterOfPosition(n.getStart(ast)).line+1,end=ast.getLineAndCharacterOfPosition(n.end).line+1;spans.push({start,end,physicalLength:end-start+1,name:n.name?.getText(ast)??null});}ts.forEachChild(n,visit);};visit(ast);
 const span=spans.find(s=>s.start===f.lineNumber),length=Number(f.description.match(/is (\d+) lines/)?.[1]);
 if(span?.physicalLength!==length)throw Error('Incorrect deterministic length');
 deterministicSpanChecks.push({findingId:f.id,filePath:file,reportedLength:length,ast:span,valid:true});
 const key=file.includes('xhr')?'deterministic-xhr-adapter-length':file.includes('http')?'deterministic-http-adapter-length':'deterministic-toformdata-length';
 add(i,key,'true',span.name+' spans '+length+' physical source lines.',
  'The trusted TypeScript AST confirms the physical span. Nested adapter/Promise callbacks share one maintainability cause per adapter. The factual length observation does not independently establish a behavioral defect or mandate splitting.',[[file,span.start,span.end]]);
}
const goldMisses=[{issueId:gold.review.goldIssueId,creditedIssueHits:0,creditedOccurrenceHits:0,
 reason:'None of the 27 model findings identifies the Node timeout callback ignoring config.timeoutErrorMessage. The timeout defect is still present at HTTP421-430 while XHR127-137 honors the option. Cancellation, serializer continuation, data-URI limits and type/document mismatches have different causes. Successful execution does not turn these into a behavioral gold match.',
 sourceEvidence:[ev('lib/adapters/http.js',421,430),ev('lib/adapters/xhr.js',127,137),ev('index.d.ts',137,138)]}];
const adjudication={schemaVersion:'public-repo-review-independent-adjudication-v1',instanceId:gold.instanceId,reviewId:session.id,runDirectory:run,
 policyVersion:JSON.parse(session.configJson).modelPolicyVersion,workflowStatus:session.status,modelStatus:session.modelStatus,
 workflowAcceptance:'NOT_ACCEPTED',claims,goldMatches:[],goldMisses,
 limitations:['Independent adjudication of this successful new Review only; earlier adjudications supplied format context, never verdict input.',
 'Exact source citations and helper-local conditional defects do not establish remote attacker reach or whole-system exploitability.',
 'Operational resource-exhaustion, cookie security impact and supported no-Symbol runtime regression remain Unknown without authorized reproduction.',
 'No upstream code/dependencies/tests were executed or installed; no network, provider, app, approval, retry, fallback or production mutations were performed.',
 'This is one completed Review in a fixed five-case/seven-occurrence benchmark. A successful case cannot certify partial benchmark acceptance.'],
 mitigationSuggestions:[
 {claimKeys:['axios:toflatobject-prototype-mutation'],status:'proposed-not-implemented',action:'Require candidate dangerous keys to be traced through every selected guard. Add evaluator counterexamples for ordinary-object membership checks that accidentally block a proposed mutation while causing a different omission. Keep source truth and security consequence separate.'},
 {claimKeys:['axios:matchall-application-dos','axios:toarray-resource-exhaustion','axios:data-uri-application-resource-exhaustion','axios:cookie-metadata-attribute-injection'],status:'proposed-not-implemented',action:'Preserve explicit uncertainty for resource budgets, application attacker entry and browser effects. Establish caller argument provenance and a supported contract before promoting a helper fact into a system exploit. Add safe-caller and bounded-runtime negative controls; do not run imported upstream code in the adjudicator.'},
 {claimKeys:['axios:formdata-symbol-supported-runtime-regression'],status:'proposed-not-implemented',action:'Include complete short-circuit guards and an explicit supported runtime capability matrix before compatibility-impact claims. Retain conditional source behavior separately from unverified environment impact.'},
 {claimKeys:[],status:'proposed-not-implemented',action:'Investigate why the validated bounded sweep and HTTP technical domain rows miss a concrete selected cross-adapter configuration inconsistency despite inspecting both files. Strengthen generic contract comparison and branch-specific diagnostics using independent fixtures. Keep this registered gold and oracle out of product prompts and model inputs.'}]};

const frozenBundleChecks=read(frozen+'/FREEZE.json').files.map(x=>({path:x.path,sha256:sha(fs.readFileSync(frozen+'/'+x.path)),valid:sha(fs.readFileSync(frozen+'/'+x.path))===x.sha256}));
const sourceChecks=inputs.map(x=>{const bytes=fs.readFileSync(source+'/'+x.relativePath),hash=sha(bytes),a=manifest.artifacts.find(a=>a.filePath===x.relativePath),imp=imported.find(a=>a.filePath===x.relativePath);return {filePath:x.relativePath,bytes:bytes.length,sha256:hash,gitBlobSha:gitSha(bytes),gitBlobMatches:gitSha(bytes)===x.gitBlobSha,frozenHashMatches:hash===x.sha256,frozenLengthMatches:bytes.length===x.bytes,manifestMatches:a?.contentHash===hash,importedMatches:imp?.contentHash.replace(/^sha256:/,'')===hash&&imp?.versionId===a?.artifactVersionId,artifactId:a?.id,artifactVersionId:a?.artifactVersionId};});
const originalDirectory='evidence/public-repo-outcomes-2026-10-22/inputs/'+gold.instanceId;
const originalStagedChecks=read(frozen+'/input-files.json').filter(x=>x.alias==='axios').map(x=>{const b=fs.readFileSync(originalDirectory+'/'+x.relativePath);return {filePath:x.relativePath,bytes:b.length,sha256:sha(b),gitBlobSha:gitSha(b),valid:b.length===x.bytes&&sha(b)===x.sha256&&gitSha(b)===x.gitBlobSha,imported:x.expectedImported};});
if(originalStagedChecks.some(x=>!x.valid))throw Error('Original staged byte/Git blob mismatch');
if(frozenBundleChecks.some(x=>!x.valid)||sourceChecks.some(x=>!x.gitBlobMatches||!x.frozenHashMatches||!x.frozenLengthMatches||!x.manifestMatches||!x.importedMatches)||manifest.artifacts.length!==inputs.length||imported.length!==inputs.length)throw Error('Frozen/import provenance mismatch');
function check(ref,kind,extra={}) {
 let file=ref.filePath??ref.path;
 const a=manifest.artifacts.find(a=>a.id===ref.artifactId)??manifest.artifacts.find(a=>a.filePath===file);
 const identityValid=Boolean(a&&a.filePath===file&&(!ref.artifactId||ref.artifactId===a.id));
 const versionValid=Boolean(a&&(!ref.sourceVersion||[a.contentHash,a.artifactVersionId].includes(ref.sourceVersion))&&(!ref.contentHash||ref.contentHash.replace(/^sha256:/,'')===a.contentHash));
 const text=texts.get(file),excerpt=ref.evidence??ref.excerpt,line=ref.lineNumber,lines=text?.split('\n');
 const present=Boolean(lines&&Number.isInteger(line)&&line>0&&line<=lines.length);
 const exact=excerpt==null?present:present&&Boolean(excerpt.trim())&&lines.slice(line-1,line-1+norm(excerpt).split('\n').length).join('\n').includes(norm(excerpt));
 return {kind,...extra,artifactId:a?.id,filePath:file,lineNumber:line,sourceVersion:ref.sourceVersion??null,excerptSha256:excerpt==null?null:sha(norm(excerpt)),identityValid,versionValid,exact,valid:identityValid&&versionValid&&exact&&(excerpt!=null||Boolean(ref.sourceVersion))};
}
const references=[];
for(const f of findings){references.push(check({artifactId:f.artifactId,filePath:f.filePath,lineNumber:f.lineNumber,sourceVersion:f.location.sourceVersion,evidence:f.evidenceText},'finding-primary',{findingId:f.id}));for(const r of f.location.relatedLocations??[])references.push(check(r,'finding-related',{findingId:f.id}));}
const map=harness.analysisMap;
const pre=harness.events.find(e=>e.event==='review_analysis_map_saved'&&e.detail.phase==='prepared')?.detail.analysisMap;
if(!pre)throw Error('Missing pre-provider feature map');
const rows=map.features.flatMap(f=>(f.assessments??[]).map(r=>({...r,featureId:f.id})));
for(const r of rows.filter(r=>r.status==='assessed'))for(const ref of r.evidence??[])references.push(check(ref,'assessed-domain',{featureId:r.featureId,domain:r.domain}));
const claimChecks=claims.flatMap(c=>c.sourceEvidence.map(r=>check(r,'adjudication-claim',{findingId:c.findingId,claimKey:c.claimKey})));
const goldChecks=goldMisses.flatMap(g=>g.sourceEvidence.map(r=>check(r,'adjudication-gold-miss',{issueId:g.issueId})));
if([...claimChecks,...goldChecks].some(x=>!x.valid))throw Error('Adjudicator excerpt mismatch');
const topology=[];
for(const f of map.features){for(const r of f.entryPoints??[])topology.push(check(r,'map-entry-point',{featureId:f.id}));for(const p of f.paths??[])for(const r of p.evidence??[])topology.push(check(r,'map-path',{featureId:f.id,pathId:p.id}));for(const u of f.unresolved??[])for(const r of u.evidence??[])topology.push(check(r,'map-unresolved',{featureId:f.id}));}
const starts=new Map(harness.events.filter(e=>e.event==='harness_step_started').map(e=>[e.detail.executionId,e.detail]));
const inspectedIds=new Set(harness.events.filter(e=>e.event==='harness_step_completed'&&e.detail.step==='read_source'&&e.detail.output?.hashChecked===true).map(e=>starts.get(e.detail.executionId)?.input?.artifactId));
const codeFiles=inputs.filter(x=>/\.[cm]?[jt]sx?$/.test(x.relativePath));
const inspectedFiles=codeFiles.filter(x=>manifest.artifacts.some(a=>a.filePath===x.relativePath&&inspectedIds.has(a.id))).map(x=>x.relativePath);
const preIds=new Set(pre.features.map(f=>f.id));
const domains=['security','business','technical','personnel'];
const disclosure=pre.features.flatMap(f=>domains.map(domain=>({featureId:f.id,domain,rows:rows.filter(r=>r.featureId===f.id&&r.domain===domain)})));
const disclosureValid=x=>x.rows.length===1&&['assessed','unverified'].includes(x.rows[0].status);
const supportedValid=x=>disclosureValid(x)&&x.rows[0].status==='assessed'&&!['not_applicable','unverified'].includes(x.rows[0].outcome)&&Boolean(x.rows[0].evidence?.length)&&x.rows[0].evidence.every(r=>check(r,'coverage').valid);
const runtime=read(run+'/runtime-code-manifest.json');
const runtimeChecks=runtime.files.map(f=>({path:f.path,expectedSha256:f.sha256,snapshotExists:fs.existsSync(run+'/runtime-source/'+f.path),snapshotMatches:fs.existsSync(run+'/runtime-source/'+f.path)&&sha(fs.readFileSync(run+'/runtime-source/'+f.path))===f.sha256}));
// Check type allegations with a trusted compiler and a synthetic consumer. No emit or evaluation.
const typeSamplePath=path.resolve(out,'__virtual_axios_consumer.ts');
const typeSample="import axios from '../../../evidence/public-repo-outcomes-2026-10-22/assessed-inputs/axios/index';\naxios.interceptors.request.clear();\naxios<{marker:number}>({}).then(r=>{ const marker:number=r.data.marker; });\naxios.request<{marker:number}>({}).then(r=>{ const marker:number=r.data.marker; });\n";
const compilerOptions={noEmit:true,strict:true,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,skipLibCheck:true};
const compilerHost=ts.createCompilerHost(compilerOptions);
const getSourceFile=compilerHost.getSourceFile.bind(compilerHost);
compilerHost.getSourceFile=(fileName,...rest)=>path.resolve(fileName)===typeSamplePath?ts.createSourceFile(fileName,typeSample,ts.ScriptTarget.ES2020,true):getSourceFile(fileName,...rest);
const typeProgram=ts.createProgram([typeSamplePath],compilerOptions,compilerHost);
const typeDiagnostics=ts.getPreEmitDiagnostics(typeProgram).map(d=>({code:d.code,line:d.file&&d.start!=null?d.file.getLineAndCharacterOfPosition(d.start).line+1:null,file:d.file?path.relative(process.cwd(),d.file.fileName).replaceAll('\\','/'):null,message:ts.flattenDiagnosticMessageText(d.messageText,' ')}));
const typeCheckPassed=typeDiagnostics.length===2&&typeDiagnostics.every(d=>d.code===2339)&&typeDiagnostics.some(d=>d.line===2&&d.message.includes('clear'))&&typeDiagnostics.some(d=>d.line===3&&d.message.includes('marker'));
if(!typeCheckPassed)throw Error('Unexpected synthetic type consumer results: '+JSON.stringify(typeDiagnostics));
const attempts=harness.events.filter(e=>e.event==='model_attempt');
const sourceArtifacts=['0050-review-session','0051-review-findings','0052-review-manifest','0053-review-traceability','0054-review-evidence','0055-review-harness','0002-imported-artifacts','0019-readiness-result','runtime-code-manifest','run-provenance','pre-run-verification','gold-freeze'].map(n=>({path:run+'/'+n+'.json',sha256:sha(fs.readFileSync(run+'/'+n+'.json'))}));
const complete=findings.every(f=>claims.some(c=>c.findingId===f.id));
if(!complete||claims.some(c=>!findings.some(f=>f.id===c.findingId&&f.verifier===c.origin)))throw Error('Finding coverage/origin mismatch');
validateGoldMatches(adjudication.goldMatches,claims);
const scored=score(run,adjudication);
const caseScore=scored.cases.find(x=>x.instanceId===gold.instanceId);
const verification={schemaVersion:'public-repo-review-independent-verification-v1',instanceId:gold.instanceId,reviewId:session.id,runDirectory:run,
 sourceArtifacts,frozenBundleChecks,sourceChecks,sourceFileCount:sourceChecks.length,sourceByteCount:sourceChecks.reduce((n,x)=>n+x.bytes,0),originalStagedChecks,
 retainedFindingCount:findings.length,originFindingCounts:{model:findings.filter(f=>f.verifier==='model').length,deterministic:findings.filter(f=>f.verifier==='deterministic').length},atomicClaimRowCount:claims.length,
 modelPrecision:precision(claims.filter(c=>c.origin==='model')),deterministicPrecision:precision(claims.filter(c=>c.origin==='deterministic')),aggregatePrecision:precision(claims),
 referenceCount:references.length,referenceValidity:{numerator:references.filter(r=>r.valid).length,denominator:references.length,value:references.filter(r=>r.valid).length/references.length},referenceChecks:references,
 claimEvidenceVerification:{referenceCount:claimChecks.length+goldChecks.length,invalidCount:[...claimChecks,...goldChecks].filter(r=>!r.valid).length,checks:[...claimChecks,...goldChecks]},
 coverage:{capturedMapStatus:map.status,final:true,selectedCodeInspection:{numerator:inspectedFiles.length,denominator:codeFiles.length,files:inspectedFiles},goldAffectedFilesInspected:gold.review.affectedFiles.every(p=>inspectedFiles.includes(p)),preProviderInferredFeatureCount:pre.features.length,capturedInferredFeatureCount:map.features.length,featureIdentityPreserved:map.features.length===pre.features.length&&map.features.every(f=>preIds.has(f.id)),capturedDomainPairCount:pre.features.length*4,capturedDomainDisclosure:{numerator:disclosure.filter(disclosureValid).length,denominator:disclosure.length},capturedSupportedClaimCoverage:{numerator:disclosure.filter(supportedValid).length,denominator:disclosure.length},capturedOutcomes:rows.reduce((a,r)=>(a[r.status+':'+r.outcome]=(a[r.status+':'+r.outcome]??0)+1,a),{}),productionCoverage:map.coverage,limits:'Selected-source execution and supported-claim measures only; N/A rows do not support claims, external/dynamic/runtime edges remain unverified. Exact citations do not validate every no-issue conclusion; registered miss demonstrates that distinction.'},
 modelAttemptCount:attempts.length,modelAttemptOutcomes:attempts.reduce((a,e)=>(a[e.detail.outcome]=(a[e.detail.outcome]??0)+1,a),{}),modelIdentities:[...new Set(attempts.map(e=>e.detail.provider+'/'+e.detail.model))],batches:{planned:harness.events.find(e=>e.event==='review_batches_planned')?.detail.batchCount,saved:harness.events.filter(e=>e.event==='review_analysis_batch_saved').length},
 workflow:{status:session.status,modelStatus:session.modelStatus,progress:JSON.parse(session.progressJson),createdAt:session.createdAt,completedAt:session.completedAt,failureReason:session.failureReason,eligible:caseScore.eligible,reviewExecutionCompleted:true,benchmarkAcceptance:'NOT_ACCEPTED'},
 findingAdjudicationCoverage:{returnedFindingIds:findings.map(f=>f.id),adjudicatedFindingIds:[...new Set(claims.map(c=>c.findingId))],complete,findingGroups:[...new Set(claims.map(c=>c.claimKey))].map(key=>({claimKey:key,verdict:claims.find(c=>c.claimKey===key).verdict,findingIds:[...new Set(claims.filter(c=>c.claimKey===key).map(c=>c.findingId))]}))},
 goldCredit:{issueId:gold.review.goldIssueId,issueHits:0,occurrenceHits:0,matchedClaimKeys:[],eligible:caseScore.eligible,canonicalOccurrenceIds:['occurrence-1'],completedEligibleRecall:{numerator:0,denominator:1},fixedBenchmarkDenominators:{issues:5,occurrences:7}},
 deterministicSpanChecks,mapTopologyAndPlannedRangeReferences:{count:topology.length,validCount:topology.filter(r=>r.valid).length,checks:topology},
 syntheticTypeContractCheck:{passed:typeCheckPassed,compilerVersion:ts.version,noEmit:true,upstreamCodeExecuted:false,sample:typeSample,diagnostics:typeDiagnostics,control:'The method-based request call on sample line 4 has no diagnostic; callable default result and missing clear are rejected on lines 3/2.'},
 runtimeProvenance:{manifestPath:run+'/runtime-code-manifest.json',capturedAt:runtime.capturedAt,sha256:sha(fs.readFileSync(run+'/runtime-code-manifest.json')),snapshotChecks:runtimeChecks,allSnapshotHashesMatch:runtimeChecks.every(x=>x.snapshotMatches),trustedParser:{version:ts.version,source:'sidecar/node_modules/typescript/lib/typescript.js',usage:'AST parse only; Axios never executed'},reviewPolicy:JSON.parse(session.configJson).modelPolicyVersion,baseCommit:gold.baseCommit,benchmarkRevision:gold.benchmarkRevision,provenance:read(run+'/run-provenance.json')},
 evaluatorProvenance:{path:out+'/adjudicate-axios.mjs',sha256:sha(fs.readFileSync(out+'/adjudicate-axios.mjs')),referenceScope:'All new Review primary/related finding references plus all captured assessed feature/domain evidence. Readiness is adjudicated separately; its assertions are not graded by this Review helper.'},
 scorerContractCheck:{passed:true,axiosCase:caseScore,acceptance:scored.acceptance,scope:'Scorer invoked against saved run snapshot only; other cases may be pending/unadjudicated. Its aggregate is not this case precision and is not five-case certification.'},
 execution:'Trusted evaluator JavaScript, workspace parser and scorer only; no imported Axios execution, installs, tests, network/provider/app calls or production changes.',
 independence:'All new returned findings individually compared to frozen source and complete relevant selected callers/guards. No older adjudication JSON or helper was imported; previous helper viewed only for output schema.'};
fs.writeFileSync(out+'/review-axios-adjudication.json',JSON.stringify(adjudication,null,2)+'\n');
fs.writeFileSync(out+'/review-axios-verification.json',JSON.stringify(verification,null,2)+'\n');
console.log(JSON.stringify({findings:findings.length,claims:claims.length,model:verification.modelPrecision,deterministic:verification.deterministicPrecision,aggregate:verification.aggregatePrecision,references:verification.referenceValidity,invalidReferences:references.filter(r=>!r.valid),claimsValid:verification.claimEvidenceVerification.invalidCount===0,sourceFiles:sourceChecks.length,codeInspection:verification.coverage.selectedCodeInspection.numerator+'/'+codeFiles.length,domainDisclosure:verification.coverage.capturedDomainDisclosure,supported:verification.coverage.capturedSupportedClaimCoverage,eligible:caseScore.eligible,goldCredit:verification.goldCredit,runtimeHashes:verification.runtimeProvenance.allSnapshotHashesMatch},null,2));
