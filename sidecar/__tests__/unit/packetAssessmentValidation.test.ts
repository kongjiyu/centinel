import { describe, expect, it } from 'vitest';
import { deriveReviewAnalysisMap } from '../../src/review/featurePathAnalysis.js';
import { validateAssessmentResponse } from '../../src/review/assessmentValidation.js';
import type { Artifact } from '../../src/artifacts.js';

const artifact: Artifact = {id:'one',projectId:'project',versionId:'frozen',contentHash:'source-sha',filePath:'src/one.ts',fileName:'one.ts',type:'source_code',source:'repository',originalPath:null,createdAt:'2026-10-25T00:00:00Z'};
const content='export function one() {\n  return true;\n}\n';
const map=deriveReviewAnalysisMap([{artifact,content}]);
const response={findings:[],featureAssessments:map.features.map(feature=>({featureId:feature.id,assessments:['security','business','technical','personnel'].map(domain=>({domain,status:'assessed',outcome:'no_issue_identified',summary:'Inspected selected operation.',evidence:feature.entryPoints}))}))};
const full={artifact,content,lineStart:1,lineEnd:4};
describe('assessment evidence stays inside the actual packet',()=>{
  it('accepts exact supplied frozen references',()=>{
    expect(validateAssessmentResponse(response,map,{requireCompleteLocalDomains:true,sources:[full]}).status).toBe('assessed');
  });
  it('rejects prompt dictionary links returned instead of full evidence references',()=>{
    const linked = structuredClone(response);
    for (const feature of linked.featureAssessments) for (const assessment of feature.assessments) {
      assessment.evidence = [{ evidenceRef: 'r0' }] as never;
    }
    expect(()=>validateAssessmentResponse(linked,map,{requireCompleteLocalDomains:true,sources:[full]})).toThrow();
  });
  it('rejects an otherwise valid full-file reference when its line was omitted from this packet',()=>{
    expect(()=>validateAssessmentResponse(response,map,{sources:[{...full,content:'  return true;',lineStart:2,lineEnd:2}]})).toThrow();
  });
  it.each([{contentHash:'another-sha'},{filePath:'src/other.ts'},{id:'other-artifact'}])('rejects mismatched frozen identity %s',changed=>{
    expect(()=>validateAssessmentResponse(response,map,{sources:[{...full,artifact:{...artifact,...changed}}]})).toThrow();
  });
});
