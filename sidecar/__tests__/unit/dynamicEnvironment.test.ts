import {beforeEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {containsLocalValue} from '../../src/dynamic/environment/secrets.js';
import {validateEnvironment} from '../../src/dynamic/environment/validation.js';
import {EnvironmentVault} from '../../src/dynamic/environment/vault.js';
import {checkEnvironment,environmentReady} from '../../src/dynamic/environment/preflight.js';
import {handleEnvironmentRoute} from '../../src/dynamic/environment/routes.js';
import {DynamicService} from '../../src/dynamic/service.js';
import {InMemoryDynamicRepository} from '../../src/dynamic/inMemoryRepository.js';
const input={name:'Local',targetUrl:'http://localhost:3000',allowedOrigins:['http://localhost:3000'],viewport:{width:1280,height:720},accountRole:'Seeded test account',requiredVariables:['TEST_PASSWORD'],startupInstructions:'Start the authorized local target manually.',targetVersion:'pinned-commit'};
const profile={...input,id:'env-a',projectId:'project-a',version:1,updatedBy:'actor-a',updatedAt:'2026-10-13T00:00:00Z'};
beforeEach(()=>{vi.restoreAllMocks();process.env.CENTINEL_TOKEN_ENCRYPTION_KEY='unit-test-only-encryption-key';});
describe('Dynamic environments',()=>{
 it('finds decoded secret strings even when JSON serialization escapes them',()=>{expect(containsLocalValue({nested:['prefix a\"secret\\token suffix']},['a\"secret\\token'])).toBe(true);expect(containsLocalValue({name:'Public profile'},['private-value'])).toBe(false);});
 it('rejects credential/query URLs, foreign origins and invalid variable names',()=>{
  for(const patch of [{targetUrl:'http://user:password@localhost:3000'},{targetUrl:'http://localhost:3000?token=secret'},{allowedOrigins:['https://other.example']},{requiredVariables:['INVALID-NAME']},{viewport:{width:100,height:720}}])expect(()=>validateEnvironment({...input,...patch})).toThrow();
 });
 it('stores values encrypted and partitions them by owner, project and profile',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'centinel-vault-'));try{
   const vault=new EnvironmentVault(root);expect(vault.write('actor-a','project-a','env-a',{TEST_PASSWORD:'seed-secret-987'})).toEqual({variableNames:['TEST_PASSWORD']});
   expect(fs.readFileSync(path.join(root,fs.readdirSync(root)[0]),'utf8')).not.toContain('seed-secret-987');
   expect(fs.statSync(path.join(root,fs.readdirSync(root)[0])).mode&0o777).toBe(0o600);
   expect(vault.read('actor-a','project-a','env-a')).toEqual({TEST_PASSWORD:'seed-secret-987'});
   expect(vault.names('actor-b','project-a','env-a')).toEqual([]);expect(vault.names('actor-a','project-b','env-a')).toEqual([]);expect(vault.names('actor-a','project-a','env-b')).toEqual([]);
   vault.write('actor-a','project-a','env-a',{TEST_PASSWORD:''});expect(vault.names('actor-a','project-a','env-a')).toEqual([]);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 });
 it('rejects invalid local values and fails closed when encryption config is unavailable',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'centinel-vault-'));try{const vault=new EnvironmentVault(root);expect(()=>vault.write('a','p','e',{bad:'value'})).toThrow();delete process.env.CENTINEL_TOKEN_ENCRYPTION_KEY;expect(()=>vault.write('a','p','e',{VALID:'secret'})).toThrow('not configured');}finally{fs.rmSync(root,{recursive:true,force:true});}
 });
 it('reports missing prerequisites and unreachable targets without executing instructions',async()=>{
  const reach=vi.fn().mockRejectedValue(new Error('offline'));const result=await checkEnvironment(profile,[],false,reach);
  expect(environmentReady(result)).toBe(false);expect(result.preflight.filter(check=>!check.ready)).toHaveLength(3);
  expect(reach.mock.calls[0][1]).toMatchObject({method:'HEAD',redirect:'manual'});expect(JSON.stringify(result)).not.toContain('seed-secret');
 });
 it('does not follow foreign redirects or call an authentication response a successful journey',async()=>{
  const result=await checkEnvironment(profile,['TEST_PASSWORD'],true,vi.fn().mockResolvedValue(new Response('',{status:302,headers:{location:'https://other.example'}})));
  expect(environmentReady(result)).toBe(false);
  const auth=await checkEnvironment(profile,['TEST_PASSWORD'],true,vi.fn().mockResolvedValue(new Response('',{status:401})));
  expect(environmentReady(auth)).toBe(true);expect(auth.preflight.at(-1)?.reason).toContain('during the journey');
 });
 it('freezes profile conditions and does not reuse a key for another environment',async()=>{
  const service=new DynamicService(new InMemoryDynamicRepository());const revision=await service.saveMission('project-a','actor-a',{name:'Smoke',goal:'Check form',targetUrl:input.targetUrl,maxSteps:1,context:null,contextAcknowledged:false,checks:[{id:'one',criterionId:'one',description:'Heading',kind:'visible_text',expected:'Sign in',required:true}]});
  const snapshot=await checkEnvironment(profile,['TEST_PASSWORD'],true,vi.fn().mockResolvedValue(new Response()));
  const {run}=await service.start('project-a','actor-a',revision.id,'key',snapshot);snapshot.viewport.width=800;
  expect(run.environment?.viewport.width).toBe(1280);
  await expect(service.start('project-a','actor-a',revision.id,'key',{...snapshot,id:'env-other'})).rejects.toThrow('different request');
 });
 it('authorizes membership before reading a profile or local values',async()=>{
  const repository={list:vi.fn(),get:vi.fn(),save:vi.fn()};const vault={names:vi.fn(),write:vi.fn()};
  await expect(handleEnvironmentRoute({method:'GET',pathname:'/projects/project-a/dynamic/environments/env-a/values',readBody:vi.fn()}, {ownerId:'actor-a',repository:repository as any,vault:vault as any,requireMember:vi.fn().mockRejectedValue(new Error('Denied')),providerReady:vi.fn()})).rejects.toThrow('Denied');
  expect(repository.get).not.toHaveBeenCalled();expect(vault.names).not.toHaveBeenCalled();
 });
});
