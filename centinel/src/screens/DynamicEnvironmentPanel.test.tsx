import {beforeEach,describe,expect,it,vi} from 'vitest';
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {DynamicEnvironmentPanel} from './DynamicEnvironmentPanel';
import {api} from '../api/client';
vi.mock('../api/client',()=>({api:{dynamicEnvironments:vi.fn(),dynamicEnvironmentValues:vi.fn(),saveDynamicEnvironment:vi.fn(),saveDynamicEnvironmentValues:vi.fn(),preflightDynamicEnvironment:vi.fn()}}));
const profile={id:'env-one',projectId:'project-a',version:1,updatedBy:'actor',updatedAt:'',name:'Local',targetUrl:'http://localhost:3000/',allowedOrigins:['http://localhost:3000'],viewport:{width:1280,height:720},accountRole:'Seeded account',requiredVariables:['TEST_PASSWORD'],startupInstructions:'Start manually',targetVersion:'commit'};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(api.dynamicEnvironments).mockResolvedValue([profile]);vi.mocked(api.dynamicEnvironmentValues).mockResolvedValue({variableNames:[]});});
describe('Environment workspace',()=>{
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
 it('discards environment responses after a project change',async()=>{
  let resolve!: (value:typeof profile[])=>void;vi.mocked(api.dynamicEnvironments).mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValueOnce([]);
  const {rerender}=render(<DynamicEnvironmentPanel projectId="project-a" value="" onChange={vi.fn()} disabled={false}/>);
  rerender(<DynamicEnvironmentPanel projectId="project-b" value="" onChange={vi.fn()} disabled={false}/>);resolve([profile]);
  await waitFor(()=>expect(api.dynamicEnvironments).toHaveBeenCalledTimes(2));const user=userEvent.setup();await user.click(screen.getByRole('combobox',{name:'Run environment'}));expect(screen.queryByRole('option',{name:'Local · v1'})).not.toBeInTheDocument();
 });
});
