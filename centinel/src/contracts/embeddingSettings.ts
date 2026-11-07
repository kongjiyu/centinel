/**
 * Frontend-owned copy of the sidecar's public embedding settings contract
 * (the sidecar `embeddingSettingsTypes.ts`). Credentials never appear in catalogs or usage.
 * `contracts/sidecarParity.test.ts` fails the type check if the two declarations drift.
 */
export type EmbeddingProviderId = 'voyage' | 'custom';

export type EmbeddingModelOption = {
  id: string;
  label: string;
  provider: 'voyage';
  dimensions: number;
  publishedFreeTokens: number | null;
  documentationUrl: string;
};

export type EmbeddingModelUsage = {
  model: string;
  knownTokens: number | null;
  calls: number;
  unknownCalls: number;
};

export type EmbeddingSettingsCatalog = {
  source: 'published_catalog';
  verifiedAt: string;
  models: EmbeddingModelOption[];
  usageAvailable: boolean;
  usage: EmbeddingModelUsage[];
  remaining: {
    status: 'not_reported';
    tokens: null;
    message: string;
    dashboardUrl: string;
  };
};
