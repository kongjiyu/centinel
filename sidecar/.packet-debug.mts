import fs from 'node:fs';
import { deriveReviewAnalysisMap } from './src/review/featurePathAnalysis.js';
import { selectEvidencePackets } from './src/review/evidencePacketSelection.js';
const manifest=JSON.parse(fs.readFileSync('../docs/PUBLIC_REPO_OUTCOME_EVALUATION_2026-10-22/manifest.json','utf8'));
const run=fs.readFileSync('../evidence/public-repo-outcomes-2026-10-22/active-mitigation-run.txt','utf8').trim();
for(const item of manifest.cases){
 const events=fs.readdirSync(run).filter(n=>n.endsWith('.json')).sort().map(n=>JSON.parse(fs.readFileSync(`${run}/${n}`,'utf8')));
 const artifacts=events.filter(e=>e.instanceId===item.instanceId&&e.kind==='imported-artifacts').at(-1)?.data;
 const sources=artifacts.map(artifact=>({artifact,content:fs.readFileSync(`${item.inputDirectory}/${artifact.filePath}`,'utf8'),state:'available'}));
 const map=deriveReviewAnalysisMap(sources); const byId=new Map(sources.map(s=>[s.artifact.id,s])); let bad=null;
 function packet(features){const plan=selectEvidencePackets(sources,features,undefined,{includeCallers:false});let sum=0;const rows=[];for(const [id,sel] of plan.byArtifactId){const source=byId.get(id);const lines=source.content.split('\n');let chars=0;for(const range of sel.ranges)chars+=lines.slice(range.lineStart-1,range.lineEnd).join('\n').length;sum+=chars;rows.push({path:source.artifact.filePath,chars,diag:sel.diagnostics,ranges:sel.ranges.length});}return{sum,rows};}
 function visit(group){const result=packet(group);if(result.sum>64000){if(group.length===1){bad={feature:group[0],packet:result};return true;}const middle=Math.ceil(group.length/2);return visit(group.slice(0,middle))||visit(group.slice(middle));}return false;}
 for(let i=0;i<map.features.length;i+=8){if(visit(map.features.slice(i,i+8)))break;}
 if(bad){console.log(JSON.stringify({alias:item.alias,features:map.features.length,feature:{id:bad.feature.id,label:bad.feature.label,entryPoints:bad.feature.entryPoints,paths:bad.feature.paths.map(p=>({label:p.label,evidence:p.evidence}))},sum:bad.packet.sum,rows:bad.packet.rows.sort((a,b)=>b.chars-a.chars).slice(0,20)},null,2));break;}
 console.log(`${item.alias} okay ${map.features.length}`);
}

