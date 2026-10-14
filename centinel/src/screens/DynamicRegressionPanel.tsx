import type {DynamicRun} from '../dynamic/types';
import {compareRegression} from '../../../sidecar/src/dynamic/regression';
const labels={passed:'Passed',failed:'Failed',uncertain:'Uncertain',not_tested:'Not tested'};
export function DynamicRegressionPanel({run}:{run:DynamicRun}){
 const comparison=compareRegression(run);if(!comparison||!run.regression)return null;
 return <section className="dw-regression" aria-labelledby="dw-regression-title"><h3 id="dw-regression-title">Pinned regression comparison</h3><p>Baseline {run.regression.runId} · original revision {run.regression.revisionId}</p><p className="dw-muted">The baseline and its evidence remain available. A later pass does not resolve a finding automatically.</p>
 {comparison.conditionChanges.length>0?<div className="dw-notice"><strong>Recorded conditions differ</strong><ul>{comparison.conditionChanges.map((change,index)=><li key={index}>{change}</li>)}</ul></div>:<p className="dw-muted">Recorded configuration matches. Private state and actual target contents are not compared.</p>}
 <div className="dw-table-scroll"><table><caption>Pinned check observations</caption><thead><tr><th>Check</th><th>Baseline</th><th>This Run</th></tr></thead><tbody>{comparison.checks.map(check=><tr key={check.checkId}><th scope="row">{check.description}</th><td>{labels[check.before]}</td><td>{labels[check.after]}</td></tr>)}</tbody></table></div><details className="dw-advanced"><summary>Comparison limits</summary><ul>{comparison.limitations.map((item,index)=><li key={index}>{item}</li>)}</ul></details>
 </section>;
}
