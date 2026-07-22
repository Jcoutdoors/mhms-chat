// QA Safety Guardrails — isolated refusal, guard, and invisibility tests.
//
// Runs with plain Node (no test framework is installed in this repo):
//   node qa-tools/tests/runTests.js
//
// EVERY test in this file is isolated. No Stream client is constructed, no network call is
// made, and no production channel or user is read or written. Production channel IDs appear
// only as inert local strings handed to the guard, which must refuse them before dispatch.

const assert = require('assert');
const {
  guardedQaWrite,
  forceMarker,
  membershipMatches,
} = require('../guard.js');
const {
  bootstrapQaUsers,
  validateRequestedUserId,
} = require('../bootstrapQaUsers.js');
const {
  bootstrapQaChannels,
  validateRequestedChannelId,
} = require('../bootstrapQaChannels.js');
const {
  createMockStreamAdapter,
  validQaChannelState,
} = require('../mocks/mockStreamAdapter.js');
const qaConfig = require('../qaConfig.js');
const {
  CHANNEL_GROUPS,
  ALL_PRODUCTION_CHANNEL_IDS,
  getLiveChannelDefs,
  retainConfiguredChannels,
  isConfiguredProductionChannelId,
} = require('../../src/channelConfig.js');

const silent = { log() {} };
const results = [];
let failed = 0;

async function test(id, name, fn) {
  try {
    const detail = await fn();
    results.push({ id, name, pass: true, detail: detail || 'ok' });
  } catch (err) {
    failed++;
    results.push({ id, name, pass: false, detail: err.message });
  }
}

/** Helper: run a guarded write against a mock and return { result, adapter }. */
async function guardedWithMock(args, mockConfig) {
  const adapter = createMockStreamAdapter(mockConfig || {});
  const result = await guardedQaWrite({ ...args, adapter, logger: silent });
  return { result, adapter };
}

const OK_CHANNEL = 'cats-qa-general';
const OK_ACTOR = 'cats-qa-user-1';
const okStates = { [OK_CHANNEL]: validQaChannelState() };

(async () => {
  // ---------------- Criterion 3: user bootstrap rejects non-allowlisted IDs -------------
  await test('AC3', 'user bootstrap rejects IDs outside the exact three-ID allowlist', async () => {
    const adapter = createMockStreamAdapter({});
    const r = await bootstrapQaUsers({
      adapter,
      requestedIds: ['cats-qa-user-99'],
      logger: silent,
    });
    assert.strictEqual(r.ok, false, 'should refuse');
    assert.strictEqual(adapter.totalCallCount(), 0, 'must refuse before ANY Stream call');
    return `refused (${r.failures[0].reason}); adapter calls = 0`;
  });

  // ---------------- Criterion 4: rejects a student-style hashed ID ---------------------
  await test('AC4', 'user bootstrap rejects a representative student-style hashed ID', async () => {
    const adapter = createMockStreamAdapter({});
    // Inert local test value only. No real cohort user is queried or targeted.
    const r = await bootstrapQaUsers({
      adapter,
      requestedIds: ['cats-ebc67674dd263dfc41d58552'],
      logger: silent,
    });
    assert.strictEqual(r.ok, false, 'should refuse');
    assert.strictEqual(adapter.totalCallCount(), 0, 'must refuse before any Stream lookup');
    return `refused before lookup (${r.failures[0].reason}); adapter calls = 0`;
  });

  // ---------------- Criterion 8/9: channel bootstrap rejects production IDs ------------
  await test('AC8', 'channel bootstrap rejects cats-mod-01 before any Stream call', async () => {
    const adapter = createMockStreamAdapter({});
    const r = await bootstrapQaChannels({
      adapter,
      requestedIds: ['cats-mod-01'],
      logger: silent,
      skipUserBootstrap: true,
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(adapter.totalCallCount(), 0, 'zero Stream calls');
    assert.ok(/denylist/.test(r.failures[0].reason), 'denylist must be the reason');
    return `refused (${r.failures[0].reason}); adapter calls = 0`;
  });

  await test('AC9', 'channel bootstrap rejects a second production channel before dispatch', async () => {
    const adapter = createMockStreamAdapter({});
    const r = await bootstrapQaChannels({
      adapter,
      requestedIds: ['cats-general'],
      logger: silent,
      skipUserBootstrap: true,
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(adapter.totalCallCount(), 0);
    return `refused (${r.failures[0].reason}); adapter calls = 0`;
  });

  // ---------------- Criterion 10: rejects non-allowlisted cats-qa- ID ------------------
  await test('AC10', 'channel bootstrap rejects cats-qa-random-test despite the QA prefix', async () => {
    const adapter = createMockStreamAdapter({});
    const r = await bootstrapQaChannels({
      adapter,
      requestedIds: ['cats-qa-random-test'],
      logger: silent,
      skipUserBootstrap: true,
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(adapter.totalCallCount(), 0);
    return `refused (${r.failures[0].reason}); adapter calls = 0`;
  });

  // ---------------- Criterion 11 (mocked half): permitted write succeeds --------------
  await test('AC11-mock', 'permitted guarded write succeeds against a valid QA channel (mock)', async () => {
    const { result, adapter } = await guardedWithMock(
      { actorId: OK_ACTOR, channelId: OK_CHANNEL, operation: 'sendQaMessage', payload: { text: 'hello' } },
      { channelStates: okStates }
    );
    assert.strictEqual(result.allowed, true, 'should be allowed');
    assert.strictEqual(adapter.calls.sendMessage, 1, 'exactly one send');
    assert.ok(result.result.text.startsWith(qaConfig.QA_MESSAGE_MARKER), 'marker forced');
    return `ALLOWED; text = "${result.result.text}"`;
  });

  // ---------------- Criterion 12/13: guarded write refuses production channels ---------
  await test('AC12', 'guarded write targeting cats-mod-01 fails before dispatch', async () => {
    const { result, adapter } = await guardedWithMock(
      { actorId: OK_ACTOR, channelId: 'cats-mod-01', operation: 'sendQaMessage', payload: { text: 'x' } },
      {}
    );
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(adapter.mutationCallCount(), 0, 'zero mutation calls');
    assert.strictEqual(adapter.totalCallCount(), 0, 'zero calls of any kind');
    return `REFUSED (${result.refusalReason}); mutation calls = 0; total calls = 0`;
  });

  await test('AC13', 'guarded write targeting cats-general fails before dispatch', async () => {
    const { result, adapter } = await guardedWithMock(
      { actorId: OK_ACTOR, channelId: 'cats-general', operation: 'sendQaMessage', payload: { text: 'x' } },
      {}
    );
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(adapter.totalCallCount(), 0);
    return `REFUSED (${result.refusalReason}); total calls = 0`;
  });

  // ---------------- Criterion 14: qa_only missing -------------------------------------
  await test('AC14', 'write fails when qa_only is missing (isolated fixture)', async () => {
    const { result, adapter } = await guardedWithMock(
      { actorId: OK_ACTOR, channelId: OK_CHANNEL, operation: 'sendQaMessage', payload: { text: 'x' } },
      {
        channelStates: {
          [OK_CHANNEL]: { exists: true, customData: { qa_fixture: true, name: 'QA — General' }, memberIds: qaConfig.QA_ACTOR_IDS.slice() },
        },
      }
    );
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(adapter.mutationCallCount(), 0, 'zero mutation calls');
    return `REFUSED (${result.refusalReason}); mutation calls = 0`;
  });

  // ---------------- Criterion 15: qa_only false ---------------------------------------
  await test('AC15', 'write fails when qa_only is false (isolated fixture)', async () => {
    const { result, adapter } = await guardedWithMock(
      { actorId: OK_ACTOR, channelId: OK_CHANNEL, operation: 'sendQaMessage', payload: { text: 'x' } },
      {
        channelStates: {
          [OK_CHANNEL]: { exists: true, customData: { qa_only: false, qa_fixture: true, name: 'QA — General' }, memberIds: qaConfig.QA_ACTOR_IDS.slice() },
        },
      }
    );
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(adapter.mutationCallCount(), 0);
    return `REFUSED (${result.refusalReason}); mutation calls = 0`;
  });

  // ---------------- Criterion 16: non-allowlisted QA-prefixed channel ------------------
  await test('AC16', 'write fails for a cats-qa- prefixed channel not in the allowlist', async () => {
    const { result, adapter } = await guardedWithMock(
      { actorId: OK_ACTOR, channelId: 'cats-qa-random-test', operation: 'sendQaMessage', payload: { text: 'x' } },
      { channelStates: { 'cats-qa-random-test': validQaChannelState() } }
    );
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(adapter.totalCallCount(), 0, 'refused locally, no read');
    return `REFUSED (${result.refusalReason}); total calls = 0`;
  });

  // ---------------- Criterion 17: denylist overrides misleading metadata ---------------
  await test('AC17', 'production denylist overrides a fixture claiming qa_only: true for cats-mod-01', async () => {
    const { result, adapter } = await guardedWithMock(
      { actorId: OK_ACTOR, channelId: 'cats-mod-01', operation: 'sendQaMessage', payload: { text: 'x' } },
      {
        // Deliberately misleading isolated fixture. Nothing is read from or written to the
        // real production channel; this state exists only inside the mock.
        channelStates: {
          'cats-mod-01': { exists: true, customData: { qa_only: true, qa_fixture: true, name: 'QA — General' }, memberIds: qaConfig.QA_ACTOR_IDS.slice() },
        },
      }
    );
    assert.strictEqual(result.allowed, false, 'must refuse');
    assert.ok(/denylist/.test(result.refusalReason), 'denylist must be the deciding control');
    assert.strictEqual(adapter.totalCallCount(), 0, 'never even read the misleading metadata');
    return `REFUSED by denylist despite qa_only:true; total calls = 0`;
  });

  // ---------------- Criterion 18: destructive operations refused ----------------------
  await test('AC18', 'destructive operations are refused before dispatch', async () => {
    const ops = ['truncate', 'deleteChannel', 'deleteUser', 'hardDelete', 'bulkCleanup'];
    const lines = [];
    for (const op of ops) {
      const { result, adapter } = await guardedWithMock(
        { actorId: OK_ACTOR, channelId: OK_CHANNEL, operation: op, payload: { text: 'x' } },
        { channelStates: okStates }
      );
      assert.strictEqual(result.allowed, false, `${op} must be refused`);
      assert.strictEqual(adapter.totalCallCount(), 0, `${op} must not call the adapter`);
      lines.push(`${op}=REFUSED/0calls`);
    }
    return lines.join(' ');
  });

  // ---------------- Thread reply parent-channel binding -------------------------------
  await test('AC-extra', 'thread reply is refused when the parent lives in another channel', async () => {
    const { result, adapter } = await guardedWithMock(
      { actorId: OK_ACTOR, channelId: OK_CHANNEL, operation: 'sendQaThreadReply', payload: { text: 'x', parentId: 'p1' } },
      { channelStates: okStates, messages: { p1: { channelId: 'cats-qa-module-a' } } }
    );
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(adapter.calls.sendThreadReply, 0, 'no reply dispatched');
    return `REFUSED (${result.refusalReason}); sendThreadReply calls = 0`;
  });

  // ---------------- Criterion 20: zero cats-qa-* in production configuration -----------
  await test('AC20', 'shared channel config and APP_CONFIG.channelGroups contain zero cats-qa-*', async () => {
    const inData = JSON.stringify(CHANNEL_GROUPS).includes('cats-qa');
    assert.strictEqual(inData, false, 'CHANNEL_GROUPS must not mention cats-qa');
    const qaIds = ALL_PRODUCTION_CHANNEL_IDS.filter(i => i.indexOf('cats-qa') === 0);
    assert.strictEqual(qaIds.length, 0);
    return `CHANNEL_GROUPS cats-qa entries = 0; production IDs = ${ALL_PRODUCTION_CHANNEL_IDS.length}`;
  });

  // ---------------- Criterion 21: application data-path invisibility -------------------
  await test('AC21-map', 'channel map retains only configured production channels', async () => {
    // Mixed collection: production + QA + an unrelated nonconfigured channel.
    const mixed = [
      { id: 'cats-general' },
      { id: 'cats-mod-03' },
      { id: 'cats-qa-general' },
      { id: 'cats-qa-module-a' },
      { id: 'mhms-general' },
    ];
    // This is the SAME helper src/index.jsx uses to build channelMap, not a copy.
    const kept = retainConfiguredChannels(mixed).map(c => c.id);
    assert.deepStrictEqual(kept, ['cats-general', 'cats-mod-03']);
    return `input=[${mixed.map(c => c.id).join(', ')}] kept=[${kept.join(', ')}]`;
  });

  await test('AC21-sidebar', 'sidebar groups come from production configuration only', async () => {
    const ids = CHANNEL_GROUPS.flatMap(g => g.channels).map(c => c.id);
    assert.ok(!ids.some(i => i.indexOf('cats-qa') === 0));
    return `sidebar channel IDs = ${ids.length}, cats-qa = 0`;
  });

  await test('AC21-unread', 'unread seeding iterates production configuration only', async () => {
    const ids = getLiveChannelDefs().map(c => c.id);
    assert.ok(!ids.some(i => i.indexOf('cats-qa') === 0));
    return `live channel defs = ${ids.length}, cats-qa = 0`;
  });

  await test('AC21-recap', 'Welcome Back recap resolves channels via production config only', async () => {
    // computeWelcomeBackRecap() resolves each unread channel via ALL_CHANNELS.find and
    // drops anything it cannot resolve. Simulate that resolution step exactly.
    const unreadCounts = { 'cats-general': 2, 'cats-qa-general': 5 };
    const live = getLiveChannelDefs();
    const resolved = Object.keys(unreadCounts)
      .filter(id => live.find(c => c.id === id))
      .sort();
    assert.deepStrictEqual(resolved, ['cats-general']);
    return `unread keys=[cats-general, cats-qa-general] resolved=[${resolved.join(', ')}]`;
  });

  await test('AC21-deeplink', 'deep-link validation rejects nonconfigured IDs', async () => {
    assert.strictEqual(isConfiguredProductionChannelId('cats-qa-general'), false);
    assert.strictEqual(isConfiguredProductionChannelId('mhms-general'), false);
    assert.strictEqual(isConfiguredProductionChannelId('cats-general'), true);
    return 'cats-qa-general=false, mhms-general=false, cats-general=true';
  });

  await test('AC21-membership-guard', 'membership predicate accepts only the exact three QA users', async () => {
    assert.strictEqual(membershipMatches(['cats-qa-user-1', 'cats-qa-user-2', 'cats-qa-user-3']), true);
    assert.strictEqual(membershipMatches(['cats-qa-user-1', 'cats-qa-user-2']), false);
    assert.strictEqual(
      membershipMatches(['cats-qa-user-1', 'cats-qa-user-2', 'cats-qa-user-3', 'cats-ebc67674dd263dfc41d58552']),
      false,
      'a real-looking extra member must invalidate'
    );
    return 'exact three = true; missing = false; extra member = false';
  });

  // ---------------- Marker forcing ----------------------------------------------------
  await test('AC-marker', 'QA marker is forced and cannot be omitted by the caller', async () => {
    assert.ok(forceMarker('plain text').startsWith(qaConfig.QA_MESSAGE_MARKER));
    assert.strictEqual(forceMarker(`${qaConfig.QA_MESSAGE_MARKER} already`), `${qaConfig.QA_MESSAGE_MARKER} already`);
    return `forceMarker('plain text') = "${forceMarker('plain text')}"`;
  });

  // ---------------- Report ------------------------------------------------------------
  console.log('\n=== QA Safety Guardrails — isolated test results ===\n');
  results.forEach(r => {
    console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] ${r.id.padEnd(20)} ${r.name}`);
    console.log(`         ${r.detail}`);
  });
  console.log(`\n  ${results.length - failed}/${results.length} passed\n`);
  process.exit(failed ? 1 : 0);
})();
