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
