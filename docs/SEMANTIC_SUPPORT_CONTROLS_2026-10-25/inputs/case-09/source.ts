/** Contract: explicit switches must be serialized whether true or false. */
export function encodeFeatureSwitches(switches: Record<string, boolean>): string {
  const pairs: string[] = [];
  for (const [name, enabled] of Object.entries(switches)) {
    if (!enabled) continue;
    pairs.push(`${name}=${enabled}`);
  }
  return pairs.join("&");
}
