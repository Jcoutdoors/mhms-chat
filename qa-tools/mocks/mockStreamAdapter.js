// Isolated mock Stream adapter for refusal-path testing.
//
// This exists so that refusal tests NEVER touch Stream. Production channel IDs appear in
// these tests only as inert local strings; nothing is ever dispatched, read, or mutated
// against the real Stream app.
//
// Every method increments a counter, so a test can prove "zero mutation calls" and
// "zero network writes" rather than merely asserting that the guard returned REFUSED.

function createMockStreamAdapter(config = {}) {
  const calls = {
    getChannelState: 0,
    getUsersByIds: 0,
    upsertQaFixtureUsers: 0,
    createQaFixtureChannel: 0,
    getMessageChannel: 0,
    sendMessage: 0,
    sendThreadReply: 0,
  };

  const mutationMethods = [
    'upsertQaFixtureUsers',
    'createQaFixtureChannel',
    'sendMessage',
    'sendThreadReply',
  ];

  return {
    name: 'mockStreamAdapter',
    calls,

    /** Total calls to any method that would write to Stream. */
    mutationCallCount() {
      return mutationMethods.reduce((n, m) => n + calls[m], 0);
    },
    /** Total calls of any kind, including reads. */
    totalCallCount() {
      return Object.keys(calls).reduce((n, m) => n + calls[m], 0);
    },

    async getChannelState(channelId) {
      calls.getChannelState++;
      if (config.channelStateError) throw Object.assign(new Error('mock read failure'), { safe: { message: 'mock read failure' } });
      const s = (config.channelStates || {})[channelId];
      if (!s) return { exists: false, customData: null, memberIds: [] };
      return s;
    },

    async getUsersByIds(ids) {
      calls.getUsersByIds++;
      const users = config.users || {};
      return ids.map(id => users[id]).filter(Boolean);
    },

    async upsertQaFixtureUsers(users) {
      calls.upsertQaFixtureUsers++;
      return { users };
    },

    async createQaFixtureChannel(channelId, data, memberIds, createdById) {
      calls.createQaFixtureChannel++;
      return { created: true, channelId, data, memberIds, createdById };
    },

    async getMessageChannel(messageId) {
      calls.getMessageChannel++;
      const m = (config.messages || {})[messageId];
      if (!m) return { exists: false, channelId: null };
      return { exists: true, channelId: m.channelId };
    },

    async sendMessage(channelId, payload) {
      calls.sendMessage++;
      return { id: 'mock-msg-1', text: payload.text };
    },

    async sendThreadReply(channelId, payload) {
      calls.sendThreadReply++;
      return { id: 'mock-reply-1', text: payload.text, parentId: payload.parentId };
    },
  };
}

/** A fully valid QA channel state, used as the baseline for "should succeed" cases. */
function validQaChannelState() {
  return {
    exists: true,
    customData: { qa_only: true, qa_fixture: true, name: 'QA — General (QA fixture, not a cohort channel)' },
    memberIds: ['cats-qa-user-1', 'cats-qa-user-2', 'cats-qa-user-3'],
  };
}

module.exports = { createMockStreamAdapter, validQaChannelState };
