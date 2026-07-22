// Real Stream adapter.
//
// This is one of only THREE files in qa-tools/ permitted to import the Stream SDK directly
// (the others being the two fixture bootstrap modules). Everything else must go through
// the guard. The static inspection script enforces this.
//
// DELIBERATE OMISSION: this adapter exposes NO destructive capability. There is no
// truncate, no channel delete, no user delete, no hard delete, no bulk operation, no
// generic passthrough. Those operations are not merely denied by policy — there is no
// method here that could perform them.
//
// OUTPUT SAFETY: this module never logs the Stream secret, tokens, Authorization headers,
// request configuration, or raw SDK/Axios error objects. Errors are sanitized on the way
// out via sanitizeError().

const { StreamChat } = require('stream-chat');
const { STREAM_API_KEY } = require('./qaConfig.js');

/**
 * Reduce any thrown SDK/HTTP error to safe fields only.
 * Never returns headers, request config, tokens, or the raw error object.
 */
function sanitizeError(err) {
  if (!err) return { message: 'unknown error' };
  const out = { message: typeof err.message === 'string' ? err.message : 'unknown error' };
  if (err.status !== undefined) out.status = err.status;
  else if (err.response && err.response.status !== undefined) out.status = err.response.status;
  if (err.code !== undefined) out.code = err.code;
  // Stream echoes a request id we can safely surface for support correlation.
  const rid =
    (err.response && err.response.headers && err.response.headers['x-request-id']) ||
    err.request_id;
  if (rid) out.requestId = rid;
  return out;
}

function requireSecret() {
  const secret = process.env.STREAM_SECRET;
  if (!secret) {
    // Presence only. The value is never printed or included in the error.
    throw new Error('STREAM_SECRET is not set in the environment');
  }
  return secret;
}

function createStreamAdapter() {
  const client = StreamChat.getInstance(STREAM_API_KEY, requireSecret());

  return {
    name: 'realStreamAdapter',

    /**
     * Read-only. Returns { exists, customData, memberIds } for a channel.
     * Uses queryChannels with watch:false so it never watches or mutates read state.
     */
    async getChannelState(channelId) {
      try {
        const res = await client.queryChannels(
          { type: 'messaging', id: { $eq: channelId } },
          {},
          { watch: false, state: true, limit: 1 }
        );
        if (!res.length) return { exists: false, customData: null, memberIds: [] };
        const ch = res[0];
        const memberIds = Object.keys((ch.state && ch.state.members) || {}).sort();
        return { exists: true, customData: ch.data || {}, memberIds };
      } catch (err) {
        throw Object.assign(new Error('getChannelState failed'), { safe: sanitizeError(err) });
      }
    },

    /** Read-only. Returns the users matching the given exact IDs. */
    async getUsersByIds(ids) {
      try {
        const res = await client.queryUsers({ id: { $in: ids } }, {}, { limit: ids.length });
        return res.users || [];
      } catch (err) {
        throw Object.assign(new Error('getUsersByIds failed'), { safe: sanitizeError(err) });
      }
    },

    /** Create-only path used exclusively by the QA user fixture bootstrap. */
    async upsertQaFixtureUsers(users) {
      try {
        return await client.upsertUsers(users);
      } catch (err) {
        throw Object.assign(new Error('upsertQaFixtureUsers failed'), { safe: sanitizeError(err) });
      }
    },

    /** Create-only path used exclusively by the QA channel fixture bootstrap. */
    async createQaFixtureChannel(channelId, data, memberIds, createdById) {
      try {
        const ch = client.channel('messaging', channelId, {
          ...data,
          members: memberIds,
          created_by_id: createdById,
        });
        await ch.create();
        return { created: true };
      } catch (err) {
        throw Object.assign(new Error('createQaFixtureChannel failed'), { safe: sanitizeError(err) });
      }
    },

    /** Read-only. Returns { exists, channelId } for a message, for parent validation. */
    async getMessageChannel(messageId) {
      try {
        const res = await client.getMessage(messageId);
        const msg = res && res.message;
        if (!msg) return { exists: false, channelId: null };
        const cid = msg.cid || (msg.channel && msg.channel.cid) || '';
        const channelId =
          (msg.channel && msg.channel.id) ||
          (cid.indexOf(':') !== -1 ? cid.slice(cid.indexOf(':') + 1) : null);
        return { exists: true, channelId };
      } catch (err) {
        throw Object.assign(new Error('getMessageChannel failed'), { safe: sanitizeError(err) });
      }
    },

    /** Guarded mutation. Only ever called by the guard, after all checks pass. */
    async sendMessage(channelId, { text, userId }) {
      try {
        const ch = client.channel('messaging', channelId);
        const res = await ch.sendMessage({ text, user_id: userId });
        return { id: res.message.id, text: res.message.text };
      } catch (err) {
        throw Object.assign(new Error('sendMessage failed'), { safe: sanitizeError(err) });
      }
    },

    /** Guarded mutation. Only ever called by the guard, after all checks pass. */
    async sendThreadReply(channelId, { text, parentId, userId }) {
      try {
        const ch = client.channel('messaging', channelId);
        const res = await ch.sendMessage({ text, parent_id: parentId, user_id: userId });
        return { id: res.message.id, text: res.message.text, parentId };
      } catch (err) {
        throw Object.assign(new Error('sendThreadReply failed'), { safe: sanitizeError(err) });
      }
    },
  };
}

module.exports = { createStreamAdapter, sanitizeError };
