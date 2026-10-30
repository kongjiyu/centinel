import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {scorePolicyRun} from '../PUBLIC_REPO_ACCEPTANCE_V7_2026-10-23/score.mjs';
export const scoreBatchDomainRun=(runDirectory,adjudication)=>scorePolicyRun(runDirectory,adjudication,'review-2026-10-24-batch-domain-coverage-v9');
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.argv[2]||!process.argv[3])throw Error('Provide actual run directory and independent adjudication');
 console.log(JSON.stringify(scoreBatchDomainRun(process.argv[2],JSON.parse(fs.readFileSync(process.argv[3],'utf8'))),null,2));
}
