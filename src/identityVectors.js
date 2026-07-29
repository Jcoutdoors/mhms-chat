// Golden identity vectors — a RELEASE INVARIANT for the deterministic Stream
// identity spec (VIF Phase 1). Shared fixture consumed by the identity tests
// and available to the future authentication service's own parity tests.
//
// Each vector records: the raw input, its normalized form, the FULL SHA-256 hex
// of the normalized UTF-8 bytes, and the final Stream user ID (`cats-` + first
// 24 hex chars). If any of these ever change, existing users would be remapped
// to new Stream identities — so these values must never change.
//
// Do NOT add provider-specific canonicalization (Gmail dots, +tags, etc.):
// plus-addressed and subdomain inputs are intentionally DISTINCT identities.

'use strict';

module.exports = [
  {
    label: 'Simple lowercase',
    input: 'person@example.com',
    normalized: 'person@example.com',
    sha256: '542d240129883c019e106e3b1b2d3f3cb3537c43c425364de8e951d5a3083345',
    userId: 'cats-542d240129883c019e106e3b',
  },
  {
    label: 'Uppercase',
    input: 'PERSON@EXAMPLE.COM',
    normalized: 'person@example.com',
    sha256: '542d240129883c019e106e3b1b2d3f3cb3537c43c425364de8e951d5a3083345',
    userId: 'cats-542d240129883c019e106e3b',
  },
  {
    label: 'Surrounding whitespace',
    input: '  person@example.com  ',
    normalized: 'person@example.com',
    sha256: '542d240129883c019e106e3b1b2d3f3cb3537c43c425364de8e951d5a3083345',
    userId: 'cats-542d240129883c019e106e3b',
  },
  {
    label: 'Mixed case',
    input: 'Person@Example.Com',
    normalized: 'person@example.com',
    sha256: '542d240129883c019e106e3b1b2d3f3cb3537c43c425364de8e951d5a3083345',
    userId: 'cats-542d240129883c019e106e3b',
  },
  {
    label: 'Plus address (distinct identity)',
    input: 'person+tag@example.com',
    normalized: 'person+tag@example.com',
    sha256: '656278d7f8246848775c3a62022b975952712f7e617d5212ad5f8e2283c43066',
    userId: 'cats-656278d7f8246848775c3a62',
  },
  {
    label: 'Subdomain (distinct identity)',
    input: 'person@mail.example.com',
    normalized: 'person@mail.example.com',
    sha256: 'db581e8d2a95531ff2dcd06cb7c668bd4edc0bd508b3dfda849a248666be6dc2',
    userId: 'cats-db581e8d2a95531ff2dcd06c',
  },
  {
    // Live production identity documented in the repository (PROJECT_KNOWLEDGE.md
    // / ASSISTANT_CONFIG). Locks parity with real deployed data.
    label: 'Documented Mark identity',
    input: 'dr.mark.mayfield@gmail.com',
    normalized: 'dr.mark.mayfield@gmail.com',
    sha256: '8114d68476d8e833db5ac08a36d68c538dc0c2b92476c6d3066bafe41b798b0b',
    userId: 'cats-8114d68476d8e833db5ac08a',
  },
];
