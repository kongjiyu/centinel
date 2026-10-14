import {DynamicContractError,type CheckDefinition} from '../types.js';import {PERSONAS,USABILITY_RULES,type UsabilityConfig} from './types.js';
export function validateUsability(value:unknown,checks:readonly CheckDefinition[]):UsabilityConfig{
 const fail=():never=>{throw new DynamicContractError(400,'Choose a supported usability persona/rule set and explicit feedback/recovery check references.');};
 if(!value||typeof value!=='object'||Array.isArray(value))return fail();const input=value as Record<string,unknown>;
 if(Object.keys(input).some(key=>!['schemaVersion','persona','rules','feedbackCheckIds','errorRecoveryCheckIds'].includes(key))||input.schemaVersion!==1||typeof input.persona!=='string'||!Object.hasOwn(PERSONAS,input.persona)||!Array.isArray(input.rules)||!input.rules.length||input.rules.length>5||new Set(input.rules).size!==input.rules.length||input.rules.some(rule=>!USABILITY_RULES.includes(rule)))return fail();
 const refs=(field:string)=>{const ids=input[field];if(!Array.isArray(ids)||ids.length>20||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!checks.some(check=>check.id===id)))return fail();return ids as string[];};
 const feedback=refs('feedbackCheckIds'),recovery=refs('errorRecoveryCheckIds');
 if(input.rules.includes('feedback')&&(!feedback.length||feedback.some(id=>!checks.some(check=>check.id===id&&['visible_text','element_visible'].includes(check.kind)))))return fail();
 if(input.rules.includes('error_recovery')&&!recovery.length)return fail();
 return {schemaVersion:1,persona:input.persona as UsabilityConfig['persona'],rules:[...input.rules],feedbackCheckIds:[...feedback],errorRecoveryCheckIds:[...recovery]};
}
