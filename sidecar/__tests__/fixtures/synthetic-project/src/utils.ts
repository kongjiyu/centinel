// CODE QUALITY ISSUE: console.log usage
export function log(message: string) {
  console.log('[LOG]', message);
}

export function formatDate(date: Date): string {
  return date.toISOString();
}

export function processItems(items: any[]) {
  // CODE QUALITY ISSUE: deep nesting (5 levels)
  for (const item of items) {
    if (item.active) {
      if (item.value > 0) {
        if (item.category === 'A') {
          if (item.priority === 'high') {
            if (item.assigned) {
              return item;
            }
          }
        }
      }
    }
  }
  return null;
}

export function calculateScore(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
