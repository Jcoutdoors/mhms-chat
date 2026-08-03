// Pure verification-code input normalization (VIF Phase 4B). Extracted from the
// component so it is unit-testable without a DOM. The code is ALWAYS a string:
// non-digits are stripped and the result is truncated to six characters, so leading
// zeros are preserved (never coerced to a number).
'use strict';

const CODE_LENGTH = 6;

function normalizeCode(raw) {
  return String(raw == null ? '' : raw).replace(/\D/g, '').slice(0, CODE_LENGTH);
}

module.exports = { CODE_LENGTH, normalizeCode };
