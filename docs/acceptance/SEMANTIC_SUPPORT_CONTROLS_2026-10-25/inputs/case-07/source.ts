export function createScratchStore(slotCount: number): Uint8Array {
  const bytesPerSlot = 256;
  return new Uint8Array(slotCount * bytesPerSlot);
}
