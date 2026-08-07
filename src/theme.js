// Anchor — Neural Canvas theme foundation (Stage 3 Slice 1a).
//
// Pure, dependency-free token data + resolution logic. NO React, NO DOM, NO I/O here — this module
// is safe to import from Node tests and from the browser provider alike (CommonJS, matching
// orgConfig.js / platformRuntime.js). The React/DOM application seam lives in themeProvider.jsx.
//
// Design intent (see PLATFORM_BLUEPRINT.md "Neural Canvas" + ARCHITECTURE_DECISIONS.md ADR-0004):
//   - Light and Dark are two equal, first-class expressions of ONE product system. They share the
//     same semantic token keys; only the values differ. Dark is deliberately layered/premium, not a
//     crude inversion of Light.
//   - Tokens are SEMANTIC (canvas / surface / textPrimary / accent / focusRing …), never literal
//     theme-specific color names, so components never bake in a hex value.
//   - Typography is expressed as semantic tokens FROM THE START (ADR-0004), even though only one
//     value set exists initially: DM Sans remains the current default for both body and display.
//   - Reusable theme logic is ORGANIZATION-NEUTRAL. Organization accent (e.g. MHMS brandColor) is
//     layered on at application time via `themeToCssVars(..., { orgAccent })`, never hardcoded here.
//   - `neural*` tokens are reserved semantic concepts for later slices (no animation in 1a).

'use strict';

// The canonical semantic token keys. LIGHT and DARK must each define EXACTLY these (completeness is
// asserted in tests). Grouped by concept for readability; order is not significant.
const COLOR_TOKEN_KEYS = [
  // canvas / surfaces
  'canvas', 'canvasSubtle', 'surface', 'surfaceRaised', 'surfaceInteractive',
  // text
  'textPrimary', 'textSecondary', 'textMuted', 'textOnAccent',
  // borders / dividers
  'borderSubtle', 'borderStrong',
  // accent
  'accent', 'accentHover', 'accentSoft', 'accentText',
  // status
  'success', 'warning', 'danger',
  // shell-ready (consumed by the Slice 1b shell; defined now so it can adopt them cleanly)
  'sidebarBackground', 'sidebarSurface', 'sidebarText', 'sidebarMuted', 'sidebarActive',
  'headerBackground', 'headerBorder',
  // accessibility
  'focusRing',
  // neural visual language (reserved; no animation in Slice 1a)
  'neuralNodePrimary', 'neuralNodeSecondary', 'neuralPath', 'neuralGlow',
];

// LIGHT — clean, professional, open, calm, highly readable, commercially broad.
const LIGHT = {
  canvas: '#f4f6fb', canvasSubtle: '#eef1f8', surface: '#ffffff', surfaceRaised: '#ffffff', surfaceInteractive: '#f7f8fb',
  textPrimary: '#181b26', textSecondary: '#383d4b', textMuted: '#686e7e', textOnAccent: '#ffffff',
  borderSubtle: '#eef0f5', borderStrong: '#d7dbe6',
  accent: '#3a55d9', accentHover: '#2f44b8', accentSoft: '#e6ebfb', accentText: '#2f44b8',
  success: '#1f9d5f', warning: '#a9701f', danger: '#c1384c',
  sidebarBackground: '#f7f8fb', sidebarSurface: '#ffffff', sidebarText: '#181b26', sidebarMuted: '#686e7e', sidebarActive: '#e6ebfb',
  headerBackground: '#ffffff', headerBorder: '#eef0f5',
  focusRing: '#2f44b8',
  neuralNodePrimary: '#3a55d9', neuralNodeSecondary: '#5872ea', neuralPath: '#c4cde8', neuralGlow: 'rgba(58,85,217,0.18)',
};

// DARK — premium, immersive, focused, layered; high contrast without fatigue; room for stronger
// neural luminosity in later slices.
const DARK = {
  canvas: '#0f1420', canvasSubtle: '#131a29', surface: '#171e2e', surfaceRaised: '#1e2740', surfaceInteractive: '#222c46',
  textPrimary: '#f2f4fa', textSecondary: '#c7cee0', textMuted: '#949cb1', textOnAccent: '#ffffff',
  borderSubtle: '#26304a', borderStrong: '#384461',
  accent: '#5872ea', accentHover: '#7189f0', accentSoft: '#202a49', accentText: '#c2cef8',
  success: '#37c98a', warning: '#e0a94a', danger: '#ec6a7a',
  sidebarBackground: '#131a29', sidebarSurface: '#171e2e', sidebarText: '#f2f4fa', sidebarMuted: '#949cb1', sidebarActive: '#202a49',
  headerBackground: '#131a29', headerBorder: '#26304a',
  focusRing: '#8ea2ff',
  neuralNodePrimary: '#7189f0', neuralNodeSecondary: '#9db0ff', neuralPath: '#2b3a63', neuralGlow: 'rgba(120,145,240,0.28)',
};

const THEMES = { light: LIGHT, dark: DARK };

// Typography — semantic tokens (ADR-0004). Only one value set exists initially: DM Sans everywhere.
// Future explicit typography / org-level typography becomes a token-value change, not a structural one.
const DM_SANS_STACK = "'DM Sans', system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const TYPOGRAPHY = {
  fontBody: DM_SANS_STACK,
  fontDisplay: DM_SANS_STACK,
  weightRegular: '400',
  weightMedium: '500',
  weightSemibold: '600',
  weightBold: '700',
  scaleXs: '12px', scaleSm: '13px', scaleBase: '15px', scaleLg: '18px', scaleXl: '22px', scaleDisplay: '28px',
  lineTight: '1.25', lineNormal: '1.5', lineRelaxed: '1.6',
};

const TYPOGRAPHY_TOKEN_KEYS = Object.keys(TYPOGRAPHY);
const THEME_TOKEN_KEYS = COLOR_TOKEN_KEYS.slice();
const THEME_PREFERENCES = ['light', 'dark', 'system'];

// Resolve a stored PREFERENCE (light | dark | system | anything-invalid) plus the current system
// signal into a concrete THEME name (light | dark). Invalid/unknown preferences fall back to the
// safe "system" behavior — never an unreadable/undefined state.
function resolveTheme(preference, systemPrefersDark) {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  // 'system' and any invalid value both defer to the OS signal.
  return systemPrefersDark ? 'dark' : 'light';
}

// Normalize an arbitrary string into a supported preference; unknown -> 'system'.
function normalizePreference(preference) {
  return THEME_PREFERENCES.indexOf(preference) === -1 ? 'system' : preference;
}

// kebab-case a camelCase token key: textPrimary -> text-primary
function kebab(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

// The CSS custom-property name for a token key: 'textPrimary' -> '--anchor-text-primary'.
function cssVarName(key) {
  return '--anchor-' + kebab(key);
}

// Build the full { '--anchor-*': value } map for a resolved theme, including typography tokens.
// `orgAccent` (optional) layers an organization brand color onto the accent tokens WITHOUT the
// theme module knowing anything organization-specific: accent + accentHover derive from it, and a
// soft/text variant fall back to the theme defaults so contrast stays theme-appropriate.
function themeToCssVars(themeName, options) {
  const opts = options || {};
  const base = THEMES[themeName] || LIGHT;
  const vars = {};
  for (const key of THEME_TOKEN_KEYS) vars[cssVarName(key)] = base[key];
  for (const key of TYPOGRAPHY_TOKEN_KEYS) vars[cssVarName(key)] = TYPOGRAPHY[key];
  if (typeof opts.orgAccent === 'string' && opts.orgAccent) {
    vars[cssVarName('accent')] = opts.orgAccent;
    // Keep a sensible hover if only a single brand color is supplied: reuse theme default hover.
    vars[cssVarName('accentHover')] = base.accentHover;
  }
  return vars;
}

// --- contrast helpers (used by tests to assert accessible foundations; pure, no DOM) ---
function _hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}
function _relLum(hex) {
  const srgb = _hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}
// WCAG contrast ratio between two solid hex colors (1..21).
function contrastRatio(hexA, hexB) {
  const la = _relLum(hexA), lb = _relLum(hexB);
  const light = Math.max(la, lb), dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

module.exports = {
  LIGHT, DARK, THEMES, TYPOGRAPHY,
  THEME_TOKEN_KEYS, TYPOGRAPHY_TOKEN_KEYS, THEME_PREFERENCES,
  resolveTheme, normalizePreference, cssVarName, themeToCssVars, contrastRatio,
};
