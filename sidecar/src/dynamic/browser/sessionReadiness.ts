import type {Page} from 'playwright';
export class SessionAuthenticationError extends Error{constructor(){super('Signed-in readiness could not be verified. Renew the local session or review its saved readiness selector.');this.name='SessionAuthenticationError';}}
export async function verifySessionReadiness(page:Page,selector:string){try{const locator=page.locator(selector);await locator.waitFor({state:'visible',timeout:10_000});if(await locator.count()!==1)throw Error();}catch{throw new SessionAuthenticationError();}}
