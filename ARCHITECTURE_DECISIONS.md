# Architecture Decisions

Concise, dated records of significant, hard-to-reverse architectural decisions and the
reasoning behind them. Current-state technical detail lives in `PROJECT_KNOWLEDGE.md`; this
file records *why* a structure exists, not *what* it currently does.

---

## ADR-0001 — Persistent connected runtime ownership boundary (Stage 1, 2026-08-05)

**Status:** Accepted and live in production (Stage 1 of the Platform Navigation & Home
Foundation; bundle `f1b3ee48…`).

**Context.** The connected Community runtime — Stream channel setup/teardown, the channel
map and active-channel behavior, unread/mention state, thread-note state and reconciliation,
Featured Updates state, readiness flags, and the migrated Stream event listeners — was defined
inline inside `src/index.jsx`'s `App()`. A future Platform Shell/Home needs to keep that
connected runtime mounted while the visible capability view changes; runtime logic fused into
one screen component cannot be kept alive across view changes without duplication.

**Decision.** Extract the persistent connected runtime into a reusable hook,
`usePlatformRuntime` (`src/platformRuntime.js`), with a strict ownership boundary:

- **PlatformRuntime owns** connected channel setup/teardown, the channel map and
  active-channel behavior, unread and mention state, thread-note state and its reconciliation
  (including the single thread-level `markRead` per opened note), Featured Updates state and
  acknowledgment, connected-runtime readiness flags, the four migrated Stream event categories
  (`message.new`, `notification.message_new`, `notification.thread_message_new`,
  `connection.recovered`), and complete user-scoped runtime reset on disconnect.
- **The auth controller continues to own** verified authentication, Stream
  connection/disconnection authority, the auth generation, logout, and *initiation* of runtime
  setup (`setupChannels`).
- **`App` continues to own** presentation composition, mobile drawer behavior, and the
  rendering/navigation surfaces.

The hook imports only leaf modules (`featuredUpdates`, `channelConfig`, `listenerBag`) and
receives everything else by injected dependency, so it never imports back from `index.jsx`
(no circular dependency).

**Why auth lifecycle stays controller-owned.** Connection identity, generation, and logout are
security-boundary concerns tied to the verified session; keeping the runtime a *consumer* of a
controller-initiated setup seam (rather than an initiator) preserves one authority for when a
connection exists and which generation owns it. Generation-aware guards
(`ownsSetup`/`setupStillOwns`) and atomic listener disposal (`listenerBag`/`disposeBagOwned`)
prevent a stale or superseded setup from acting.

**Why App retains presentation composition.** Presentation (mobile drawer, layout, navigation
surfaces) is view-specific and must remain swappable by the future Shell without touching
runtime logic. The runtime therefore exposes semantic actions and never references mobile
presentation (e.g. drawer close is composed in the view around `runtime.selectChannel`, not
inside the hook).

**Consequences / tradeoffs.**
- Enables a Platform Shell/Home to keep one connected runtime mounted while capability views
  change — the purpose of this foundation.
- Stage 1 is intentionally behavior-preserving: no product/UX change shipped; it is an
  ownership migration validated to be visually and behaviorally identical.
- Adds one module and an injected-dependency contract to reason about; mitigated by unit
  coverage (`platformRuntime.test.mjs`, `appWiring.test.mjs`) that pins the ownership
  boundary structurally.
- The single-owner thread-read reconciliation removed a prior duplicate `markRead`; this was
  validated in production (exactly one thread-level `markRead` per notification-driven open).

**References.** Source PR #25 (merge `8ad7490`), corrective thread-read commit `5a688d0`,
bundle PR #26 (merge `a6af17ef`). See `PROJECT_KNOWLEDGE.md` → "Stage 1" and
`REVIEW_HANDOFF.md` for the release and validation record.

---

## ADR-0002 — Assistant is a persistent contextual capability, not a navigation destination (Stage 3, pre-Slice-1a)

**Status:** Accepted, documentation-only; implementation begins in a future Stage 3 slice.

**Context.** Early Stage 3 concept exploration inconsistently depicted the AI assistant
both as a normal sidebar navigation destination and as a persistent floating presence
simultaneously. This is an architectural decision, not a visual one: a navigation
destination implies leaving the current context; a persistent contextual presence
implies the opposite.

**Decision.** The assistant (ATLAS for MHMS) is a persistent contextual capability,
default-rendered as a fixed presence (e.g. bottom-right), not a duplicate entry in
primary navigation. Opening the assistant must preserve the user's current destination
and context rather than navigating away from it. Organization configuration may enable
alternate access paths (search/command interface, contextual "Ask Assistant" actions,
Help & Support entry points) without introducing a second, redundant nav destination by
default.

**Consequences.** The Stage 3 assistant implementation will treat this as a
platform-level, config-driven component composed alongside, rather than inside, primary
navigation. Any future organization configuration that exposes an assistant as a
navigation destination is a deliberate opt-in rather than the default architecture.

---

## ADR-0003 — Home information architecture is conventional accessible content, not a radial layout (Stage 3, pre-Slice-1a)

**Status:** Accepted, documentation-only; implementation begins in a future Stage 3 slice.

**Context.** Early Neural Canvas concept imagery depicted Home as a radial node
arrangement (capabilities arranged circularly around a central Home anchor). This
imagery has no defined DOM/keyboard order and was exploratory, not an approved
information architecture.

**Decision.** Home's information architecture remains conventional, linear, accessible
content surfaces: orientation/greeting, what needs attention, continue where you left
off, capability surfaces, personal shortcuts, relevant contextual information. Neural
visual elements (node/pathway motifs) may exist in the surrounding visual environment
but must not define DOM order, tab order, or content structure. Radial/node imagery is
visual-language exploration only and does not constitute approved IA.

**Consequences.** Home Hub implementation and any neural-environment visual work are
built against this ordering constraint from the start, avoiding a later accessibility
retrofit of the kind already flagged as deferred debt in Stage 2.

---

## ADR-0004 — Typography defaults to current platform values pending a design-token foundation (Stage 3, pre-Slice-1a)

**Status:** Accepted, documentation-only; implementation begins with the theme
foundation slice.

**Context.** Neural Canvas concept imagery used AI-generated typography (Inter, Plus
Jakarta Sans) that was never an authoritative specification.

**Decision.** The current platform default (DM Sans) is preserved as the starting
point. Theme/design-token architecture introduces semantic typography tokens (body
family, display/heading family, weights, scale, line height) so a future explicit
typography decision — including organization-level configuration — is a token-value
change, not a structural one. No arbitrary organization-uploaded fonts are implemented
in Stage 3; if organization-level typography configuration is added later, it should
draw from an approved/supported set.

**Consequences.** The theme foundation slice's token module must express typography as
named semantic tokens from the start, even though only one value set (the current DM
Sans default) exists initially.
