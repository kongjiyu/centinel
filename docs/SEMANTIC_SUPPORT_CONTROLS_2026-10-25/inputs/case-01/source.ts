export interface QueryRequest {
  maxItems?: number;
}

export interface SearchSink {
  take(options: { maxItems: number }): void;
}

const DEFAULT_MAX_ITEMS = 24;

export function selectedSearch(request: QueryRequest, sink: SearchSink): void {
  const maxItems = request.maxItems ?? DEFAULT_MAX_ITEMS;
  sink.take({ maxItems });
}
