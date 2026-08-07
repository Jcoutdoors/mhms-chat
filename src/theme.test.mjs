// Stage 3 Slice 1a — theme foundation guards. Pure-logic behavioral tests over theme.js plus
// structural guards that the theme seam does not disturb destination/runtime ownership. No DOM here
// (the ThemeProvider's document/matchMedia glue is verified via the local browser screenshots).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LIGHT, DARK, TYPOGRAPHY,
  THEME_TOKEN_KEYS, TYPOGRAPHY_TOKEN_KEYS, THEME_PREFERENCES,
  resolveTheme, normalizePreference, cssVarName, themeToCssVars, contrastRatio,
} from './theme.js';

const PROVIDER = readFileSync(new URL('./themeProvider.jsx', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('./index.jsx', import.meta.url), 'utf8');
const SHELL = readFileSync(new URL('./platformShell.jsx', import.meta.url), 'utf8');
const HEADER = readFileSync(new URL('./shellHeader.jsx', import.meta.url), 'utf8');
const HOME = readFileSync(new URL('./homeDestination.jsx', import.meta.url), 'utf8');

function fnBody(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} present`);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `${name} body delimited`);
  return src.slice(start, end + 3);
}

// ---- resolution ----
test('1. an explicit light preference resolves to light (regardless of system)', () => {
  assert.equal(resolveTheme('light', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
});

test('2. an explicit dark preference resolves to dark (regardless of system)', () => {
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('dark', true), 'dark');
});

test('3. system preference resolves to light when the OS is light', () => {
  assert.equal(resolveTheme('system', false), 'light');
});

test('4. system preference resolves to dark when the OS is dark', () => {
  assert.equal(resolveTheme('system', true), 'dark');
});

test('5. an invalid/unknown preference falls back to system behavior (never undefined/unreadable)', () => {
  assert.equal(resolveTheme('rainbow', false), 'light');
  assert.equal(resolveTheme('rainbow', true), 'dark');
  assert.equal(resolveTheme(undefined, true), 'dark');
  assert.equal(resolveTheme(null, false), 'light');
  // normalizePreference collapses unknowns to 'system' (the documented safe default)
  assert.equal(normalizePreference('rainbow'), 'system');
  assert.equal(normalizePreference('dark'), 'dark');
  assert.deepEqual(THEME_PREFERENCES, ['light', 'dark', 'system']);
});

// ---- token completeness ----
test('6. Light and Dark define exactly the same complete semantic token set', () => {
  assert.ok(THEME_TOKEN_KEYS.length >= 25, 'a meaningful token set exists');
  for (const key of THEME_TOKEN_KEYS) {
    assert.equal(typeof LIGHT[key], 'string', `LIGHT.${key} defined`);
    assert.ok(LIGHT[key].length > 0, `LIGHT.${key} non-empty`);
    assert.equal(typeof DARK[key], 'string', `DARK.${key} defined`);
    assert.ok(DARK[key].length > 0, `DARK.${key} non-empty`);
  }
  // no extra keys beyond the canonical list
  assert.deepEqual(Object.keys(LIGHT).sort(), THEME_TOKEN_KEYS.slice().sort(), 'LIGHT has no extra/missing keys');
  assert.deepEqual(Object.keys(DARK).sort(), THEME_TOKEN_KEYS.slice().sort(), 'DARK has no extra/missing keys');
});

test('7. required semantic concepts are present (canvas/surface/text/accent/status/shell/focus/neural)', () => {
  for (const key of [
    'canvas', 'surface', 'surfaceRaised', 'textPrimary', 'textSecondary', 'textMuted', 'textOnAccent',
    'borderSubtle', 'borderStrong', 'accent', 'accentHover', 'accentSoft', 'success', 'warning', 'danger',
    'sidebarBackground', 'sidebarActive', 'headerBackground', 'headerBorder', 'focusRing',
    'neuralNodePrimary', 'neuralPath',
  ]) {
    assert.ok(THEME_TOKEN_KEYS.includes(key), `token ${key} exists`);
  }
});

// ---- typography (ADR-0004) ----
test('8. typography tokens exist and default to DM Sans (no Inter / Plus Jakarta)', () => {
  assert.ok(TYPOGRAPHY_TOKEN_KEYS.includes('fontBody'), 'fontBody token exists');
  assert.ok(TYPOGRAPHY_TOKEN_KEYS.includes('fontDisplay'), 'fontDisplay token exists');
  assert.ok(/DM Sans/.test(TYPOGRAPHY.fontBody), 'body font defaults to DM Sans');
  assert.ok(/DM Sans/.test(TYPOGRAPHY.fontDisplay), 'display font defaults to DM Sans');
  const all = JSON.stringify(TYPOGRAPHY);
  assert.equal(/Inter|Plus Jakarta/.test(all), false, 'no AI-concept fonts leaked in');
  // semantic weight + scale + line-height concepts are present from the start
  for (const k of ['weightRegular', 'weightBold', 'scaleBase', 'scaleDisplay', 'lineNormal']) {
    assert.ok(TYPOGRAPHY_TOKEN_KEYS.includes(k), `typography token ${k} exists`);
  }
});

// ---- css-var mapping + organization accent ----
test('9. themeToCssVars emits --anchor-* custom properties for every color + typography token', () => {
  const vars = themeToCssVars('light', {});
  assert.equal(cssVarName('textPrimary'), '--anchor-text-primary');
  for (const key of THEME_TOKEN_KEYS) assert.ok(cssVarName(key) in vars, `${cssVarName(key)} present`);
  for (const key of TYPOGRAPHY_TOKEN_KEYS) assert.ok(cssVarName(key) in vars, `${cssVarName(key)} present`);
  assert.equal(vars['--anchor-canvas'], LIGHT.canvas);
});

test('10. an organization accent overrides ONLY the accent token, not the reusable theme logic', () => {
  const withOrg = themeToCssVars('light', { orgAccent: '#3b73d8' });
  assert.equal(withOrg['--anchor-accent'], '#3b73d8', 'org brand color drives accent');
  assert.equal(withOrg['--anchor-canvas'], LIGHT.canvas, 'non-accent tokens unchanged');
  assert.equal(withOrg['--anchor-text-primary'], LIGHT.textPrimary, 'text tokens unchanged');
  // theme.js itself hardcodes no MHMS/org color as the accent default
  const themeSrc = readFileSync(new URL('./theme.js', import.meta.url), 'utf8');
  assert.equal(themeSrc.includes('#3b73d8'), false, 'MHMS brandColor is not baked into theme.js');
});

// ---- accessibility foundations ----
test('11. body/heading text meets >=4.5:1 contrast on canvas and surface in BOTH themes', () => {
  for (const [name, t] of [['light', LIGHT], ['dark', DARK]]) {
    for (const bg of ['canvas', 'surface', 'surfaceRaised']) {
      assert.ok(contrastRatio(t.textPrimary, t[bg]) >= 4.5, `${name}: textPrimary on ${bg} >= 4.5`);
      assert.ok(contrastRatio(t.textSecondary, t[bg]) >= 4.5, `${name}: textSecondary on ${bg} >= 4.5`);
    }
    assert.ok(contrastRatio(t.textMuted, t.surface) >= 4.5, `${name}: textMuted on surface >= 4.5`);
  }
});

test('12. accent buttons and the focus ring stay visible in BOTH themes', () => {
  for (const [name, t] of [['light', LIGHT], ['dark', DARK]]) {
    // text on accent: AA for UI/large text (>=3:1); dark accent is intentionally luminous.
    assert.ok(contrastRatio(t.textOnAccent, t.accent) >= 3.0, `${name}: textOnAccent on accent >= 3.0`);
    // focus ring must be clearly visible against the canvas it sits on.
    assert.ok(t.focusRing && t.focusRing.length > 0, `${name}: focusRing defined`);
    assert.ok(contrastRatio(t.focusRing, t.canvas) >= 3.0, `${name}: focusRing visible on canvas`);
  }
});

// ---- ownership / non-interference guards ----
test('13. ThemeProvider is the single seam and imports no runtime/auth/Stream, owns no destination state', () => {
  assert.ok(/export function ThemeProvider\(/.test(PROVIDER), 'ThemeProvider is exported');
  assert.equal(/platformRuntime|usePlatformRuntime/.test(PROVIDER), false, 'no runtime import/use');
  assert.equal(/authController|createAuthController|from '\.\/authState'/.test(PROVIDER), false, 'no auth');
  assert.equal(/stream-chat|StreamChat/.test(PROVIDER), false, 'no Stream');
  assert.equal(/activeDestination|setActiveDestination/.test(PROVIDER), false, 'owns no destination state');
});

test('14. theme wrapping does not alter destination ownership or runtime wiring', () => {
  // App is wrapped in ThemeProvider at the root, above the runtime.
  assert.ok(/<ThemeProvider orgAccent=\{MHMS_ORG_CONFIG\.brandColor\}>/.test(INDEX), 'root wraps App in ThemeProvider with org accent');
  assert.ok(/import \{ ThemeProvider \} from '\.\/themeProvider'/.test(INDEX), 'ThemeProvider imported');
  // unchanged Stage 2 invariants:
  assert.equal((INDEX.match(/usePlatformRuntime\(/g) || []).length, 1, 'still exactly one usePlatformRuntime');
  const app = fnBody(INDEX, 'App');
  assert.equal(app.includes('initialDestination'), false, 'App still passes no initialDestination');
  assert.ok(/const \[activeDestination, setActiveDestination\] = useState\(/.test(SHELL), 'PlatformShell still owns activeDestination');
});

test('15. theme is consumed through --anchor-* tokens in the themed surfaces (not new literal palettes)', () => {
  for (const [name, src] of [['ShellHeader', HEADER], ['HomeDestination', HOME], ['PlatformShell', SHELL]]) {
    assert.ok(/var\(--anchor-/.test(src), `${name} consumes anchor tokens`);
  }
  // typography flows through the body-font token in the shell + Home
  assert.ok(HEADER.includes("var(--anchor-font-body"), 'ShellHeader uses the body font token');
  assert.ok(HOME.includes("var(--anchor-font-display") && HOME.includes("var(--anchor-font-body"), 'Home uses font tokens');
});
