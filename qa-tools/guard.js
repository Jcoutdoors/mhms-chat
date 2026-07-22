// Shared QA mutation guard.
//
// This is the ONLY permitted Stream mutation path for repository-managed QA scripts.
// (That is a rule for qa-tools/, not a claim about the production application.)
//
// KNOWN LIMITATION — read this before trusting it:
// This is a policy and code-enforced boundary, NOT a Stream-enforced environment boundary.
// Unlike a separate Stream application, where credentials for one app cannot touch the
// other, this depends on every QA script actually using this guard, on QA channels staying
// out of the production configuration, and on QA channel membership staying limited to the
// fixed QA fixture users. A future unguarded one-off script would bypass all of it.
// Do not describe this as physical or environment isolation.
//
// The "declared QA actor ID" is an operational convention enforced by this tooling. The
// token worker will mint a token for any supplied user_id without proving caller identity,
// so this is NOT authentication and must never be described as an authenticated QA user.

const {
  QA_CHANNEL_PREFIX,
  QA_ACTOR_PREFIX,
  QA_ACTOR_IDS,
  QA_MESSAGE_MARKER,
  PERMITTED_OPERATIONS,
  STREAM_APP_ID,
  isProductionChannelId,
  isApprovedQaChannelId,
  isApprovedQaActorId,
  isDestructiveOperation,
} = require('./qaConfig.js');

/** A refusal carries the reason and the sanitized preflight, and never dispatches. */
function refuse(reason, preflight) {
  return {
    allowed: false,
    decision: 'REFUSED',
    refusalReason: reason,
    preflight: { ...preflight, decision: 'REFUSED' },
    result: null,
  };
}

/**
 * Force the QA marker into message text. The caller cannot omit it.
 */
function forceMarker(text) {
  const body = typeof text === 'string' ? text.trim() : '';
  if (body.indexOf(QA_MESSAGE_MARKER) === 0) return body;
  return `${QA_MESSAGE_MARKER} ${body}`.trim();
}

function membershipMatches(memberIds) {
  if (!Array.isArray(memberIds)) return false;
  const actual = memberIds.slice().sort();
  const expected = QA_ACTOR_IDS.slice().sort();
  if (actual.length !== expected.length) return false;
  return actual.every((id, i) => id === expected[i]);
}

/**
 * The single guarded mutation entry point.
 *
 * CHECK ORDER — deliberately local-first, denylist-first:
 *   Local, zero adapter calls:
 *     L1 channelId is NOT in the production denylist (independent + authoritative)
 *     L2 operation is explicitly permitted (default-deny)
 *     L3 channelId is a string with the cats-qa- prefix
 *     L4 channelId is in the exact QA channel allowlist
 *     L5 actorId has the cats-qa-user- prefix AND is in the exact actor allowlist
 *     L6 payload is well-formed for the operation
 *   Persistent state, adapter-backed reads:
 *     R1 channel exists
 *     R2 stored qa_only === true
 *     R3 stored qa_fixture === true
 *     R4 membership is exactly the three QA fixture users
 *     R5 (thread reply only) parent message exists AND belongs to this same channel
 *
 * Two deliberate deviations from the brief's literal a-f ordering, both strengthenings:
 *
 *  1. Local checks run before any adapter read, so a production channel ID is refused with
 *     ZERO Stream calls of any kind — not even a read. The brief places the stored qa_only
 *     read at step (b), which would require touching Stream before the denylist could
 *     refuse. Local-first is what makes "no mutation method invoked, no network write sent"
 *     literally provable via adapter call counters.
 *
 *  2. The denylist is checked FIRST rather than at step (d). Checked later it would be
 *     shadowed by the prefix check for every real production ID (production IDs never carry
 *     the cats-qa- prefix), so the denylist would never actually be the deciding control.
 *     First position makes it demonstrably authoritative, including against a fixture that
 *     falsely claims qa_only: true for a production channel ID.
 *
 * There is deliberately NO process-local "bootstrap complete" flag. The bootstrap command
 * and a later write may run in different Node processes, where an in-memory flag would not
 * survive and would invite an unsafe bypass. Persistent Stream fixture state, revalidated
 * on every write via R1-R4, is the authoritative precondition.
 *
 * Fails closed: any missing, ambiguous, malformed, or unreadable value refuses.
 */
async function guardedQaWrite({ actorId, channelId, operation, payload, adapter, logger } = {}) {
  const log = logger || console;

  const preflight = {
    streamAppId: STREAM_APP_ID,
    declaredQaActorId: actorId === undefined ? '(missing)' : String(actorId),
    targetChannelId: channelId === undefined ? '(missing)' : String(channelId),
    storedQaOnly: '(not read)',
    requestedOperation: operation === undefined ? '(missing)' : String(operation),
    isDestructive: isDestructiveOperation(operation),
    decision: 'PENDING',
  };

  const emit = out => {
    log.log('[QA GUARD PREFLIGHT]', JSON.stringify(out.preflight));
    return out;
  };

  // ---- L1: production denylist (independent, authoritative, checked FIRST) ----
  // Deliberately ahead of the prefix and allowlist checks so that it is provably the
  // control that stops a production channel, rather than being shadowed by the prefix
  // check. Refuses regardless of prefix, stored metadata, allowlist claims, or caller
  // assertions — including a fixture that falsely claims qa_only: true.
  if (typeof channelId === 'string' && isProductionChannelId(channelId)) {
    return emit(refuse('channel ID is on the production denylist', preflight));
  }
  // ---- L2: operation allowlist (default-deny) ----
  if (typeof operation !== 'string' || PERMITTED_OPERATIONS.indexOf(operation) === -1) {
    return emit(refuse(`operation not permitted: ${String(operation)}`, preflight));
  }
  // ---- L3: QA channel prefix ----
  if (typeof channelId !== 'string' || channelId.indexOf(QA_CHANNEL_PREFIX) !== 0) {
    return emit(refuse(`channel ID lacks required ${QA_CHANNEL_PREFIX} prefix`, preflight));
  }
  // ---- L4: exact QA channel allowlist ----
  if (!isApprovedQaChannelId(channelId)) {
    return emit(refuse('channel ID is not in the approved QA channel allowlist', preflight));
  }
  // ---- L5: declared QA actor ----
  if (typeof actorId !== 'string' || actorId.indexOf(QA_ACTOR_PREFIX) !== 0) {
    return emit(refuse(`actor ID lacks required ${QA_ACTOR_PREFIX} prefix`, preflight));
  }
  if (!isApprovedQaActorId(actorId)) {
    return emit(refuse('actor ID is not in the approved QA actor allowlist', preflight));
  }
  // ---- L6: payload shape ----
  const p = payload || {};
  if (typeof p.text !== 'string' || !p.text.trim()) {
    return emit(refuse('payload.text is required and must be a non-empty string', preflight));
  }
  if (operation === 'sendQaThreadReply' && (typeof p.parentId !== 'string' || !p.parentId.trim())) {
    return emit(refuse('payload.parentId is required for sendQaThreadReply', preflight));
  }
  if (!adapter || typeof adapter.getChannelState !== 'function') {
    return emit(refuse('no usable adapter supplied', preflight));
  }

  // ---- Persistent fixture state (adapter-backed) ----
  let state;
  try {
    state = await adapter.getChannelState(channelId);
  } catch (err) {
    const safe = err && err.safe ? err.safe : { message: 'channel state unreadable' };
    return emit(refuse(`could not read channel state: ${safe.message}`, preflight));
  }

  if (!state || state.exists !== true) {
    return emit(refuse('target QA channel does not exist (run the bootstrap first)', preflight));
  }
  const custom = state.customData || {};
  preflight.storedQaOnly = custom.qa_only === undefined ? '(absent)' : String(custom.qa_only);

  if (custom.qa_only !== true) {
    return emit(refuse('channel does not have stored qa_only === true', preflight));
  }
  if (custom.qa_fixture !== true) {
    return emit(refuse('channel does not have stored qa_fixture === true', preflight));
  }
  if (!membershipMatches(state.memberIds)) {
    return emit(
      refuse(
        `channel membership is not exactly the three QA fixture users (found ${
          (state.memberIds || []).length
        })`,
        preflight
      )
    );
  }

  // ---- R5: thread-reply parent must live in this same approved QA channel ----
  if (operation === 'sendQaThreadReply') {
    if (typeof adapter.getMessageChannel !== 'function') {
      return emit(refuse('adapter cannot verify parent message channel', preflight));
    }
    let parent;
    try {
      parent = await adapter.getMessageChannel(p.parentId);
    } catch (err) {
      const safe = err && err.safe ? err.safe : { message: 'parent lookup failed' };
      return emit(refuse(`could not verify parent message: ${safe.message}`, preflight));
    }
    if (!parent || parent.exists !== true) {
      return emit(refuse('parent message does not exist', preflight));
    }
    if (parent.channelId !== channelId) {
      return emit(
        refuse('parent message belongs to a different channel than the target', preflight)
      );
    }
  }

  // ---- All checks passed: dispatch ----
  preflight.decision = 'ALLOWED';
  log.log('[QA GUARD PREFLIGHT]', JSON.stringify(preflight));

  const text = forceMarker(p.text);
  try {
    let result;
    if (operation === 'sendQaMessage') {
      result = await adapter.sendMessage(channelId, { text, userId: actorId });
    } else {
      result = await adapter.sendThreadReply(channelId, {
        text,
        parentId: p.parentId,
        userId: actorId,
      });
    }
    return { allowed: true, decision: 'ALLOWED', refusalReason: null, preflight, result };
  } catch (err) {
    const safe = err && err.safe ? err.safe : { message: 'dispatch failed' };
    return {
      allowed: true,
      decision: 'ALLOWED_BUT_FAILED',
      refusalReason: null,
      preflight,
      result: null,
      error: safe,
    };
  }
}

module.exports = { guardedQaWrite, forceMarker, membershipMatches };
