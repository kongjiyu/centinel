import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { encryptSecret, decryptSecret } from '../../tokenVault.js';
import { DynamicContractError } from '../types.js';
import { variableName } from './validation.js';
/** Values are owner/project/profile-scoped on this device, never cloud metadata. */
export class EnvironmentVault {
  constructor(private readonly root: string) {}
  private file(owner: string, project: string, profile: string) { return path.join(this.root, crypto.createHash('sha256').update(JSON.stringify([owner,project,profile])).digest('hex')+'.json'); }
  read(owner: string, project: string, profile: string): Record<string,string> {
    const file = this.file(owner,project,profile);
    if (!fs.existsSync(file)) return {};
    try { return JSON.parse(decryptSecret(fs.readFileSync(file,'utf8'))); }
    catch { throw new DynamicContractError(503, 'Local environment values cannot be unlocked. Re-enter them on this device.'); }
  }
  names(owner: string, project: string, profile: string) { return Object.keys(this.read(owner,project,profile)).sort(); }
  write(owner: string, project: string, profile: string, values: unknown) {
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.entries(values).length > 30 || Object.entries(values).some(([name,value]) => !variableName(name) || typeof value !== 'string' || value.length > 8000 || value.includes('\0'))) throw new DynamicContractError(400,'Provide at most 30 named environment values.');
    const stored = this.read(owner,project,profile);
    for (const [name,value] of Object.entries(values)) { if (value === '') delete stored[name]; else stored[name] = value as string; }
    fs.mkdirSync(this.root,{recursive:true,mode:0o700});
    const file=this.file(owner,project,profile); const temp=file+'.'+crypto.randomUUID();
    fs.writeFileSync(temp,encryptSecret(JSON.stringify(stored)),{mode:0o600}); fs.renameSync(temp,file);
    return { variableNames: Object.keys(stored).sort() };
  }
}
