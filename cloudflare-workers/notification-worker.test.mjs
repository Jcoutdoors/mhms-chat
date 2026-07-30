// notification-worker tests (Resend notification-domain migration).
//
// Exercises the REAL default export from notification-worker.js by driving it
// with synthetic Stream "message.new" webhook payloads and a stubbed global
// fetch that captures the outbound Resend request WITHOUT making a network call
// (so no production email is ever sent and no real API key is used).
//
// Proves: @mark / Dr. Mark variants route to Mark; @support / @help route to
// Jonathan; unrelated messages send nothing; the sender is the migrated address;
// recipients, subject/body template, and the Resend request structure are
// unchanged; provider-failure behavior is unchanged; and no secret is logged.
//
// Deterministic. No network / Stream / real secrets. Run via `node --test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './notification-worker.js';

const RESEND_URL = 'https://api.resend.com/emails';
const TEST_SECRET = 'test-resend-key-DO-NOT-LOG';
const EXPECTED_FROM = 'CATS Program <notifications@send.mentalhealthmadesimple.life>';

// Install a fetch stub that records every outbound request and returns a canned
// Response. Returns { calls, restore }. `status` controls the simulated Resend
// HTTP status; `throwErr`, if set, makes the stub throw (network-failure sim).
function stubFetch({ status = 200, throwErr = null } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (throwErr) throw throwErr;
    return new Response(JSON.stringify({ id: 'test-email-id' }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

// Capture console output for the duration of `fn` so tests can assert nothing
// secret is logged. Restores the originals afterward.
async function withConsoleCapture(fn) {
  const lines = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(orig)) {
    console[k] = (...args) => { lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  }
  try {
    await fn();
  } finally {
    Object.assign(console, orig);
  }
  return lines;
}

// Build a message.new webhook Request for the given text/channel.
function webhook(text, { channelId = 'cats-general', userName = 'Alex Rivera' } = {}) {
  return new Request('https://cats-notifications.example/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'message.new',
      channel_id: channelId,
      message: { text, user: { id: 'u1', name: userName } },
    }),
  });
}

async function run(text, opts, stubOpts) {
  const s = stubFetch(stubOpts);
  try {
    const res = await worker.fetch(webhook(text, opts), { RESEND_API_KEY: TEST_SECRET });
    return { res, calls: s.calls };
  } finally {
    s.restore();
  }
}

// Parses the JSON body of a captured Resend call.
function payloadOf(call) {
  assert.equal(call.url, RESEND_URL, 'posts to the Resend emails endpoint');
  return JSON.parse(call.init.body);
}

// ---------------- routing ----------------

test('@mark routes to Mark only (one email, correct recipient)', async () => {
  const { res, calls } = await run('hey @mark can you look at this?');
  assert.equal(calls.length, 1);
  const p = payloadOf(calls[0]);
  assert.deepEqual(p.to, ['dr.mark.mayfield@gmail.com']);
  assert.equal((await res.text()).includes('mark:200'), true);
});

test('supported Dr. Mark variants route to Mark', async () => {
  // These are the forms the current regex actually matches. NOTE: the dotted form
  // "@dr.mark.mayfield" is NOT matched (a dot between "mark" and "mayfield" breaks
  // the pattern); that is asserted separately below to lock in real behavior. This
  // migration deliberately does not change mention detection.
  const variants = [
    '@dr.mayfield hi',
    '@dr. mayfield hi',
    '@dr.mark mayfield hi',
    '@dr. mark mayfield hi',
    'shout out to @Mark', // case-insensitive
  ];
  for (const v of variants) {
    const { calls } = await run(v);
    assert.equal(calls.length, 1, `variant should send exactly one: ${v}`);
    assert.deepEqual(payloadOf(calls[0]).to, ['dr.mark.mayfield@gmail.com'], `variant routes to Mark: ${v}`);
  }
});

test('regex behavior preserved: dotted "@dr.mark.mayfield" is NOT matched (documents current behavior)', async () => {
  const { calls } = await run('@dr.mark.mayfield hi');
  assert.equal(calls.length, 0, 'unchanged: this dotted form does not trigger routing');
});

test('@support and @help route to Jonathan only', async () => {
  for (const v of ['I need @support please', 'can I get @help here']) {
    const { calls } = await run(v);
    assert.equal(calls.length, 1, `should send exactly one: ${v}`);
    assert.deepEqual(payloadOf(calls[0]).to, ['jonathan@nexgenrva.com'], `routes to Jonathan: ${v}`);
  }
});

test('unrelated messages send nothing; email-like locals do not false-trigger', async () => {
  for (const v of [
    'just a normal message',
    'email me at jon@support.org',        // guard: char before @ is a word char
    'see sarah@markholdings.com',         // guard: mark not a standalone mention
    'check out @marketing updates',       // \b stops @marketing matching mark
  ]) {
    const { res, calls } = await run(v);
    assert.equal(calls.length, 0, `no email for: ${v}`);
    assert.equal((await res.text()).includes('no matches'), true);
  }
});

test('a message mentioning both routes sends to both recipients', async () => {
  const { calls } = await run('@mark and @support please');
  assert.equal(calls.length, 2);
  const tos = calls.map((c) => payloadOf(c).to[0]).sort();
  assert.deepEqual(tos, ['dr.mark.mayfield@gmail.com', 'jonathan@nexgenrva.com']);
});

// ---------------- sender / template / structure ----------------

test('sender is the migrated notifications@send.mentalhealthmadesimple.life', async () => {
  const { calls } = await run('@mark hi');
  assert.equal(payloadOf(calls[0]).from, EXPECTED_FROM);
  assert.equal(payloadOf(calls[0]).from.includes('notifications.nexgenrva.com'), false, 'legacy domain gone');
});

test('Resend request structure is unchanged (method, auth header, JSON keys)', async () => {
  const { calls } = await run('@support hi');
  const { init } = calls[0];
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Authorization'], `Bearer ${TEST_SECRET}`);
  assert.equal(init.headers['Content-Type'], 'application/json');
  const p = payloadOf(calls[0]);
  assert.deepEqual(Object.keys(p).sort(), ['from', 'html', 'subject', 'to'].sort());
});

test('template content is unchanged except the sender (subject, CTA, channel, escaping)', async () => {
  const { calls } = await run('@mark look at <b>this</b>', { channelId: 'cats-mod-03', userName: 'Sam & Co' });
  const p = payloadOf(calls[0]);
  // subject reflects sender name + friendly channel name (unchanged behavior)
  assert.equal(p.subject, 'Sam & Co mentioned you in Mod 3 · Trauma, ACEs & PTSD');
  // CTA + chat URL unchanged
  assert.equal(p.html.includes('https://chat.mentalhealthmadesimple.life'), true);
  assert.equal(p.html.includes('Respond in the Chat'), true);
  // friendly channel name interpolated
  assert.equal(p.html.includes('Mod 3 · Trauma, ACEs &amp; PTSD'), true);
  // HTML escaping still applied to user text and sender name (v61 behavior)
  assert.equal(p.html.includes('&lt;b&gt;this&lt;/b&gt;'), true, 'user text escaped');
  assert.equal(p.html.includes('Sam &amp; Co'), true, 'sender name escaped');
});

// ---------------- webhook handling / failure behavior ----------------

test('non-message.new events and non-POST are ignored without sending', async () => {
  // GET -> 200 OK, no send
  const s1 = stubFetch();
  try {
    const res = await worker.fetch(new Request('https://x/', { method: 'GET' }), { RESEND_API_KEY: TEST_SECRET });
    assert.equal(res.status, 200);
    assert.equal(s1.calls.length, 0);
  } finally { s1.restore(); }

  // wrong event type -> 200 Ignored, no send
  const s2 = stubFetch();
  try {
    const req = new Request('https://x/', { method: 'POST', body: JSON.stringify({ type: 'message.updated', message: { text: '@mark' } }) });
    const res = await worker.fetch(req, { RESEND_API_KEY: TEST_SECRET });
    assert.equal(res.status, 200);
    assert.equal(s2.calls.length, 0);
  } finally { s2.restore(); }
});

test('provider non-2xx behavior is unchanged: status surfaced in body, handler still 200', async () => {
  const { res, calls } = await run('@mark hi', {}, { status: 500 });
  assert.equal(calls.length, 1);
  assert.equal(res.status, 200);
  assert.equal((await res.text()).includes('mark:500'), true, 'provider status surfaced unchanged');
});

test('no secret value is logged during a send', async () => {
  const lines = await withConsoleCapture(async () => { await run('@mark and @support', {}, { status: 200 }); });
  assert.equal(lines.join('\n').includes(TEST_SECRET), false, 'API key never logged');
});
