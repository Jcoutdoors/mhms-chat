import React, { useLayoutEffect, useState } from 'react';
import { resolveTheme, normalizePreference, themeToCssVars, cssVarName } from './theme.js';

// ThemeProvider (Stage 3 Slice 1a) — the SINGLE owner of theme preference/resolution/application.
//
// It resolves a preference (light | dark | system) against the OS `prefers-color-scheme` signal and
// applies the resolved theme by writing platform CSS custom properties (`--platform-*`) and a
// `data-theme` attribute onto <html>. Downstream components consume the theme purely through those
// CSS variables (e.g. `var(--platform-surface)`), so there is NO duplicate React theme state to keep
// in sync — this is the one resolution seam future Settings→Appearance / org-default / user-override
// flows will drive. It imports NO runtime, auth, or Stream module and owns no destination state.
//
// Preference source (this slice): `initialPreference` prop (review/test seam) ?? URL `?theme=` (local
// verification only) ?? 'system'. NO persistence/localStorage yet — not needed to validate the
// architecture; adding it later is a one-line change at this same seam (documented in the plan).
//
// Accessibility: injects one global `:focus-visible` outline using `--platform-focus-ring` so keyboard
// focus is visible in BOTH themes. (Destination-change focus management and aria-live are explicitly
// Slice 1b, and are NOT implemented here.)

const FOCUS_STYLE_ID = 'platform-theme-base';

function readInitialPreference(initialPreference) {
  if (initialPreference) return normalizePreference(initialPreference);
  if (typeof window !== 'undefined' && window.location && window.location.search) {
    const m = /[?&]theme=(light|dark|system)\b/.exec(window.location.search);
    if (m) return m[1];
  }
  return 'system';
}

function systemPrefersDark() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

// Idempotent: one <style> element carrying theme-level base rules (focus ring + canvas defaults).
function ensureBaseStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FOCUS_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = FOCUS_STYLE_ID;
  el.textContent =
    ':root{color-scheme:light dark}' +
    'html,body{background:var(' + cssVarName('canvas') + ');color:var(' + cssVarName('textPrimary') + ')}' +
    '*:focus-visible{outline:2px solid var(' + cssVarName('focusRing') + ');outline-offset:2px}';
  document.head.appendChild(el);
}

function applyTheme(resolved, orgAccent) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const vars = themeToCssVars(resolved, { orgAccent });
  for (const name in vars) root.style.setProperty(name, vars[name]);
  root.setAttribute('data-theme', resolved);
}

export function ThemeProvider({ children, initialPreference, orgAccent }) {
  const [preference, setPreference] = useState(() => readInitialPreference(initialPreference));
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const resolved = resolveTheme(preference, systemDark);

  // Apply before paint (useLayoutEffect) so there is no unthemed flash; re-applies on any change.
  useLayoutEffect(() => {
    ensureBaseStyle();
    applyTheme(resolved, orgAccent);
  }, [resolved, orgAccent]);

  // Track the OS signal so 'system' stays correct without a reload.
  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setSystemDark(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, []);

  // No global debug API is exposed. Local/QA theme selection is driven either by the
  // `initialPreference` prop (the supported review/test seam) or the narrow `?theme=` query read in
  // readInitialPreference (invalid values still fall back safely via normalizePreference/resolveTheme).
  return children;
}
