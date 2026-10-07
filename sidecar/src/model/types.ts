/** Shared inference contract. Product-specific IDs belong to orchestration,
 * rather than the transport used by Review and Dynamic Testing. */
export type ModelRequest = {
  systemPrompt: string;
  prompt: string;
  signal?: AbortSignal;
  repair?: boolean;
  imagePaths?: string[];
  outputSchema?: Record<string, unknown>;
};
