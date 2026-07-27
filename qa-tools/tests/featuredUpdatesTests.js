// v63.1 Featured Updates — Layer 1 isolated deterministic tests.
//
//   node qa-tools/tests/featuredUpdatesTests.js
//
// No Stream client is constructed and no network call is made. These tests feed plain
// fixture objects to the SAME pure helpers the application uses (from src/featuredUpdates.js
// and src/channelConfig.js), never a duplicated copy.

const assert = require('assert');
const fu = require('../../src/featuredUpdates.js');
const cfg = require('../../src/channelConfig.js');

const isProd = cfg.isConfiguredProductionChannelId;
const results = [];
let failed = 0;

function test(id, name, fn) {
  try {
    const detail = fn();
    results.push({ id, name, pass: true, detail: detail || 'ok' });
  } catch (err) {
    failed++;
    results.push({ id, name, pass: false, detail: err.message });
  }
}

const FIXED = Date.parse('2026-07-22T12:00:00Z');
const now = () => FIXED;
const iso = deltaDaysAgo => new Date(FIXED - deltaDaysAgo * 86400000).toISOString();
const MARK = 'cats-8114d68476d8e833db5ac08a';

const BASE_CONFIG = {
  enabled: true,
  sectionLabel: 'New from Mark',
  authorIds: [MARK],
  sourceChannelIds: ['cats-announcements'],
  maxItems: 3,
  previewLength: 60,
  lookbackDays: 7,
};

// A memory storage that can be told to throw on read or write.
function memStorage(initial, opts = {}) {
  let data = initial === undefined ? {} : { [fu.FEATURED_ACK_KEY]: initial };
  return {
    getItem(k) { if (opts.readThrows) throw new Error('read denied'); return k in data ? data[k] : null; },
    setItem(k, v) { if (opts.writeThrows) throw new Error('quota'); data[k] = v; },
    _dump() { return data[fu.FEATURED_ACK_KEY]; },
  };
}

function markMsg(over = {}) {
  return {
    id: over.id || 'm-' + Math.random().toString(36).slice(2, 8),
    user: { id: MARK, name: 'Mark Mayfield' },
    text: 'text',
    created_at: iso(1),
    type: 'regular',
    ...over,
  };
}

// Build channelResults + assemble using a no-ack store unless one is supplied.
function assemble(messages, conf = BASE_CONFIG, isAck = () => false) {
  return fu.assembleFeaturedItems(
    [{ channelId: 'cats-announcements', channelName: '📣 Announcements', messages }],
    conf,
    { isAcknowledged: isAck, nowMs: FIXED }
  );
}

// ---------------- Config validation (each disable condition) ----------------
test('L1-cfg-valid', 'valid config passes', () => {
  const r = fu.validateFeaturedUpdatesConfig(BASE_CONFIG, isProd);
  assert.strictEqual(r.ok, true);
  return 'ok=true';
});
[
  ['enabled:false', { enabled: false }, false],
  ['enabled non-bool', { enabled: 'y' }, true],
  ['sectionLabel empty', { sectionLabel: ' ' }, true],
  ['authorIds empty', { authorIds: [] }, true],
  ['authorIds malformed', { authorIds: [1] }, true],
  ['sourceChannelIds empty', { sourceChannelIds: [] }, true],
  ['source outside prod', { sourceChannelIds: ['cats-qa-general'] }, true],
  ['mhms source', { sourceChannelIds: ['mhms-general'] }, true],
  ['maxItems 0', { maxItems: 0 }, true],
  ['maxItems 11 no clamp', { maxItems: 11 }, true],
  ['maxItems 3.5', { maxItems: 3.5 }, true],
  ['previewLength 0', { previewLength: 0 }, true],
  ['lookbackDays -1', { lookbackDays: -1 }, true],
].forEach(([label, patch, expectInvalid]) => {
  test('L1-cfg-' + label.replace(/\W+/g, '_'), 'disables on ' + label, () => {
    const r = fu.validateFeaturedUpdatesConfig({ ...BASE_CONFIG, ...patch }, isProd);
    assert.strictEqual(r.ok, false, 'must not be ok');
    assert.strictEqual(r.invalid, expectInvalid, 'invalid flag');
    return `ok=false invalid=${r.invalid} (${r.reason})`;
  });
});

// ---------------- Qualification ----------------
test('L1-qualify-included', 'a qualifying top-level Mark post is included', () => {
  const items = assemble([markMsg({ id: 'good1', text: 'Module 4 is posted' })]);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].messageId, 'good1');
  return 'included good1';
});
test('L1-qualify-nonmark', 'a non-Mark author is excluded', () => {
  const items = assemble([markMsg({ id: 'x', user: { id: 'cats-someone-else', name: 'Sam' } })]);
  assert.strictEqual(items.length, 0);
  return 'excluded';
});
test('L1-qualify-reply', 'a thread reply (parent_id) is excluded', () => {
  const items = assemble([markMsg({ id: 'x', parent_id: 'p1' })]);
  assert.strictEqual(items.length, 0);
  return 'excluded';
});
test('L1-qualify-deleted', 'a deleted post is excluded', () => {
  const a = assemble([markMsg({ id: 'x', deleted_at: iso(0) })]);
  const b = assemble([markMsg({ id: 'y', type: 'deleted' })]);
  assert.strictEqual(a.length + b.length, 0);
  return 'both excluded';
});
test('L1-qualify-shadow-system', 'a shadowed or system message is excluded', () => {
  const a = assemble([markMsg({ id: 'x', shadowed: true })]);
  const b = assemble([markMsg({ id: 'y', type: 'system' })]);
  assert.strictEqual(a.length + b.length, 0);
  return 'both excluded';
});
test('L1-qualify-attach-only', 'an attachment-only post (no text) is excluded', () => {
  const items = assemble([markMsg({ id: 'x', text: '', attachments: [{ type: 'image' }] })]);
  assert.strictEqual(items.length, 0);
  return 'excluded';
});
test('L1-qualify-text-plus-attach', 'a text-plus-attachment post qualifies on its text', () => {
  const items = assemble([markMsg({ id: 'x', text: 'See attached', attachments: [{ type: 'file', title: 'syllabus.pdf' }] })]);
  assert.strictEqual(items.length, 1);
  assert.ok(items[0].preview.indexOf('syllabus') === -1, 'preview must not use attachment metadata');
  return `preview="${items[0].preview}"`;
});
test('L1-qualify-whitespace', 'a whitespace-only-text post is excluded', () => {
  const items = assemble([markMsg({ id: 'x', text: '   \n\t ' })]);
  assert.strictEqual(items.length, 0);
  return 'excluded';
});

// ---------------- 7-day boundary ----------------
test('L1-boundary', '7-day boundary: just inside included, just outside excluded', () => {
  const inside = assemble([markMsg({ id: 'in', created_at: iso(6.9) })]);
  const outside = assemble([markMsg({ id: 'out', created_at: iso(7.1) })]);
  assert.strictEqual(inside.length, 1, 'inside included');
  assert.strictEqual(outside.length, 0, 'outside excluded');
  return 'inside=1 outside=0';
});

// ---------------- Acknowledgment filtering ----------------
test('L1-ack-excluded', 'a previously acknowledged item is excluded (simulated later session)', () => {
  // Fresh sessionStorage does not matter for featured; persisted localStorage does.
  const store = fu.createFeaturedAckStore({
    storage: memStorage(JSON.stringify({ version: 1, acknowledged: { seen1: iso(1) } })),
    lookbackDays: 7, now,
  });
  const items = assemble([markMsg({ id: 'seen1' }), markMsg({ id: 'fresh1' })], BASE_CONFIG, id => store.isAcknowledged(id));
  assert.deepStrictEqual(items.map(i => i.messageId), ['fresh1']);
  return 'seen1 excluded, fresh1 included';
});

// ---------------- localStorage Case A / Case B ----------------
test('L1-caseA-malformed', 'Case A: malformed localStorage treated as empty, section works', () => {
  const s = memStorage('{broken');
  const warns = [];
  const store = fu.createFeaturedAckStore({ storage: s, lookbackDays: 7, now, warn: m => warns.push(m) });
  assert.strictEqual(store.getAcknowledgedIds().length, 0);
  assert.strictEqual(store.usingMemoryFallback, false, 'not a Case B');
  store.acknowledge(['m1'], iso(0));
  assert.ok((() => { try { JSON.parse(s._dump()); return true; } catch (e) { return false; } })(), 'overwritten valid');
  return `empty + warned(${warns.length}) + overwritten valid`;
});
test('L1-caseB-read', 'Case B: localStorage read throws -> in-memory fallback', () => {
  const store = fu.createFeaturedAckStore({ storage: memStorage(undefined, { readThrows: true }), lookbackDays: 7, now });
  assert.strictEqual(store.usingMemoryFallback, true);
  store.acknowledge(['m1'], iso(0));
  assert.strictEqual(store.isAcknowledged('m1'), true);
  return 'fallback engaged, in-memory ack works';
});
test('L1-caseB-write', 'Case B: localStorage write throws -> in-memory fallback engages', () => {
  const store = fu.createFeaturedAckStore({ storage: memStorage(undefined, { writeThrows: true }), lookbackDays: 7, now });
  assert.strictEqual(store.usingMemoryFallback, false, 'read succeeded');
  store.acknowledge(['m1'], iso(0));
  assert.strictEqual(store.usingMemoryFallback, true, 'flipped on write failure');
  assert.strictEqual(store.isAcknowledged('m1'), true);
  return 'fallback after write failure, ack retained';
});
test('L1-inmemory-samesession', 'in-memory acknowledgment prevents same-page-session repetition', () => {
  const store = fu.createFeaturedAckStore({ storage: memStorage(undefined, { readThrows: true }), lookbackDays: 7, now });
  const before = assemble([markMsg({ id: 'a' })], BASE_CONFIG, id => store.isAcknowledged(id));
  store.acknowledge(before.map(i => i.messageId), iso(0));
  const after = assemble([markMsg({ id: 'a' })], BASE_CONFIG, id => store.isAcknowledged(id));
  assert.strictEqual(before.length, 1);
  assert.strictEqual(after.length, 0);
  return 'shown once, suppressed on re-eval this session';
});
test('L1-inmemory-reload', 'acked items become eligible again after simulated reload when storage unavailable', () => {
  // Simulate: first page session acknowledges in memory (storage unavailable), then a
  // brand-new store instance (page reload) with the same unavailable storage.
  const s1 = memStorage(undefined, { readThrows: true, writeThrows: true });
  const store1 = fu.createFeaturedAckStore({ storage: s1, lookbackDays: 7, now });
  store1.acknowledge(['a'], iso(0));
  const store2 = fu.createFeaturedAckStore({ storage: memStorage(undefined, { readThrows: true }), lookbackDays: 7, now });
  const items = assemble([markMsg({ id: 'a' })], BASE_CONFIG, id => store2.isAcknowledged(id));
  assert.strictEqual(items.length, 1, 'eligible again after reload (documented degradation)');
  return 'in-memory ack did not survive reload (expected)';
});
test('L1-ack-prune', 'acknowledgment pruning removes entries older than lookbackDays', () => {
  const store = fu.createFeaturedAckStore({
    storage: memStorage(JSON.stringify({ version: 1, acknowledged: { old: iso(8), recent: iso(2) } })),
    lookbackDays: 7, now,
  });
  assert.strictEqual(store.isAcknowledged('old'), false);
  assert.strictEqual(store.isAcknowledged('recent'), true);
  return 'old pruned, recent kept';
});

// ---------------- Ordering / cap / multiple ----------------
test('L1-max3', 'a maximum of three items is enforced', () => {
  const msgs = [1, 2, 3, 4, 5].map(n => markMsg({ id: 'm' + n, created_at: iso(n) }));
  const items = assemble(msgs);
  assert.strictEqual(items.length, 3);
  return 'sliced to 3';
});
test('L1-multiple-same-channel', 'multiple qualifying posts from the same channel are allowed', () => {
  const items = assemble([markMsg({ id: 'a', created_at: iso(1) }), markMsg({ id: 'b', created_at: iso(2) })]);
  assert.strictEqual(items.length, 2);
  return '2 from one channel';
});
test('L1-order', 'deterministic newest-first ordering', () => {
  const items = assemble([
    markMsg({ id: 'older', created_at: iso(3) }),
    markMsg({ id: 'newest', created_at: iso(1) }),
    markMsg({ id: 'middle', created_at: iso(2) }),
  ]);
  assert.deepStrictEqual(items.map(i => i.messageId), ['newest', 'middle', 'older']);
  return 'newest,middle,older';
});
test('L1-tiebreak', 'deterministic tie-break by message ID on equal timestamps', () => {
  const t = iso(1);
  const items = assemble([
    markMsg({ id: 'aaa', created_at: t }),
    markMsg({ id: 'ccc', created_at: t }),
    markMsg({ id: 'bbb', created_at: t }),
  ]);
  // Descending by ID for a stable, unambiguous order.
  assert.deepStrictEqual(items.map(i => i.messageId), ['ccc', 'bbb', 'aaa']);
  return 'ccc,bbb,aaa (desc by id)';
});
test('L1-partial-failure', 'one source-channel failure omits only that channel', () => {
  // A failed channel simply contributes no messages array; the good one still assembles.
  const items = fu.assembleFeaturedItems([
    { channelId: 'cats-announcements', channelName: '📣 Announcements', messages: [markMsg({ id: 'good' })] },
    { channelId: 'cats-other', channelName: 'Other', messages: [] }, // simulated failed query
  ], BASE_CONFIG, { isAcknowledged: () => false, nowMs: FIXED });
  assert.deepStrictEqual(items.map(i => i.messageId), ['good']);
  return 'good retained, failed channel contributed nothing';
});

// ---------------- Preview ----------------
test('L1-preview-collapse', 'preview collapses whitespace and line breaks', () => {
  assert.strictEqual(fu.makePreview('a\n\n  b   c', 60), 'a b c');
  return 'collapsed';
});
test('L1-preview-ellipsis', 'ellipsis added only when truncation occurs', () => {
  assert.strictEqual(fu.makePreview('short', 60), 'short');
  const long = 'x'.repeat(80);
  const p = fu.makePreview(long, 60);
  assert.strictEqual(p.length, 61); // 60 chars + ellipsis
  assert.ok(p.endsWith('…'));
  return 'no ellipsis when short; ellipsis when cut';
});

// ---------------- Date ----------------
test('L1-date', 'relative date: Today / Yesterday / N days ago', () => {
  assert.strictEqual(fu.relativeDate(iso(0), FIXED), 'Today');
  assert.strictEqual(fu.relativeDate(iso(1), FIXED), 'Yesterday');
  assert.strictEqual(fu.relativeDate(iso(3), FIXED), '3 days ago');
  return 'Today/Yesterday/3 days ago';
});

// ---------------- Access-permission boundary (real helper) ----------------
test('L1-access', 'access boundary: loaded+member ok; not loaded excluded; loaded w/o members ok', () => {
  const loadedMember = { 'cats-announcements': { state: { members: { 'u1': {} } } } };
  const loadedNoMember = { 'cats-announcements': { state: { members: { 'other': {} } } } };
  const loadedNoMembersPopulated = { 'cats-announcements': { state: { members: {} } } };
  assert.strictEqual(fu.isChannelAccessibleToUser(loadedMember, 'cats-announcements', 'u1'), true);
  assert.strictEqual(fu.isChannelAccessibleToUser(loadedNoMember, 'cats-announcements', 'u1'), false);
  assert.strictEqual(fu.isChannelAccessibleToUser({}, 'cats-announcements', 'u1'), false, 'not loaded');
  assert.strictEqual(fu.isChannelAccessibleToUser(loadedNoMembersPopulated, 'cats-announcements', 'u1'), true, 'loaded, members not populated');
  return 'member=ok, non-member=no, not-loaded=no, unpopulated=ok';
});

// ---------------- Eligibility (helper level) ----------------
test('L1-eligibility', 'featured-only produces items; empty produces none', () => {
  const withFeatured = assemble([markMsg({ id: 'a' })]);
  const none = assemble([]);
  assert.strictEqual(withFeatured.length, 1);
  assert.strictEqual(none.length, 0);
  return 'featured-only=1 item (dialog would open); none=0 (would not)';
});

// ---------------- Filter shape (verified against SDK earlier) ----------------
test('L1-filter-shape', 'search filter has $in author, $gte created_at, $exists:false parent_id', () => {
  const f = fu.buildFeaturedSearchFilter([MARK], iso(7));
  assert.deepStrictEqual(f['user.id'], { $in: [MARK] });
  assert.ok(f.created_at.$gte);
  assert.deepStrictEqual(f.parent_id, { $exists: false });
  return JSON.stringify(f);
});

// ---------------- Report ----------------
console.log('\n=== v63.1 Featured Updates — Layer 1 isolated tests ===\n');
results.forEach(r => {
  console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] ${r.id.padEnd(26)} ${r.name}`);
  console.log(`         ${r.detail}`);
});
console.log(`\n  ${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
