import type { Page } from 'playwright';
import type { CheckDefinition, CheckResult, CheckVerdict } from './types.js';

/** Checks use configured expectations, never a model's terminal declaration. */
export async function checkPage(page: Page, definitions: CheckDefinition[], evidenceIds: string[], signal?: AbortSignal, privacy:{sensitiveSelectors?:readonly string[]}={}): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of definitions) {
    const result: CheckResult = { checkId: check.id, criterionId: check.criterionId, verdict: 'uncertain', observed: null, reason: '', evidenceIds: [...evidenceIds], checkedAt: new Date().toISOString() };
    if (signal?.aborted || page.isClosed()) {
      result.reason = 'Page unavailable or execution stopped before verification.';
    } else {
      try {
        let pass: boolean;
        if (check.kind === 'url') {
          result.observed = page.url();
          pass = result.observed === check.expected;
        } else if (check.kind === 'visible_text') {
          const text = await page.locator('body').innerText({ timeout: 3000 });
          // Store the expectation/match only, not arbitrary page text or secrets.
          pass = text.includes(check.expected);
          result.observed = pass ? 'Expected visible text found.' : 'Expected visible text absent.';
        } else if(check.kind==='element_visible') {
          const locator = page.locator(check.selector);
          const count = await locator.count();
          if (count > 1) throw new Error('ambiguous');
          pass = count === 1 && await locator.isVisible();
          result.observed = pass ? 'One visible element found.' : 'No visible matching element found.';
        } else {
          const locator=page.locator(check.selector);
          if(await locator.count()!==1||!await locator.isVisible())throw new Error('Form state unavailable');
          if(check.kind==='field_enabled'){
            if(!await locator.evaluate(element=>element.matches('input,button,select,textarea')))throw new Error('Unsupported enabled control');
            pass=await locator.isEnabled()===check.expected;
          }else{
            const actual=await locator.evaluate((element,selectors)=>{
              if(element.matches('input[type="password"],[autocomplete="current-password"],[autocomplete="new-password"],[autocomplete^="cc-"],[data-centinel-sensitive]')||element.closest('[data-centinel-sensitive]')||selectors.some(selector=>element.matches(selector)||!!element.closest(selector)))throw new Error('Private form state');
              if('value' in element&&String(element.value).length>10000)throw new Error('Form observation too large');
              if(element instanceof HTMLSelectElement&&element.selectedOptions.length>30)throw new Error('Too many selected values');
              if(element instanceof HTMLSelectElement)return {tag:'select',value:element.value,selected:[...element.selectedOptions].map(option=>option.value),valid:element.validity.valid};
              if(element instanceof HTMLTextAreaElement)return {tag:'textarea',value:element.value,valid:element.validity.valid};
              if(element instanceof HTMLInputElement&&element.type!=='file')return {tag:'input',type:element.type,value:element.value,checked:element.checked,valid:element.validity.valid};
              throw new Error('Unsupported form control');
            },privacy.sensitiveSelectors??[]);
            if(check.kind==='field_value')pass=actual.value===check.expected;
            else if(check.kind==='field_checked'){if(actual.tag!=='input'||!['checkbox','radio'].includes(actual.type??''))throw new Error('Not checkable');pass=actual.checked===check.expected;}
            else if(check.kind==='field_valid')pass=actual.valid===check.expected;
            else if(check.kind==='selected_values'){if(actual.tag!=='select')throw new Error('Not selectable');pass=JSON.stringify([...actual.selected??[]].sort())===JSON.stringify([...check.expected].sort());}
            else throw new Error('Unsupported form state');
          }
          result.observed=pass?'Expected form state matched.':'Expected form state did not match.';
        }
        if (signal?.aborted || page.isClosed()) throw new Error('stopped');
        result.verdict = pass ? 'passed' : 'failed';
        result.reason = pass ? 'Configured criterion matched the observed page.' : 'Configured criterion did not match the observed page.';
      } catch {
        result.reason = 'The checker could not obtain an unambiguous observation.';
      }
    }
    results.push(result);
  }
  return results;
}

export function aggregateChecks(definitions: CheckDefinition[], results: CheckResult[]): CheckVerdict {
  const required = definitions.filter(check => check.required);
  if (!required.length) return 'not_tested';
  const verdicts = required.map(check => {
    const matches = results.filter(result => result.checkId === check.id && result.criterionId === check.criterionId);
    return matches.length === 1 ? matches[0].verdict : 'uncertain';
  });
  if (verdicts.includes('failed')) return 'failed';
  return verdicts.every(verdict => verdict === 'passed') ? 'passed' : 'uncertain';
}
