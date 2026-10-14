import {describe,it,expect} from 'vitest';
import {redactObservation,redactObservationRecord} from '../../src/dynamic/browser/privacy.js';
describe('Browser observation privacy boundary',()=>{
 it('removes seeded values and escaped forms before provider or evidence persistence',()=>{
  const secret='qa-private&token';const text=[secret,encodeURIComponent(secret),JSON.stringify(secret).slice(1,-1)].join(' ');
  expect(redactObservation(text,[secret])).not.toContain('qa-private');
 });
 it('removes userinfo and all query/fragment values from otherwise unknown URLs',()=>{
  const result=redactObservation('Visit https://tester:password@example.com/signin?code=unknown#token=unknown now',[]);
  expect(result).toContain('https://example.com/signin?');expect(result).not.toMatch(/password|unknown|tester/);
 });
 it('sanitizes nested traces and keys while preserving numeric check metadata',()=>{
  const input={steps:[{url:'http://localhost:3000/?access_token=private',text:'seed-private',duration:12}], 'seed-private':'value'};
  const result=redactObservationRecord(input,['seed-private']);expect(JSON.stringify(result)).not.toContain('private');expect(result.steps[0].duration).toBe(12);expect(input.steps[0].text).toBe('seed-private');
 });
 it('preserves surrounding punctuation when redacting URL query data',()=>{expect(redactObservation('Blocked (http://localhost:3000/?code=private). Retry.',[])).toBe('Blocked (http://localhost:3000/?[REDACTED]). Retry.');});
});
