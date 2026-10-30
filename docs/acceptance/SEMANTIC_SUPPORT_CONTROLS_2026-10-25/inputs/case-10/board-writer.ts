import type { ExportPlan } from "./contract";

export function writeBoard(plan: ExportPlan): string {
  const gutter = plan.gutter ?? "";
  return `${gutter}BOARD${gutter}`;
}
