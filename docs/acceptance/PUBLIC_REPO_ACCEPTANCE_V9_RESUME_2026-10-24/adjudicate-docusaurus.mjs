import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import ts from '../../../sidecar/node_modules/typescript/lib/typescript.js';
import {precision, score} from '../PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22/score.mjs';
import {validateGoldMatches} from '../PUBLIC_REPO_ACCEPTANCE_V7_2026-10-23/score.mjs';

// Trusted evaluator. Upstream modules are read/parsed; never imported or executed.
// Byte/reference verification schema follows the Axios helper; judgments below are independent.
const out='docs/acceptance/PUBLIC_REPO_ACCEPTANCE_V9_RESUME_2026-10-24';
const run='evidence/public-repo-outcomes-2026-10-22/run-2026-10-24T15-46-37-089Z';
const frozen='docs/acceptance/PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22';
const source='evidence/public-repo-outcomes-2026-10-22/assessed-inputs/docusaurus';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const load=n=>read(run+'/'+n+'.json').data;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const gitSha=b=>crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex');
const norm=s=>s.replaceAll('\r\n','\n');
const gold=read(frozen+'/manifest.json').cases.find(x=>x.alias==='docusaurus');
const inputs=read(frozen+'/input-files.json').filter(x=>x.alias==='docusaurus'&&x.expectedImported);
const texts=new Map(inputs.map(x=>[x.relativePath,norm(fs.readFileSync(source+'/'+x.relativePath,'utf8'))]));
const findings=load('0088-review-findings'),session=load('0087-review-session'),manifest=load('0089-review-manifest');
const harness=load('0092-review-harness'),imported=load('0006-imported-artifacts');
const u=name=>'packages/docusaurus-utils/src/'+name+'.ts';
const ev=(file,start,end=start)=>({filePath:file,lineNumber:start,excerpt:texts.get(file).split('\n').slice(start-1,end).join('\n')});
const claims=[];
function add(i,key,verdict,claim,reason,ranges) {
 const f=findings[i];
 claims.push({instanceId:gold.instanceId,findingId:f.id,origin:f.verifier,claimKey:'docusaurus:'+key,verdict,claim,reason,sourceEvidence:ranges.map(x=>ev(...x))});
}
add(0,'unpinned-install-tool','true','The selected postinstall chain invokes an unversioned npx package absent from the selected root manifest dependencies.',
 'postinstall runs yarn lock:update, whose command is npx --yes yarn-deduplicate. The complete devDependencies contains no yarn-deduplicate pin. This is a concrete installation reproducibility weakness: the command does not bind a package version. Actual cache/registry resolution, CI execution and compromise are separate unresolved consequences; no installation was performed.',
 [['package.json',47,48],['package.json',65,65],['package.json',68,119]]);
add(0,'install-registry-compromise','unknown','A real installation retrieves mutable registry code or is exposed to package compromise.',
 'Selected package scripts do not establish installed npx version, workspace cache, lockfiles, network settings, lifecycle enablement or CI behavior. Conditional unpinned invocation is supported, while an actual registry download, compromise or installation impact requires environment evidence.',
 [['package.json',47,48],['package.json',65,65]]);
for(const i of [1,17]) add(i,'credential-url-downstream-disclosure','unknown','The credential-bearing URL causes an unintended secret disclosure through downstream handling.',
 'Both branches intentionally construct an authenticated Git push URL from a parameter named gitCredentials. The representation visibly contains that value, but no selected caller logs/displays/persists the result and no redaction contract is supplied. Intentional authentication data flow alone does not establish an unintended disclosure defect. The finding itself acknowledges the missing downstream behavior; retain its security consequence as Unknown rather than credit a mere representation observation.',
 [[u('urlUtils'),264,276],[u('index'),54,59]]);
add(2,'extension-case-inconsistency','true','fileToPath normalizes index extensions case-insensitively and ordinary extensions case-sensitively.',
 'The exported helper directly accepts string input. With index.MD the first case-insensitive branch returns /; with foo.MD the second expression retains .MD, while foo.md loses it. This establishes inconsistent normalization in the helper, not that the omitted content-sourcing plugins accept uppercase extensions.',
 [[u('urlUtils'),124,136],[u('index'),44,49]]);
add(2,'uppercase-content-supported-runtime','unknown','Uppercase content filenames are supported by omitted content plugins and produce broken deployed URLs.',
 'No selected caller invokes fileToPath, and globUtils default ignore patterns do not define the content inclusion policy. The helper inconsistency is verified separately; end-to-end support for uppercase filename variants and deployed URL effects remain unverified.',
 [[u('urlUtils'),124,136],[u('globUtils'),16,27]]);
for(const i of [3,16]) add(i,'raw-prototype-key-grouping','true','groupTaggedItems can throw when its callback directly supplies a raw inherited object key.',
 'The callback returns Tag[] without any helper-local normalization. result={} inherits __proto__/constructor; ??= does not replace a non-null inherited value, and .items.push then reads missing items. This proves conditional raw exported-helper failure for a direct callback returning such a key, not global prototype pollution or a normal front-matter build exploit.',
 [[u('tags'),99,121],[u('index'),64,68]]);
add(16,'normalized-frontmatter-prototype-key-build','unknown','Crafted front matter can pass a raw __proto__ permalink into grouping and abort a site build.',
 'Concrete selected counter-evidence: normalizeFrontMatterTag always prepends tagsPath through normalizeUrl. With a conventional /tags base, a supplied __proto__ permalink becomes /tags/__proto__, which is an ordinary own-key candidate and does not collide with Object.prototype. No selected build caller establishes a missing normalization, unusual empty base or raw callback path from front matter; the helper-level conditional failure is distinct and credited once.',
 [[u('tags'),34,61],[u('tags'),64,83],[u('tags'),99,121],[u('urlUtils'),68,106]]);
add(4,'utf8-byte-boundary-truncation','true','The non-Windows/non-macOS shortName branch can split a UTF-8 code point.',
 'The slice end simplifies to 244 bytes irrespective of the original length. A string of 243 ASCII characters followed by a multibyte character leaves an incomplete sequence at that offset; Buffer UTF-8 decoding substitutes a replacement character. This is an exported-helper conditional correctness fact. Windows/macOS take the character-slice branch. The only selected caller passes kebabCase output, which narrows ordinary reachability; no actual generated filename corruption is asserted.',
 [[u('pathUtils'),10,46],[u('hashUtils'),28,37],[u('index'),88,94]]);
for(const i of [5,12]) add(i,'heading-code-fence-state','true','Heading-ID rewriting can alter a heading inside a longer backtick code fence.',
 'The function toggles one boolean for any line starting with three backticks. An opening four-backtick line enters code state; an inner three-backtick line incorrectly exits it. A following ## heading without a pre-existing ID reaches addHeadingId. This is writeMarkdownHeadingId, a different operation from the intentional three/four escape-fence scope of unwrapMdxCodeBlocks; it earns no CRLF gold credit.',
 [[u('markdownUtils'),418,461],[u('markdownUtils'),70,84]]);
add(12,'heading-tilde-fence-state','true','Heading-ID rewriting also alters headings inside tilde fences.',
 'The only state transition checks startsWith three backticks. A tilde fence never enters code state; its ## heading without an ID is processed as document text. This and longer-backtick handling share one inadequate delimiter-state root cause, so the precision key is common across both manifestations.',
 [[u('markdownUtils'),442,461]]);
// Same insufficient delimiter-state cause, so tilde and nested-backtick manifestations deduplicate.
claims.at(-1).claimKey='docusaurus:heading-code-fence-state';
for(const i of [6,14]) add(i,'directive-regexp-metacharacters','true','Caller-supplied directive names can change regex meaning or cause construction failure.',
 'The exported helper accepts string[] and joins entries into a capture group without escaping or validation. A direct entry [ yields an unterminated character class in new RegExp; alternation entries change the named directives matched. There is no selected caller establishing remotely controlled settings. This is conditional helper behavior only, with no credited security exploit or catastrophic-backtracking allegation.',
 [[u('markdownUtils'),86,114],[u('index'),70,76]]);
for(const i of [7,8,13]) add(i,'malformed-markdown-link-uri','true','Malformed percent encoding in a processed relative .md target throws instead of returning a broken-link record.',
 'A non-fenced line [link](%ZZ.md) passes the link capture and lowercase .md filter. Its unprefixed target causes content paths and siteDir to populate sourcesToTry. The first map invokes decodeURIComponent before any lookup and throws URIError; the synchronous function has no catch. Broken links are otherwise retained and returned. Existing code-fence/HTTP/@site guards narrow this trigger. This proves the local document operation abort, not a remote service outage.',
 [[u('markdownLinks'),61,70],[u('markdownLinks'),88,126],[u('markdownLinks'),129,161],[u('markdownLinks'),181,198]]);
for(const i of [9,26]) add(i,'data-file-parent-path','true','A relative parent path can escape the selected content directory in getDataFilePath and reach its reader.',
 'A relative ../outside.yml value is admitted by the string contract. findFolderContainingFile tests the joined parent path; if it exists, getDataFilePath resolves the same relative value outside the content root. getDataFileData reads the result before YAML validation. The catch logs and rethrows; validation is after the read and is not a containment guard. The defect is conditional helper containment, not a proven application authorization bypass.',
 [[u('dataFileUtils'),15,42],[u('dataFileUtils'),52,70],[u('dataFileUtils'),82,95]]);
add(9,'data-file-untrusted-read','unknown','An untrusted application actor can read an unauthorized YAML file through this utility.',
 'Only the exported utilities and internal getDataFileData-to-getDataFilePath chain are selected. No application caller binds a user-controlled relative path, trust boundary or filesystem permission. A normal trusted build configuration may intentionally address sibling data. Preserve the conditional path fact separately from the unresolved security consequence.',
 [[u('dataFileUtils'),15,42],[u('dataFileUtils'),52,70],[u('index'),109,118]]);
for(const i of [10,22]) add(i,'short-hash-name-collision','true','The three-hex suffix cannot guarantee uniqueness for inputs sharing the normalized filename.',
 'simpleHash truncates MD5 to three hex characters, so there are 4096 suffix values. docuHash combines this with kebabCase, not the original string, and may further truncate the name. More than 4096 distinct punctuation/separator variants mapping to the same normalized name must collide. This refutes the unqualified avoiding-name-collision comment as a guarantee; it does not establish observed asset overwrite. The selected webpack asset naming uses contenthash, so that distinct pipeline must not be accused of this collision.',
 [[u('hashUtils'),12,37],[u('webpackUtils'),63,82]]);
for(const i of [10,22]) add(i,'short-hash-asset-overwrite','unknown','A docuHash collision overwrites or aliases generated assets in an actual supplied application.',
 'No selected call site invokes docuHash. Its theoretical noninjectivity is supported, but a concrete consumer, colliding accepted inputs, collision handling and a file-write consequence are missing. getFileLoaderUtils instead uses [name]-[contenthash].[ext], which is counter-evidence to extrapolating this helper into that selected asset path.',
 [[u('hashUtils'),22,37],[u('webpackUtils'),63,82]]);
add(11,'site-alias-outside-resolution','unknown','aliasedSitePath permits an unauthorized file read through webpack.',
 'The function intentionally retains ../ and explicitly delegates resolution to webpack. It only returns a string and performs no read. Its selected caller in markdownLinks maps source candidates to aliases and looks them up in the supplied sourceToPermalink map; it does not pass arbitrary aliases into a loader. Outside resolution/trust permissions depend on an omitted consumer. An @site/../ string is demonstrable but is not itself a demonstrated security defect.',
 [[u('pathUtils'),83,93],[u('markdownLinks'),148,165]]);
add(15,'tag-duplicate-loss-contract','false','Discarding colliding tag permalinks violates the selected normalization contract.',
 'The complete comment explicitly promises unique-by-permalink results and declares collision behavior undetermined. uniqBy implements that promise. groupTaggedItems also says routes must be unique and intentionally merges labels such as some label/some-label. Keeping the first entry is consistent with this contract; no requirement to reject, retain all labels or warn is supplied. A policy improvement can be considered, but the alleged unexpected data-loss defect is not established.',
 [[u('tags'),64,83],[u('tags'),91,98],[u('tags'),110,128]]);
for(const i of [18,23]) {
 add(i,'git-shell-filename-interpolation','true','The exported Git-date helper embeds an existing filename in a shell command without escaping shell syntax.',
  'The existence check verifies only -f. path.basename removes directories but retains shell-significant characters permitted by a POSIX filesystem. The command string is double quoted; that does not escape a contained quote or command substitution on shells that interpret them. args is assembled from fixed options and an enum comparison, so it is not the alleged arbitrary string entry. This proves a conditional unsafe shell-command construction; no command was executed.',
  [[u('gitUtils'),75,124],[u('index'),26,31]]);
 add(i,'git-shell-application-execution','unknown','An application attacker can execute commands through getFileCommitDate in a supported deployment.',
  'The selected sample does not contain ShellJS implementation, actual shell/platform configuration, application callers or the origin of existing filenames. A POSIX shell-sensitive name is a supported conditional risk, but external control, whether a build processes such a file and actual privileges remain unverified. Windows filename restrictions and shell semantics differ. No runtime reproduction was authorized.',
  [[u('gitUtils'),89,124],[u('index'),26,31]]);
}
for(const i of [19,24]) add(i,'output-html-parent-read','true','Parent-directory segments in a permalink can produce an HTML candidate outside outDir.',
 'path.join normalizes ../ segments, and no containment check follows. With trailingSlash=false and ../outside.html, the second candidate is outside outDir and retains its html extension; if it exists, findAsyncSequential selects it and fs.readFile returns its bytes. The existing-file predicate and trailingSlash choice are necessary conditions, not containment safeguards. Remote actor control is scored separately.',
 [[u('emitUtils'),65,100],[u('jsUtils'),1,70]]);
add(19,'output-html-absolute-join-reset','false','An absolute permalink by itself resets path.join and discards outDir.',
 'Node path.join concatenates and normalizes segments; unlike path.resolve, a later rooted segment does not reset the already joined prefix. For the POSIX example outDir=/site/build and permalink=/secret, the result is /site/build/secret/index.html, not /secret/index.html. The ../ traversal mechanism is real and separately credited; absolute syntax alone is the wrong cause.',
 [[u('emitUtils'),76,85]]);
for(const i of [19,24]) add(i,'output-html-untrusted-read','unknown','An untrusted actor can exploit readOutputHTMLFile to read outside the authorized site output.',
 'No selected application caller or security containment requirement establishes untrusted permalink control. The bytes are returned to the caller rather than automatically transmitted. Relative path escape at the helper is concrete; authorization bypass or data disclosure at application level remains unverified.',
 [[u('emitUtils'),65,100],[u('index'),26,26]]);
for(const i of [20,25]) {
 add(i,'generated-file-parent-write','true','generate can write outside generatedFilesDir for an absolute or parent-relative file value.',
  'The documented file parameter is relative to the directory, but no runtime containment check exists. path.resolve honors absolute values and ../; skipCache=true reaches outputFile directly. With cache enabled the changed-content branch also writes. This proves conditional helper write behavior; it does not prove untrusted application control.',
  [[u('emitUtils'),15,43],[u('emitUtils'),46,62]]);
 add(i,'generated-file-untrusted-write','unknown','An attacker can control generate file paths and overwrite unauthorized application files.',
  'No selected caller invokes generate with input from an untrusted actor. Output permissions and sandbox boundaries are not supplied. Relative path contracts are often trusted build API contracts; the conditional helper escape alone cannot establish remote exploitability or actual unauthorized overwrite.',
  [[u('emitUtils'),15,35],[u('index'),26,26]]);
}
for(const i of [21,28]) {
 add(i,'port-incomplete-validation','true','DEFAULT_PORT can contain NaN, a partial integer parse, or an out-of-range integer.',
  'The nonempty environment string is passed directly to parseInt. abc becomes NaN, 3000x becomes 3000, and 70000 stays out of the ordinary TCP port range. The value is exported without further checks in constants. No selected server consumer establishes the eventual startup behavior.',
  [[u('constants'),85,88],[u('index'),14,24]]);
 add(i,'port-deployment-failure','unknown','Malformed PORT causes a supported Docusaurus startup failure or incorrect deployed behavior.',
  'No selected consumer uses DEFAULT_PORT other than re-export. An omitted caller may validate, choose a free port, handle NaN or provide a diagnostic. The unchecked value fact is supported; a concrete startup failure and quality of its diagnostic require omitted caller/runtime evidence.',
  [[u('constants'),85,88],[u('index'),14,24]]);
}
add(21,'port-zero-unusable','false','Port zero is intrinsically an unusable TCP server port.',
 'Zero is the standard server request for an OS-assigned ephemeral port; it is not intrinsically unusable. The supplied comment does not prohibit that mode, and no selected server API rejects zero. abc and 70000 are distinct invalid-value cases and do not justify bundling zero with them.',
 [[u('constants'),85,88]]);
add(27,'loader-limit-type-surface','true','The URL-loader limit environment override remains a string while its fallback is numeric.',
 'Nullish coalescing preserves empty/nonnumeric/negative text. getFileLoaderUtils forwards it directly as url-loader options.limit and also interpolates it into an inline loader query. This confirms an inconsistent unvalidated value surface; it does not establish dependency rejection, coercion, incorrect asset size behavior or startup failure.',
 [[u('constants'),93,100],[u('webpackUtils'),58,82],[u('webpackUtils'),89,95]]);
add(27,'loader-limit-runtime-impact','unknown','String or malformed loader limits cause a concrete URL-loader behavior regression.',
 'The selected webpack wrapper is present, so forwarding is verified, but url-loader/file-loader implementations and validation/coercion contracts are outside the selection. String query values may be intentionally supported. No authorized dependency/runtime reproduction establishes a failure or asset-inlining consequence.',
 [[u('constants'),93,100],[u('webpackUtils'),77,95]]);

const deterministicSpanChecks=[];
for(let i=29;i<findings.length;i++) {
 const f=findings[i],file=f.filePath;
 if(!f.description.startsWith('Function ')) {
  add(i,'deterministic-note:'+file+':'+f.lineNumber,'true','The reported TODO maintenance note exists at the cited location.',
   'The exact comment is present. This is a factual maintenance observation, not independent proof of a behavioral defect, exploitable security issue or violated mandatory project policy.',[[file,f.lineNumber,f.lineNumber]]);
  continue;
 }
 const ast=ts.createSourceFile(file,texts.get(file),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),spans=[];
 const visit=n=>{if(ts.isFunctionLike(n)&&n.body){const start=ast.getLineAndCharacterOfPosition(n.getStart(ast)).line+1,end=ast.getLineAndCharacterOfPosition(n.end).line+1;spans.push({start,end,physicalLength:end-start+1,name:n.name?.getText(ast)??null});}ts.forEachChild(n,visit);};visit(ast);
 const span=spans.find(s=>s.start===f.lineNumber),length=Number(f.description.match(/is (\d+) lines/)?.[1]);
 if(span?.physicalLength!==length)throw Error('Incorrect deterministic length');
 deterministicSpanChecks.push({findingId:f.id,filePath:file,reportedLength:length,ast:span,valid:true});
 add(i,'deterministic-length:'+file+':'+span.start,'true',span.name+' spans '+length+' physical source lines.',
  'Trusted TypeScript AST confirms the exact physical span. This supports the reported maintainability measurement; the count alone does not demonstrate a behavioral defect or mandate splitting.',[[file,span.start,span.end]]);
}
const goldMisses=[{issueId:gold.review.goldIssueId,canonicalOccurrenceIds:['occurrence-1'],creditedIssueHits:0,creditedOccurrenceHits:0,
 reason:'None of the 29 model findings identifies unwrapMdxCodeBlocks, its bare-LF extraction assumption or retained CRLF escape fences. The heading-ID fence-state and directive-regex findings concern different operations and mechanisms. A deterministic TODO at markdownUtils65 is not a CRLF prediction. The registered defect remains in regexp3/regexp4: CRLF after mdx-code-block prevents the required immediate LF, leaving embedded MDX escaped instead of unwrapped. LF three/four-backtick forms are supported intentionally; arbitrary fence-length support is not required. Missing TabItem compilation is registered gold context, not independently reproduced runtime evidence.',
 sourceEvidence:[ev(u('markdownUtils'),61,84)]}];
const adjudication={schemaVersion:'public-repo-review-independent-adjudication-v1',instanceId:gold.instanceId,reviewId:session.id,runDirectory:run,
 policyVersion:JSON.parse(session.configJson).modelPolicyVersion,workflowStatus:session.status,modelStatus:session.modelStatus,
 workflowAcceptance:'NOT_ACCEPTED',claims,goldMatches:[],goldMisses,
 limitations:['Independent adjudication of this successful new Review; Axios supplied verification/output structure only, never Docusaurus judgments.',
 'Unknowns retain missing dependency, caller, normalization, runtime and application trust evidence. Conditional helper facts do not establish deployed vulnerabilities.',
 'No upstream code/dependencies/tests were executed or installed. No network, provider, app, approval, retry, fallback or production mutations occurred.',
 'One execution-eligible case cannot establish acceptance of the fixed five-project/seven-occurrence benchmark. Source inspection and bounded graph disclosure do not prove whole-program correctness or security.'],
 mitigationSuggestions:[
 {claimKeys:['docusaurus:normalized-frontmatter-prototype-key-build','docusaurus:site-alias-outside-resolution'],status:'proposed-not-implemented',action:'Require selected caller argument provenance and complete upstream normalization/guard evidence before elevating a raw helper condition into a build or security consequence. Preserve a separate conditional helper claim and explicit unresolved application path.'},
 {claimKeys:['docusaurus:tag-duplicate-loss-contract','docusaurus:output-html-absolute-join-reset','docusaurus:port-zero-unusable'],status:'proposed-not-implemented',action:'Use generic counter-evidence checks for documented deduplication, operation-specific path semantics and valid boundary modes. Do not treat an intentional documented contract or ordinary observation as a violated requirement.'},
 {claimKeys:['docusaurus:credential-url-downstream-disclosure','docusaurus:git-shell-application-execution','docusaurus:loader-limit-runtime-impact','docusaurus:port-deployment-failure'],status:'proposed-not-implemented',action:'Keep dependency/runtime/trust effects unverified until supplied evidence identifies an actual caller, accepted input contract, relevant capability and sink. Exact quotes cannot establish these missing causal links.'},
 {claimKeys:[],status:'proposed-not-implemented',action:'Investigate generic line-ending boundary and nearby-operation contract comparison coverage using independent fixtures. The validated source sweep inspected the gold file but missed a different selected operation. Keep this registered gold mechanism and benchmark answers out of production prompts and app inputs.'}]};

const frozenBundleChecks=read(frozen+'/FREEZE.json').files.map(x=>({path:x.path,sha256:sha(fs.readFileSync(frozen+'/'+x.path)),valid:sha(fs.readFileSync(frozen+'/'+x.path))===x.sha256}));
const sourceChecks=inputs.map(x=>{const bytes=fs.readFileSync(source+'/'+x.relativePath),hash=sha(bytes),a=manifest.artifacts.find(a=>a.filePath===x.relativePath),imp=imported.find(a=>a.filePath===x.relativePath);return {filePath:x.relativePath,bytes:bytes.length,sha256:hash,gitBlobSha:gitSha(bytes),gitBlobMatches:gitSha(bytes)===x.gitBlobSha,frozenHashMatches:hash===x.sha256,frozenLengthMatches:bytes.length===x.bytes,manifestMatches:a?.contentHash===hash,importedMatches:imp?.contentHash.replace(/^sha256:/,'')===hash&&imp?.versionId===a?.artifactVersionId,artifactId:a?.id,artifactVersionId:a?.artifactVersionId};});
const originalDirectory='evidence/public-repo-outcomes-2026-10-22/inputs/'+gold.instanceId;
const originalStagedChecks=read(frozen+'/input-files.json').filter(x=>x.alias==='docusaurus').map(x=>{const b=fs.readFileSync(originalDirectory+'/'+x.relativePath);return {filePath:x.relativePath,bytes:b.length,sha256:sha(b),gitBlobSha:gitSha(b),valid:b.length===x.bytes&&sha(b)===x.sha256&&gitSha(b)===x.gitBlobSha,imported:x.expectedImported};});
if(originalStagedChecks.some(x=>!x.valid))throw Error('Original staged byte/Git blob mismatch');
if(frozenBundleChecks.some(x=>!x.valid)||sourceChecks.some(x=>!x.gitBlobMatches||!x.frozenHashMatches||!x.frozenLengthMatches||!x.manifestMatches||!x.importedMatches)||manifest.artifacts.length!==inputs.length||imported.length!==inputs.length)throw Error('Frozen/import provenance mismatch');
function check(ref,kind,extra={}) {
 const file=ref.filePath??ref.path;
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
const attempts=harness.events.filter(e=>e.event==='model_attempt');
const sourceArtifacts=['0087-review-session','0088-review-findings','0089-review-manifest','0090-review-traceability','0091-review-evidence','0092-review-harness','0006-imported-artifacts','0086-readiness-collected','runtime-code-manifest','run-provenance','pre-run-verification','gold-freeze'].map(n=>({path:run+'/'+n+'.json',sha256:sha(fs.readFileSync(run+'/'+n+'.json'))}));
const complete=findings.every(f=>claims.some(c=>c.findingId===f.id));
if(!complete||claims.some(c=>!findings.some(f=>f.id===c.findingId&&f.verifier===c.origin)))throw Error('Finding coverage/origin mismatch');
validateGoldMatches(adjudication.goldMatches,claims);
const scored=score(run,adjudication),caseScore=scored.cases.find(x=>x.instanceId===gold.instanceId);
const canonical=gold.review.goldOccurrenceCount===1?['occurrence-1']:gold.review.affectedFiles;
if(JSON.stringify(canonical)!==JSON.stringify(goldMisses[0].canonicalOccurrenceIds))throw Error('Canonical gold mismatch');
const semanticsControls={upstreamExecuted:false,description:'Trusted Node built-ins establish generic path/byte semantics only; no frozen helper invoked.',
 posixAbsoluteJoin:{actual:path.posix.join('/site/build','/secret','index.html'),expected:'/site/build/secret/index.html'},
 posixParentJoin:{actual:path.posix.join('/site/build','../outside.html'),expected:'/site/outside.html'},
 winAbsoluteJoin:{actual:path.win32.join('C:\\site\\build','\\secret','index.html'),expected:'C:\\site\\build\\secret\\index.html'},
 posixAbsoluteResolve:{actual:path.posix.resolve('/site/build','/secret'),expected:'/secret'},
 utf8PartialDecode:{actual:Buffer.from('a'.repeat(243)+'€').subarray(0,244).toString(),expected:'a'.repeat(243)+'�'},
 integerParsing:{abc:Number.isNaN(Number.parseInt('abc',10)),partial:Number.parseInt('3000x',10),zero:Number.parseInt('0',10)}};
if(['posixAbsoluteJoin','posixParentJoin','winAbsoluteJoin','posixAbsoluteResolve','utf8PartialDecode'].some(k=>semanticsControls[k].actual!==semanticsControls[k].expected))throw Error('Unexpected trusted semantic control');
const verification={schemaVersion:'public-repo-review-independent-verification-v1',instanceId:gold.instanceId,reviewId:session.id,runDirectory:run,
 sourceArtifacts,frozenBundleChecks,sourceChecks,sourceFileCount:sourceChecks.length,sourceByteCount:sourceChecks.reduce((n,x)=>n+x.bytes,0),originalStagedChecks,
 retainedFindingCount:findings.length,originFindingCounts:{model:findings.filter(f=>f.verifier==='model').length,deterministic:findings.filter(f=>f.verifier==='deterministic').length},atomicClaimRowCount:claims.length,
 modelPrecision:precision(claims.filter(c=>c.origin==='model')),deterministicPrecision:precision(claims.filter(c=>c.origin==='deterministic')),aggregatePrecision:precision(claims),
 referenceCount:references.length,referenceValidity:{numerator:references.filter(r=>r.valid).length,denominator:references.length,value:references.filter(r=>r.valid).length/references.length},referenceChecks:references,
 claimEvidenceVerification:{referenceCount:claimChecks.length+goldChecks.length,invalidCount:[...claimChecks,...goldChecks].filter(r=>!r.valid).length,checks:[...claimChecks,...goldChecks]},
 coverage:{capturedMapStatus:map.status,final:true,selectedCodeInspection:{numerator:inspectedFiles.length,denominator:codeFiles.length,files:inspectedFiles},goldAffectedFilesInspected:gold.review.affectedFiles.every(p=>inspectedFiles.includes(p)),preProviderInferredFeatureCount:pre.features.length,capturedInferredFeatureCount:map.features.length,featureIdentityPreserved:map.features.length===pre.features.length&&map.features.every(f=>preIds.has(f.id)),capturedDomainPairCount:pre.features.length*4,capturedDomainDisclosure:{numerator:disclosure.filter(disclosureValid).length,denominator:disclosure.length},capturedSupportedClaimCoverage:{numerator:disclosure.filter(supportedValid).length,denominator:disclosure.length},capturedOutcomes:rows.reduce((a,r)=>(a[r.status+':'+r.outcome]=(a[r.status+':'+r.outcome]??0)+1,a),{}),productionCoverage:map.coverage,limits:'Selected-source execution and bounded graph disclosure only; N/A does not support a claim. Exact evidence and final status do not validate all no-issue conclusions; the registered gold miss is retained.'},
 modelAttemptCount:attempts.length,modelAttemptOutcomes:attempts.reduce((a,e)=>(a[e.detail.outcome]=(a[e.detail.outcome]??0)+1,a),{}),modelIdentities:[...new Set(attempts.map(e=>e.detail.provider+'/'+e.detail.model))],batches:{planned:harness.events.find(e=>e.event==='review_batches_planned')?.detail.batchCount,saved:harness.events.filter(e=>e.event==='review_analysis_batch_saved').length},
 workflow:{status:session.status,modelStatus:session.modelStatus,progress:JSON.parse(session.progressJson),createdAt:session.createdAt,completedAt:session.completedAt,failureReason:session.failureReason,eligible:caseScore.eligible,reviewExecutionCompleted:true,benchmarkAcceptance:'NOT_ACCEPTED'},
 findingAdjudicationCoverage:{returnedFindingIds:findings.map(f=>f.id),adjudicatedFindingIds:[...new Set(claims.map(c=>c.findingId))],complete,findingGroups:[...new Set(claims.map(c=>c.claimKey))].map(key=>({claimKey:key,verdict:claims.find(c=>c.claimKey===key).verdict,findingIds:[...new Set(claims.filter(c=>c.claimKey===key).map(c=>c.findingId))]}))},
 goldCredit:{issueId:gold.review.goldIssueId,issueHits:0,occurrenceHits:0,matchedClaimKeys:[],eligible:caseScore.eligible,canonicalOccurrenceIds:canonical,completedEligibleRecall:{numerator:0,denominator:1},fixedBenchmarkDenominators:{issues:5,occurrences:7}},
 deterministicSpanChecks,semanticsControls,mapTopologyAndPlannedRangeReferences:{count:topology.length,validCount:topology.filter(r=>r.valid).length,checks:topology},
 runtimeProvenance:{manifestPath:run+'/runtime-code-manifest.json',capturedAt:runtime.capturedAt,sha256:sha(fs.readFileSync(run+'/runtime-code-manifest.json')),snapshotChecks:runtimeChecks,allSnapshotHashesMatch:runtimeChecks.every(x=>x.snapshotMatches),trustedParser:{version:ts.version,source:'sidecar/node_modules/typescript/lib/typescript.js',usage:'AST parse only; upstream Docusaurus code/dependencies never executed'},reviewPolicy:JSON.parse(session.configJson).modelPolicyVersion,baseCommit:gold.baseCommit,benchmarkRevision:gold.benchmarkRevision,observedProviderModel:[...new Set(attempts.map(e=>e.detail.provider+'/'+e.detail.model))],provenance:read(run+'/run-provenance.json')},
 evaluatorProvenance:{path:out+'/adjudicate-docusaurus.mjs',sha256:sha(fs.readFileSync(out+'/adjudicate-docusaurus.mjs')),referenceScope:'All new Review primary/related finding references plus every captured assessed feature/domain evidence citation; Readiness adjudicated separately.'},
 scorerContractCheck:{passed:true,docusaurusCase:caseScore,acceptance:scored.acceptance,scope:'Saved snapshot scorer is trusted evaluator code; aggregate includes pending/unadjudicated cases and is not five-case certification.'},
 execution:'Trusted evaluator JavaScript, Node built-ins, workspace TypeScript parser and trusted scorers only. No imported upstream execution, installs, tests, network/provider/app calls or production changes.',
 independence:'All 43 new returned findings individually checked against frozen source and relevant selected callers/guards/contracts. No prior Docusaurus judgments loaded; Axios helper supplied output schema and generic byte/reference verification plumbing only.'};
fs.writeFileSync(out+'/review-docusaurus-adjudication.json',JSON.stringify(adjudication,null,2)+'\n');
fs.writeFileSync(out+'/review-docusaurus-verification.json',JSON.stringify(verification,null,2)+'\n');
console.log(JSON.stringify({findings:findings.length,claims:claims.length,model:verification.modelPrecision,deterministic:verification.deterministicPrecision,aggregate:verification.aggregatePrecision,references:verification.referenceValidity,invalidReferences:references.filter(r=>!r.valid),claimsValid:verification.claimEvidenceVerification.invalidCount===0,sourceFiles:sourceChecks.length,codeInspection:verification.coverage.selectedCodeInspection.numerator+'/'+codeFiles.length,domainDisclosure:verification.coverage.capturedDomainDisclosure,supported:verification.coverage.capturedSupportedClaimCoverage,eligible:caseScore.eligible,goldCredit:verification.goldCredit,runtimeHashes:verification.runtimeProvenance.allSnapshotHashesMatch,modelIdentities:verification.modelIdentities,batches:verification.batches,attempts:verification.modelAttemptOutcomes},null,2));
