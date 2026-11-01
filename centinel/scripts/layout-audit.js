/*
 * Centinel layout audit — paste or inject into a signed-in Centinel page.
 *
 * Returns layout defects visible at the current viewport:
 *   truncated   text cut off with an ellipsis or line clamp
 *   overlap     two visible text elements drawn on top of each other
 *   clipped     content hidden by a fixed-size overflow:hidden container
 *   misaligned  labels in the same visual row whose tops differ by 3–40px
 *   overflow    content wider than the viewport (horizontal page scroll)
 *   squeezed    text forced into a column so narrow it breaks every few letters
 *   tiny-text   text rendered below the 12px minimum
 *
 * Usage: window.centinelLayoutAudit() → { url, viewport, issues: [...] }
 */
(() => {
  const describe = el => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${text ? ` "${text}"` : ''}`;
  };

  const isVisible = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
    if (el.closest('[aria-hidden="true"], .visually-hidden, .sr-only')) return false;
    // Hidden by clip (visually-hidden pattern).
    if (s.clip === 'rect(0px, 0px, 0px, 0px)' || (s.position === 'absolute' && r.width <= 1 && r.height <= 1)) return false;
    // Content of a collapsed <details> still reports a box in Chromium.
    for (let d = el.closest('details:not([open])'); d; d = d.parentElement?.closest('details:not([open])')) {
      const summary = d.querySelector(':scope > summary');
      if (!summary || !summary.contains(el)) return false;
    }
    for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const p = parent.getBoundingClientRect();
      if (p.width <= 1 || p.height <= 1) return false;
    }
    const v = visibleRect(el);
    return v.width > 1 && v.height > 1;
  };

  // The element's box clipped by every scrolling/overflow-hidden ancestor.
  const visibleRect = el => {
    const r = el.getBoundingClientRect();
    let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
    for (let parent = el.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
      const s = getComputedStyle(parent);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const p = parent.getBoundingClientRect();
      left = Math.max(left, p.left); top = Math.max(top, p.top);
      right = Math.min(right, p.right); bottom = Math.min(bottom, p.bottom);
    }
    return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  };

  const pinned = el => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (position === 'sticky' || position === 'fixed') return true;
    }
    return false;
  };

  const ownText = el => [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());

  const audit = () => {
    const issues = [];
    const all = [...document.querySelectorAll('body *')].filter(el => !['SCRIPT', 'STYLE', 'svg', 'path', 'OPTION'].includes(el.tagName));
    const visible = all.filter(isVisible);
    const textEls = visible.filter(ownText);

    // Truncation (ellipsis or line clamp).
    for (const el of visible) {
      const s = getComputedStyle(el);
      const clamped = s.webkitLineClamp && s.webkitLineClamp !== 'none';
      if (s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) {
        issues.push({ type: 'truncated', el: describe(el), detail: `${el.scrollWidth}px content in ${el.clientWidth}px` });
      } else if (clamped && el.scrollHeight > el.clientHeight + 1) {
        issues.push({ type: 'truncated', el: describe(el), detail: `line clamp ${s.webkitLineClamp}` });
      }
    }

    // Overlapping text.
    // Content scrolling beneath a sticky header is expected, so pinned elements are skipped.
    const boxes = textEls.filter(el => !pinned(el)).map(el => ({ el, r: visibleRect(el) }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 4 && h > 4) issues.push({ type: 'overlap', el: describe(a.el), detail: `overlaps ${describe(b.el)} (${Math.round(w)}×${Math.round(h)}px)` });
      }
    }

    // Content clipped by a fixed-size container.
    for (const el of visible) {
      const s = getComputedStyle(el);
      if (s.overflowY !== 'hidden' && s.overflow !== 'hidden') continue;
      if (s.textOverflow === 'ellipsis' || el.scrollHeight <= el.clientHeight + 2) continue;
      const box = el.getBoundingClientRect();
      const hiddenChild = [...el.querySelectorAll('button, a, h1, h2, h3, p, input')].find(child => {
        const r = child.getBoundingClientRect();
        return r.height > 0 && (r.bottom > box.bottom + 2 || r.top < box.top - 2);
      });
      if (hiddenChild) issues.push({ type: 'clipped', el: describe(el), detail: `hides ${describe(hiddenChild)}` });
    }

    // Form controls on the same row that do not line up (input, select, textarea).
    const controls = visible.filter(el => el.matches('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea, .select-trigger, select'));
    for (let i = 0; i < controls.length; i++) {
      for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i].getBoundingClientRect(), b = controls[j].getBoundingClientRect();
        const sideBySide = a.right <= b.left || b.right <= a.left;
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        const diff = Math.abs(a.top - b.top);
        if (sideBySide && overlapY > 0 && diff >= 3) {
          issues.push({ type: 'misaligned', el: describe(controls[i]), detail: `${Math.round(diff)}px off ${describe(controls[j])}` });
        } else if (sideBySide && overlapY > 0 && Math.abs(a.height - b.height) > 6 && !controls[i].matches('textarea') && !controls[j].matches('textarea')) {
          issues.push({ type: 'misaligned', el: describe(controls[i]), detail: `${Math.round(a.height)}px tall beside ${Math.round(b.height)}px ${describe(controls[j])}` });
        }
      }
    }

    // Horizontal page overflow.
    const root = document.scrollingElement || document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) {
      const widest = visible.filter(el => el.getBoundingClientRect().right > root.clientWidth + 1).slice(-1)[0];
      issues.push({ type: 'overflow', el: widest ? describe(widest) : 'page', detail: `${root.scrollWidth}px wide in ${root.clientWidth}px viewport` });
    }

    // Text squeezed into a column so narrow that words break every few letters.
    for (const el of textEls) {
      const r = el.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.4;
      const length = (el.textContent || '').trim().length;
      if (length >= 12 && r.width < 64 && r.height > lineHeight * 3.5) {
        issues.push({ type: 'squeezed', el: describe(el), detail: `${Math.round(r.width)}px wide, ${Math.round(r.height / lineHeight)} lines` });
      }
    }

    // Text below the 12px minimum.
    for (const el of textEls) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 12) issues.push({ type: 'tiny-text', el: describe(el), detail: `${size}px` });
    }

    const seen = new Set();
    return {
      url: location.hash || location.pathname,
      viewport: `${innerWidth}×${innerHeight}`,
      issues: issues.filter(issue => {
        const key = issue.type + issue.el + issue.detail;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    };
  };

  // Visit every screen (and each project tab), scrolling the main pane so
  // below-the-fold content is audited too. Resolves to { label: [issue, …] }.
  const sweep = async ({ projectId, settleMs = 2500 } = {}) => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const out = {};
    const scroller = () => [...document.querySelectorAll('*')]
      .filter(el => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 20 && el.clientHeight > 300)
      .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    const run = async label => {
      const seen = new Set();
      const found = [];
      const pane = scroller();
      const steps = pane ? Math.min(12, Math.ceil(pane.scrollHeight / (pane.clientHeight * 0.8))) : 1;
      for (let i = 0; i < steps; i++) {
        if (pane) { pane.scrollTop = i * pane.clientHeight * 0.8; await sleep(250); }
        for (const issue of audit().issues) {
          const key = `${issue.type}|${issue.el}|${issue.detail.replace(/\(\d+×\d+px\)/, '')}`;
          if (!seen.has(key)) { seen.add(key); found.push(`${issue.type} | ${issue.el} | ${issue.detail}`); }
        }
      }
      if (pane) pane.scrollTop = 0;
      if (found.length) out[label] = found;
    };
    for (const screen of ['dashboard', 'projects', 'review-entry', 'dynamic-testing', 'review-playground', 'settings', 'help', 'profile']) {
      location.hash = `#/${screen}`;
      await sleep(settleMs);
      await run(screen);
    }
    if (projectId) {
      location.hash = `#/project-detail?projectId=${projectId}`;
      await sleep(settleMs + 500);
      for (const tab of ['Overview', 'Assessment', 'Findings', 'Source', 'Collaborators', 'Settings']) {
        const button = [...document.querySelectorAll('.project-section-nav button, [role=tab]')].find(el => el.textContent.trim() === tab);
        if (!button) { out[`project/${tab}`] = ['(tab not found)']; continue; }
        button.click();
        await sleep(settleMs);
        await run(`project/${tab}`);
      }
    }
    location.hash = '#/dashboard';
    await sleep(settleMs);
    const inspect = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Inspect');
    if (inspect) {
      inspect.click();
      await sleep(settleMs + 1000);
      await run(`inspect:${location.hash.split('?')[0]}`);
    }
    return { viewport: `${innerWidth}×${innerHeight}`, out };
  };

  window.centinelLayoutAudit = audit;
  window.centinelLayoutSweep = sweep;
  return audit();
})();
