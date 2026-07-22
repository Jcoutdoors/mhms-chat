// QA channel fixture bootstrap — CREATE AND VALIDATE ONLY.
//
// This module exists because the normal guard requires stored qa_only === true, which
// cannot be read before a channel exists. Its scope is therefore deliberately tiny: create
// or validate exactly four fixed fixture channels. It exposes no update path, no delete, no
// truncate, and no bulk operation.
//
// It can never convert an existing production channel into a QA channel: every requested ID
// is checked against the exact four-item allowlist AND the production denylist BEFORE any
// Stream call is made.
//
// Fails closed. An existing fixture with wrong metadata or wrong membership is reported and
// left untouched — never auto-repaired, updated, deleted, truncated, or replaced.

const {
  QA_CHANNEL_IDS,
  QA_CHANNEL_PREFIX,
  QA_ACTOR_IDS,
  isApprovedQaChannelId,
  isProductionChannelId,
  buildQaChannelFixture,
} = require('./qaConfig.js');
const { membershipMatches } = require('./guard.js');
const { bootstrapQaUsers } = require('./bootstrapQaUsers.js');

/** The fixture channels are created by a QA fixture identity, never a production identity. */
const QA_CHANNEL_CREATOR_ID = 'cats-qa-user-1';

/**
 * Validate a requested channel ID. Entirely local — no Stream call, no dispatch.
 */
function validateRequestedChannelId(id) {
  if (typeof id !== 'string' || !id.trim()) {
    return { ok: false, reason: 'channel ID must be a non-empty string' };
  }
  // Production denylist is checked first and is authoritative.
  if (isProductionChannelId(id)) {
    return { ok: false, reason: 'channel ID is on the production denylist' };
  }
  if (id.indexOf(QA_CHANNEL_PREFIX) !== 0) {
    return { ok: false, reason: `channel ID lacks required ${QA_CHANNEL_PREFIX} prefix` };
  }
  if (!isApprovedQaChannelId(id)) {
    // Catches cats-qa-random-test and anything else that merely matches the prefix.
    return { ok: false, reason: 'channel ID is not in the exact four-ID QA channel allowlist' };
  }
  return { ok: true, reason: null };
}

/** True when stored channel data carries the required forced QA-identifying metadata. */
function fixtureChannelMetadataIsValid(customData) {
  if (!customData) return false;
  if (customData.qa_only !== true) return false;
  if (customData.qa_fixture !== true) return false;
  if (typeof customData.name !== 'string' || customData.name.indexOf('QA —') !== 0) return false;
  return true;
}

/**
 * Create or validate the four fixed QA fixture channels.
 *
 * REQUIRED ORDER: the QA fixture users must exist and validate first, because each channel
 * is created with exactly those three as members. This function enforces that ordering
 * itself rather than trusting a caller or a process-local flag.
 */
async function bootstrapQaChannels({ adapter, requestedIds, logger, skipUserBootstrap } = {}) {
  const log = logger || console;
  const ids = requestedIds || QA_CHANNEL_IDS.slice();
  const failures = [];

  // ---- Local allowlist + denylist gate, BEFORE any Stream call ----
  for (const id of ids) {
    const v = validateRequestedChannelId(id);
    if (!v.ok) failures.push({ id, stage: 'allowlist', reason: v.reason });
  }
  if (failures.length) {
    log.log('[QA CHANNEL BOOTSTRAP] refused before any Stream call:', JSON.stringify(failures));
    return { ok: false, created: [], validated: [], failures, report: 'refused-locally' };
  }
  if (!adapter || typeof adapter.getChannelState !== 'function') {
    return {
      ok: false,
      created: [],
      validated: [],
      failures: [{ stage: 'adapter', reason: 'no usable adapter supplied' }],
      report: 'refused-locally',
    };
  }

  // ---- Enforced ordering: users first ----
  if (!skipUserBootstrap) {
    const userResult = await bootstrapQaUsers({ adapter, logger: log });
    if (!userResult.ok) {
      log.log('[QA CHANNEL BOOTSTRAP] aborting: QA fixture users did not validate');
      return {
        ok: false,
        created: [],
        validated: [],
        failures: [{ stage: 'user-prerequisite', reason: 'QA fixture users failed', userResult }],
        report: 'user-prerequisite-failed',
      };
    }
  }

  const created = [];
  const validated = [];

  for (const id of ids) {
    let state;
    try {
      state = await adapter.getChannelState(id);
    } catch (err) {
      const safe = err && err.safe ? err.safe : { message: 'channel state unreadable' };
      failures.push({ id, stage: 'lookup', reason: safe.message });
      continue;
    }

    if (!state.exists) {
      try {
        await adapter.createQaFixtureChannel(
          id,
          buildQaChannelFixture(id),
          QA_ACTOR_IDS.slice(),
          QA_CHANNEL_CREATOR_ID
        );
        created.push(id);
      } catch (err) {
        const safe = err && err.safe ? err.safe : { message: 'create failed' };
        failures.push({ id, stage: 'create', reason: safe.message });
      }
      continue;
    }

    // Existing fixture: validate metadata AND exact membership. Never repair.
    const metaOk = fixtureChannelMetadataIsValid(state.customData);
    const memberOk = membershipMatches(state.memberIds);
    if (metaOk && memberOk) {
      validated.push(id);
    } else {
      failures.push({
        id,
        stage: 'validation',
        reason: 'existing QA channel has incorrect metadata or membership',
        observed: {
          qa_only:
            state.customData && state.customData.qa_only !== undefined
              ? state.customData.qa_only
              : '(absent)',
          qa_fixture:
            state.customData && state.customData.qa_fixture !== undefined
              ? state.customData.qa_fixture
              : '(absent)',
          memberIds: state.memberIds || [],
          metadataValid: metaOk,
          membershipValid: memberOk,
        },
      });
    }
  }

  if (failures.length) {
    log.log(
      '[QA CHANNEL BOOTSTRAP] failing closed, no repair attempted:',
      JSON.stringify(failures)
    );
    return { ok: false, created, validated, failures, report: 'validation-failed' };
  }

  return { ok: true, created, validated, failures: [], report: 'ok' };
}

module.exports = {
  bootstrapQaChannels,
  validateRequestedChannelId,
  fixtureChannelMetadataIsValid,
  QA_CHANNEL_CREATOR_ID,
};
