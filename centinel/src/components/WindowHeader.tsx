import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import { Copy, Minus, Square, X } from 'lucide-react';

type WindowMenuId = 'file' | 'edit' | 'view' | 'help';

type MenuItem = {
  label: string;
  onSelect: () => void | Promise<void>;
};

const MENU_LABELS: Record<WindowMenuId, string> = {
  file: 'File',
  edit: 'Edit',
  view: 'View',
  help: 'Help',
};

async function callTauriWindowAction(action: 'minimize' | 'toggleMaximize' | 'close' | 'startDragging'): Promise<boolean> {
  try {
    if (action === 'minimize') await appWindow.minimize();
    if (action === 'toggleMaximize') await appWindow.toggleMaximize();
    if (action === 'close') await appWindow.close();
    if (action === 'startDragging') await appWindow.startDragging();
    return true;
  } catch {
    // The browser and Vitest do not provide the Tauri bridge. Callers use a
    // small browser-safe fallback where one exists and otherwise no-op.
    return false;
  }
}

function runDocumentCommand(command: string) {
  try {
    document.execCommand(command);
  } catch {
    // execCommand is not implemented in some browsers and in jsdom. It is a
    // best-effort native editing affordance, not required for navigation.
  }
}

function setBrowserZoom(value: number) {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('zoom', value === 1 ? '' : `${value}`);
}

export function WindowHeader() {
  const [openMenu, setOpenMenu] = useState<WindowMenuId | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const aboutCloseRef = useRef<HTMLButtonElement | null>(null);
  const triggerRefs = useRef<Partial<Record<WindowMenuId, HTMLButtonElement | null>>>({});

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const value = await appWindow.isMaximized();
        if (mounted) setMaximized(value);
      } catch {
        // Browser/Vitest fallback starts unmaximized.
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (aboutOpen) {
      const timer = window.setTimeout(() => aboutCloseRef.current?.focus(), 0);
      const handleKeyDown = (event: globalThis.KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        setAboutOpen(false);
        window.setTimeout(() => triggerRefs.current.help?.focus(), 0);
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        window.clearTimeout(timer);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
    return undefined;
  }, [aboutOpen]);

  useEffect(() => {
    if (!openMenu) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;
      if (Object.values(triggerRefs.current).some(trigger => trigger?.contains(target))) return;
      closeMenu();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenu]);

  const closeMenu = (restoreFocus = true) => {
    const current = openMenu;
    setOpenMenu(null);
    if (current && restoreFocus) {
      window.setTimeout(() => triggerRefs.current[current]?.focus(), 0);
    }
  };

  const focusMenuItem = (menu: WindowMenuId, position: 'first' | 'last' = 'first') => {
    window.setTimeout(() => {
      const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
      if (!items?.length) return;
      (position === 'last' ? items[items.length - 1] : items[0]).focus();
    }, 0);
    setOpenMenu(menu);
  };

  const toggleMenu = (menu: WindowMenuId) => {
    if (openMenu === menu) {
      closeMenu();
      return;
    }
    focusMenuItem(menu);
  };

  const handleMenuTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>, menu: WindowMenuId) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      focusMenuItem(menu);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusMenuItem(menu, 'last');
    } else if (event.key === 'Escape' && openMenu) {
      event.preventDefault();
      closeMenu();
    }
  };

  const handleMenuItemKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    if (!items?.length) return;
    const index = Array.from(items).indexOf(event.currentTarget);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1) % items.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1].focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    }
  };

  const minimize = async () => {
    await callTauriWindowAction('minimize');
  };

  const toggleMaximize = async () => {
    const handled = await callTauriWindowAction('toggleMaximize');
    if (!handled) setMaximized(value => !value);
    else setMaximized(value => !value);
  };

  const closeWindow = async () => {
    const handled = await callTauriWindowAction('close');
    if (!handled && typeof window !== 'undefined' && typeof window.close === 'function') {
      try {
        window.close();
      } catch {
        // Browsers may refuse to close a tab they did not open.
      }
    }
  };

  const updateZoom = (nextZoom: number) => {
    const bounded = Math.min(1.5, Math.max(0.8, Number(nextZoom.toFixed(2))));
    setZoom(bounded);
    setBrowserZoom(bounded);
  };

  const menus: Record<WindowMenuId, MenuItem[]> = {
    file: [
      { label: 'Close window', onSelect: closeWindow },
    ],
    edit: [
      { label: 'Undo', onSelect: () => runDocumentCommand('undo') },
      { label: 'Redo', onSelect: () => runDocumentCommand('redo') },
      { label: 'Cut', onSelect: () => runDocumentCommand('cut') },
      { label: 'Copy', onSelect: () => runDocumentCommand('copy') },
      { label: 'Paste', onSelect: () => runDocumentCommand('paste') },
    ],
    view: [
      { label: 'Zoom in', onSelect: () => updateZoom(zoom + 0.1) },
      { label: 'Zoom out', onSelect: () => updateZoom(zoom - 0.1) },
      { label: 'Reset zoom', onSelect: () => updateZoom(1) },
    ],
    help: [
      {
        label: 'About Centinel',
        onSelect: () => setAboutOpen(true),
      },
    ],
  };

  const handleDragMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button === 0) void callTauriWindowAction('startDragging');
  };

  return (
    <header className="window-header" aria-label="Application window controls">
      <div
        className="window-header-brand"
        data-tauri-drag-region
        onDoubleClick={() => { void toggleMaximize(); }}
      >
        <img src="/assets/centinel-shield.svg" alt="" aria-hidden="true" />
        <span>Centinel</span>
      </div>

      <nav className="window-header-menus" aria-label="Application menu">
        {(Object.keys(MENU_LABELS) as WindowMenuId[]).map(menu => (
          <div className="window-menu" key={menu}>
            <button
              type="button"
              className="window-menu-trigger"
              ref={element => { triggerRefs.current[menu] = element; }}
              aria-haspopup="menu"
              aria-expanded={openMenu === menu}
              onClick={() => toggleMenu(menu)}
              onKeyDown={event => handleMenuTriggerKeyDown(event, menu)}
            >
              {MENU_LABELS[menu]}
            </button>
            {openMenu === menu && (
              <div className="window-menu-popup" ref={menuRef} role="menu" aria-label={`${MENU_LABELS[menu]} menu`}>
                {menus[menu].map(item => (
                  <button
                    type="button"
                    role="menuitem"
                    className="window-menu-item"
                    key={item.label}
                    onClick={async () => {
                      await item.onSelect();
                      closeMenu(item.label !== 'About Centinel');
                    }}
                    onKeyDown={handleMenuItemKeyDown}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div
        className="window-header-drag-region"
        data-tauri-drag-region
        aria-hidden="true"
        onMouseDown={handleDragMouseDown}
        onDoubleClick={() => { void toggleMaximize(); }}
      />

      <div className="window-header-controls" aria-label="Window controls">
        <button type="button" className="window-control" aria-label="Minimize window" title="Minimize" onClick={() => { void minimize(); }}>
          <Minus size={16} strokeWidth={1.7} aria-hidden="true" />
        </button>
        <button type="button" className="window-control" aria-label={maximized ? 'Restore window' : 'Maximize window'} title={maximized ? 'Restore' : 'Maximize'} onClick={() => { void toggleMaximize(); }}>
          {maximized
            ? <Copy data-testid="restore-window-icon" size={15} strokeWidth={1.7} aria-hidden="true" />
            : <Square data-testid="maximize-window-icon" size={15} strokeWidth={1.7} aria-hidden="true" />}
        </button>
        <button type="button" className="window-control window-control-close" aria-label="Close window" title="Close" onClick={() => { void closeWindow(); }}>
          <X size={16} strokeWidth={1.7} aria-hidden="true" />
        </button>
      </div>

      {aboutOpen && (
        <div className="window-about" role="dialog" aria-modal="true" aria-labelledby="window-about-title">
          <div className="window-about-card">
            <h2 id="window-about-title">About Centinel</h2>
            <p>Centinel is a local-first quality-assurance workspace for Review and Dynamic Testing.</p>
            <button ref={aboutCloseRef} autoFocus type="button" className="btn-secondary" onClick={() => {
              setAboutOpen(false);
              window.setTimeout(() => triggerRefs.current.help?.focus(), 0);
            }}>Close</button>
          </div>
        </div>
      )}
    </header>
  );
}
