import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ShellHeader } from './shellHeader';
import { GlobalSidebar } from './globalSidebar';
import { HomeDestination } from './homeDestination';

// PlatformShell (Stage 3 Slice 1b) — the durable global application shell and the SINGLE owner of shell
// presentation state: the active top-level destination, the desktop sidebar collapsed flag, the mobile
// global-navigation drawer open flag, and the responsive breakpoint. It composes three layers:
//   - GlobalSidebar — PRIMARY destination navigation (Home/Community, config-driven). Desktop: a
//     collapsible rail. Mobile: an overlay drawer (Escape closes; focus moves in on open and returns to
//     the header toggle on an explicit close; a backdrop dismisses it).
//   - ShellHeader — the top UTILITY header (sidebar toggle + current-area context + Help). It is no
//     longer the destination switcher.
//   - <main> — the content region presenting Home or the Community `children`.
//
// It does NOT own the runtime, Stream client, auth controller, or any Community/channel state — those
// stay in App, above the shell, and remain mounted while the destination switches (the connected
// runtime persists; switching does not reconnect or reset channel/unread/thread/Featured state). This is
// the GLOBAL shell ("which area am I in?"); Community keeps its OWN contextual channel navigation and its
// own mobile channel drawer — those are intentionally separate from this global drawer.
//
// Accessibility (closes the Stage 2 deferred debt): a labelled primary <nav>; aria-current on the active
// destination; accessible names in collapsed/icon-only mode; a keyboard-operable toggle; on a
// destination change, focus moves to the <main> content landmark (post-mount only, never on load) and a
// polite aria-live status announces the new area; the mobile drawer manages focus in/return and Escape.
// Focus indicators use the Slice 1a --platform-focus-ring. No routing/persistence; the narrow
// `initialDestination` review seam remains (App does not pass it in production → Community default).

const NAV_ID = 'platform-global-nav';
const SR_ONLY = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

function useIsMobile() {
  const query = '(max-width: 768px)';
  const read = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
    ? window.matchMedia(query).matches : false;
  const [mobile, setMobile] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const onChange = (e) => setMobile(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, []);
  return mobile;
}

export function PlatformShell({ config, children, initialDestination = 'community' }) {
  const [activeDestination, setActiveDestination] = useState(
    initialDestination === 'home' ? 'home' : 'community',
  );
  const [collapsed, setCollapsed] = useState(false);
  const [globalNavOpen, setGlobalNavOpen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const isMobile = useIsMobile();

  const mainRef = useRef(null);
  const toggleRef = useRef(null);
  const closeBtnRef = useRef(null);
  const didMountRef = useRef(false);
  const prevOpenRef = useRef(false);
  const closedByNavRef = useRef(false);

  const destinations = (config && Array.isArray(config.destinations)) ? config.destinations : [];
  const activeMeta = destinations.find((d) => d && d.id === activeDestination);
  const activeLabel = (activeMeta && activeMeta.label) || '';

  const selectDestination = useCallback((id) => {
    setActiveDestination(id);
    setGlobalNavOpen((open) => {
      if (open) closedByNavRef.current = true; // closing due to navigation → don't yank focus back to toggle
      return false;
    });
  }, []);

  // Destination-change orientation: announce the new area and move focus to the content landmark.
  // Skips the initial mount so page load never steals focus.
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return; }
    setAnnounce(activeLabel);
    if (mainRef.current) mainRef.current.focus();
  }, [activeDestination]); // activeLabel derived from it; intentionally keyed on the destination

  // Mobile drawer: focus the close control on open; listen for Escape to close.
  useEffect(() => {
    if (!isMobile || !globalNavOpen) return undefined;
    const raf = requestAnimationFrame(() => { if (closeBtnRef.current) closeBtnRef.current.focus(); });
    const onKey = (e) => { if (e.key === 'Escape') setGlobalNavOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('keydown', onKey); };
  }, [isMobile, globalNavOpen]);

  // Return focus to the toggle when the drawer closes via an explicit dismiss (Escape / backdrop /
  // close button) — but NOT when it closed because the user navigated to a new destination.
  useEffect(() => {
    if (prevOpenRef.current && !globalNavOpen) {
      if (closedByNavRef.current) closedByNavRef.current = false;
      else if (toggleRef.current) toggleRef.current.focus();
    }
    prevOpenRef.current = globalNavOpen;
  }, [globalNavOpen]);

  const onToggleSidebar = () => {
    if (isMobile) setGlobalNavOpen((o) => !o);
    else setCollapsed((c) => !c);
  };

  const navExpanded = isMobile ? globalNavOpen : !collapsed;

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'row', overflow: 'hidden', background: 'var(--platform-canvas, #f4f6fb)', color: 'var(--platform-text-primary, #181b26)' }}>
      {/* Desktop: the global sidebar is a collapsible rail in normal flow. */}
      {!isMobile && (
        <div id={NAV_ID} style={{ flexShrink: 0, width: collapsed ? 68 : 248, height: '100%', transition: 'width 0.15s ease' }}>
          <GlobalSidebar
            config={config}
            activeDestination={activeDestination}
            onSelectDestination={selectDestination}
            collapsed={collapsed}
          />
        </div>
      )}

      {/* Main column: utility header + content landmark. */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ShellHeader
          config={config}
          activeLabel={activeLabel}
          navExpanded={navExpanded}
          navControlsId={NAV_ID}
          isMobile={isMobile}
          onToggleSidebar={onToggleSidebar}
          toggleRef={toggleRef}
        />
        <main
          id="platform-main"
          ref={mainRef}
          tabIndex={-1}
          aria-label={activeLabel || undefined}
          style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', outline: 'none' }}
        >
          {activeDestination === 'home'
            ? <HomeDestination config={config} onGoToCommunity={() => selectDestination('community')} />
            : children}
        </main>
      </div>

      {/* Mobile: the global sidebar is an overlay drawer (separate from Community's channel drawer). */}
      {isMobile && globalNavOpen && (
        <>
          <div
            onClick={() => setGlobalNavOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(10,14,25,0.45)' }}
          />
          <div
            id={NAV_ID}
            role="dialog"
            aria-modal="true"
            aria-label="Primary navigation"
            style={{ position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 1310, width: 268, maxWidth: '86vw', height: '100dvh', boxShadow: '0 12px 40px rgba(10,14,25,0.35)' }}
          >
            <button
              ref={closeBtnRef}
              type="button"
              onClick={() => setGlobalNavOpen(false)}
              aria-label="Close navigation"
              style={{ position: 'absolute', top: 10, right: 10, zIndex: 1, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 8, cursor: 'pointer', background: 'transparent', color: 'var(--platform-sidebar-muted, #686e7e)' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
            <GlobalSidebar
              config={config}
              activeDestination={activeDestination}
              onSelectDestination={selectDestination}
              collapsed={false}
            />
          </div>
        </>
      )}

      {/* Polite destination-change announcement for assistive technology. */}
      <div role="status" aria-live="polite" style={SR_ONLY}>{announce}</div>
    </div>
  );
}
