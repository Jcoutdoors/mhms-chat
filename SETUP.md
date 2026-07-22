# SETUP — rebuilding and deploying the CATS chat

This explains how to recreate the build environment from the files in this package and how
to deploy. Read `PROJECT_KNOWLEDGE.md` first for the full picture.

---

## Rebuilding the build environment

You need Node.js. From a working directory:

1. Copy `source/index.jsx` into `src/index.jsx`.
2. Copy `source/webpack.config.js` and `source/package.json` into the working directory root.
3. Install dependencies:
   ```
   npm install
   ```
   (If a global prefix error appears in a sandboxed environment, that is environment-specific
   and does not affect a normal local machine.)
4. Build:
   ```
   npx webpack
   ```
   This produces `dist/chat.bundle.js` and three numbered chunk files. Build takes ~40s.
5. Create `dist/index.html` using the wrapper in `PROJECT_KNOWLEDGE.md` (the static loader).

---

## The deploy loop (every change)

1. Edit `src/index.jsx`.
2. `npx webpack`
3. Recreate `dist/index.html` (static wrapper).
4. Confirm 5 output files exist in `dist/`: `index.html`, `chat.bundle.js`, and three `*.chunk.js` files.
5. Sanity check the bundle:
   - `du -h dist/chat.bundle.js` should be ~1.8MB.
   - `wc -l src/index.jsx` should be roughly 2,650 lines (NOT hundreds of thousands).
     (This figure was stale at "~1,100" for several releases; it is the verified current
     size as of the QA Safety Guardrails release. Check `PROJECT_KNOWLEDGE.md` for the
     exact count recorded with the most recent version.)
6. In the GitHub repo `mhms-chat` (account `jcoutdoors`): delete the old 5 files, then upload the new 5 together.
7. Wait ~2 minutes for GitHub Pages, then hard refresh the Squarespace page.

The live app is embedded at `https://www.mentalhealthmadesimple.life/catscourse#community`
and served from `https://jcoutdoors.github.io/mhms-chat/`.

---

## Deploying the Cloudflare Workers

Only needed when worker logic changes (not for normal app changes).

**Token worker (`mhms-chat-token`):**
- Source: `cloudflare-workers/token-worker.js`
- In Cloudflare > Workers > mhms-chat-token > Edit Code, paste the file, Deploy.
- Required env var: `STREAM_SECRET` (Secret) = the Stream app secret.

**Notification worker (`cats-notifications`):**
- Source: `cloudflare-workers/notification-worker.js`
- In Cloudflare > Workers > cats-notifications > Edit Code, paste the file, Deploy.
- Required env var: `RESEND_API_KEY` (Secret) = the Resend API key.
- Stream webhook: Stream Dashboard > MHMS Cohort app > Overview > Webhook & Event Configuration. URL points at this worker, subscribed only to `message.new`.

To add another email route, copy the `if (/@(...)/i.test(text)) { ... }` block and change
the pattern and the recipient address.

---

## Testing a fresh deploy

1. Open the community page in your normal browser and a second user in an incognito window.
2. Getting Started channel renders and reads correctly top to bottom.
3. Post messages; confirm avatars, own-vs-other alignment, reactions, edit/delete, threads, pins.
4. Type `@` and confirm the autocomplete dropdown appears; confirm `@everyone` shows only for an instructor account (ID starting with `cats-jonathan`, `cats-mark`, `cats-mayfield`, or `jonathan`).
5. From the second user, mention the first by name; confirm the red `@` badge, browser notification (allow permission once), and chime.
6. Post `@support` from any account; confirm `jonathan@nexgenrva.com` gets the email. Post `@mark`; confirm `dr.mark.mayfield@gmail.com` gets the email.
7. Open the 🔍 search in a channel with history and confirm results appear.

---

## If something looks broken

- **Changes not showing up after deploy:** confirm you uploaded all 5 files and deleted the old ones; confirm Pages finished (~2 min); hard refresh. If still wrong, check the bundle size and `index.jsx` line count for corruption (see the hard lesson in PROJECT_KNOWLEDGE.md).
- **"user was deleted" error in one browser:** `localStorage.removeItem('cats_profile')` in that browser's console, refresh.
- **Reactions / uploads / user search fail:** re-check Stream role permissions (listed in PROJECT_KNOWLEDGE.md).
- **No emails:** check the worker's `RESEND_API_KEY` is set as a Secret, the Stream webhook is subscribed to `message.new` and pointed at the worker, and the from-domain is still verified in Resend.

---

## QA Safety Guardrails (read before doing ANY QA)

After the v63 incident, in which two real production channels were truncated during QA,
all repository-managed QA work must go through `qa-tools/`. This is the required workflow.

### What this is, and what it is not

This is a **policy and code-enforced boundary, not a Stream-enforced environment boundary.**
QA fixtures live inside the same production Stream application. Unlike a separate Stream app,
where credentials for one app cannot touch the other, this depends on:

- every QA script actually using the guard
- QA channels staying out of the production channel configuration
- QA channel membership staying limited to the fixed QA fixture users
- nobody writing an unguarded one-off mutation script in future

Do not describe this as physical or environment isolation.

The QA actor is a **declared QA actor ID**. The token worker will mint a token for any
supplied `user_id` without proving the caller owns it, so this is an operational convention
enforced by the tooling. It is **not authentication**. Never call it an "authenticated QA user".

### Fixed QA fixture users (exactly three, permanent)

- `cats-qa-user-1`
- `cats-qa-user-2`
- `cats-qa-user-3`

### Fixed QA channels (exactly four, permanent)

- `cats-qa-general`
- `cats-qa-announcements`
- `cats-qa-module-a`
- `cats-qa-module-b`

These are permanent fixtures. They are **not** created and destroyed per release, and they
are never automatically reset.

### Required bootstrap order

1. Create or validate the three QA fixture **users**.
2. Create or validate the four QA fixture **channels**.
3. Verify each channel contains **exactly** those three users.
4. Only then are guarded QA writes permitted.

`bootstrapQaChannels()` enforces this ordering itself; it runs the user bootstrap first and
aborts if the users do not validate.

### Fixture validation behaviour

Both bootstraps are idempotent and **validate** existing fixtures rather than silently
accepting them. If an existing fixture has missing or incorrect QA metadata, or a channel has
unexpected membership, the bootstrap **fails closed**: it reports the discrepancy and changes
nothing. It will not repair, update, delete, truncate, or replace it. Fixing a mismatched
fixture requires explicit product-owner direction.

There is deliberately **no process-local "bootstrap complete" flag.** The bootstrap and a
later write may run in different Node processes. Persistent Stream fixture state, revalidated
on every single write, is the authoritative precondition.

### Normal guarded-write workflow

```js
const { createStreamAdapter } = require('./qa-tools/streamAdapter.js');
const { guardedQaWrite } = require('./qa-tools/guard.js');

const adapter = createStreamAdapter();           // requires STREAM_SECRET in the environment
const r = await guardedQaWrite({
  actorId: 'cats-qa-user-1',                     // declared QA actor ID
  channelId: 'cats-qa-general',                  // must be an approved QA channel
  operation: 'sendQaMessage',
  payload: { text: 'checking the recap' },
  adapter,
});
```

Every write revalidates, in this order — local checks first, so a production channel ID is
refused with **zero** Stream calls:

1. channel ID is **not** on the production denylist (checked first, authoritative)
2. operation is explicitly permitted
3. channel ID has the `cats-qa-` prefix
4. channel ID is in the exact four-channel allowlist
5. actor ID has the `cats-qa-user-` prefix and is in the exact three-actor allowlist
6. payload is well formed
7. channel exists, has stored `qa_only === true` and `qa_fixture === true`
8. channel membership is exactly the three QA fixture users
9. for a thread reply, the parent message belongs to that same QA channel

### Permitted operations

- `sendQaMessage`
- `sendQaThreadReply`

That is the whole list. Reactions are deliberately excluded until a real QA case needs one,
which would go through a separate reviewed change. Everything else is default-denied.

### Test-message prefix

Every QA message must carry the marker `[QA v63.1]`. The guard **forces** it into the text;
a caller cannot omit it.

### Prohibited operations

Never reachable through `qa-tools/`, even for approved QA channels:

`truncate()`, channel deletion, user deletion, hard delete, production channel update,
production user update, bulk cleanup, automated teardown, automated reset, destructive
membership cleanup, and general-purpose mutation passthrough.

The real Stream adapter exposes **no destructive method at all** — these are not merely
policy-denied, there is no code path that could perform them.

### No reset, no teardown, no routine cleanup

QA fixtures and QA messages **persist**. There is no reset script and no teardown script, and
none may be added. Accumulating QA messages in QA channels is expected and fine.

If exceptional cleanup is ever genuinely required:

- it needs **product-owner approval**
- a human performs it directly in the Stream dashboard
- it is not part of the normal QA workflow
- no cleanup utility is added to the repository

### Sanitized error output

QA tooling must never print environment-variable values, `STREAM_SECRET`, user or server
tokens, Authorization headers, request configuration, or raw SDK/Axios error objects. Errors
are reduced to `message`, `status`, `code`, and `requestId`. When checking environment setup,
report presence only, e.g. `STREAM_SECRET present: yes`.

### Verification commands

```
node qa-tools/tests/runTests.js     # isolated guard/bootstrap/invisibility tests (no Stream calls)
node qa-tools/staticInspect.js      # fails if QA tooling reaches the SDK outside the adapter
```

`staticInspect.js` enforces that direct Stream SDK access exists only in
`qa-tools/streamAdapter.js`, and that no destructive Stream operation appears anywhere in
`qa-tools/`. Run both before and after any change to QA tooling.
