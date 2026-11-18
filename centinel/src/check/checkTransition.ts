let transition: { id: string; rect: DOMRect } | undefined;

export function rememberCheckTransition(id: string, element: Element | null) {
  if (element) transition = { id, rect: element.getBoundingClientRect() };
}

export function animateCheckTransition(id: string, element: HTMLElement | null) {
  if (!element || transition?.id !== id) return;
  const { rect } = transition;
  transition = undefined;
  if (!element.animate || !window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
  const target = element.getBoundingClientRect();
  if (!target.width || !target.height) return;
  element.animate([
    { transform: `translate(${rect.left - target.left}px, ${rect.top - target.top}px) scale(${rect.width / target.width}, ${rect.height / target.height})`, transformOrigin: 'top left', opacity: .65 },
    { transform: 'none', transformOrigin: 'top left', opacity: 1 },
  ], { duration: 220, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
}
