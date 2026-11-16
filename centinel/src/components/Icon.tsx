import type { LucideIcon } from 'lucide-react';
import './Icon.css';

/**
 * The one component that sizes and aligns icons (DESIGN.md §8 Icons):
 * 1.2 times its text, centred on the text's optical midline, with fixed
 * corrections for shapes whose visual weight is off-centre.
 */
export type IconShape = 'triangle' | 'play';

export function Icon({ icon: Glyph, shape, className = '', label }: { icon: LucideIcon; shape?: IconShape; className?: string; label?: string }) {
  return (
    <Glyph
      className={`ci${shape ? ` ci-${shape}` : ''}${className ? ` ${className}` : ''}`}
      size="1.2em"
      strokeWidth={1.7}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    />
  );
}
