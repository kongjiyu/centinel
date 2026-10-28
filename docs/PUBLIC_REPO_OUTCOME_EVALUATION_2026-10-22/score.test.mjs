import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precision } from './score.mjs';
test('precision counts independently adjudicated unique claims', () => {
  const result = precision([{claimKey:'a',verdict:'true'}, {claimKey:'a',verdict:'true'}, {claimKey:'b',verdict:'false'}]);
  assert.equal(result.tp,1); assert.equal(result.fp,1); assert.equal(result.value,0.5);
});
test('unknown claims retain an explicit uncertainty interval', () => {
  const result = precision([{claimKey:'a',verdict:'true'}, {claimKey:'b',verdict:'unknown'}]);
  assert.equal(result.unknown,1); assert.equal(result.value,1); assert.equal(result.lowerBound,0.5); assert.equal(result.upperBound,1);
});
test('no predictions have undefined precision', () => {
  assert.equal(precision([]).value,null); assert.equal(precision([]).lowerBound,null);
});
test('conflicting or missing adjudications fail instead of changing denominators', () => {
  assert.throws(() => precision([{claimKey:'a',verdict:'true'}, {claimKey:'a',verdict:'false'}]));
  assert.throws(() => precision([{claimKey:'a'}]));
});
