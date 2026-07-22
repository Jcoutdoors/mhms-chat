// Fixed QA configuration: allowlists, forced fixture metadata, and the production denylist.
//
// Everything here is deliberately FIXED. These are permanent fixtures, not per-release
// scratch resources. There is no reset, teardown, or cleanup path anywhere in qa-tools/.
//
// The production denylist is DERIVED from the shared channel configuration module. It is
// never hand-maintained here, and src/index.jsx is never parsed as text.

const { ALL_PRODUCTION_CHANNEL_IDS } = require('../src/channelConfig.js');

// Public Stream identifiers. These are not secrets (the API key is the client key that
// ships in the browser bundle). The Stream SECRET is never referenced in this file.
const STREAM_APP_ID = '1613783';
const STREAM_API_KEY = '9bdsdh9s956e';

const QA_CHANNEL_PREFIX = 'cats-qa-';
const QA_ACTOR_PREFIX = 'cats-qa-user-';

/** The ONLY approved declared QA actor IDs. Exact allowlist, not a pattern. */
const QA_ACTOR_IDS = Object.freeze([
  'cats-qa-user-1',
  'cats-qa-user-2',
  'cats-qa-user-3',
]);

/** The ONLY approved QA channel IDs. Exact allowlist, not a pattern. */
const QA_CHANNEL_IDS = Object.freeze([
  'cats-qa-general',
  'cats-qa-announcements',
  'cats-qa-module-a',
  'cats-qa-module-b',
]);

/** Every QA test message must visibly carry this marker. The guard forces it. */
const QA_MESSAGE_MARKER = '[QA v63.1]';

/**
 * Permitted operations. Default-deny: anything not in this list is refused.
 *
 * Reactions are deliberately NOT included. No current acceptance requirement needs a
 * reaction mutation, and the platform principle is the smallest operation surface that
 * works. A future release may add one through a separate reviewed change.
 */
const PERMITTED_OPERATIONS = Object.freeze(['sendQaMessage', 'sendQaThreadReply']);

/**
 * Operations that must never be reachable through repository-managed QA tooling, even for
 * approved QA channels. These are listed so the guard can classify them as destructive for
 * the preflight report. The real enforcement is that PERMITTED_OPERATIONS is an allowlist
 * AND the Stream adapter exposes no destructive method at all.
 */
const KNOWN_DESTRUCTIVE_OPERATIONS = Object.freeze([
  'truncate',
  'deleteChannel',
  'deleteUser',
  'hardDelete',
  'updateProductionChannel',
  'updateProductionUser',
  'bulkCleanup',
  'destructiveMembershipCleanup',
  'teardown',
  'reset',
  'mutationPassthrough',
]);

/** Production denylist, derived from the shared channel configuration. Authoritative. */
function getProductionDenylist() {
  return ALL_PRODUCTION_CHANNEL_IDS.slice();
}

function isProductionChannelId(id) {
  return getProductionDenylist().indexOf(id) !== -1;
}

function isApprovedQaChannelId(id) {
  return QA_CHANNEL_IDS.indexOf(id) !== -1;
}

function isApprovedQaActorId(id) {
  return QA_ACTOR_IDS.indexOf(id) !== -1;
}

function isDestructiveOperation(operation) {
  return KNOWN_DESTRUCTIVE_OPERATIONS.indexOf(operation) !== -1;
}

/**
 * Forced QA-identifying data for a fixture user. The caller cannot omit or override these.
 */
function buildQaUserFixture(id) {
  const suffix = id.slice(QA_ACTOR_PREFIX.length);
  return {
    id,
    name: `QA Fixture User ${suffix} (not a real member)`,
    qa_only: true,
    qa_fixture: true,
  };
}

const QA_CHANNEL_LABELS = Object.freeze({
  'cats-qa-general': 'General',
  'cats-qa-announcements': 'Announcements',
  'cats-qa-module-a': 'Module A',
  'cats-qa-module-b': 'Module B',
});

/**
 * Forced QA-identifying data for a fixture channel. The caller cannot omit or override.
 */
function buildQaChannelFixture(id) {
  return {
    name: `QA — ${QA_CHANNEL_LABELS[id]} (QA fixture, not a cohort channel)`,
    qa_only: true,
    qa_fixture: true,
  };
}

module.exports = {
  STREAM_APP_ID,
  STREAM_API_KEY,
  QA_CHANNEL_PREFIX,
  QA_ACTOR_PREFIX,
  QA_ACTOR_IDS,
  QA_CHANNEL_IDS,
  QA_MESSAGE_MARKER,
  PERMITTED_OPERATIONS,
  KNOWN_DESTRUCTIVE_OPERATIONS,
  getProductionDenylist,
  isProductionChannelId,
  isApprovedQaChannelId,
  isApprovedQaActorId,
  isDestructiveOperation,
  buildQaUserFixture,
  buildQaChannelFixture,
  QA_CHANNEL_LABELS,
};
