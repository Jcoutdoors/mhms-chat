// QA user fixture bootstrap — CREATE AND VALIDATE ONLY.
//
// Scope is deliberately tiny: it can create or validate exactly three fixed fixture users
// and nothing else. It exposes no delete, no deactivate, no bulk operation, and no general
// user-update path. It can never touch a non-QA user, because every ID is checked against
// an exact three-item allowlist BEFORE any Stream lookup is attempted.
//
// Fails closed. An existing fixture that does not match the required QA-identifying data is
// reported and left completely untouched — never auto-repaired, updated, deleted, or
// replaced. That requires explicit product-owner direction.

const {
  QA_ACTOR_IDS,
  QA_ACTOR_PREFIX,
  isApprovedQaActorId,
  buildQaUserFixture,
} = require('./qaConfig.js');

/**
 * Validate a requested user ID against the exact allowlist.
 * Returns { ok, reason }. Runs entirely locally — no Stream lookup, no dispatch.
 */
function validateRequestedUserId(id) {
  if (typeof id !== 'string' || !id.trim()) {
    return { ok: false, reason: 'user ID must be a non-empty string' };
  }
  if (id.indexOf(QA_ACTOR_PREFIX) !== 0) {
    return { ok: false, reason: `user ID lacks required ${QA_ACTOR_PREFIX} prefix` };
  }
  if (!isApprovedQaActorId(id)) {
    // Catches cats-qa-user-99 and anything else that merely matches the prefix.
    return { ok: false, reason: 'user ID is not in the exact three-ID QA fixture allowlist' };
  }
  return { ok: true, reason: null };
}

/** True when a stored user carries the required forced QA-identifying data. */
function fixtureUserIsValid(stored) {
  if (!stored) return false;
  if (stored.qa_only !== true) return false;
  if (stored.qa_fixture !== true) return false;
  if (typeof stored.name !== 'string' || stored.name.indexOf('QA Fixture User') !== 0) return false;
  return true;
}

/**
 * Create or validate the three fixed QA fixture users.
 *
 * @param {object} opts
 * @param {object} opts.adapter  real or isolated adapter
 * @param {string[]} [opts.requestedIds]  defaults to the exact three; anything else refuses
 * @returns {Promise<{ok, created, validated, failures, report}>}
 */
async function bootstrapQaUsers({ adapter, requestedIds, logger } = {}) {
  const log = logger || console;
  const ids = requestedIds || QA_ACTOR_IDS.slice();
  const failures = [];

  // ---- Local allowlist gate, BEFORE any Stream lookup or mutation ----
  for (const id of ids) {
    const v = validateRequestedUserId(id);
    if (!v.ok) failures.push({ id, stage: 'allowlist', reason: v.reason });
  }
  if (failures.length) {
    log.log('[QA USER BOOTSTRAP] refused before any Stream lookup:', JSON.stringify(failures));
    return { ok: false, created: [], validated: [], failures, report: 'refused-locally' };
  }
  if (!adapter || typeof adapter.getUsersByIds !== 'function') {
    return {
      ok: false,
      created: [],
      validated: [],
      failures: [{ stage: 'adapter', reason: 'no usable adapter supplied' }],
      report: 'refused-locally',
    };
  }

  // ---- Read existing fixtures ----
  let existing = [];
  try {
    existing = await adapter.getUsersByIds(ids);
  } catch (err) {
    const safe = err && err.safe ? err.safe : { message: 'user lookup failed' };
    return {
      ok: false,
      created: [],
      validated: [],
      failures: [{ stage: 'lookup', reason: safe.message }],
      report: 'lookup-failed',
    };
  }
  const byId = {};
  existing.forEach(u => {
    byId[u.id] = u;
  });

  const created = [];
  const validated = [];
  const toCreate = [];

  for (const id of ids) {
    const stored = byId[id];
    if (!stored) {
      toCreate.push(buildQaUserFixture(id));
      continue;
    }
    if (fixtureUserIsValid(stored)) {
      validated.push(id);
    } else {
      // FAIL CLOSED. Do not repair, update, delete, or replace.
      failures.push({
        id,
        stage: 'validation',
        reason: 'existing fixture user is missing or has incorrect QA-identifying data',
        observed: {
          qa_only: stored.qa_only === undefined ? '(absent)' : stored.qa_only,
          qa_fixture: stored.qa_fixture === undefined ? '(absent)' : stored.qa_fixture,
          name: typeof stored.name === 'string' ? stored.name : '(absent)',
        },
      });
    }
  }

  if (failures.length) {
    log.log('[QA USER BOOTSTRAP] failing closed, no repair attempted:', JSON.stringify(failures));
    return { ok: false, created: [], validated, failures, report: 'validation-failed' };
  }

  if (toCreate.length) {
    try {
      await adapter.upsertQaFixtureUsers(toCreate);
      toCreate.forEach(u => created.push(u.id));
    } catch (err) {
      const safe = err && err.safe ? err.safe : { message: 'create failed' };
      return {
        ok: false,
        created: [],
        validated,
        failures: [{ stage: 'create', reason: safe.message }],
        report: 'create-failed',
      };
    }
  }

  return { ok: true, created, validated, failures: [], report: 'ok' };
}

module.exports = { bootstrapQaUsers, validateRequestedUserId, fixtureUserIsValid };
