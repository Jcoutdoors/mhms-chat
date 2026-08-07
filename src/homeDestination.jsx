import React from 'react';
import { resolveOrgText } from './orgConfig.js';

// HomeDestination (Stage 2 Slice 4) — the minimal Home foundation surface. Presentation only:
// it renders an organization-configured heading, supporting copy, and one primary action that
// returns to Community. It receives NO runtime, Stream client, channel/unread/thread state, auth
// controller, or auth state — only `config` and the `onGoToCommunity` callback (the smallest prop
// contract it actually uses; a user prop is added later only when an approved Home need requires it).
//
// Copy is resolved through the shared orgConfig token-fill (resolveOrgText), so no org-specific
// wording is hardcoded here. This is a foundation, not the final Home experience: no cards,
// dashboards, activity/unread/featured summaries, consultation widgets, assistant surface, tasks,
// learning progress, icons, imagery, or animation.
export function HomeDestination({ config, onGoToCommunity }) {
  const home = (config && config.home) || {};
  const heading = resolveOrgText(config, home.heading || '');
  const supporting = resolveOrgText(config, home.supporting || '');
  const actionLabel = home.goToCommunityLabel || 'Go to Community';

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100%', minHeight: 0, width: '100%', boxSizing: 'border-box',
        padding: '32px 24px', textAlign: 'center',
        fontFamily: "var(--platform-font-body, 'DM Sans', sans-serif)",
        color: 'var(--platform-text-primary, #181b26)', background: 'var(--platform-canvas, #fff)',
      }}
    >
      <div style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <h1 style={{ fontFamily: "var(--platform-font-display, 'DM Sans', sans-serif)", fontSize: 28, fontWeight: 700, letterSpacing: '0.005em', margin: 0, color: 'var(--platform-text-primary, #181b26)' }}>
          {heading}
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--platform-text-secondary, #686e7e)', margin: 0 }}>
          {supporting}
        </p>
        <button
          type="button"
          onClick={onGoToCommunity}
          style={{
            marginTop: 8, cursor: 'pointer', border: 'none',
            background: 'var(--platform-accent, #3a55d9)', color: 'var(--platform-text-on-accent, #fff)',
            fontFamily: "var(--platform-font-body, 'DM Sans', sans-serif)", fontSize: 14, fontWeight: 700,
            padding: '12px 22px', borderRadius: 12, boxShadow: '0 4px 12px var(--platform-neural-glow, rgba(58,85,217,0.28))',
          }}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
