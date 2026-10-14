import type {DynamicRun} from '../dynamic/types';
const labels={passed:'Passed',failed:'Failed',uncertain:'Uncertain',not_tested:'Not tested'};
export function DynamicExplorationPanel({run}:{run:DynamicRun}){
 if(run.revision.mode!=='exploratory'&&!run.exploration)return null;
 const scope=run.exploration;
 return <section className="dw-exploration" aria-labelledby="dw-exploration-title"><h3 id="dw-exploration-title">Recorded exploratory scope</h3>{!scope?<p className="dw-muted">Exploratory scope has not been recorded. This does not establish visits or coverage.</p>:<>
  <p>{scope.states.length} sampled states · {scope.actions.length} recorded actions</p>
  <p className="dw-muted">{scope.unvisitedControls.length} state/control pairs have no confirmed interaction; {scope.unresolvedControls.length} have an uncertain interaction. This is sampled scope, not complete website coverage.</p>
  {scope.truncated&&<p className="dw-notice" role="status">Scope recording reached its retention limit. Additional visits or actions may be missing.</p>}
  <div className="dw-table-scroll"><table><caption>Selected exploration objectives</caption><thead><tr><th>Objective</th><th>Independent result</th></tr></thead><tbody>{scope.objectives.map(objective=><tr key={objective.criterionId}><th scope="row">{run.revision.checks.find(check=>check.criterionId===objective.criterionId)?.description??objective.criterionId}</th><td>{labels[objective.verdict]}</td></tr>)}</tbody></table></div>
  <details className="dw-advanced"><summary>Sampled states and remaining scope</summary><ul>{scope.states.map(state=><li key={state.id}><strong>{state.title||'Untitled observed page'}</strong> · {state.url}<small> · Observed {state.visits} times · {state.controls.length} sampled controls{state.omittedControls?' · More controls omitted':''}</small></li>)}</ul><ul>{scope.limitations.map((limitation,index)=><li key={index}>{limitation}</li>)}</ul></details>
 </>}</section>;
}
