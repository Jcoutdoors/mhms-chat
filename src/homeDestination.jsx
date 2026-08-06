import React from 'react';
import { resolveOrgText } from './orgConfig.js';

// HomeDestination (Stage 2 Slice 4) — the minimal Home foundation surface. Presentation only:
// it renders an organization-configured heading, supporting copy, and one primary action that
// returns to Community. It receives NO runtime, Stream client, channel/unread/thread state, auth
// controller, or auth state — only `config`, `currentUser` (reserved for future personalization;
// unused until an approved config field supports it), and the `onGoToCommunity` callback.
//
// Copy is resolved through the shared orgConfig token-fill (resolveOrgText), so no org-specific
// wording is hardcoded here. This is a foundation, not the final Home experience: no cards,
// dashboards, activity/unread/featured summaries, consultation widgets, assistant surface, tasks,
// learning progress, icons, imagery, or animation.
export function HomeDestination({ config, currentUser, onGoToCommunity }) {
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
        fontFamily: "'DM Sans', sans-serif", color: '#181b26', background: '#fff',
      }}
    >
      <div style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 28, fontWeight: 700, letterSpacing: '0.005em', margin: 0, color: '#181b26' }}>
          {heading}
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: '#686e7e', margin: 0 }}>
          {supporting}
        </p>
        <button
          type="button"
          onClick={onGoToCommunity}
          style={{
            marginTop: 8, cursor: 'pointer', border: 'none',
            background: 'linear-gradient(135deg,#3a55d9,#2f44b8)', color: '#fff',
            fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 700,
            padding: '12px 22px', borderRadius: 12, boxShadow: '0 4px 12px rgba(58,85,217,0.28)',
          }}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
