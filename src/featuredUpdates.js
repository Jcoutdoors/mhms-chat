// Featured Updates (v63.1) — pure, testable helpers.
//
// CommonJS, same rationale as channelConfig.js: webpack consumes it via interop and the
// Node test scripts require() it directly. Every function here is deterministic and free of
// React/Stream state, so the isolated (Layer 1) tests exercise exactly this code.
//
// This module holds: configuration validation, the persistent acknowledgment store (with
// its localStorage Case A / Case B handling), and — added in the retrieval commit — the
// message qualification, ordering, and preview helpers.
//
// Why a separate acknowledgment record from the existing channel/thread one:
// The v63 channel/thread acknowledgment lives in sessionStorage and works because Stream
// maintains real unread state for channels and threads independently. A "featured" top-level
// announcement post has no server-side unread/read state, so session-only acknowledgment
// would re-surface the same posts every time the browser is closed and reopened inside the
// 7-day window. Featured Updates therefore get their own narrowly-scoped localStorage record.
// There is NO reliable per-user "last visit" timestamp in this app; lookbackDays (7) is the
// permanent retrieval horizon, not a fallback path.

const FEATURED_ACK_KEY = 'cats_featured_updates_ack';
const FEATURED_ACK_VERSION = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Validate the featuredUpdates config.
 *
 * @param {object} cfg   the ASSISTANT_CONFIG.featuredUpdates object
 * @param {(id:string)=>boolean} isConfiguredProductionChannelId  the SHARED predicate from
 *        channelConfig.js — the same one the app uses, never a copy
 * @returns {{ ok:boolean, invalid:boolean, reason:(string|null) }}
 *   ok=true    -> valid AND enabled; proceed with retrieval
 *   ok=false, invalid=false -> deliberately disabled (enabled:false); no warning
 *   ok=false, invalid=true  -> malformed configuration; caller logs a sanitized warning
 *
 * Never clamps. An out-of-range maxItems is invalid configuration, not something to coerce.
 */
function validateFeaturedUpdatesConfig(cfg, isConfiguredProductionChannelId) {
  if (!cfg || typeof cfg !== 'object') {
    return { ok: false, invalid: true, reason: 'featuredUpdates config is missing or not an object' };
  }
  if (typeof cfg.enabled !== 'boolean') {
    return { ok: false, invalid: true, reason: 'enabled must be a boolean' };
  }
  if (cfg.enabled === false) {
    // Intentional off switch, not an error.
    return { ok: false, invalid: false, reason: 'featuredUpdates disabled by configuration' };
  }
  if (typeof cfg.sectionLabel !== 'string' || !cfg.sectionLabel.trim()) {
    return { ok: false, invalid: true, reason: 'sectionLabel is missing, empty, or not a string' };
  }
  if (
    !Array.isArray(cfg.authorIds) ||
    cfg.authorIds.length === 0 ||
    !cfg.authorIds.every(a => typeof a === 'string' && a.trim())
  ) {
    return { ok: false, invalid: true, reason: 'authorIds is missing, empty, or malformed' };
  }
  if (
    !Array.isArray(cfg.sourceChannelIds) ||
    cfg.sourceChannelIds.length === 0 ||
    !cfg.sourceChannelIds.every(c => typeof c === 'string' && c.trim())
  ) {
    return { ok: false, invalid: true, reason: 'sourceChannelIds is missing, empty, or malformed' };
  }
  if (typeof isConfiguredProductionChannelId !== 'function') {
    return { ok: false, invalid: true, reason: 'no production channel predicate supplied' };
  }
  const outside = cfg.sourceChannelIds.filter(id => !isConfiguredProductionChannelId(id));
  if (outside.length) {
    return { ok: false, invalid: true, reason: 'source channel outside shared production configuration' };
  }
  if (!Number.isInteger(cfg.maxItems) || cfg.maxItems < 1 || cfg.maxItems > 10) {
    // No silent clamp — out of range is invalid configuration.
    return { ok: false, invalid: true, reason: 'maxItems must be an integer in the range 1-10' };
  }
  if (typeof cfg.previewLength !== 'number' || !Number.isFinite(cfg.previewLength) || cfg.previewLength <= 0) {
    return { ok: false, invalid: true, reason: 'previewLength must be a positive number' };
  }
  if (typeof cfg.lookbackDays !== 'number' || !Number.isFinite(cfg.lookbackDays) || cfg.lookbackDays <= 0) {
    return { ok: false, invalid: true, reason: 'lookbackDays must be a positive number' };
  }
  return { ok: true, invalid: false, reason: null };
}

/**
 * Create the Featured Update acknowledgment store.
 *
 * Persistence model, per the two distinct failure cases in the spec:
 *
 *  Case A — storage is available but the stored record is malformed (bad JSON / wrong shape /
 *           corrupt): treat as empty (no acknowledgments known), keep showing valid items,
 *           and overwrite with a valid structure on the next successful write.
 *
 *  Case B — storage is unavailable or read/write throws (private browsing, quota, etc.):
 *           fall back to an in-memory map scoped to this page session. Items are still shown
 *           and acknowledged in memory so they don't repeat within the page session; this
 *           acknowledgment deliberately does NOT survive reload or restart. That is the
 *           understood degradation, not a bug.
 *
 * Only message ID -> ISO acknowledgment timestamp is ever stored. Never message content,
 * author, or channel data. Entries older than lookbackDays are pruned on load and on write.
 *
 * @param {object} opts
 * @param {Storage|null} opts.storage  a localStorage-like object, or null/absent
 * @param {number} opts.lookbackDays   retrieval horizon; also the pruning horizon
 * @param {()=>number} [opts.now]      injectable clock for tests (ms)
 * @param {(msg:string)=>void} [opts.warn]  sanitized warning sink
 */
function createFeaturedAckStore({ storage, lookbackDays, now, warn } = {}) {
  const nowMs = () => (typeof now === 'function' ? now() : Date.now());
  const horizonMs = (typeof lookbackDays === 'number' && lookbackDays > 0 ? lookbackDays : 7) * DAY_MS;
  const logWarn = typeof warn === 'function' ? warn : () => {};

  let usingMemoryFallback = false;

  function prune(map) {
    const cutoff = nowMs() - horizonMs;
    const out = {};
    Object.keys(map).forEach(id => {
      const t = Date.parse(map[id]);
      if (!isNaN(t) && t >= cutoff) out[id] = map[id];
    });
    return out;
  }

  function loadPersistent() {
    if (!storage || typeof storage.getItem !== 'function') {
      usingMemoryFallback = true;
      return {};
    }
    let raw;
    try {
      raw = storage.getItem(FEATURED_ACK_KEY);
    } catch (e) {
      // Case B: reading storage throws at all.
      usingMemoryFallback = true;
      logWarn('featured ack: storage read failed, using in-memory fallback');
      return {};
    }
    if (raw == null) return {};
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // Case A: malformed JSON. Treat as empty; a later successful write overwrites it.
      logWarn('featured ack: stored record was unparseable, treating as empty');
      return {};
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.version !== FEATURED_ACK_VERSION ||
      !parsed.acknowledged ||
      typeof parsed.acknowledged !== 'object'
    ) {
      // Case A: wrong shape.
      logWarn('featured ack: stored record had an unexpected shape, treating as empty');
      return {};
    }
    const clean = {};
    Object.keys(parsed.acknowledged).forEach(id => {
      const ts = parsed.acknowledged[id];
      if (typeof id === 'string' && id && typeof ts === 'string' && !isNaN(Date.parse(ts))) {
        clean[id] = ts;
      }
    });
    return clean;
  }

  // In-memory map is always the working copy; it is seeded from persistent state (pruned).
  let memory = prune(loadPersistent());

  function persist() {
    if (usingMemoryFallback || !storage || typeof storage.setItem !== 'function') return;
    try {
      storage.setItem(
        FEATURED_ACK_KEY,
        JSON.stringify({ version: FEATURED_ACK_VERSION, acknowledged: memory })
      );
    } catch (e) {
      // Case B on write: switch to in-memory fallback for the rest of the page session.
      usingMemoryFallback = true;
      logWarn('featured ack: storage write failed, using in-memory fallback');
    }
  }

  return {
    key: FEATURED_ACK_KEY,
    version: FEATURED_ACK_VERSION,
    isAcknowledged(id) {
      return Object.prototype.hasOwnProperty.call(memory, id);
    },
    getAcknowledgedIds() {
      return Object.keys(memory);
    },
    /** Acknowledge the given displayed message IDs (whole displayed set, on dismissal). */
    acknowledge(ids, whenIso) {
      const ts = whenIso || new Date(nowMs()).toISOString();
      (ids || []).forEach(id => {
        if (typeof id === 'string' && id) memory[id] = ts;
      });
      memory = prune(memory);
      persist();
    },
    get usingMemoryFallback() {
      return usingMemoryFallback;
    },
  };
}

// ---------------------------------------------------------------------------------------
// Retrieval processing (v63.1 Commit 2). Pure and deterministic: the isolated tests feed
// these plain message objects and assert the qualification/ordering/preview outcome. The
// live Stream query lives in src/index.jsx; these helpers never touch Stream.
// ---------------------------------------------------------------------------------------

/**
 * Access-permission boundary for a source channel.
 *
 * Being listed in `sourceChannelIds` does NOT by itself prove the current user can access a
 * channel. The real proof is presence in the loaded channel map, which is populated from
 * `queryChannels` filtered through `retainConfiguredChannels()` — the same path the rest of
 * the app relies on, and one that only returns channels the user can actually read.
 *
 * If membership state is populated on the loaded channel, require the user to be a member.
 * If it is not yet populated (connect-time timing), presence in the loaded map is sufficient,
 * since the channel would not be in that map otherwise.
 */
function isChannelAccessibleToUser(channelMap, channelId, userId) {
  const ch = channelMap && channelMap[channelId];
  if (!ch) return false;
  const members = ch.state && ch.state.members;
  if (members && Object.keys(members).length) {
    return !!members[userId];
  }
  return true;
}

/** Build the exact channel.search() filter, verified against the installed SDK. */
function buildFeaturedSearchFilter(authorIds, sinceISO) {
  return {
    'user.id': { $in: authorIds },
    created_at: { $gte: sinceISO },
    parent_id: { $exists: false },
  };
}

/** The ISO threshold for "within the lookback horizon", relative to now (ms). */
function lookbackThresholdISO(lookbackDays, nowMs) {
  const t = (typeof nowMs === 'number' ? nowMs : Date.now()) - lookbackDays * DAY_MS;
  return new Date(t).toISOString();
}

/**
 * Does a raw message qualify as a Featured Update?
 *
 * All conditions must hold. Author and channel gating happen at retrieval (one query per
 * source channel, filtered by author server-side), so this focuses on per-message validity:
 * top-level, non-deleted/shadowed/system, has real text, within the horizon, unacknowledged.
 *
 * @param {object} msg              a Stream message object
 * @param {object} ctx
 * @param {Set<string>} ctx.authorIdSet   configured author IDs
 * @param {number} ctx.sinceMs            lookback threshold in ms
 * @param {(id:string)=>boolean} ctx.isAcknowledged
 * @param {number} ctx.nowMs
 */
function messageQualifies(msg, ctx) {
  if (!msg || typeof msg !== 'object') return false;
  if (typeof msg.id !== 'string' || !msg.id) return false;
  // Top-level only.
  if (msg.parent_id) return false;
  // Author must be configured (defense in depth; retrieval already filters by author).
  const authorId = msg.user && msg.user.id;
  if (!authorId || !ctx.authorIdSet.has(authorId)) return false;
  // Not deleted / shadowed / system.
  if (msg.deleted_at || msg.type === 'deleted') return false;
  if (msg.shadowed === true) return false;
  if (msg.type === 'system' || msg.type === 'ephemeral') return false;
  // Must have real, non-whitespace text. Attachment-only posts (no text) do not qualify;
  // text-plus-attachment qualifies on its text alone.
  if (typeof msg.text !== 'string' || !msg.text.trim()) return false;
  // Within the lookback horizon.
  const created = Date.parse(msg.created_at);
  if (isNaN(created) || created < ctx.sinceMs) return false;
  // Not already acknowledged.
  if (ctx.isAcknowledged(msg.id)) return false;
  return true;
}

/** Collapse whitespace/line breaks and truncate to previewLength; ellipsis only if cut. */
function makePreview(text, previewLength) {
  const collapsed = String(text || '').replace(/\s+/g, ' ').trim();
  if (collapsed.length <= previewLength) return collapsed;
  return collapsed.slice(0, previewLength).trimEnd() + '…';
}

/**
 * Assemble the final Featured Update items from per-channel raw message arrays.
 *
 * Merges across sources, keeps only qualifying messages, sorts newest-first, breaks equal
 * timestamps deterministically by message ID (descending, so it is stable and unambiguous),
 * and slices to maxItems. Returns lightweight item objects — no attachment metadata.
 *
 * @param {Array<{channelId:string, channelName:string, messages:object[]}>} channelResults
 * @param {object} cfg      validated featuredUpdates config
 * @param {object} ctx      { isAcknowledged, nowMs }
 */
function assembleFeaturedItems(channelResults, cfg, ctx) {
  const nowMs = typeof ctx.nowMs === 'number' ? ctx.nowMs : Date.now();
  const sinceMs = nowMs - cfg.lookbackDays * DAY_MS;
  const authorIdSet = new Set(cfg.authorIds);
  const qualifyCtx = {
    authorIdSet,
    sinceMs,
    nowMs,
    isAcknowledged: typeof ctx.isAcknowledged === 'function' ? ctx.isAcknowledged : () => false,
  };

  const items = [];
  (channelResults || []).forEach(cr => {
    (cr.messages || []).forEach(msg => {
      if (!messageQualifies(msg, qualifyCtx)) return;
      items.push({
        messageId: msg.id,
        channelId: cr.channelId,
        channelName: cr.channelName,
        authorId: msg.user.id,
        authorName: (msg.user && msg.user.name) || 'Mark Mayfield',
        authorImage: (msg.user && msg.user.image) || null,
        authorColor: (msg.user && msg.user.color) || null,
        createdAt: msg.created_at,
        createdAtMs: Date.parse(msg.created_at),
        preview: makePreview(msg.text, cfg.previewLength),
      });
    });
  });

  items.sort((a, b) => {
    if (b.createdAtMs !== a.createdAtMs) return b.createdAtMs - a.createdAtMs; // newest first
    return b.messageId.localeCompare(a.messageId); // deterministic tie-break by ID
  });

  return items.slice(0, cfg.maxItems);
}

/** Concise relative date ("Today", "Yesterday", "N days ago") from an ISO string. */
function relativeDate(iso, nowMs) {
  const t = Date.parse(iso);
  if (isNaN(t)) return '';
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const startOfDay = ms => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

module.exports = {
  FEATURED_ACK_KEY,
  FEATURED_ACK_VERSION,
  validateFeaturedUpdatesConfig,
  createFeaturedAckStore,
  isChannelAccessibleToUser,
  buildFeaturedSearchFilter,
  lookbackThresholdISO,
  messageQualifies,
  makePreview,
  assembleFeaturedItems,
  relativeDate,
};
