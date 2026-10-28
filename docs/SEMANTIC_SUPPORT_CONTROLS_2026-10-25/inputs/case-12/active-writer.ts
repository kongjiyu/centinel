import type { FrameOptions } from "./contract";

export function writeCard(options: FrameOptions): string {
  const mark = options.frameMark ?? "";
  return `${mark}CARD${mark}`;
}
