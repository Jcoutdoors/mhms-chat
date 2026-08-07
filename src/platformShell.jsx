import React, { useState } from 'react';
import { ShellHeader } from './shellHeader';
import { HomeDestination } from './homeDestination';

// PlatformShell (Stage 2 Slice 5) — the authenticated presentation container and owner of the platform
// chrome. It owns ONLY the in-memory active-destination selection, renders the persistent ShellHeader
// above the content region, and conditionally presents Home or Community inside that region:
//   - ShellHeader shows organization identity + Home/Community navigation (labels from
//     config.destinations) and calls back here to switch destinations.
//   - Community (the default) is the `children` presentation App constructs and passes in.
//   - Home is HomeDestination, composed here from `config`.
//
// It does NOT own the runtime, Stream client, auth controller, or any Community/channel state — those
// stay in App, above the shell, and remain mounted while the destination switches. Only the Community
// *presentation* unmounts when Home is active; the connected runtime persists, so switching does NOT
// reconnect, re-run setupChannels, reset the active channel, or clear unread/thread/Featured state.
// Re-selecting the already-active destination is a no-op (setState to the same value).
//
// Layout: PlatformShell owns the viewport-height shell as a flex column. ShellHeader is fixed-height
// chrome (flex-shrink:0); the content region flexes to fill the remaining space (flex:1, min-height:0),
// so the active destination fills the area BENEATH the header instead of adding a second viewport
// height. Community's outer sizing was switched to height:100% to fill this region (no magic pixel
// subtraction). The outer shell uses 100dvh so mobile dynamic-viewport behavior is preserved.
//
// Still NO routing or persistence (a later slice): destination state is in-memory only — no URL, hash,
// history, or storage — so a refresh returns authenticated users to Community. The narrow
// `initialDestination` review seam remains; App does NOT pass it in production, so authenticated users
// still initialize to Community. Destination-change focus management and aria-live announcements are
// deliberately not here yet (a later, separately scoped concern).
export function PlatformShell({ config, children, initialDestination = 'community' }) {
  const [activeDestination, setActiveDestination] = useState(
    initialDestination === 'home' ? 'home' : 'community',
  );

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--platform-canvas, #f4f6fb)', color: 'var(--platform-text-primary, #181b26)' }}>
      <ShellHeader
        config={config}
        activeDestination={activeDestination}
        onSelectDestination={setActiveDestination}
      />
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {activeDestination === 'home' ? (
          <HomeDestination
            config={config}
            onGoToCommunity={() => setActiveDestination('community')}
          />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
