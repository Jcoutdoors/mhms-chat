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
   - `wc -l src/index.jsx` should be ~1,100 lines (NOT hundreds of thousands).
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
