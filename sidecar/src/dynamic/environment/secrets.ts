/** Inspect decoded strings, including JSON-escaped values; never return matches. */
export function containsLocalValue(value: unknown, secrets: string[]): boolean {
  if(typeof value==='string')return secrets.some(secret=>Boolean(secret)&&value.includes(secret));
  if(Array.isArray(value))return value.some(item=>containsLocalValue(item,secrets));
  if(value&&typeof value==='object')return Object.values(value).some(item=>containsLocalValue(item,secrets));
  return false;
}
