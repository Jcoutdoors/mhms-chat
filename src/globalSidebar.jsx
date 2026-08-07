import React from 'react';

// GlobalSidebar (Stage 3 Slice 1b) — the platform's PRIMARY destination navigation ("which major area
// am I in?"). Presentation-only: it renders the organization identity, one accessible control per
// enabled configured destination, and a Help & Support utility. It owns NO state — the active
// destination, the collapsed flag, and selection all arrive as props from the single shell owner
// (PlatformShell). It takes NO runtime/auth/Stream dependency.
//
// Config-driven: destinations come from `config.destinations` ({id,label,enabled?,icon?}); only
// `enabled !== false` entries render, and icons resolve from a small built-in set (neutral fallback for
// unknown/absent). No organization/product name is hardcoded here — identity text is `config.orgName`/
// `config.orgSubtitle`, the collapsed mark is the org's first initial, and Help routes to
// `config.supportContact` when present. This is NOT Community's channel navigation (that stays inside
// Community); this answers only the top-level area.
//
// Accessibility: a labelled <nav>; each destination is a real <button type="button"> with an accessible
// name that survives collapsed (icon-only) mode via aria-label + title; the active destination carries
// aria-current="page" (exactly one). Focus indicators use the Slice 1a --platform-focus-ring token.

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V20h5v-6h4v6h5V9.5',
  community: 'M17 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7 0a3 3 0 1 0-2.5-4.6M21 20v-1a3.5 3.5 0 0 0-2.5-3.35',
  help: 'M9.1 9a3 3 0 1 1 4.6 2.5c-.9.6-1.7 1.2-1.7 2.5M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  dot: 'M12 12h.01',
};

function Glyph({ name }) {
  const d = ICONS[name] || ICONS.dot;
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      <path d={d} />
    </svg>
  );
}

export function GlobalSidebar({ config, activeDestination, onSelectDestination, collapsed = false }) {
  const all = (config && Array.isArray(config.destinations)) ? config.destinations : [];
  const destinations = all.filter((d) => d && d.enabled !== false && d.id);
  const orgName = (config && config.orgName) || '';
  const orgSubtitle = (config && config.orgSubtitle) || '';
  const supportContact = (config && config.supportContact) || '';
  const initial = (orgName.trim()[0] || '•').toUpperCase();

  const railBg = 'var(--platform-sidebar-background, #f7f8fb)';
  const activeBg = 'var(--platform-sidebar-active, #e6ebfb)';
  const textPrimary = 'var(--platform-sidebar-text, #181b26)';
  const textMuted = 'var(--platform-sidebar-muted, #686e7e)';
  const border = 'var(--platform-border-subtle, #eef0f5)';

  const itemBase = {
    display: 'flex', alignItems: 'center', gap: 12, width: '100%',
    minHeight: 44, padding: collapsed ? '10px 0' : '10px 12px',
    justifyContent: collapsed ? 'center' : 'flex-start',
    border: 'none', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
    fontFamily: "var(--platform-font-body, 'DM Sans', sans-serif)", fontSize: 14, background: 'transparent',
    color: textMuted,
  };

  return (
    <nav
      aria-label="Primary"
      style={{
        display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box',
        width: '100%', background: railBg, borderRight: `1px solid ${border}`,
        fontFamily: "var(--platform-font-body, 'DM Sans', sans-serif)", color: textPrimary,
        padding: collapsed ? '14px 10px' : '14px 12px', gap: 6,
      }}
    >
      {/* Organization identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: collapsed ? '2px 0 10px' : '2px 6px 12px', justifyContent: collapsed ? 'center' : 'flex-start' }}>
        <div aria-hidden="true" style={{
          flexShrink: 0, width: 32, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--platform-accent, #3b73d8)', color: 'var(--platform-text-on-accent, #fff)', fontWeight: 700, fontSize: 15,
        }}>{initial}</div>
        {!collapsed && (
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{orgName}</div>
            {orgSubtitle ? <div style={{ fontSize: 12, color: textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{orgSubtitle}</div> : null}
          </div>
        )}
      </div>

      {/* Primary destinations */}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        {destinations.map((d) => {
          const isActive = d.id === activeDestination;
          return (
            <li key={d.id}>
              <button
                type="button"
                aria-current={isActive ? 'page' : undefined}
                aria-label={d.label}
                title={collapsed ? d.label : undefined}
                onClick={() => onSelectDestination(d.id)}
                style={{
                  ...itemBase,
                  fontWeight: isActive ? 700 : 600,
                  background: isActive ? activeBg : 'transparent',
                  color: isActive ? textPrimary : textMuted,
                }}
              >
                <Glyph name={d.icon} />
                {!collapsed && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Utility area — Help & Support */}
      <div style={{ borderTop: `1px solid ${border}`, paddingTop: 8, marginTop: 6 }}>
        <a
          href={supportContact ? `mailto:${supportContact}` : undefined}
          aria-label="Help & Support"
          title={collapsed ? 'Help & Support' : undefined}
          style={{ ...itemBase, textDecoration: 'none' }}
        >
          <Glyph name="help" />
          {!collapsed && <span>Help &amp; Support</span>}
        </a>
      </div>
    </nav>
  );
}
