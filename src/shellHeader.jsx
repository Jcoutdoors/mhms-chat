import React from 'react';

// ShellHeader (Stage 3 Slice 1b) — the top UTILITY header. As of the global-shell slice it is NO LONGER
// the primary destination switcher (Home/Community moved to the GlobalSidebar). Its role is global
// utility: the sidebar toggle, a compact current-area context label, and a secondary Help shortcut.
// Presentation-only: it owns no state, takes no runtime/auth/Stream dependency, and does NOT duplicate
// the primary destination navigation.
//
// The toggle controls the global sidebar (collapse on desktop / open the drawer on mobile). It exposes
// aria-expanded + aria-controls (pointing at the sidebar/drawer) and receives a ref from PlatformShell
// so focus can return to it when the mobile drawer closes. Colors/typography come from --platform-*
// tokens; the focus ring is the Slice 1a --platform-focus-ring.

function ToggleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function ShellHeader({ config, activeLabel, navExpanded, navControlsId, isMobile, onToggleSidebar, toggleRef }) {
  const orgName = (config && config.orgName) || '';
  const supportContact = (config && config.supportContact) || '';
  const toggleLabel = isMobile
    ? (navExpanded ? 'Close global navigation' : 'Open global navigation')
    : (navExpanded ? 'Collapse navigation' : 'Expand navigation');

  return (
    <header
      style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, height: 56, padding: '0 12px 0 8px', boxSizing: 'border-box',
        background: 'var(--platform-header-background, #fff)',
        borderBottom: '1px solid var(--platform-header-border, #eef0f5)',
        fontFamily: "var(--platform-font-body, 'DM Sans', sans-serif)",
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <button
          ref={toggleRef}
          type="button"
          onClick={onToggleSidebar}
          aria-label={toggleLabel}
          aria-expanded={!!navExpanded}
          aria-controls={navControlsId}
          style={{
            flexShrink: 0, width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', borderRadius: 9, cursor: 'pointer', background: 'transparent',
            color: 'var(--platform-text-secondary, #4a4f5e)',
          }}
        >
          <ToggleIcon />
        </button>
        {/* Compact current-area context (not navigation — the primary nav lives in the sidebar). */}
        <span
          style={{
            fontSize: 15, fontWeight: 700, color: 'var(--platform-text-primary, #181b26)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {activeLabel || orgName}
        </span>
      </div>
      {/* Secondary Help access (primary Help lives in the sidebar utility area). */}
      <a
        href={supportContact ? `mailto:${supportContact}` : undefined}
        aria-label="Help"
        style={{
          flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 40, padding: '0 12px',
          borderRadius: 9, textDecoration: 'none', fontSize: 14, fontWeight: 600,
          fontFamily: "var(--platform-font-body, 'DM Sans', sans-serif)",
          color: 'var(--platform-text-secondary, #4a4f5e)',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M9.1 9a3 3 0 1 1 4.6 2.5c-.9.6-1.7 1.2-1.7 2.5M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
        <span>Help</span>
      </a>
    </header>
  );
}
