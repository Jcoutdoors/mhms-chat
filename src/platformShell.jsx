import React from 'react';

// PlatformShell (Stage 2 Slice 2) — the authenticated presentation container that will later
// host platform-level destinations and shell chrome. Slice 2 is a behavior-preserving BOUNDARY
// ONLY: it renders its single child (CommunityDestination) as the sole, always-active
// destination and adds NO shell chrome, navigation, destination state, layout, or wrapper DOM.
//
// It renders a React.Fragment so the DOM beneath it is byte-identical to Slice 1 — the shell
// introduces a composition seam without changing what the user sees. It intentionally imports
// nothing from App, CommunityDestination, the runtime, the auth controller, or organization
// configuration; it simply composes `children`. No destination-selection state is added yet: it
// is not structurally necessary while Community is the only destination, and adding it now would
// be speculative (it arrives in a later slice alongside real navigation).
export function PlatformShell({ children }) {
  return <>{children}</>;
}
