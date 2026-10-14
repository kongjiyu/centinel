import {beforeEach,describe,expect,it,vi} from 'vitest';
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {DynamicEnvironmentPanel} from './DynamicEnvironmentPanel';
import {api} from '../api/client';
vi.mock('../api/client',()=>({api:{unitRuns:vi.fn().mockResolvedValue([]),dynamicHooks:vi.fn(),dynamicWorkspace:vi.fn(),dynamicEnvironmentData:vi.fn(),recordDynamicEnvironmentData:vi.fn(),dynamicEnvironments:vi.fn(),dynamicEnvironmentValues:vi.fn(),saveDynamicEnvironment:vi.fn(),saveDynamicEnvironmentValues:vi.fn(),preflightDynamicEnvironment:vi.fn()}}));
const profile={id:'env-one',projectId:'project-a',version:1,updatedBy:'actor',updatedAt:'',name:'Local',targetUrl:'http://localhost:3000/',allowedOrigins:['http://localhost:3000'],viewport:{width:1280,height:720},accountRole:'Seeded account',requiredVariables:['TEST_PASSWORD'],startupInstructions:'Start manually',targetVersion:'commit'};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(api.dynamicHooks).mockResolvedValue([]);vi.mocked(api.dynamicWorkspace).mockResolvedValue({authorization:null});vi.mocked(api.dynamicEnvironmentData).mockResolvedValue({profileId:'env-one',state:'unprepared',preparedVersion:null,preparation:null,runId:null,events:[]});vi.mocked(api.dynamicEnvironments).mockResolvedValue([profile]);vi.mocked(api.dynamicEnvironmentValues).mockResolvedValue({variableNames:[]});});
describe('Environment workspace',()=>{
 it('requires repeat consent to refer to an approved click rule and round-trips that consent',async()=>{
  vi.mocked(api.saveDynamicEnvironment).mockResolvedValue(profile);const user=userEvent.setup();render(<DynamicEnvironmentPanel projectId="project-a" value="env-one" onChange={vi.fn()} disabled={false}/>);await user.click(screen.getByText('Manage environments and local values'));await user.click(screen.getByRole('button',{name:'Edit selected environment'}));await user.click(screen.getByText('Browser action permissions',{exact:true}));await user.type(screen.getByLabelText('Click controls safe to repeat (optional)'),'#menu');await user.click(screen.getByRole('button',{name:'Save environment'}));expect(await screen.findByRole('alert')).toHaveTextContent('already be approved');expect(api.saveDynamicEnvironment).not.toHaveBeenCalled();await user.type(screen.getByLabelText('Controls allowed to click'),'#menu');await user.click(screen.getByRole('button',{name:'Save environment'}));await waitFor(()=>expect(api.saveDynamicEnvironment).toHaveBeenCalledWith('project-a',expect.objectContaining({actionPolicy:{schemaVersion:1,interactions:[{selector:'#menu',actions:['click'],repeatable:true}],allowCoordinates:false}}),'env-one'));expect(screen.getByLabelText('Click controls safe to repeat (optional)')).toHaveValue('');
 });
 it('saves explicit action grants, preserves multiline input and resets them when editing an older profile',async()=>{
  vi.mocked(api.saveDynamicEnvironment).mockResolvedValue(profile);const user=userEvent.setup();render(<DynamicEnvironmentPanel projectId="project-a" value="env-one" onChange={vi.fn()} disabled={false}/>);
  await user.click(screen.getByText('Manage environments and local values'));await user.click(screen.getByRole('button',{name:'Edit selected environment'}));await user.click(screen.getByText('Browser action permissions',{exact:true}));
  await user.type(screen.getByLabelText('Controls allowed to click'),'#save\n#next');await user.type(screen.getByLabelText('Fields allowed to fill'),'#name\n#save');await user.click(screen.getByLabelText('Allow screenshot coordinates for approved controls'));
  await user.click(screen.getByRole('button',{name:'Save environment'}));await waitFor(()=>expect(api.saveDynamicEnvironment).toHaveBeenCalledWith('project-a',expect.objectContaining({actionPolicy:{schemaVersion:1,interactions:[{selector:'#save',actions:['click','type']},{selector:'#next',actions:['click']},{selector:'#name',actions:['type']}],allowCoordinates:true}}),'env-one'));
  expect(screen.getByLabelText('Controls allowed to click')).toHaveValue('');expect(screen.getByLabelText('Allow screenshot coordinates for approved controls')).not.toBeChecked();
 });

 it('saves a shared profile separately from local variable values',async()=>{
  vi.mocked(api.saveDynamicEnvironment).mockResolvedValue(profile);const change=vi.fn();const user=userEvent.setup();
  render(<DynamicEnvironmentPanel projectId="project-a" value="" onChange={change} disabled={false}/>);
  await user.click(screen.getByText('Manage environments and local values'));
  await user.type(screen.getByLabelText('Environment name'),'Local');await user.type(screen.getByLabelText('Environment website'),'http://localhost:3000');await user.type(screen.getByLabelText('Required variable names'),'TEST_PASSWORD');
  await user.click(screen.getByRole('button',{name:'Save environment'}));await screen.findByText(/Environment version 1 saved/);
  expect(api.saveDynamicEnvironment).toHaveBeenCalledWith('project-a',expect.objectContaining({requiredVariables:['TEST_PASSWORD'],allowedOrigins:['http://localhost:3000']}),undefined);expect(change).toHaveBeenCalledWith('env-one');expect(api.saveDynamicEnvironmentValues).not.toHaveBeenCalled();
 });
 it('clears a saved secret input and displays only available names',async()=>{
  vi.mocked(api.saveDynamicEnvironmentValues).mockResolvedValue({variableNames:['TEST_PASSWORD']});const user=userEvent.setup();
  render(<DynamicEnvironmentPanel projectId="project-a" value="env-one" onChange={vi.fn()} disabled={false}/>);
  await user.click(screen.getByText('Manage environments and local values'));await user.type(screen.getByLabelText('Variable name'),'TEST_PASSWORD');await user.type(screen.getByLabelText('Local value'),'test-secret-456');
  await user.click(screen.getByRole('button',{name:'Save local value'}));await screen.findByText(/Local value saved/);
  expect(screen.getByLabelText('Local value')).toHaveValue('');expect(screen.queryByText('test-secret-456')).not.toBeInTheDocument();expect(screen.getByText(/Available names: TEST_PASSWORD/)).toBeInTheDocument();
 });
 it('records failed cleanup separately and never offers preparation for dirty data',async()=>{
  const dirty={profileId:'env-one',state:'cleanup_required' as const,preparedVersion:1,preparation:null,runId:'run-one',events:[]};
  vi.mocked(api.dynamicEnvironmentData).mockResolvedValue(dirty);vi.mocked(api.recordDynamicEnvironmentData).mockResolvedValue(dirty);
  const user=userEvent.setup();render(<DynamicEnvironmentPanel projectId="project-a" value="env-one" onChange={vi.fn()} disabled={false}/>);await user.click(screen.getByText('Manage environments and local values'));
  await screen.findByText(/Cleanup required. This environment cannot be reused/);expect(screen.queryByRole('button',{name:'Record preparation'})).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('Cleanup outcome and verification'),'Fixture cleanup failed; inspect the test item');await user.click(screen.getByRole('combobox',{name:'Data operation outcome'}));await user.click(screen.getByRole('option',{name:'Failed — needs recovery'}));await user.click(screen.getByRole('button',{name:'Record cleanup'}));
  await waitFor(()=>expect(api.recordDynamicEnvironmentData).toHaveBeenCalledWith('project-a','env-one','cleanup','failed','Fixture cleanup failed; inspect the test item'));
  expect(screen.getByText(/Cleanup required. This environment cannot be reused/)).toBeInTheDocument();
 });
 it('discards environment responses after a project change',async()=>{
  let resolve!: (value:typeof profile[])=>void;vi.mocked(api.dynamicEnvironments).mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValueOnce([]);
  const {rerender}=render(<DynamicEnvironmentPanel projectId="project-a" value="" onChange={vi.fn()} disabled={false}/>);
  rerender(<DynamicEnvironmentPanel projectId="project-b" value="" onChange={vi.fn()} disabled={false}/>);resolve([profile]);
  await waitFor(()=>expect(api.dynamicEnvironments).toHaveBeenCalledTimes(2));const user=userEvent.setup();await user.click(screen.getByRole('combobox',{name:'Run environment'}));expect(screen.queryByRole('option',{name:'Local · v1'})).not.toBeInTheDocument();
 });
 it('shows shared ownership and blocks preparing data reserved by another profile',async()=>{vi.mocked(api.dynamicEnvironmentData).mockResolvedValue({profileId:'env-one',state:'unprepared',preparedVersion:null,preparation:null,runId:null,events:[],resource:{key:'shared:qa-payments',reserved:false,available:false,ownerProfileId:'other-env',ownerName:'Prepared QA',ownerState:'cleanup_required'}});const user=userEvent.setup();render(<DynamicEnvironmentPanel projectId="project-a" value="env-one" onChange={vi.fn()} disabled={false}/>);await user.click(screen.getByText('Manage environments and local values'));await screen.findByText(/Shared data is reserved by Prepared QA/);expect(screen.getByRole('button',{name:'Record preparation'})).toBeDisabled();});
 it('saves actual execution limits and removes an optional token stop limit when cleared',async()=>{
  vi.mocked(api.saveDynamicEnvironment).mockResolvedValue(profile);const user=userEvent.setup();render(<DynamicEnvironmentPanel projectId="project-a" value="env-one" onChange={vi.fn()} disabled={false}/>);
  await user.click(screen.getByText('Manage environments and local values'));await user.click(screen.getByRole('button',{name:'Edit selected environment'}));await user.click(screen.getByText('Execution limits',{exact:true}));
  const duration=screen.getByLabelText('Maximum duration (seconds)');await user.clear(duration);await user.type(duration,'20');const calls=screen.getByLabelText('Maximum model calls');await user.clear(calls);await user.type(calls,'2');const tokens=screen.getByLabelText('Accounted-token stop limit (optional)');await user.type(tokens,'1000');await user.clear(tokens);
  await user.click(screen.getByRole('button',{name:'Save environment'}));await waitFor(()=>expect(api.saveDynamicEnvironment).toHaveBeenCalledWith('project-a',expect.objectContaining({budgets:expect.objectContaining({runtimeMs:20000,maxModelCalls:2})}),'env-one'));
  expect(vi.mocked(api.saveDynamicEnvironment).mock.calls.at(-1)?.[1].budgets).not.toHaveProperty('maxAccountedTokens');
 });

});
