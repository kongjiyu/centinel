import type { FrameOptions } from "./contract";

// Documented exception: byte-stable output ignores frameMark to preserve exact bytes.
export function writeByteStable(_options: FrameOptions): string {
  return "BYTE-STABLE";
}
