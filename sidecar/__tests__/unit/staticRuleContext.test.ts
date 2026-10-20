import { describe, expect, it } from 'vitest';
import quality from '../../src/rules/codeQuality.js';
import secrets from '../../src/rules/secrets.js';
const nesting = quality.find(rule => rule.id === 'cq-deep-nesting')!;
const credential = secrets.find(rule => rule.id === 'secrets-api-key')!;

describe('syntax-aware diagnostic candidates', () => {
  it('does not mistake nested data, strings, comments or indentation for JS control flow', () => {
    expect(nesting.analyze(`const data = { a: { b: { c: { d: { e: { value: true } } } } } };
                const value = "if (a) { if (b) { } }";
                // if (c) { if (d) { if (e) { } } }`, 'fixture.ts')).toEqual([]);
  });
  it('detects five real conditional branches even when minified', () => {
    expect(nesting.analyze('function run(){if(a){if(b){if(c){if(d){if(e){run();}}}}}}', 'fixture.js')).toHaveLength(1);
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
