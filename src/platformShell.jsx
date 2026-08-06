import React, { useState } from 'react';
import { HomeDestination } from './homeDestination';

// PlatformShell (Stage 2 Slice 4) — the authenticated presentation container. It owns ONLY the
// in-memory active-destination selection and conditionally presents either Home or Community:
//   - Community (the default) is the `children` presentation App constructs and passes in.
//   - Home is HomeDestination, composed here from `config` + `homeProps`.
//
// It does NOT own the runtime, Stream client, auth controller, or any Community/channel state —
// those stay in App, above the shell, and remain mounted while the destination switches (only the
// Community *presentation* unmounts when Home is active; the connected runtime persists).
//
// Slice 4 ships NO visible shell header or Home/Community navigation (that is Slice 5). Home is
// reachable only through the narrow `initialDestination` review seam, which App does NOT pass in
// production, so authenticated users still land in Community. Destination state is in-memory only:
// no URL, hash, history, or storage persistence — it does not survive refresh/logout/remount.
export function PlatformShell({ config, homeProps, children, initialDestination = 'community' }) {
  const [activeDestination, setActiveDestination] = useState(
    initialDestination === 'home' ? 'home' : 'community',
  );

  if (activeDestination === 'home') {
    return (
      <HomeDestination
        config={config}
        currentUser={homeProps && homeProps.currentUser}
        onGoToCommunity={() => setActiveDestination('community')}
      />
    );
  }

  return <>{children}</>;
}
