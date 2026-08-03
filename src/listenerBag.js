// Generation-scoped listener bag (VIF Phase 4B2 App wiring).
//
// A disposable collection of unsubscribe/cleanup handles owned by ONE
// generation-scoped operation (a single setupChannels run). The App's
// generation-aware channel setup registers every Stream listener/watcher through a
// bag so that, when the operation becomes stale (logout, client replacement, retry,
// or a superseding connect), exactly the handles that operation created are disposed
// — never any other operation's, and never leaked.
//
// Semantics:
//   - add(unsub): store the handle. If the bag is ALREADY disposed (the op went
//     stale before this handle was registered), dispose the handle immediately and
//     do not retain it — a stale operation must never leave a listener attached.
//   - dispose(): mark disposed and invoke every stored handle once, swallowing
//     errors so one failing unsubscribe cannot strand the rest. Idempotent.
//
// Pure CommonJS: no timers, no I/O, no React — unit-testable in Node.

'use strict';

function createListenerBag() {
  let handles = [];
  let disposed = false;

  function safeCall(unsub) {
    try { unsub(); } catch { /* best-effort cleanup */ }
  }

  return {
    // Register an unsubscribe handle. Non-functions are ignored. A handle added
    // after disposal is disposed immediately (never retained).
    add(unsub) {
      if (typeof unsub !== 'function') return;
      if (disposed) { safeCall(unsub); return; }
      handles.push(unsub);
    },
    // Dispose all registered handles exactly once; further adds self-dispose.
    dispose() {
      disposed = true;
      const pending = handles;
      handles = [];
      for (const unsub of pending) safeCall(unsub);
    },
    get size() { return handles.length; },
    get disposed() { return disposed; },
  };
}

module.exports = { createListenerBag };
