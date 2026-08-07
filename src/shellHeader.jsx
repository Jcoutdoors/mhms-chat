import React from 'react';

// ShellHeader (Stage 2 Slice 5) — the persistent platform chrome. Presentation-only: it shows the
// organization identity and the Home/Community destination navigation, and reports selections up
// through onSelectDestination. It owns NO destination state (PlatformShell does) and takes NO runtime,
// Stream client, auth controller/state, channel/unread/thread state, or profile/logout callbacks.
//
// Navigation entries come from config.destinations — the single organization source of truth — so no
// destination (Home/Community) is hardcoded here and the shell stays organization-agnostic. Identity
// text comes from config.orgName; the active-state accent uses config.brandColor. No logo/avatar mark
// is baked in.
//
// Semantics: a <header> containing the identity and a <nav aria-label="Primary"> with one <button> per
// destination. The active destination is exposed with aria-current="page" (exactly one at a time).
// There is no routing yet, so these are real buttons — no href, hash, router Link, or History API — and
// there is no URL/hash/history/storage behavior. Destination-change focus management and aria-live
// announcements are deliberately NOT here (they are a later, separately scoped concern).
export function ShellHeader({ config, activeDestination, onSelectDestination }) {
  const destinations = (config && Array.isArray(config.destinations)) ? config.destinations : [];
  const orgName = (config && config.orgName) || '';
  const brandColor = (config && config.brandColor) || '#3b73d8';

  return (
    <header
      style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, height: 56, padding: '0 16px', boxSizing: 'border-box',
        background: 'var(--platform-header-background, #fff)',
        borderBottom: '1px solid var(--platform-header-border, #eef0f5)',
        fontFamily: "var(--platform-font-body, 'DM Sans', sans-serif)",
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
        <span
          style={{
            fontSize: 15, fontWeight: 700, color: 'var(--platform-text-primary, #181b26)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {orgName}
        </span>
      </div>
      <nav aria-label="Primary" style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {destinations.map((d) => {
          const isActive = d.id === activeDestination;
          return (
            <button
              key={d.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSelectDestination(d.id)}
              style={{
                cursor: 'pointer', border: 'none', borderRadius: 8,
                minHeight: 44, padding: '9px 15px',
                fontFamily: "var(--platform-font-body, 'DM Sans', sans-serif)",
                fontSize: 14, fontWeight: isActive ? 700 : 600,
                background: isActive ? `var(--platform-accent, ${brandColor})` : 'transparent',
                color: isActive ? 'var(--platform-text-on-accent, #fff)' : 'var(--platform-text-secondary, #4a4f5e)',
              }}
            >
              {d.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
