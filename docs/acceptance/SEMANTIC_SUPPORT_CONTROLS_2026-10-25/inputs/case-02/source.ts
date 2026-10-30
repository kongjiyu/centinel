export interface QueryRequest {
  maxItems?: number;
}

export interface SearchSink {
  take(options: { maxItems: number }): void;
}

const DEFAULT_MAX_ITEMS = 24;

export function selectedSearch(request: QueryRequest, sink: SearchSink): void {
  const requested = request.maxItems ?? DEFAULT_MAX_ITEMS;
  const maxItems = Math.min(DEFAULT_MAX_ITEMS, Math.max(1, requested));
  sink.take({ maxItems });
}
