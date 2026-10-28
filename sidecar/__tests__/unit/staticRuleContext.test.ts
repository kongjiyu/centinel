import { describe, expect, it } from 'vitest';
import quality from '../../src/rules/codeQuality.js';
import secrets from '../../src/rules/secrets.js';
import security from '../../src/rules/security.js';
import { normalizeDeterministicFinding } from '../../src/review/findings.js';
const nesting = quality.find(rule => rule.id === 'cq-deep-nesting')!;
const credential = secrets.find(rule => rule.id === 'secrets-api-key')!;
const debugOutput = quality.find(rule => rule.id === 'cq-console-log')!;
const longFunction = quality.find(rule => rule.id === 'cq-long-function')!;

describe('syntax-aware diagnostic candidates', () => {
  it('keeps HTML sinks as unconfirmed observations and excludes examples and constant writes', () => {
    const rule=security.find(rule=>rule.id==='sec-innerhtml')!;
    expect(rule.analyze('// node.innerHTML = userInput;\nconst example="node.innerHTML = value";\nnode.innerHTML="Static content";', 'fixture.js')).toEqual([]);
    const findings=rule.analyze('dom.innerHTML = (newHtml && newHtml.__html) || "";', 'renderer.js');
    expect(findings).toHaveLength(1);
    expect(normalizeDeterministicFinding(findings[0])).toMatchObject({severity:'info',confidence:'low'});
    expect(findings[0].message).toContain('alone does not establish');
    expect(rule.analyze('node["innerHTML"] += req.body.value;', 'handler.ts')).toHaveLength(1);
  });
  it('does not turn a maintenance note into a mandatory release blocker', () => {
    const findings=quality.find(rule=>rule.id==='cq-todo-comments')!.analyze('// TODO: improve the label', 'fixture.ts');
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).not.toContain('before release');
  });
  it('does not mistake nested data, strings, comments or indentation for JS control flow', () => {
    expect(nesting.analyze(`const data = { a: { b: { c: { d: { e: { value: true } } } } } };
                const value = "if (a) { if (b) { } }";
                // if (c) { if (d) { if (e) { } } }`, 'fixture.ts')).toEqual([]);
  });
  it('detects five real conditional branches even when minified', () => {
    expect(nesting.analyze('function run(){if(a){if(b){if(c){if(d){if(e){run();}}}}}}', 'fixture.js')).toHaveLength(1);
  });
  it('keeps else-if alternatives at the same nesting depth', () => {
    expect(nesting.analyze('function run(){if(a){}else if(b){}else if(c){}else if(d){}else if(e){}else if(f){if(g){run();}}}', 'fixture.js')).toEqual([]);
    expect(nesting.analyze('if(a){}else if(b){if(c){if(d){if(e){if(f){run();}}}}}', 'fixture.js')).toHaveLength(1);
  });
  it('excludes documentation examples and intentional diagnostic channels from debug candidates', () => {
    expect(debugOutput.analyze('/** Example: console.log(value); */\nconst example = "console.debug(value)";\nconsole.warn("deprecated");\nconsole.error("request failed");\nconsole.info("service ready");', 'fixture.js')).toEqual([]);
  });
  it('retains real log and debug call candidates with source line evidence', () => {
    const findings = debugOutput.analyze('function run(){\nconsole.log(value);\nconsole.debug(value);\n}', 'fixture.ts');
    expect(findings.map(finding => finding.lineNumber)).toEqual([2,3]);
    expect(findings.every(finding => finding.message.startsWith('Possible'))).toBe(true);
  });
  it('uses the complete function body and a verbatim start-line quote for long functions', () => {
    const content = 'export function work() {\nif (ready) {\nrun();\n}\n' + 'run();\n'.repeat(101) + '}';
    const findings = longFunction.analyze(content, 'fixture.ts');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({lineNumber:1, evidence:'export function work() {'});
    expect(findings[0].message).toContain('106 lines');
  });
  it('does not report variable names, environment references, symbolic fields or interpolated credentials as literal leaks', () => {
    expect(credential.analyze(`const secret = process.env.SECRET_VALUE;
      const token = env.secret_value; const apiKey = config.apiKey;
      const password = getPassword(); const csrf_token = 'csrf_token';
      const tokenName = 'access_token'; const token = 'access_token';
      const secret = \`prefix-\${process.env.SECRET}\`;
      // const secret = 'this-is-comment-only';`, 'fixture.ts')).toEqual([]);
  });
  it('keeps real literal candidates and redacts their value without claiming proved exposure', () => {
    const findings = credential.analyze("const token = 'abc123456-sensitive';", 'fixture.ts');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Possible hardcoded');
    expect(JSON.stringify(findings)).not.toContain('abc123456-sensitive');
  });
});
