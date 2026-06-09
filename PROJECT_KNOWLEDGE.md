# CATS Community Chat — Project Knowledge

This is the operating manual and current state for the custom community chat built for
the MHMS / CATS cohort program. Drop this whole folder into the project as knowledge so
any new conversation starts with full context. **Current version: v49 (live in production).**

---

## What this is

A custom multi-channel community chat for a paid 20-student cohort ("CATS Program"),
embedded in a Squarespace course site. Built with the Stream Chat React SDK, bundled with
webpack, hosted on GitHub Pages, and embedded as an iframe in Squarespace. Two Cloudflare
Workers handle authentication tokens and email notifications.

It is LIVE with real students. Treat every change as a production change.

---

## Architecture

**Chat bundle (the app itself)**
- React app built with webpack into a single self-contained bundle plus a few lazy chunks.
- Hosted on GitHub Pages (repo `mhms-chat`, personal GitHub account `jcoutdoors`), served via the custom domain `https://chat.mentalhealthmadesimple.life` (GitHub Pages custom domain; DNS is a CNAME at GoDaddy: name `chat` -> `jcoutdoors.github.io`). The old `https://jcoutdoors.github.io/mhms-chat/` address now redirects to the custom domain.
- The iframe embed in Squarespace points at `https://chat.mentalhealthmadesimple.life`.
- Why bundled this way: Squarespace blocks external CDN scripts and ES modules, so React, stream-chat, and stream-chat-react are all pre-bundled into one file and loaded from GitHub Pages inside an iframe.

**Stream Chat app**
- App name: "MHMS Cohort"
- App ID: `1613783`
- Public API key: `9bdsdh9s956e`  (safe to expose; this is the client key)
- Region: us-east
- Mode: Production (not dev)
- The Stream SECRET (used to sign tokens) lives only in the token worker's env. It is NOT in the app and NOT in this document.

**Token Worker (Cloudflare)**
- Name: `mhms-chat-token`
- URL: `https://mhms-chat-token.jonathan-5ad.workers.dev`
- Generates HS256 JWT user tokens. Takes `?user_id=`, returns `{ token }`.
- Env var: `STREAM_SECRET` (Secret).
- Source: `cloudflare-workers/token-worker.js`

**Notification Worker (Cloudflare)**
- Name: `cats-notifications`
- URL: `https://cats-notifications.jonathan-5ad.workers.dev`
- Receives Stream `message.new` webhook events, sends email via Resend.
- Env var: `RESEND_API_KEY` (Secret).
- From address: `no-reply@notifications.nexgenrva.com` (verified subdomain in Resend).
- Routing: `@mark` / `@dr. mayfield` → emails `dr.mark.mayfield@gmail.com`; `@support` / `@help` → emails `jonathan@nexgenrva.com`.
- Stream webhook is configured under Stream Dashboard > Overview > Webhook & Event Configuration, subscribed only to `message.new`.
- Source: `cloudflare-workers/notification-worker.js`

**Cloudflare account**
- Account: Jonathan@nexgenrva.com
- Subdomain: `jonathan-5ad.workers.dev`

> **Security note:** The Resend API key and the Stream secret appeared in the original
> build conversation. They are intentionally NOT stored in this document. They live only
> in the respective Cloudflare worker env vars. Consider rotating the Resend key at some
> point as hygiene. Never paste secrets into project files.

---

## Build & deploy workflow

This is the loop for every change. Follow it exactly.

1. Edit `source/index.jsx`.
2. From the project root with dependencies installed: `npx webpack` (builds into `dist/`). Build takes ~40s.
3. Recreate `dist/index.html` (the wrapper that loads `./chat.bundle.js`). The wrapper is simple and static; its contents are in this doc below.
4. Webpack emits 5 files that ALL must be uploaded to GitHub together: `index.html`, `chat.bundle.js`, and three numbered chunk files like `387.chunk.js`, `760.chunk.js`, `893.chunk.js`. The chunk numbers/names can change between builds.
5. In the `mhms-chat` GitHub repo: delete the old files first, then upload all 5 new files.
6. Wait ~2 minutes for GitHub Pages to deploy, then hard refresh.

**Build dependencies:** see `source/package.json`. Key versions: react 18, stream-chat 8, stream-chat-react 11, webpack 5, babel with preset-env + preset-react.

**Webpack config:** see `source/webpack.config.js`.

**The dist/index.html wrapper:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CATS Program Community</title>
  <style>* { margin: 0; padding: 0; box-sizing: border-box; } html, body { height: 100%; width: 100%; overflow: hidden; } #root { height: 100vh; width: 100%; }</style>
</head>
<body>
  <div id="root"></div>
  <script src="./chat.bundle.js"></script>
</body>
</html>
```

**Healthy bundle check:** `chat.bundle.js` should be roughly 1.8MB. If it is wildly larger
or the line count of `index.jsx` is in the hundreds of thousands, the source file is
corrupted (see hard lesson below). Verify a distinctive term appears only a handful of
times: `grep -o "queryUsers" dist/chat.bundle.js | wc -l` should return a single-digit
number, not thousands.

---

## HARD LESSON: file corruption (read before editing)

During the original build, a bad find-and-replace matched thousands of times and ballooned
`index.jsx` to ~1.9 MILLION lines / 63MB. Every "fix" after that compiled fine but built on
the corrupted file, so changes never reached the deployed bundle. This caused a long stretch
of "fixes that did nothing." The fix was to delete the file and rebuild it clean.

Rules to avoid repeating it:
- Never do large repeated `str_replace` operations that could match many times.
- After any significant edit, verify: `wc -l source/index.jsx` (should be ~1,100 lines, not millions) and `du -h dist/chat.bundle.js` (~1.8MB).
- A quick brace-balance script that ignores strings/comments is useful. Note: the `ProfileCard` function body `{` and its `return (` always show as 2 false-positive "unclosed" entries because the checker is JSX-blind. A THIRD entry indicates a real bug.

---

## Channels (sidebar structure)

Defined in `CHANNEL_GROUPS` in `index.jsx`.

**Start Here**
- `cats-getting-started` — "📖 Getting Started" — a STATIC wiki page, not a Stream channel. Rendered by the `GettingStartedWiki` component. Listed in `STATIC_CHANNELS`.
- `cats-announcements` — "📣 Announcements" — read-only for non-instructors.

**Course Modules**
- `cats-mod-01` … `cats-mod-10`, named e.g. "Mod 1 · Development & Neuroscience", "Mod 2 · Attachment Theory", "Mod 3 · Trauma, ACEs & PTSD", "Mod 4 · Therapeutic Presence", "Mod 5 · CBT, DBT & ACT", "Mod 6 · TF-CBT, EMDR & MI", "Mod 7 · Crisis Intervention", "Mod 8 · Family Systems", "Mod 9 · Identity, Culture & Tech", "Mod 10 · Supervised Practice".

**Community**
- `cats-general` — "General" — default landing channel.
- `cats-weekly-wins` — "Weekly Wins"
- `cats-readings` — "Readings & Resources"

Key constants in code:
- `ALL_CHANNELS` = all channels EXCEPT those in `STATIC_CHANNELS` (the wiki is not a Stream channel).
- `STATIC_CHANNELS = ['cats-getting-started']`
- `ANNOUNCEMENTS_ID = 'cats-announcements'`, `GETTING_STARTED_ID = 'cats-getting-started'`
- Instructor gating: `canPostAnnouncements(user)` reads the `instructor` flag set from `INSTRUCTOR_EMAILS` at setup (see Profiles & identity above). This same flag gates who can use `@everyone`. (Earlier versions gated by ID prefix; that was replaced in v35 when IDs became email hashes.)

---

## Features built and live

**Profiles & identity** — first/last name, REQUIRED email, optional bio, optional website/LinkedIn, 12-color avatar picker. Setup modal on first visit, editable from the sidebar footer. Stored in `localStorage` under `cats_profile` and upserted to Stream.
  - **Identity is derived from the email.** `emailToUserId(email)` SHA-256 hashes the normalized (trimmed, lowercased) email and takes the first 24 hex chars, prefixed `cats-`. The same email always produces the same Stream user ID, so a person reconnects as the same account on any device. This is what closes the cross-device duplicate-account gap.
  - The email field shows a short line explaining it keeps the account synced across devices. Email is validated (required, basic format check).
  - **Existing pre-email profiles:** on load, if a stored profile has no email, the user is routed into the setup form (name and color pre-filled) to add one once. Adding the email rederives their ID from the email and connects on the stable ID. There was essentially no message history at rollout (one test thread), so old-message authorship was not a concern.
  - **Instructor status is gated by email, not by ID.** `INSTRUCTOR_EMAILS = ['jonathan@nexgenrva.com','dr.mark.mayfield@gmail.com']`. At setup, `isInstructorEmail()` sets an `instructor` boolean on the profile, which is stored, passed to Stream on `connectUser` (so it travels on the user object and on every message's `msg.user`), and read by `canPostAnnouncements(user)`. This replaced the old ID-prefix gating, which broke once IDs became email-hash strings.
  - `canPostAnnouncements(user)` now takes a USER OBJECT (reads `user.instructor`), not an ID string. Call sites: the announcements input gate, the `@everyone` autocomplete option, and the inbound `@everyone` sender check (`canPostAnnouncements(msg.user)`).

**Messaging UI** — white premium UI, DM Sans font, colored initial-avatars. Custom message component: full name above bubble, own messages right/blue, others left/gray. Click name/avatar to open a profile card.

**Threads** — hover a message → Reply → opens a thread panel. Shows "N replies" under the original.

**Pins** — hover → 📌 to pin/unpin. Pinned messages show a yellow "Pinned" tag.

**Reactions** — hover → 😊 picker (👍 ❤️ 😄 😮 😢). Reaction pills with counts under the message; click a pill to toggle your own.

**Edit / delete own messages** — hover your own message → ✏️ (inline edit, Enter to save / Esc to cancel, shows "edited") or 🗑 (confirm, then "This message was deleted").

**Emoji picker** — smiley button left of the message box. Loaded from CDN at runtime (`cdn.jsdelivr.net/npm/emoji-mart@5`) to avoid webpack bundling issues that caused React errors.

**Mentions with autocomplete** — type `@` → dropdown of cohort members. `@everyone` option only shows for instructors (`canPostAnnouncements`). Mentions render highlighted blue in messages via `renderTextWithMentions()` using `memberNameRegistry`.

**Mention alerts** — when mentioned (or `@everyone` from an instructor), the user gets: a red `@` badge on the channel, a browser notification (one-time permission request), and a soft chime (Web Audio). Fired from the client `message.new` / `notification.message_new` listeners. Skips your own messages.

**Email routing (via notification worker)** — `@mark` / `@dr. mayfield` → Mark's email; `@support` / `@help` → Jonathan's email. Independent of the in-chat alerts.

**Getting Started wiki** — static formatted read-only page. Sections: Channels, Announcements, Posting & replying, Mentions, Reaching the instructor (@mark), Tech help & support (@support/@help), Notifications, Searching messages, Your account (same email = same account on any device), Sharing files, Need help.

**Setup form intro note (v37)** — the profile setup form shows an adaptive note at the top during signup. Returning users (stored profile with a name but no email) see a "welcome back, your data is safe, this just links your devices" reassurance. First-timers see a short "here's how this works" intro. Controlled by `showIntro` (signup only) and `isReturning` props on `ProfileForm`.

**Unread / mention badges** — blue number = unread count, red `@` = mention. Clears on opening the channel.

**Members list** — full roster via `chatClient.queryUsers` with presence. Green dot = online, gray = offline. Refreshes every ~6s and on presence events. Also feeds `memberNameRegistry` for mention highlighting and the autocomplete roster.
  - Root cause of an earlier long bug: Stream only pushes `watcher_count`, not watcher objects, by default. The roster is built from `queryUsers` (presence) plus channel watchers/members as fallback, plus the connected user.

**Message search** — 🔍 icon at top-right of each channel opens a search box. Uses `channel.search()` to find messages within that channel. Results show sender, text, date. Scoped to the active channel (not global) for simplicity and reliability.

**Date dividers** — Stream's date separators between messages from different days, styled to match.

**Jump to latest** — scroll-to-bottom button appears when scrolled up, styled in brand blue.

**Deep linking** — `getInitialChannelId()` reads a `?channel=` param or hash; defaults to `cats-general`.

**Announcements read-only** — for non-instructors the input is replaced with a notice directing them to General.

**Mobile responsiveness (v33/v34)** — at <=768px the sidebar becomes a slide-in overlay with a dark backdrop, toggled by a boxed hamburger button at top-left of the content area. Selecting a channel, tapping the backdrop, or tapping the X closes it. Desktop layout is unchanged. `isMobile` tracks `window.innerWidth <= 768` via a resize listener. Header and wiki get extra left/top padding on mobile so the hamburger does not overlap.
  - **v34 fix:** Stream's ChannelHeader renders its own hamburger (`str-chat__header-hamburger`). Our old CSS hid an outdated class name, so after an SDK update Stream's button reappeared next to ours (double hamburger). Fix: hide `.str-chat__header-hamburger` (kept the old rule too as a harmless fallback).

---

## Stream permissions (configured in Stream dashboard)

For the `user` role and `.app` scope, these are enabled: CreateMessage, CreateChannel,
ReadChannel, ReadChannelMembers, SendMessage, CreateReply, CreateReaction, UploadAttachment,
AddOwnChannelMembership, PinMessage (own), and on the `.app` scope: Query Users (SearchUser).
If reactions, uploads, or user search ever break, re-check these.

> Note: announcements read-only is currently enforced in the UI (the input is hidden for
> non-instructors). For true server-side lockdown you would also set channel-level
> permissions in Stream. The UI gating covers normal use.

---

## Known quirks

- **Stale localStorage / deleted users:** If a browser has an old `cats_profile` pointing to a Stream user that was deleted, you get "WS failed code 16 user was deleted". Fix in that browser only: `localStorage.removeItem('cats_profile')` in the console, then refresh. Nothing server-side.
- **Per-context localStorage:** Each access context (standalone URL vs iframe) has its own localStorage. This is why all access is routed through the one Squarespace URL, so there is a single profile-setup context.
- **`jonathan822`** is a protected/undeletable original Stream account; harmless.
- **Notifications + sound** only fire for messages from OTHER users, and the browser asks permission once. To test, use a second browser / incognito window as a second user.

---

## Shipped since the original build

- **v33** — mobile responsiveness (slide-in sidebar, hamburger, backdrop) and the empty-state fix (EmptyStateIndicator must be passed to `Channel`, not `MessageList`).
- **v34** — fixed the double hamburger (hide Stream's `str-chat__header-hamburger`).
- **v35** — email-required identity. ID derived from email, instructor gating by email allowlist. Closes the cross-device duplicate-account gap.
- **v36** — first attempt at taller inputs (minRows alone, which the SDK ignores without grow) plus the "Your account" wiki section.
- **v37** — taller inputs actually working: `grow={true}` is required or the SDK caps the textarea at maxRows=1 and ignores minRows. Main and thread now use grow + minRows=5 + maxRows=12. Also added an adaptive setup-form intro note (returning users see a "your data is safe, this just links your devices" reassurance; first-timers see a short intro).
- **v38** — richer General empty-state: welcomes new arrivals and guides them to the Getting Started wiki with a button (jumps to the wiki channel) before they post. EMPTY_PROMPTS now supports title/body/ctaLabel/ctaChannel/afterCta; ChannelEmptyState takes an `onJump` handler wired to handleChannelSelect.
- **v39** — one-time welcome card. Shows once per person on first entry after connecting (independent of empty states, so it survives even when channels are busy). Two buttons: "Open the Getting Started guide" (jumps to wiki) and "Got it, take me to the chat" (dismiss). Tracked by a `welcomed` flag on the stored profile; preserved across email migration so people who already saw it are not re-welcomed. NOTE: the flag is per-browser (like all profile data), so a person opening a brand-new device may see it once more there. The fall membership login could make this truly once-per-person.
- **v40** — visual restyle (part 1 of 2). New design system: CSS-variable palette (indigo primary scale, warm-tinted neutrals, layered surfaces canvas/sidebar/surface), Fraunces serif for the brand mark against DM Sans body, the app now a floating rounded panel with soft shadow on a tinted canvas, gradient logo mark, active-channel "raised card" treatment, muted/harmonious 12-color avatar palette (replaced the loud primaries), restyled composer (rounded, focus ring), reaction pills, header (blur), date separators, and a weighted hint line under the composer: "Type @ to mention someone in the group · @mark reaches Dr. Mayfield · @support reaches tech support". NOTE: message stream still uses left/right bubbles; converting to the flat grouped layout is part 2 (message grouping). Mobile carries the same tokens. Mockup reference: cats-chat-restyle-proposal.html.
- **v41** — fix: the hover toolbar and reaction picker were anchored to the far edge of the message row, which floated them far from the bubble on a full-width (non-embed) screen. Now anchored next to the bubble (56px in on the content side) for both own and others' messages.
- **v42** — restored a visible send button. Stream's native send button (`.str-chat__send-button`) was not showing in our custom composer layout (v2 theme positions it inside its own wrapper, which our restyle hid). Added our own gradient airplane button to the composer; it dispatches an Enter keydown on the textarea (the same path Enter-to-send already uses, the reliable trigger) and only fires on non-empty text. Native button hidden via CSS.
- **v43** — fixed mobile sidebar scrolling. The sidebar had a nested scroll region (the members list was `flex:1` + `overflowY:auto` inside the already-scrollable sidebar), so on mobile the inner list captured the gesture and the channel list above could not be reached. Made the whole sidebar one scroll container: members list and profile footer now flow normally (no competing scroll, no `marginTop:auto` pin), with `WebkitOverflowScrolling:touch` for momentum.
- **v44** — custom domain migration. Chat now served from `https://chat.mentalhealthmadesimple.life` (GoDaddy CNAME -> jcoutdoors.github.io, GitHub Pages custom domain, Enforce HTTPS on). Updated the notification icon URL off the old address. IMPORTANT LESSONS from the migration: (1) the app's `emailToUserId` uses `crypto.subtle`, which only exists in a secure (HTTPS) context, so the new domain could not log anyone in until Enforce HTTPS was on. (2) The token worker had a single hardcoded `Access-Control-Allow-Origin`; it now keeps an allow-list (subdomain, github.io, both squarespace hosts) and echoes the matching origin. (3) Setting a GitHub Pages custom domain immediately redirects the old address to the new one, so it must only be set AFTER DNS is verified and HTTPS is ready, or the live embed breaks. The notification worker did NOT need a CORS change (it receives Stream webhooks, not browser calls).
- **v45/v46** — persistent unread + mention badges (the real fix). v45 first made the client watch ALL channels on login (so live `message.new` fires everywhere, not just opened channels). v46 then switched from in-memory counting to Stream's server-side read state: on login, badges are seeded from `channel.countUnread()` and `channel.countUnreadMentions()`, so users see everything missed since their LAST session (and across devices), not just what arrives while connected. Opening a channel calls `channel.markRead()` so the cleared state persists server-side; a message arriving in the currently-viewed channel marks read instead of badging (uses an `activeIdRef` so the event handler sees the current channel). REQUIRES `read_events` enabled on the `messaging` channel type in the Stream dashboard, or counts return 0 and it silently falls back to live-only. Real-time browser popup/chime remain mention-only and live-only by nature (a closed browser can't be notified; that would need push infrastructure). Deployed as one build (v45 skipped as a standalone).
- **v47** — search icon restyle. The channel search was a bare faint emoji stranded in the far-right corner of the header, hard to locate. Now a bordered boxed button (white background, 1px border, 38x38, radius 10, soft shadow, indigo hover) matching the send button, moved inward (right:24) and vertically centered (top:13) in the 64px header.
- **v48** — copy update to match the notification worker's added `@dr. mark mayfield` route. Updated the Getting Started wiki "Reaching the instructor" section and the composer hint line under the message box to list `@dr. mark mayfield` alongside `@mark`. (Worker change is separate, deployed in Cloudflare; see notification-worker.js.)
- **v49** — clickable links in messages. Message text previously rendered URLs as plain dead text. Added a `linkifyText` helper that detects http(s) and bare `www.` URLs in the non-mention text segments and renders them as underlined indigo links opening in a new tab (trailing sentence punctuation is left outside the link; emails are not linked). Mention highlighting is unchanged and now composes with linkifying. Also fixed an early-return so links render even when there are no known member-name mention tokens. NOTE: this is clickable links only, NOT rich preview/unfurl cards. Stream's URL Enrichment is ON server-side, so preview data exists; rendering preview cards in the custom message component is a separate, larger piece best coordinated with the message-grouping restyle (part 2).

## Roadmap (not yet built)

1. **Direct messaging** — 1:1 channels (Stream supports natively). Real UI build: DM list, start-a-DM, unread handling. The biggest remaining feature; its own project.

Smaller polish, slot in anytime:
- **Message grouping** — collapse consecutive messages from one person to show name/avatar once. Low effort, visual.
- **Link previews** — unfurl pasted URLs into title/thumbnail. Medium effort. Nice for Readings.

Parked unless a need appears:
- **Profile photo uploads** — needs an image backend (e.g. Cloudflare R2).
- **Weekly digest email to Mark** — a scheduled (cron) job.

**Fall cohort plan:** move the course behind a free Squarespace membership login. That gives a real logged-in identity the chat can read, which permanently solves identity and retires the email-derived-ID approach (which is the interim solution while the course sits on an unlisted page). When that happens, identity should switch to the Squarespace member identity.

Dropped: calendar feature.

**Working principle agreed with Jonathan:** the Getting Started wiki is the single source of
truth for how the chat works. Any user-facing feature we ship gets documented in the wiki in
the same build. Behind-the-scenes mechanics (worker internals, instructor-gating logic) do
not go in the wiki.

---

## Jonathan's universal output rules (apply to all copy and writing)

- No em-dashes, ever. Use periods, commas, parentheses, or rephrase.
- No fabricated stories or anecdotes.
- No "most leaders" or other AI-sounding filler.
- Copy should sound like something Jonathan would actually say.
- Brand voice: Gary Vee directness + Mr. Rogers warmth + a comedian's timing.

---

## File inventory in this project package

- `PROJECT_KNOWLEDGE.md` — this document.
- `source/index.jsx` — the complete current app source (current version is in the version line at the top of this doc). The real working file.
- `source/webpack.config.js` — webpack build config.
- `source/package.json` — dependencies and versions.
- `cloudflare-workers/token-worker.js` — the JWT token worker (`mhms-chat-token`).
- `cloudflare-workers/notification-worker.js` — the email worker (`cats-notifications`), current deployed version.
- `SETUP.md` — how to rebuild the environment from scratch and the exact deploy steps.
