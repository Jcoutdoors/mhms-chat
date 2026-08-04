// Persistent connected Community runtime (Platform Navigation & Home — Stage 1).
//
// usePlatformRuntime owns ONLY the connected Community runtime attached to the client the
// verified-auth controller provides. It does NOT own the verified session, the Stream
// client lifecycle authority, the auth generation, or logout — those stay with the
// controller/App (see PROJECT_KNOWLEDGE.md "Stage 1"). The controller continues to INITIATE
// channel setup via the existing seam `setupChannels({ client, userId, user, isCurrent })`
// and supplies `isCurrent`; this hook never independently watches auth state to decide when
// to connect or set up channels — it has no competing Stream lifecycle.
//
// Circular-dependency avoidance: this module imports only leaf modules (featuredUpdates,
// channelConfig, listenerBag) and receives everything else from index.jsx via injected
// `deps` (the createAuthController pattern). It imports nothing from index.jsx.
//
// CONTRACT: the returned object exposes read-only data + semantic actions only. It never
// exposes tokens, cookies, the Stream clientRef, the listenerBag, the auth generation,
// internal synchronization refs, or raw React state setters. Views must not know how the
// runtime represents state internally.

'use strict';

const { useState, useRef, useEffect, useCallback } = require('react');
const {
  createFeaturedAckStore, validateFeaturedUpdatesConfig, isChannelAccessibleToUser,
  buildFeaturedSearchFilter, assembleFeaturedItems,
} = require('./featuredUpdates');
const { retainConfiguredChannels, isConfiguredProductionChannelId, STATIC_CHANNELS } = require('./channelConfig');
const { createListenerBag } = require('./listenerBag');

// The connected phases during which the runtime holds a live client + listeners. Leaving
// this set (logout, sign-out error, service error, session end) tears the runtime down.
const CONNECTED_PHASES = ['loadingProfile', 'profileSetup', 'savingProfile', 'community'];

// Pure: reconcile thread notes when a thread becomes the open/active thread. If a note exists
// for `threadId`, returns the notes WITHOUT it and hadNote:true; otherwise returns the notes
// unchanged and hadNote:false. A null/absent threadId (no active thread) removes nothing and
// never touches unrelated notes. Used by the runtime-owned reconciliation effect, which decides
// when to call markRead; `hadNote` is retained for that effect and for isolated testing.
function reconcileThreadNoteOnOpen(notes, threadId) {
  const src = notes || {};
  const hadNote = !!(threadId && src[threadId]);
  if (!hadNote) return { notes: src, hadNote: false };
  const next = { ...src };
  delete next[threadId];
  return { notes: next, hadNote: true };
}

// Pure: the empty, user-scoped runtime state. Used by teardown so no data or pending navigation
// from one verified user can survive into another verified session. `activeId` resets to the
// configured initial channel. Static config / injected deps are NOT part of this.
function emptyRuntimeState(initialChannelId) {
  return {
    chatClient: null,
    channelMap: {},
    activeId: initialChannelId,
    unreadCounts: {},
    mentionCounts: {},
    threadNotes: {},
    pendingThread: null,
    openThreadId: null,
    pendingFeatured: null,
    featuredUnavailable: false,
    featuredItems: [],
    channelUnreadReady: false,
    threadRecoveryReady: false,
    featuredUpdatesReady: false,
  };
}

// Dispose `bag` (idempotent via listenerBag) and clear the owner ref ONLY if it still points at
// `bag`. This is the ownership rule that lets a stale/older op dispose its OWN local bag while
// never disposing or clearing a NEWER op's bag. Returns whether the owner ref was cleared.
// `ownerRef` is a { current } ref object.
function disposeBagOwned(bag, ownerRef) {
  if (!bag) return false;
  bag.dispose();
  if (ownerRef.current === bag) { ownerRef.current = null; return true; }
  return false;
}

// Setup-operation ownership. A setupChannels invocation remains valid only while BOTH its auth
// generation is current AND its local bag is still the active owned bag. This guards two
// overlapping same-generation setup calls: once a newer setup installs its own bag, the older
// op's predicate goes false even though isCurrent() is still true. `ownerRef` is a { current } ref.
function setupStillOwns(isCurrent, ownerRef, bag) {
  return isCurrent() && ownerRef.current === bag;
}

function usePlatformRuntime(deps) {
  const {
    currentUser,                    // session-derived { id, name, instructor, ... } | null (App-owned)
    authPhase,                      // controller phase string; drives teardown only
    allChannels,                    // ALL_CHANNELS
    getInitialChannelId,            // () => channelId
    canPostAnnouncements,           // (user) => bool
    fireMentionAlert,               // (title, body) => void
    requestNotificationPermission,  // () => void
    upsertThreadNote,               // (setThreadNotes, note) => void
    featuredConfig,                 // ASSISTANT_CONFIG.featuredUpdates
  } = deps;
  // NOTE: mobile-drawer closing is NOT a runtime concern. selectChannel performs channel
  // behavior only; the view wraps it to also close the App-owned mobile drawer.

  // --- persistent connected-runtime state (each has a current lifecycle reason) ---
  const [chatClient, setChatClient] = useState(null);
  const [channelMap, setChannelMap] = useState({});
  const [activeId, setActiveId] = useState(getInitialChannelId);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [mentionCounts, setMentionCounts] = useState({});
  const [threadNotes, setThreadNotes] = useState({});
  const [pendingThread, setPendingThread] = useState(null);
  const [openThreadId, setOpenThreadId] = useState(null);
  const [pendingFeatured, setPendingFeatured] = useState(null);
  const [featuredUnavailable, setFeaturedUnavailable] = useState(false);
  const [channelUnreadReady, setChannelUnreadReady] = useState(false);
  const [threadRecoveryReady, setThreadRecoveryReady] = useState(false);
  const [featuredUpdatesReady, setFeaturedUpdatesReady] = useState(false);
  const [featuredItems, setFeaturedItems] = useState([]);

  // --- internal synchronization + lifecycle refs (never exposed) ---
  const authBagRef = useRef(null);          // active generation's Stream listener bag
  const clientRef = useRef(null);           // mirrors the controller's connected client for handlers
  const activeIdRef = useRef(activeId);
  const openThreadIdRef = useRef(null);
  const featuredAckStoreRef = useRef(null);

  // Tracks whether we have been in a connected phase, so the full user-scoped teardown runs
  // exactly once on the connected -> disconnected transition (not throughout the pre-auth flow).
  const wasConnectedRef = useRef(false);

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { openThreadIdRef.current = openThreadId; }, [openThreadId]);

  // Dispose a listener bag idempotently, clearing the shared reference ONLY if it still owns
  // that reference (so a stale/older op can never dispose or clear a newer op's bag).
  const disposeOwnedBag = useCallback((bag) => { disposeBagOwned(bag, authBagRef); }, []);

  // Complete user-scoped teardown: dispose live listeners and reset ALL authenticated-user +
  // connected-runtime state and internal user-scoped refs to their empty values. Static config
  // and injected deps are untouched. Guarantees no data or pending navigation from one verified
  // user survives into another verified session.
  const teardownRuntime = useCallback(() => {
    disposeOwnedBag(authBagRef.current);
    const empty = emptyRuntimeState(getInitialChannelId());
    setChatClient(empty.chatClient);
    setChannelMap(empty.channelMap);
    setActiveId(empty.activeId);
    setUnreadCounts(empty.unreadCounts);
    setMentionCounts(empty.mentionCounts);
    setThreadNotes(empty.threadNotes);
    setPendingThread(empty.pendingThread);
    setOpenThreadId(empty.openThreadId);
    setPendingFeatured(empty.pendingFeatured);
    setFeaturedUnavailable(empty.featuredUnavailable);
    setFeaturedItems(empty.featuredItems);
    setChannelUnreadReady(empty.channelUnreadReady);
    setThreadRecoveryReady(empty.threadRecoveryReady);
    setFeaturedUpdatesReady(empty.featuredUpdatesReady);
    clientRef.current = null;
    activeIdRef.current = empty.activeId;
    openThreadIdRef.current = null;
    featuredAckStoreRef.current = null;
  }, [disposeOwnedBag, getInitialChannelId]);

  // On unmount, dispose whatever listeners are live.
  useEffect(() => () => { disposeOwnedBag(authBagRef.current); }, [disposeOwnedBag]);

  // Teardown when we leave the connected phases (logout / sign-out error / service error /
  // session end) — but only on the connected -> disconnected transition. The controller has
  // already disconnected Stream; this disposes the JS listeners and resets all user-scoped
  // runtime state/refs. setupChannels also disposes the prior bag on client replacement/retry —
  // this is the logout/teardown counterpart. Runtime teardown NEVER disconnects Stream.
  useEffect(() => {
    if (CONNECTED_PHASES.includes(authPhase)) { wasConnectedRef.current = true; return; }
    if (wasConnectedRef.current) { wasConnectedRef.current = false; teardownRuntime(); }
  }, [authPhase, teardownRuntime]);

  // Auto-clear the transient "featured update no longer available" notice.
  useEffect(() => {
    if (!featuredUnavailable) return undefined;
    const t = setTimeout(() => setFeaturedUnavailable(false), 4500);
    return () => clearTimeout(t);
  }, [featuredUnavailable]);

  // The active channel is being viewed, so it carries no badge.
  useEffect(() => {
    if (activeId) {
      setUnreadCounts((prev) => ({ ...prev, [activeId]: 0 }));
      setMentionCounts((prev) => ({ ...prev, [activeId]: 0 }));
    }
  }, [activeId]);

  // v63.1 Featured Updates — acknowledgment store accessor (page-session singleton; falls
  // back to in-memory if localStorage access throws).
  const getFeaturedAckStore = useCallback(() => {
    if (!featuredAckStoreRef.current) {
      let storage = null;
      try { storage = window.localStorage; } catch (e) { storage = null; }
      featuredAckStoreRef.current = createFeaturedAckStore({
        storage,
        lookbackDays: featuredConfig && featuredConfig.lookbackDays,
        warn: (msg) => console.warn('[CATS FEATURED]', msg),
      });
    }
    return featuredAckStoreRef.current;
  }, [featuredConfig]);

  // v63.1 Featured Updates retrieval — bounded channel.search() per configured source,
  // author/horizon/top-level filtered, per-channel isolated. isCurrent gates the commit.
  const retrieveFeaturedUpdates = useCallback(async (client, map, profile, isCurrent = () => true) => {
    const cfg = featuredConfig;
    const check = validateFeaturedUpdatesConfig(cfg, isConfiguredProductionChannelId);
    if (!check.ok) {
      if (check.invalid) console.warn('[CATS FEATURED] section disabled, invalid config:', check.reason);
      if (isCurrent()) setFeaturedItems([]);
      return;
    }
    const store = getFeaturedAckStore();
    const sinceISO = new Date(Date.now() - cfg.lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    const filter = buildFeaturedSearchFilter(cfg.authorIds, sinceISO);

    const channelResults = [];
    for (const channelId of cfg.sourceChannelIds) {
      if (!isConfiguredProductionChannelId(channelId)) continue;
      if (!isChannelAccessibleToUser(map, channelId, profile.id)) {
        console.warn('[CATS FEATURED] source channel not accessible via loaded path, skipping:', channelId);
        continue;
      }
      try {
        const resp = await map[channelId].search(filter, { limit: cfg.maxItems, sort: [{ created_at: -1 }] });
        const messages = (resp.results || []).map((r) => r.message || r);
        const chDef = allChannels.find((c) => c.id === channelId);
        channelResults.push({ channelId, channelName: (chDef && chDef.name) || channelId, messages });
      } catch (e) {
        console.warn('[CATS FEATURED] source channel query failed, omitting:', channelId, e.message);
      }
    }

    let items = [];
    try {
      items = assembleFeaturedItems(channelResults, cfg, { isAcknowledged: (id) => store.isAcknowledged(id), nowMs: Date.now() });
    } catch (e) {
      console.warn('[CATS FEATURED] assembly failed:', e.message);
      items = [];
    }
    if (isCurrent()) setFeaturedItems(items);
  }, [featuredConfig, allChannels, getFeaturedAckStore]);

  // Ensure a channel object exists + is watched (channels loaded at login are not watched).
  const ensureChannel = useCallback(async (id) => {
    const chDef = allChannels.find((c) => c.id === id);
    if (!chDef || !clientRef.current) return channelMap[id] || null;
    let channel = channelMap[id];
    if (!channel) {
      channel = clientRef.current.channel('messaging', chDef.id, { name: chDef.name, members: [currentUser.id] });
      setChannelMap((prev) => ({ ...prev, [id]: channel }));
    }
    try { await channel.watch({ presence: true }); } catch (e) {}
    return channel;
  }, [allChannels, channelMap, currentUser]);

  // Select a channel: clears its badges, watches it, and stops watching the previous one so
  // only the active channel is watched (preserves unread/mention persistence elsewhere). This
  // is channel behavior only — the view wraps it to also close the App-owned mobile drawer.
  const selectChannel = useCallback(async (id) => {
    const prevId = activeIdRef.current;
    setActiveId(id);
    setUnreadCounts((prev) => ({ ...prev, [id]: 0 }));
    setMentionCounts((prev) => ({ ...prev, [id]: 0 }));
    if (STATIC_CHANNELS.includes(id)) return;
    const ch = await ensureChannel(id);
    if (ch) { try { await ch.markRead(); } catch (e) {} }
    if (prevId && prevId !== id && !STATIC_CHANNELS.includes(prevId)) {
      const prevCh = channelMap[prevId];
      if (prevCh && prevCh.stopWatching) { try { await prevCh.stopWatching(); } catch (e) {} }
    }
  }, [ensureChannel, channelMap]);

  // Open a thread from a thread-note: select its channel (if needed) then queue the jump.
  const openThreadTarget = useCallback((note) => {
    if (note.channelId !== activeIdRef.current) selectChannel(note.channelId);
    setPendingThread({ channelId: note.channelId, threadId: note.threadId });
  }, [selectChannel]);

  // Featured-update navigation target: activate the channel, then queue the scroll/highlight.
  const openFeaturedTarget = useCallback((item) => {
    setFeaturedUnavailable(false);
    if (item.channelId !== activeIdRef.current) selectChannel(item.channelId);
    setPendingFeatured({ channelId: item.channelId, messageId: item.messageId });
  }, [selectChannel]);

  // Record the active thread (or null for none) — void. Reconciliation (removing a matching
  // unread note + marking that thread read) is owned by the runtime effect below, which reads
  // CURRENT state rather than a passively-synchronized ref, so it can never act on stale data
  // and never returns a stale synchronous decision.
  const activeThreadChanged = useCallback((threadId) => {
    setOpenThreadId(threadId);
  }, []);

  // Runtime-owned active-thread reconciliation. When a thread is open AND a matching unread note
  // exists in CURRENT state, remove that note and mark the thread read on its channel — read
  // marking happens ONLY when a matching unread note existed. After removal the note is gone, so
  // the effect settles (no loop). Closing (openThreadId null) removes nothing and never touches
  // unrelated notes. The markRead side effect runs in the effect body, NEVER inside a state
  // updater (React may invoke updaters more than once under StrictMode/concurrent rendering).
  useEffect(() => {
    if (!openThreadId) return;
    const note = threadNotes[openThreadId];
    if (!note) return;
    setThreadNotes((prev) => reconcileThreadNoteOnOpen(prev, openThreadId).notes);
    const ch = channelMap[note.channelId]
      || (clientRef.current && clientRef.current.activeChannels && clientRef.current.activeChannels['messaging:' + note.channelId]);
    if (ch && ch.markRead) {
      ch.markRead({ thread_id: openThreadId }).catch((e) => console.warn('[CATS THREAD DIAG] markRead (open) failed', e && e.message));
    }
  }, [openThreadId, threadNotes, channelMap]);

  // Thread cross-channel navigation resolved (opened OR failed) — clears the pending target.
  const resolveThreadJump = useCallback(() => setPendingThread(null), []);
  // Featured navigation outcomes.
  const completeFeaturedJump = useCallback(() => setPendingFeatured(null), []);
  const markFeaturedUnavailable = useCallback(() => { setPendingFeatured(null); setFeaturedUnavailable(true); }, []);
  // Featured acknowledgment — narrow semantic ops over the INTERNAL ack store (never exposed).
  const isFeaturedAcknowledged = useCallback((featuredId) => getFeaturedAckStore().isAcknowledged(featuredId), [getFeaturedAckStore]);
  const acknowledgeFeatured = useCallback((featuredIds) => getFeaturedAckStore().acknowledge(featuredIds), [getFeaturedAckStore]);

  // --- the controller-initiated, generation-aware channel setup seam (lifecycle) ---
  // The controller calls this with { client, userId, user, isCurrent }. We consult isCurrent()
  // before every network stage, after each await, and before every state mutation or listener
  // registration; a stale generation disposes exactly the listeners it registered and commits
  // nothing more. All Stream listeners register through `bag` for atomic disposal.
  const setupChannels = useCallback(async ({ client, userId, user, isCurrent }) => {
    // Only a CURRENT invocation may replace the active listener bag. If already stale, return
    // without touching ownership so a superseded setup can never dispose the newer owner's bag.
    if (!isCurrent()) return;
    if (authBagRef.current) { authBagRef.current.dispose(); authBagRef.current = null; }
    const bag = createListenerBag();
    authBagRef.current = bag;
    // After the bag is installed, validity requires BOTH a current generation AND that this op
    // still owns the active bag. Every checkpoint/handler/finalizer below uses ownsSetup(), not
    // isCurrent(), so a same-generation newer setup that replaced the bag makes this op inert.
    const ownsSetup = () => setupStillOwns(isCurrent, authBagRef, bag);
    const profile = (user && user.id) ? user : { id: userId };
    try {
      if (!ownsSetup()) { disposeOwnedBag(bag); return; }
      clientRef.current = client;

      const initialId = getInitialChannelId();
      const initialChDef = allChannels.find((c) => c.id === initialId) || allChannels.find((c) => c.id === 'cats-general');

      const allIds = allChannels.map((c) => c.id);
      const map = {};
      try {
        const queried = await client.queryChannels(
          { type: 'messaging', id: { $in: allIds } },
          { last_message_at: -1 },
          { watch: false, state: true, presence: false, limit: 30 },
        );
        retainConfiguredChannels(queried).forEach((ch) => { map[ch.id] = ch; });
      } catch (e) { /* fall through; set up the active channel below */ }
      if (!ownsSetup()) { disposeOwnedBag(bag); return; }

      for (const chDef of allChannels) {
        let ch = map[chDef.id];
        if (!ch) {
          ch = client.channel('messaging', chDef.id, { name: chDef.name, members: [profile.id] });
          map[chDef.id] = ch;
        }
        const isMember = ch.state && ch.state.members && ch.state.members[profile.id];
        if (!isMember) {
          try { await ch.addMembers([profile.id]); } catch (e) {}
          if (!ownsSetup()) { disposeOwnedBag(bag); return; }
        }
      }

      try {
        const activeCh = map[initialChDef.id] || client.channel('messaging', initialChDef.id, { name: initialChDef.name, members: [profile.id] });
        await activeCh.watch({ presence: true });
        map[initialChDef.id] = activeCh;
      } catch (e) {}
      if (!ownsSetup()) { disposeOwnedBag(bag); return; }

      setChatClient(client);
      setChannelMap(map);
      setActiveId(initialChDef.id);

      try {
        const seededUnread = {};
        const seededMentions = {};
        allChannels.forEach((chDef) => {
          const ch = map[chDef.id];
          if (!ch) return;
          const u = ch.countUnread();
          const m = ch.countUnreadMentions();
          if (u > 0 || m > 0) console.log('[CATS DIAG seed]', chDef.id, '| unread:', u, '| mentions:', m);
          if (u > 0) seededUnread[chDef.id] = u;
          if (m > 0) seededMentions[chDef.id] = m;
        });
        console.log('[CATS DIAG seed] result -> unread:', JSON.stringify(seededUnread), '| mentions:', JSON.stringify(seededMentions));
        delete seededUnread[initialChDef.id];
        delete seededMentions[initialChDef.id];
        if (!ownsSetup()) { disposeOwnedBag(bag); return; }
        setUnreadCounts(seededUnread);
        setMentionCounts(seededMentions);
        if (map[initialChDef.id]) { try { await map[initialChDef.id].markRead(); } catch (e) {} }
      } catch (e) { /* read state unavailable: fall back to live-only counting */ }
      if (!ownsSetup()) { disposeOwnedBag(bag); return; }
      setChannelUnreadReady(true);

      const detectAndAlert = (event) => {
        if (!ownsSetup()) return;
        const chId = event.channel_id || event.cid?.replace('messaging:', '');
        if (!chId) return;
        const msg = event.message || {};
        const text = msg.text || '';
        const lower = text.toLowerCase();
        const senderId = msg.user?.id || '';
        const senderName = msg.user?.name || 'Someone';
        const myId = profile.id;
        const myName = (profile.name || '').toLowerCase();
        const myFirst = myName.split(' ')[0];
        if (senderId === myId) return;
        if (chId === activeIdRef.current) {
          const ch = clientRef.current && clientRef.current.activeChannels ? clientRef.current.activeChannels['messaging:' + chId] : null;
          if (ch && ch.markRead) { try { ch.markRead(); } catch (e) {} }
          return;
        }
        const mentionedMe = (myFirst && lower.includes('@' + myFirst)) || (myName && lower.includes('@' + myName));
        const everyoneByInstructor = lower.includes('@everyone') && canPostAnnouncements(msg.user);
        const isMention = mentionedMe || everyoneByInstructor;
        setUnreadCounts((prev) => ({ ...prev, [chId]: (prev[chId] || 0) + 1 }));
        if (isMention) {
          setMentionCounts((prev) => ({ ...prev, [chId]: (prev[chId] || 0) + 1 }));
          const chName = (allChannels.find((c) => c.id === chId) || {}).name || 'the chat';
          fireMentionAlert(`${senderName} mentioned you`, `In ${chName}: ${text.slice(0, 120)}`);
        }
      };

      if (!ownsSetup()) { disposeOwnedBag(bag); return; }
      { const s = client.on('message.new', (event) => detectAndAlert(event)); bag.add(() => s.unsubscribe()); }
      { const s = client.on('notification.message_new', (event) => detectAndAlert(event)); bag.add(() => s.unsubscribe()); }
      requestNotificationPermission();

      const handleThreadReply = async (event) => {
        if (!ownsSetup()) return;
        console.log('[CATS THREAD DIAG] notification.thread_message_new received', {
          keys: Object.keys(event || {}), channel_id: event.channel_id, cid: event.cid,
          parent_id: event.message?.parent_id, replier: event.message?.user?.id,
        });
        const reply = event.message || {};
        const parentId = reply.parent_id;
        if (!parentId) { console.warn('[CATS THREAD DIAG] no parent_id on event, skipping'); return; }
        const replierId = reply.user?.id;
        if (!replierId || replierId === profile.id) { console.log('[CATS THREAD DIAG] rejected: own reply'); return; }
        const channelId = event.channel_id || (event.cid || '').replace('messaging:', '');
        if (!channelId) { console.warn('[CATS THREAD DIAG] no channel ID on event, skipping'); return; }
        try {
          const probe = clientRef.current.channel('messaging', channelId);
          const response = await probe.getMessagesById([parentId]);
          if (!ownsSetup()) return; // stale generation OR superseded same-gen setup after the async parent lookup
          const parent = response && response.messages && response.messages[0];
          if (!parent) { console.warn('[CATS THREAD DIAG] parent lookup returned no message', parentId); return; }
          if (parent.user?.id !== profile.id) { console.log('[CATS THREAD DIAG] rejected: not my thread', { parentAuthor: parent.user?.id }); return; }
          console.log('[CATS THREAD DIAG] accepted: notifying', { threadId: parentId, channelId });
          upsertThreadNote(setThreadNotes, {
            threadId: parentId, channelId, replierName: reply.user?.name || 'Someone', replierId,
            preview: (reply.text || '').slice(0, 120), latestReplyId: reply.id || null,
            createdAt: reply.created_at || new Date().toISOString(),
          });
          if (openThreadIdRef.current !== parentId) {
            const channelName = (allChannels.find((channel) => channel.id === channelId) || {}).name || 'the chat';
            fireMentionAlert(`${reply.user?.name || 'Someone'} replied to your thread`, `In ${channelName}: ${(reply.text || '').slice(0, 120)}`);
          }
        } catch (e) { console.warn('[CATS THREAD DIAG] parent lookup failed', e.message); }
      };
      const threadReplySubscription = client.on('notification.thread_message_new', handleThreadReply);
      bag.add(() => threadReplySubscription.unsubscribe());

      const reconcileThreads = async (trigger) => {
        try {
          const result = await client.queryThreads({ watch: false, limit: 30, participant_limit: 10, reply_limit: 1 });
          if (!ownsSetup()) return; // stale generation OR superseded same-gen setup after the async queryThreads
          const threads = result.threads || [];
          console.log('[CATS THREAD DIAG] queryThreads result', { trigger, count: threads.length });
          threads.forEach((thread) => {
            const unread = thread.ownUnreadCount;
            if (!unread) return;
            const state = thread.state.getLatestValue();
            const parentUserId = state.parentMessage?.user?.id;
            if (parentUserId !== profile.id) return;
            const lastReply = state.replies && state.replies.length ? state.replies[state.replies.length - 1] : null;
            const channelObject = thread.channel;
            const channelId = channelObject ? (channelObject.id || (channelObject.cid || '').replace('messaging:', '')) : null;
            if (!channelId) { console.warn('[CATS THREAD DIAG] queryThreads thread missing channel ID', thread.id); return; }
            console.log('[CATS THREAD DIAG] queryThreads reconciled unread thread', { threadId: thread.id, channelId, unread });
            if (!ownsSetup()) return;
            upsertThreadNote(setThreadNotes, {
              threadId: thread.id, channelId, replierName: lastReply?.user?.name || 'Someone',
              replierId: lastReply?.user?.id, preview: (lastReply?.text || '').slice(0, 120),
              latestReplyId: lastReply?.id || null, createdAt: state.updatedAt || new Date().toISOString(),
            });
          });
        } catch (e) { console.warn('[CATS THREAD DIAG] queryThreads reconciliation failed', trigger, e.message); }
      };
      reconcileThreads('initial-connect').finally(() => { if (ownsSetup()) setThreadRecoveryReady(true); });

      const recoveredSubscription = client.on('connection.recovered', () => { if (ownsSetup()) reconcileThreads('connection.recovered'); });
      bag.add(() => recoveredSubscription.unsubscribe());

      // Pass ownsSetup (not isCurrent) so Featured's final state publication cannot occur after
      // this setup has been superseded by a same-generation newer setup.
      retrieveFeaturedUpdates(client, map, profile, ownsSetup).finally(() => { if (ownsSetup()) setFeaturedUpdatesReady(true); });
    } catch (e) {
      disposeOwnedBag(bag);
      throw e;
    }
  }, [allChannels, getInitialChannelId, canPostAnnouncements, fireMentionAlert, requestNotificationPermission, upsertThreadNote, retrieveFeaturedUpdates, disposeOwnedBag]);

  return {
    // ---- read-only data ----
    chatClient, channelMap, activeId, unreadCounts, mentionCounts,
    threadNotes, pendingThread, openThreadId,
    featuredItems, pendingFeatured, featuredUnavailable,
    channelUnreadReady, threadRecoveryReady, featuredUpdatesReady,
    // ---- semantic actions ----
    selectChannel,
    openThreadTarget, activeThreadChanged, resolveThreadJump,
    openFeaturedTarget, completeFeaturedJump, markFeaturedUnavailable,
    isFeaturedAcknowledged, acknowledgeFeatured,
    // ---- lifecycle (controller-initiated) ----
    setupChannels,
  };
}

module.exports = { usePlatformRuntime, CONNECTED_PHASES, reconcileThreadNoteOnOpen, emptyRuntimeState, disposeBagOwned, setupStillOwns };
