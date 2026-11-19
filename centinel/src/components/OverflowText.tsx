import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import './OverflowText.css';

export function OverflowText({ text }: { text: string }) {
  const frame = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      if (frame.current && content.current) {
        setOverflow(Math.max(0, Math.ceil(content.current.getBoundingClientRect().width - frame.current.clientWidth)));
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    if (frame.current) observer.observe(frame.current);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, [text]);

  return <span ref={frame} className="overflow-text" data-overflow={overflow > 0 || undefined}
    style={{ '--text-travel': `${overflow + 12}px`, '--text-duration': `${Math.min(3600, Math.max(900, overflow * 18))}ms` } as CSSProperties}>
    <span ref={content}>{text}</span>
  </span>;
}
