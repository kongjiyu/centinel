/** Public embedding settings contract. Credentials never appear in catalogs or usage. */
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
