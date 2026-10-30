import { describe, it, expect, vi } from 'vitest';
import { boundedSourceRead, retryTimedOutSourceRead } from '../../src/review/abort.js';
describe('source read deadline',()=>{
  it('bounds adapters ignoring abort', async()=>{
    await expect(boundedSourceRead(()=>new Promise(()=>{}), undefined, 5)).rejects.toMatchObject({name:'TimeoutError'});
  });
  it('cancels a pending read and rejects pre-cancelled work', async()=>{
    const controller=new AbortController();
    const result=boundedSourceRead(()=>new Promise(()=>{}),controller.signal);
    controller.abort(new DOMException('Cancelled','AbortError'));
    await expect(result).rejects.toMatchObject({name:'AbortError'});
    await expect(boundedSourceRead(async()=> 'unused',controller.signal)).rejects.toThrow();
  });
  it('does not publish a result resolved in the same turn as cancellation', async () => {
    const controller = new AbortController();
    await expect(boundedSourceRead(async () => {
      controller.abort();
      return 'cancelled evidence';
    }, controller.signal)).rejects.toThrow();
  });
  it('returns successful reads and preserves read errors', async () => {
    await expect(boundedSourceRead(async () => 'verified evidence')).resolves.toBe('verified evidence');
    const failure = new Error('hash mismatch');
    await expect(boundedSourceRead(async () => { throw failure; })).rejects.toBe(failure);
  });
  it('retries only a timeout and stops after two read attempts', async () => {
    const timeout = new DOMException('Source read deadline exceeded', 'TimeoutError');
    const wait = vi.fn(async () => undefined);
    const read = vi.fn().mockRejectedValueOnce(timeout).mockResolvedValueOnce('verified');
    await expect(retryTimedOutSourceRead(read, undefined, wait)).resolves.toBe('verified');
    expect(read.mock.calls.map(call => call[0])).toEqual([1, 2]);
    expect(wait).toHaveBeenCalledWith(1000, undefined);
    const unavailable = vi.fn().mockRejectedValue(timeout);
    await expect(retryTimedOutSourceRead(unavailable, undefined, wait)).rejects.toBe(timeout);
    expect(unavailable).toHaveBeenCalledTimes(2);
  });
  it.each(['hash mismatch', 'unauthorized', 'persistence failed', 'quota exhausted'])('does not retry %s', async message => {
    const read = vi.fn().mockRejectedValue(new Error(message));
    const wait = vi.fn(async () => undefined);
    await expect(retryTimedOutSourceRead(read, undefined, wait)).rejects.toThrow(message);
    expect(read).toHaveBeenCalledOnce(); expect(wait).not.toHaveBeenCalled();
  });
  it('cancellation during backoff prevents a second read', async () => {
    const controller = new AbortController();
    const read = vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    await expect(retryTimedOutSourceRead(read, controller.signal, async () => { controller.abort(); })).rejects.toThrow();
    expect(read).toHaveBeenCalledOnce();
  });
});
