let pending: { id: string; rect: DOMRect; expiresAt: number } | undefined;

export function rememberComposerPosition(id: string, rect: DOMRect) {
  pending = { id, rect, expiresAt: Date.now() + 5000 };
}

export function animateComposerArrival(id: string, composer: HTMLElement) {
  if (!pending || pending.id !== id) return;
  const { rect, expiresAt } = pending;
  pending = undefined;
  if (Date.now() > expiresAt || !composer.animate || !window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches) return;
  const destination = composer.getBoundingClientRect();
  if (!destination.width || !destination.height) return;
  return composer.animate([
    { transform: `translate(${rect.left - destination.left}px, ${rect.top - destination.top}px) scale(${rect.width / destination.width}, ${rect.height / destination.height})`, transformOrigin: 'top left' },
    { transform: 'none', transformOrigin: 'top left' },
  ], { duration: 360, easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)' });
}
