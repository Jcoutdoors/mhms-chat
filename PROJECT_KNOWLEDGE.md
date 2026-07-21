# CATS Community Chat - Project Knowledge

This is the operating manual and current state for the custom community chat built for
the MHMS / CATS cohort program. This lives in the repo and in the project knowledge so
any new conversation starts with full context. **Current version: v61 live in production.**

**IMPORTANT SOURCE/BUILD STATE (read before building):** The repo is fully at v61, source and
built files both. v61 absorbed the previously-uncommitted v60 work (clickable mailto links +
two wiki sections), so that gap is closed; nothing is pending re-application. Two standing
notes for the next session:
- The Atlas AI agent is BUILT but ON HOLD and intentionally NOT in the repo. Jonathan wants to
 flesh out Atlas's scope before committing or wiring anything. Do not start Atlas work unless
 he raises it. See the Atlas section for why holding is deliberate (scope growth may require
 real worker/architecture changes, so building more now would be premature).
- The repo's Worker files were found drifted from production TWICE (token worker CORS in this
 session's audit, notification worker features likewise). Both are reconciled as of v61, but
 the rule stands: when Jonathan pastes a Worker's actual deployed source, that is ground
 truth over the repo copy. Do not assume the committed Worker files match Cloudflare without
 verifying.
- v62 (Thread Reply Notifications) has passed Product Office release review, approved with
 notes, and lives on branch `v62-thread-reply-notifications`. It is NOT merged to main and
 NOT deployed; production is still v61. See the v62 section below for full detail.

---

## What this is

A custom multi-channel community chat for a paid cohort of roughly 18 students ("CATS Program"),
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
- Public API key: `9bdsdh9s956e` (safe to expose; this is the client key)
- Region: us-east
- Mode: Production (not dev)
- The Stream SECRET (used to sign tokens) lives only in the token worker's env. It is NOT in the app and NOT in this document.

**Token Worker (Cloudflare)**
- Name: `mhms-chat-token`
- URL: `https://mhms-chat-token.jonathan-5ad.workers.dev`
- Generates HS256 JWT user tokens. Takes `?user_id=`, returns `{ token }`.
- Env var: `STREAM_SECRET` (Secret).
- CORS: origin allow-list (`ALLOWED_ORIGINS`: the chat subdomain, jcoutdoors.github.io, both
 squarespace hosts) that echoes the matching origin. An unrecognized origin is not rejected;
 it silently falls back to the subdomain and still gets a token. That, plus the fact that any
 request supplying a user_id can mint a token for that user_id, is documented INTENTIONAL
 architectural debt: acceptable for a paywalled cohort with no sensitive data, do not reuse
 this pattern for anything requiring real auth, and do not "fix" it casually since the app
 depends on the current behavior.
- Source: `cloudflare-workers/token-worker.js` (reconciled to match production in v61; the
 repo copy previously had a stale wildcard-CORS version).

**Notification Worker (Cloudflare)**
- Name: `cats-notifications`
- URL: `https://cats-notifications.jonathan-5ad.workers.dev`
- Receives Stream `message.new` webhook events, sends email via Resend.
- Env var: `RESEND_API_KEY` (Secret).
- From address: `no-reply@notifications.nexgenrva.com` (verified subdomain in Resend).
- Routing: `@mark` / `@dr. mayfield` / `@dr. mark mayfield` → emails `dr.mark.mayfield@gmail.com`; `@support` / `@help` → emails `jonathan@nexgenrva.com`. (The `@dr. mark mayfield` variant was added in v48.) As of v61, mention patterns have a negative-lookbehind guard so email addresses in message text (like `jon@support.org` or Mark's own Gmail address) do NOT false-trigger, and a trailing word boundary so `@marketing` does not partially match `@mark`.
- The email template includes a `CHANNEL_NAMES` friendly-name map (keep in sync with
 `APP_CONFIG.channelGroups` in the app) and a "Respond in the Chat" button linking to
 `CHAT_URL`. Both are production features that predate v61 but were missing from the repo
 copy until the v61 reconciliation.
- As of v61, `senderName`, `channelName`, and message `text` are HTML-escaped via
 `escapeHtml()` before insertion into the email template (previously unescaped, an
 injection path into the recipient inboxes).
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

1. Edit `src/index.jsx` (the editable source in the repo).
2. From the project root with dependencies installed: `npx webpack` (builds into `dist/`). Build takes ~40s.
3. Recreate `dist/index.html` (the wrapper that loads `./chat.bundle.js`). The wrapper is simple and static; its contents are in this doc below.
4. Webpack emits 5 files that ALL must be uploaded to GitHub together: `index.html`, `chat.bundle.js`, and three numbered chunk files like `387.chunk.js`, `760.chunk.js`, `893.chunk.js`. The chunk numbers/names can change between builds. (Webpack also emits `.LICENSE.txt` files; those are not part of the 5 deploy files and can be ignored.)
5. In the `mhms-chat` GitHub repo: delete the old files first, then upload all 5 new files.
6. Wait ~2 minutes for GitHub Pages to deploy, then hard refresh.

**Build dependencies:** see `package.json` (repo root). Key versions: react 18, stream-chat 8, stream-chat-react 11, webpack 5, babel with preset-env + preset-react.

**Webpack config:** see `webpack.config.js` (repo root).

**The dist/index.html wrapper** (current version, includes the favicon/icon links added in v53):
```html
<!DOCTYPE html>
<html lang="en">
<head>
 <meta charset="UTF-8">
 <meta name="viewport" content="width=device-width, initial-scale=1.0">
 <title>CATS Program Community</title>
 <link rel="icon" type="image/x-icon" href="./favicon.ico">
 <link rel="apple-touch-icon" href="./apple-touch-icon.png">
 <style>* { margin: 0; padding: 0; box-sizing: border-box; } html, body { height: 100%; width: 100%; overflow: hidden; } #root { height: 100vh; width: 100%; }</style>
</head>
<body>
 <div id="root"></div>
 <script src="./chat.bundle.js"></script>
</body>
</html>
```

Note on repo files: the four icon files (`favicon.ico`, `apple-touch-icon.png`, `icon-192.png`,
`icon-512.png`) are permanent at the repo root. Upload them once; they do not change between
normal builds. A normal deploy is still the 5 code files (`index.html`, `chat.bundle.js`,
three `*.chunk.js`).

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
- After any significant edit, verify: `wc -l src/index.jsx` (1,586 lines as of v61; was
 1,552 at v59; NOT hundreds of thousands) and `du -h dist/chat.bundle.js` (~1.8MB).
 A stale "~1,100 lines" figure lived in SETUP.md through v60 and misled a session; the
 numbers here are the verified ones.
- A quick brace-balance script that ignores strings/comments is useful. Note: the `ProfileCard` function body `{` and its `return (` always show as 2 false-positive "unclosed" entries because the checker is JSX-blind. A THIRD entry indicates a real bug.

---

## Channels (sidebar structure)

Defined in `APP_CONFIG.channelGroups` in `index.jsx` (was a standalone `CHANNEL_GROUPS`
const before v61; folded into APP_CONFIG, same data).

**Start Here**
- `cats-getting-started`: "📖 Getting Started" - a STATIC wiki page, not a Stream channel. Rendered by the `GettingStartedWiki` component. Listed in `STATIC_CHANNELS`.
- `cats-announcements`: "📣 Announcements" - read-only for non-instructors.

**Course Modules**
- `cats-mod-01` … `cats-mod-10`, named e.g. "Mod 1 · Development & Neuroscience", "Mod 2 · Attachment Theory", "Mod 3 · Trauma, ACEs & PTSD", "Mod 4 · Therapeutic Presence", "Mod 5 · CBT, DBT & ACT", "Mod 6 · TF-CBT, EMDR & MI", "Mod 7 · Crisis Intervention", "Mod 8 · Family Systems", "Mod 9 · Identity, Culture & Tech", "Mod 10 · Supervised Practice".

**Community**
- `cats-general`: "General" - default landing channel.
- `cats-weekly-wins`: "Weekly Wins"
- `cats-readings`: "Readings & Resources"

Key constants in code:
- `APP_CONFIG` (new in v61): a single object near the top of `index.jsx` collecting the
 clearly CATS-specific settings: `orgName`/`orgSubtitle` (sidebar branding), `apiKey` and
 `tokenUrl` (Stream client key and token worker URL), `instructorEmails`, `consult`
 (`.link`/`.time`/`.dates` for the Zoom consultation card and bar), and `channelGroups`.
 The old standalone consts (`TOKEN_URL`, `API_KEY`, `INSTRUCTOR_EMAILS`, `CONSULT_LINK`,
 `CONSULT_TIME`, `CONSULT_DATES`, `CHANNEL_GROUPS`) no longer exist; everything reads from
 `APP_CONFIG`. This is a configuration boundary only, not a module split; the app is still
 one file by design.
- `ALL_CHANNELS` = all channels EXCEPT those in `STATIC_CHANNELS` (the wiki is not a Stream channel). Derived from `APP_CONFIG.channelGroups`.
- `STATIC_CHANNELS = ['cats-getting-started']`
- `ANNOUNCEMENTS_ID = 'cats-announcements'`, `GETTING_STARTED_ID = 'cats-getting-started'`
- Instructor gating: `canPostAnnouncements(user)` reads the `instructor` flag set from `APP_CONFIG.instructorEmails` at setup (see Profiles & identity above). This same flag gates who can use `@everyone`. (Earlier versions gated by ID prefix; that was replaced in v35 when IDs became email hashes.)

---

## Features built and live

**Profiles & identity** - first/last name, REQUIRED email, optional bio, optional website/LinkedIn, 12-color avatar picker. Setup modal on first visit, editable from the sidebar footer. Stored in `localStorage` under `cats_profile` and upserted to Stream.
 - **Identity is derived from the email.** `emailToUserId(email)` SHA-256 hashes the normalized (trimmed, lowercased) email and takes the first 24 hex chars, prefixed `cats-`. The same email always produces the same Stream user ID, so a person reconnects as the same account on any device. This is what closes the cross-device duplicate-account gap.
 - The email field shows a short line explaining it keeps the account synced across devices. Email is validated (required, basic format check).
 - **Existing pre-email profiles:** on load, if a stored profile has no email, the user is routed into the setup form (name and color pre-filled) to add one once. Adding the email rederives their ID from the email and connects on the stable ID. There was essentially no message history at rollout (one test thread), so old-message authorship was not a concern.
 - **Instructor status is gated by email, not by ID.** `APP_CONFIG.instructorEmails = ['jonathan@nexgenrva.com','dr.mark.mayfield@gmail.com']`. At setup, `isInstructorEmail()` sets an `instructor` boolean on the profile, which is stored, passed to Stream on `connectUser` (so it travels on the user object and on every message's `msg.user`), and read by `canPostAnnouncements(user)`. This replaced the old ID-prefix gating, which broke once IDs became email-hash strings.
 - `canPostAnnouncements(user)` now takes a USER OBJECT (reads `user.instructor`), not an ID string. Call sites: the announcements input gate, the `@everyone` autocomplete option, and the inbound `@everyone` sender check (`canPostAnnouncements(msg.user)`).

**Messaging UI** - white premium UI, DM Sans font, colored initial-avatars. Custom message component: full name above bubble, own messages right/blue, others left/gray. Click name/avatar to open a profile card.

**Avatar images (v61)** - `Avatar` accepts an `image` prop. When present it renders a
circular `<img>` with `object-fit: cover`; when absent, empty, or when the image fails to
load, it falls back to colored initials (an `imgFailed` state, reset whenever `image`
changes), so a broken URL never shows a broken-image icon. `image` is threaded through
every Avatar call site: ProfileForm preview, ProfileCard, CustomMessage, MembersList,
MentionAutocomplete, Sidebar footer, and the ChannelSearchPanel result rows (a 7th call
site found in the v61 audit beyond the originally-listed 6). `profile.image` is also
included in the `connectUser`/`upsertUser` payloads so a future-populated image reaches
Stream and flows to every render site. There is NO upload UI or image storage yet; this is
the rendering plumbing only, which unblocks both a future Atlas avatar and student photos.

**Threads** - hover a message → Reply → opens a thread panel. Shows "N replies" under the original.

**Pins** - hover → 📌 to pin/unpin. Pinned messages show a yellow "Pinned" tag.

**Reactions** - hover → 😊 picker (👍 ❤️ 😄 😮 😢). Reaction pills with counts under the message; click a pill to toggle your own.

**Edit / delete own messages** - hover your own message → ✏️ (inline edit, Enter to save / Esc to cancel, shows "edited") or 🗑 (confirm, then "This message was deleted").

**Emoji picker** - smiley button left of the message box. Loaded from CDN at runtime (`cdn.jsdelivr.net/npm/emoji-mart@5`) to avoid webpack bundling issues that caused React errors.

**Mentions with autocomplete** - type `@` → dropdown of cohort members. `@everyone` option only shows for instructors (`canPostAnnouncements`). Mentions render highlighted blue in messages via `renderTextWithMentions()` using `memberNameRegistry`.

**Mention alerts** - when mentioned (or `@everyone` from an instructor), the user gets: a red `@` badge on the channel, a browser notification (one-time permission request), and a soft chime (Web Audio). Fired from the client `message.new` / `notification.message_new` listeners. Skips your own messages.

**Email routing (via notification worker)** - `@mark` / `@dr. mayfield` / `@dr. mark mayfield` → Mark's email; `@support` / `@help` → Jonathan's email. Independent of the in-chat alerts. As of v61, patterns are guarded against firing from email addresses inside message text.

**Clickable links and email addresses in messages** - `linkifyText` detects http(s) URLs, bare `www.` URLs, and bare email addresses in the non-mention text segments and renders them as underlined indigo links. URLs open in a new tab; email addresses become `mailto:` links. Detection runs in a single regex pass so URL and email matches never overlap. Trailing sentence punctuation stays outside URL links. Mention highlighting composes with linkifying, and a known pre-existing interaction is unchanged: an email whose local part matches a member's first name (e.g. `sarah@gmail.com`) is caught by the mention pass first.

**Getting Started wiki** - static formatted read-only page. Sections: Channels, Announcements, Posting & replying, Mentions, Reaching the instructor (@mark), Turning in assignments (email work straight to dr.mark.mayfield@gmail.com, live mailto link, no portal), Tech help & support (@support/@help), Notifications, Searching messages, Links and email addresses (pasted links and addresses go clickable automatically), Your account (same email = same account on any device), Sharing files, Need help. Plus the consult card at the top (see v53/v54).

**Setup form intro note (v37)** - the profile setup form shows an adaptive note at the top during signup. Returning users (stored profile with a name but no email) see a "welcome back, your data is safe, this just links your devices" reassurance. First-timers see a short "here's how this works" intro. Controlled by `showIntro` (signup only) and `isReturning` props on `ProfileForm`.

**Unread / mention badges** - blue number = unread count, red `@` = mention. Clears on opening the channel.

**Members list** - full roster via `chatClient.queryUsers` with presence. Green dot = online, gray = offline. Refreshes every ~6s and on presence events. Also feeds `memberNameRegistry` for mention highlighting and the autocomplete roster.
 - Root cause of an earlier long bug: Stream only pushes `watcher_count`, not watcher objects, by default. The roster is built from `queryUsers` (presence) plus channel watchers/members as fallback, plus the connected user.

**Message search** - 🔍 icon at top-right of each channel opens a search box. Uses `channel.search()` to find messages within that channel. Results show sender, text, date. Scoped to the active channel (not global) for simplicity and reliability.

**Date dividers** - Stream's date separators between messages from different days, styled to match.

**Jump to latest** - scroll-to-bottom button appears when scrolled up, styled in brand blue.

**Deep linking** - `getInitialChannelId()` reads a `?channel=` param or hash; defaults to `cats-general`.

**Announcements read-only** - for non-instructors the input is replaced with a notice directing them to General.

**Mobile responsiveness (v33/v34)** - at <=768px the sidebar becomes a slide-in overlay with a dark backdrop, toggled by a boxed hamburger button at top-left of the content area. Selecting a channel, tapping the backdrop, or tapping the X closes it. Desktop layout is unchanged. `isMobile` tracks `window.innerWidth <= 768` via a resize listener. Header and wiki get extra left/top padding on mobile so the hamburger does not overlap.
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

- **v33** - mobile responsiveness (slide-in sidebar, hamburger, backdrop) and the empty-state fix (EmptyStateIndicator must be passed to `Channel`, not `MessageList`).
- **v34** - fixed the double hamburger (hide Stream's `str-chat__header-hamburger`).
- **v35** - email-required identity. ID derived from email, instructor gating by email allowlist. Closes the cross-device duplicate-account gap.
- **v36** - first attempt at taller inputs (minRows alone, which the SDK ignores without grow) plus the "Your account" wiki section.
- **v37** - taller inputs actually working: `grow={true}` is required or the SDK caps the textarea at maxRows=1 and ignores minRows. Main and thread now use grow + minRows=5 + maxRows=12. Also added an adaptive setup-form intro note (returning users see a "your data is safe, this just links your devices" reassurance; first-timers see a short intro).
- **v38** - richer General empty-state: welcomes new arrivals and guides them to the Getting Started wiki with a button (jumps to the wiki channel) before they post. EMPTY_PROMPTS now supports title/body/ctaLabel/ctaChannel/afterCta; ChannelEmptyState takes an `onJump` handler wired to handleChannelSelect.
- **v39** - one-time welcome card. Shows once per person on first entry after connecting (independent of empty states, so it survives even when channels are busy). Two buttons: "Open the Getting Started guide" (jumps to wiki) and "Got it, take me to the chat" (dismiss). Tracked by a `welcomed` flag on the stored profile; preserved across email migration so people who already saw it are not re-welcomed. NOTE: the flag is per-browser (like all profile data), so a person opening a brand-new device may see it once more there. The fall membership login could make this truly once-per-person.
- **v40** - visual restyle (part 1 of 2). New design system: CSS-variable palette (indigo primary scale, warm-tinted neutrals, layered surfaces canvas/sidebar/surface), Fraunces serif for the brand mark against DM Sans body, the app now a floating rounded panel with soft shadow on a tinted canvas, gradient logo mark, active-channel "raised card" treatment, muted/harmonious 12-color avatar palette (replaced the loud primaries), restyled composer (rounded, focus ring), reaction pills, header (blur), date separators, and a weighted hint line under the composer: "Type @ to mention someone in the group · @mark reaches Dr. Mayfield · @support reaches tech support". NOTE: message stream still uses left/right bubbles; converting to the flat grouped layout is part 2 (message grouping). Mobile carries the same tokens. Mockup reference: cats-chat-restyle-proposal.html.
- **v41** - fix: the hover toolbar and reaction picker were anchored to the far edge of the message row, which floated them far from the bubble on a full-width (non-embed) screen. Now anchored next to the bubble (56px in on the content side) for both own and others' messages.
- **v42** - restored a visible send button. Stream's native send button (`.str-chat__send-button`) was not showing in our custom composer layout (v2 theme positions it inside its own wrapper, which our restyle hid). Added our own gradient airplane button to the composer; it dispatches an Enter keydown on the textarea (the same path Enter-to-send already uses, the reliable trigger) and only fires on non-empty text. Native button hidden via CSS.
- **v43** - fixed mobile sidebar scrolling. The sidebar had a nested scroll region (the members list was `flex:1` + `overflowY:auto` inside the already-scrollable sidebar), so on mobile the inner list captured the gesture and the channel list above could not be reached. Made the whole sidebar one scroll container: members list and profile footer now flow normally (no competing scroll, no `marginTop:auto` pin), with `WebkitOverflowScrolling:touch` for momentum.
- **v44** - custom domain migration. Chat now served from `https://chat.mentalhealthmadesimple.life` (GoDaddy CNAME -> jcoutdoors.github.io, GitHub Pages custom domain, Enforce HTTPS on). Updated the notification icon URL off the old address. IMPORTANT LESSONS from the migration: (1) the app's `emailToUserId` uses `crypto.subtle`, which only exists in a secure (HTTPS) context, so the new domain could not log anyone in until Enforce HTTPS was on. (2) The token worker had a single hardcoded `Access-Control-Allow-Origin`; it now keeps an allow-list (subdomain, github.io, both squarespace hosts) and echoes the matching origin. (3) Setting a GitHub Pages custom domain immediately redirects the old address to the new one, so it must only be set AFTER DNS is verified and HTTPS is ready, or the live embed breaks. The notification worker did NOT need a CORS change (it receives Stream webhooks, not browser calls).
- **v45/v46** - persistent unread + mention badges (the real fix). v45 first made the client watch ALL channels on login (so live `message.new` fires everywhere, not just opened channels). v46 then switched from in-memory counting to Stream's server-side read state: on login, badges are seeded from `channel.countUnread()` and `channel.countUnreadMentions()`, so users see everything missed since their LAST session (and across devices), not just what arrives while connected. Opening a channel calls `channel.markRead()` so the cleared state persists server-side; a message arriving in the currently-viewed channel marks read instead of badging (uses an `activeIdRef` so the event handler sees the current channel). REQUIRES `read_events` enabled on the `messaging` channel type in the Stream dashboard, or counts return 0 and it silently falls back to live-only. Real-time browser popup/chime remain mention-only and live-only by nature (a closed browser can't be notified; that would need push infrastructure). Deployed as one build (v45 skipped as a standalone).
- **v47** - search icon restyle. The channel search was a bare faint emoji stranded in the far-right corner of the header, hard to locate. Now a bordered boxed button (white background, 1px border, 38x38, radius 10, soft shadow, indigo hover) matching the send button, moved inward (right:24) and vertically centered (top:13) in the 64px header.
- **v48** - copy update to match the notification worker's added `@dr. mark mayfield` route. Updated the Getting Started wiki "Reaching the instructor" section and the composer hint line under the message box to list `@dr. mark mayfield` alongside `@mark`. (Worker change is separate, deployed in Cloudflare; see notification-worker.js.)
- **v49** - clickable links in messages. Message text previously rendered URLs as plain dead text. Added a `linkifyText` helper that detects http(s) and bare `www.` URLs in the non-mention text segments and renders them as underlined indigo links opening in a new tab (trailing sentence punctuation is left outside the link; emails are not linked). Mention highlighting is unchanged and now composes with linkifying. Also fixed an early-return so links render even when there are no known member-name mention tokens. NOTE: this is clickable links only, NOT rich preview/unfurl cards. Stream's URL Enrichment is ON server-side, so preview data exists; rendering preview cards in the custom message component is a separate, larger piece best coordinated with the message-grouping restyle (part 2).
- **v50–v52** - mobile UX overhaul (confirmed on-device across three iterations). v50: thread/replies now open as a full-screen overlay on mobile instead of the side-by-side split that made mobile nearly unusable (CSS `.str-chat__thread{position:fixed;inset:0}` under the `max-width:768px` media query; safe because Stream's Thread renders `null` when closed, so no invisible overlay). Composer made compact on mobile (`minRows` 1 instead of 5, both main and Thread inputs) so the send button stays reachable. Tap-to-reveal message toolbar on touch via `isTouchDevice()` (hover doesn't exist on touch; tapping a bubble toggles the action row). v51: custom `CatsThreadHeader` with a pronounced indigo "Back" button (Stream's default close was too faint to find on mobile AND desktop); passed via `<Thread ThreadHeader={...}>`, which receives `closeThread` as a prop. v52: fixed composer clipping below the screen, root cause was `100vh` including the area behind the mobile browser toolbar; switched mobile to `100dvh` (dynamic viewport height) and made the app edge-to-edge on mobile (no padding/rounded floating panel) so the composer anchors correctly. Added `minHeight:0` to the flex chat column. KEY LESSON: `100vh` is wrong on mobile browsers; use `100dvh` for full-height mobile layouts.

- **v53/v54** - consult card and consult bar. A card at the top of the Getting Started wiki (indigo gradient, the six summer dates, timezone helper) plus a slim persistent bar across the top of every channel. Favicon wired in. v54 reworded the bar to read as recurring information rather than "join now". The Zoom link is fixed and recurring, so it is safe to hardcode.
- **v55** - real Stream mentions. `submitWithMentions` (an `overrideSubmitHandler`) attaches `mentioned_users` on send, mapping @name from the roster, and @everyone to all channel members for instructors. Before this, mentions were only highlighted text, so Stream never recorded them and `countUnreadMentions()` always returned 0.
- **v56, v56b, v56c** - DIAGNOSTIC builds only, never meant to ship. Console logging, then watch-timing logging, then a prototype-level wrapper around `markRead` that logged a stack trace on every call. These existed to answer one question: what was wiping unread mentions. See the hard lesson below.
- **v57** - THE FIX (Option A). Replaced watch-all-channels with `client.queryChannels(..., { watch: false, state: true, presence: false })`, which loads every channel's state and read data without making the user a present watcher. Only the active channel is watched. Membership is ensured via `addMembers` so `notification.message_new` still fires for channels the user is not watching.
- **v58** - fixed the side effect of v57. `ensureChannel` returned early when a channel was already in the map, so opening a channel never watched it, and your own messages did not appear until you refreshed. Now `ensureChannel` always watches the channel being opened, and `handleChannelSelect` calls `stopWatching()` on the previous one. Exactly one channel is watched at any moment.
- **v59** - clean production build, diagnostics stripped. The missing notification chime turned out to be the browser autoplay policy (audio needs a user gesture first), not a code bug. It resolved itself.
- **v60** - built in a prior session but never committed or deployed; fully absorbed into v61. The design: email addresses in messages become clickable `mailto:` links, plus two wiki sections ("Turning in assignments" and "Links and email addresses"). See v61 for what actually shipped.
- **v61** - Baseline Integrity + Avatar Foundation. Four parts.
 (1) Worker reconciliation: the repo's committed Worker files had drifted from what's live
 in Cloudflare, so both were replaced with the confirmed deployed source (Jonathan pasted
 the real files from Cloudflare this session). Token worker: no logic change; confirmed the
 v44 origin allow-list is real, added an explicit architectural-debt comment (unrestricted
 user_id token minting; unrecognized origins silently fall back rather than reject; both
 intentional). Notification worker: confirmed the `CHANNEL_NAMES` friendly-name map, the
 "Respond in the Chat" reply button, and the working multi-word Mark regex are real
 production features (none were in the repo copy or this doc); preserved all three. Fixed
 two real bugs: mention patterns matched inside email addresses (jon@support.org fired the
 support route; Mark's own Gmail address, now published in the wiki, would have fired his),
 solved with a negative-lookbehind guard plus a trailing word boundary; and senderName,
 channelName, and message text went into the email HTML unescaped, solved with escapeHtml()
 on all three. Regex verified against a 14-case test matrix. Deployed to Cloudflare
 alongside the app deploy (the app's new wiki section actively encourages typing Mark's
 email address into chat, which is exactly what the old regex false-triggered on).
 (2) Re-applied the v60 work on the v59 base: `linkifyText` now detects bare email
 addresses and renders them as mailto: links, in the same regex pass as URL detection so
 matches never overlap; added the "Turning in assignments" wiki section (Mark's address as
 a live mailto link) and the "Links and email addresses" wiki section.
 (3) Avatar image rendering: `Avatar` accepts an `image` prop, renders a circular
 object-fit-cover image with initials fallback on absence OR load failure (no broken-image
 icon ever), threaded through all seven call sites (the six planned plus ChannelSearchPanel
 results, found in the audit), and `profile.image` added to connectUser/upsertUser so a
 future image value reaches Stream. No upload UI, no storage backend, no Atlas wiring.
 (4) APP_CONFIG: one object collecting org labels, API key, token URL, instructor emails,
 consult details, and channel groups; all old standalone consts removed and call sites
 repointed; verified zero stray references by grep. No module split, no broader refactor.
 Build verified: index.jsx 1,586 lines (v59 baseline was 1,552; delta consistent with the
 changes, checked clean for corruption), bundle 1.8MB, queryUsers x4 in the bundle. Also
 corrected the stale "~1,100 lines" figure that had been sitting in SETUP.md.

## v62 - Thread Reply Notifications (reviewed, NOT YET DEPLOYED)

**Status:** passed Product Office release review. Release recommendation: approved with
notes. Lives on branch `v62-thread-reply-notifications`, not merged to main, not deployed.
Production is still v61. `src/index.jsx` is 2,267 lines, `dist/chat.bundle.js` is
approximately 1.8MB.

**What it does:** notifies a user when someone replies to a thread they started, even when
they are not currently watching that thread's channel, without watching any additional
channel and without breaking the one-watched-channel architecture (see the hard lesson
below).

**Verified with a live cross-channel test against the real production Stream app**
(isolated throwaway users and channels, cleaned up after): `notification.thread_message_new`
fired for User A while User A was watching only Channel A. Channel B, where the reply was
actually posted, remained unwatched throughout, confirmed both before and after the test.

**Notification behavior, all directly verified in a two-user browser walkthrough:**
- One notification represents one unread thread. Multiple unread replies to the same thread
 update the same entry instead of creating duplicates; the most recent reply's preview and
 replier name replace the previous one.
- Persists across reload/reconnect through `client.queryThreads({ watch: false, ... })`
 reconciliation, so a missed reply still surfaces the notification after a reload even
 without the live event having been received in that session.
- Clicking the bell notification switches to the correct channel, opens the correct parent
 thread, and clears the notification.
- Opening the same thread through Stream's native reply-count link, not just the bell, also
 clears the notification. This is handled by one centralized watcher on the thread state
 Stream already exposes, not by attaching a click handler to every message.
- A reply to a thread the current user does not own does not notify them (verified with a
 separate throwaway thread owner and a separate throwaway replier, neither being the
 observing user).
- A user's own reply to their own thread does not notify them.
- The one-watched-channel architecture is unchanged. No additional channel is ever watched.

**Bug found and fixed in the same pass (pre-existing, not introduced by v62):**
`CatsThreadHeader` (added in v51 for a clearer close control, since Stream's default close
was reported as too faint to find on mobile and desktop) has never actually rendered.
`stream-chat-react` does not accept a `ThreadHeader` prop on `<Thread>`; it must be passed to
`<Channel>`, which feeds it through to `ComponentContext`. The prop had been placed on
`<Thread>` since v51, where React silently ignores unrecognized props, so every thread panel
has shown Stream's plain default close icon instead of the intended indigo "Back" button, on
every version since v51. Corrected by moving `ThreadHeader` to `<Channel>`, with no change to
`CatsThreadHeader` itself. Verified rendering correctly on both desktop and mobile after the
fix.

**No Cloudflare Worker changes were required or made.**

**QA process note:** there is no sandbox or dev Stream app, so local browser QA runs against
the real production Stream app and real token worker. A temporary local CORS proxy (gitignored,
deleted after use, no secret involved) was used only to work around the token worker's origin
allow-list rejecting `localhost`. The production `tokenUrl` was restored before the final build,
and the diff was confirmed clean of any proxy or localhost reference.

## HARD LESSON: never watch all channels (read before touching notifications)

Watching a Stream channel makes you a present watcher. When a message arrives in a channel
you are watching, Stream's server advances your read pointer automatically. It does this
server-side, on receipt. No `markRead()` call appears anywhere, which is why this took five
diagnostic rounds to find.

The consequence: v45's "watch every channel so live badges work" silently destroyed v46's
"persist unread mentions across sessions". The two fixes were fighting each other. Unread
mentions could never survive a reload, because the mention was marked read the instant it
arrived.

The proof was a stack-trace wrapper on `markRead` showing exactly one call, on the landing
channel, while eleven other channels had a fresh `last_read` timestamp anyway.

The rule now:
- Load channels with `queryChannels({ watch: false, state: true })`. This gives read state
 and membership without presence.
- Watch ONLY the channel the user is currently viewing. Unwatch the previous one.
- Live badges and chimes for other channels come from `notification.message_new`, which
 fires for channels you are a member of but not watching.
- Cohort presence (the green dots) comes from the `queryUsers` presence poll and does NOT
 depend on watching channels. Per-channel watcher presence is not used anywhere.

Do not reintroduce watch-all. It looks like a convenience and it is a regression.

## HARD LESSON: repo Worker files can drift from production (found in v61)

Twice in the v61 audit, the committed `cloudflare-workers/` files turned out to be older
than what was actually running: the token worker's repo copy still had the pre-v44 wildcard
CORS, and the notification worker's repo copy was missing the channel-name map, the reply
button, and the multi-word Mark regex fix. Worker changes get deployed by pasting into the
Cloudflare dashboard, so nothing forces the repo copy to be updated at the same time. The
rules now:
- When a Worker changes in Cloudflare, update the repo copy in the same sitting.
- When a session needs to modify a Worker, verify against the actual deployed source first
 (ask Jonathan to paste it from Cloudflare). His pasted source is ground truth; the repo
 copy is a claim.

## AI support agent: Atlas (built, ON HOLD, not in repo)

A third Cloudflare Worker that answers "how does this work" questions in the chat. It is
built and syntax-checked but has never run, and it is intentionally NOT committed to the repo.

**STATUS (Jonathan's decision):** Atlas is parked pending a scope conversation. Before wiring
anything up, Jonathan wants to decide how big Atlas becomes, because scope growth changes the
architecture, not just the code. The fork that matters: "Atlas answers and forgets" (the
current build: worker + Anthropic API, no memory) versus "Atlas remembers conversations,
logs what the cohort asks, and reports patterns to Mark" (needs a database, e.g. Cloudflare
D1/KV, and becomes a materially bigger system). Deciding that first avoids building more now
and retrofitting later. Do NOT resume Atlas work unless Jonathan raises it.

**What it is for.** Students ask the same logistics questions repeatedly, and they wait on
Jonathan or Mark to answer. Both of Jessy's real questions (where do reflection journals go,
where did the reading excerpts go) are answerable from the knowledge base. The agent answers
them instantly, and Jonathan still gets the @support email, so a human stays in the loop.

**Files (built in an earlier session, held OUTSIDE the repo in session outputs, not committed):**
- `ai-agent-worker.js` - the agent. Worker name must be `cats-ai-agent` when deployed.
- An Atlas-enabled `notification-worker.js` - a copy that adds the fan-out and the bot guard.
 IMPORTANT: that held copy predates the v61 notification worker (it lacks the v61
 email-address guard and HTML escaping). When Atlas resumes, the fan-out and bot guard must
 be re-applied ON TOP OF the v61 worker, not by pasting the old held copy over it.
These exist only in prior session outputs. If scope changes, they get rebuilt to match.

**Architecture.** Stream sends `message.new` to ONE webhook URL, which is the existing
`cats-notifications` worker. That worker now does its email routing as before, and also
forwards a copy of the payload to the AI worker via `ctx.waitUntil` (fire and forget, so a
slow or broken agent never affects email).

**Secrets** (Cloudflare env, never in files): `ANTHROPIC_API_KEY`, `STREAM_SECRET`.

**Model:** `claude-sonnet-5`. Verified against current Anthropic docs, not from memory. The
model lineup moved after the training cutoff. Sampling params (temperature, top_p) are
unsupported on current-generation models and are omitted deliberately.

**Four guards** (all tested):
1. Ignore messages from `cats-assistant`. Without this the bot answers itself forever.
2. Never post in Announcements.
3. Only respond to the trigger `(^|\s)@(assistant|ai|support|help)\b`. The leading
 whitespace requirement matters: without it, an email address like `jon@support.org`
 inside a message triggers the bot. (The v61 notification worker now uses the same class
 of guard for its own email routing.)
4. Never answer a message directed at @mark.

The notification worker has the matching guard: it ignores `cats-assistant` messages, so
when Atlas says "tag @mark", Mark does not get emailed.

**Safety design.** This is a clinical training program. Module 07 is suicide risk and
self-injury. The prompt has four branches:
- Answer logistics from the knowledge base.
- Route clinical and course-content questions to Mark, with substance. A good handoff names
 what they are asking, points to the exact module and reading (a real 48-reading module map (the worker comment said 47; actual extracted count is 48)
 extracted from the Student Guide), notes that Consultation Groups meet in Week 2, and gives
 one next step. It never teaches the material. The stated reason is that Dr. Mayfield teaches
 a specific framework (Relational-Attachment-Trauma) and a generic textbook answer could
 contradict what students are certified on.
- ACUTE CRISIS: if a client is in immediate danger right now, no module, no curriculum, no
 clinical steps. Point to a person now, their emergency protocols, their licensure
 obligations.
- PERSONAL DISTRESS: if the student themselves is struggling, respond warmly and briefly,
 no clinical advice, point to a human.

**Self-test.** `GET /selftest?channel=cats-mod-10` runs the whole chain (upsert the bot user,
add it to the channel, call Claude, try both Stream auth methods) and returns JSON with a
verdict: `claudeWorks`, `canPostToStream`, `workingAuthMethod`. Use it before turning the
agent on. Module 10 is empty, so it is the safe channel to test in.

**Kill switch.** Blank `AI_AGENT_URL` in the notification worker and redeploy. Atlas goes
silent in seconds. Email routing is unaffected.

**Test bench.** `cats-assistant-test-bench.jsx` is a React artifact that runs the exact
resolved system prompt against 11 cases (3 answer, 6 route, 2 crisis) with no key and no
production contact. The prompt is extracted programmatically from the worker so the bench and
the worker can never drift.

**KNOWLEDGE BASE CORRECTION (important).** The CATS Student Guide says assignments are
submitted via "Course Platform, then Submit". That is wrong in practice. Mark wants everything
emailed to dr.mark.mayfield@gmail.com. There is no upload portal. The Guide is a document, not
ground truth. Where the Guide and Mark's actual practice disagree, Mark wins. Check other
Guide-derived facts before trusting them. (As of v61 the correct workflow is documented for
students in the wiki's "Turning in assignments" section.)

**Setup order** (nothing reaches students until step 5):
0. Run the test bench, judge the refusals.
1. Get an Anthropic API key.
2. Create the `cats-ai-agent` worker, paste the file, Deploy.
3. Add both secrets, Deploy again.
4. Hit `/selftest?channel=cats-mod-10`. Both verdict flags must be true.
5. Update `cats-notifications` with the new worker file (rebuilt on the v61 base, see the
 Files note above). This turns the agent on.
6. Live-test in Module 10 with the test account.

**Renaming.** `const ASSISTANT_NAME = 'Atlas';` is a one-line change. The name was chosen
because an atlas shows you where things are without telling you what to think, which is
exactly the boundary this agent must hold.

## Roadmap (not yet built)

**In flight right now (next session picks this up):**

1. **Atlas: scope conversation FIRST, then build.** Before any further Atlas code, decide how
 big Atlas becomes (answer-and-forget vs. stateful-with-memory-and-logging). That decision
 determines whether the existing worker just needs prompt edits or a whole new architecture
 (a database). Only after that do we rebuild/commit the Atlas workers and run the setup order
 in the AI agent section. Note: the Avatar image-rendering prerequisite for the Atlas avatar
 is DONE as of v61; when Atlas is un-parked, wiring in Jonathan's single Atlas avatar image
 is now just a matter of hosting the image and setting the bot user's `image` field. The
 standing decision holds: ONE image, no per-pose art, no per-message custom field, no
 model-chosen pose, no crisis-override pose logic.

2. **Welcome-back "here's what you missed" summary.** Deliberately queued behind the Option A
 fix, because it needs accurate persisted unread state, which now exists. Show it only when
 there is something missed, and once per session rather than on every refresh.

3. **Thread reply notifications.** Both Mark and Jessy asked for this independently: someone
 replies to a thread you started and you never find out. Scope agreed: notify on replies to
 threads you started (not full thread-participation tracking), delivered as an in-app badge
 plus the existing chime treatment, no email for now. BUILT as v62, reviewed and approved
 with notes, not yet merged or deployed. See the v62 section above for full detail.

4. **Direct messaging** - 1:1 channels (Stream supports natively). Real UI build: DM list,
 start-a-DM, unread handling. The biggest remaining chat feature; its own project.

Smaller polish, slot in anytime:
- **Message grouping** - collapse consecutive messages from one person to show name/avatar once. Low effort, visual.
- **Link previews** - unfurl pasted URLs into title/thumbnail. Medium effort. Nice for Readings.

**Gamification and engagement scoring (discussed, deliberately not started).**
Jonathan wants Skool-style ranks based on engagement. Honest constraints raised and agreed:
- This needs persistent state the project does not have. Everything today is stateless
 (Stream holds messages, localStorage holds identity, workers are stateless). Ranks, points,
 and streaks need a real database. Cloudflare D1 or Workers KV is the natural fit, but it is
 a new stack component, not a feature toggle.
- Scoring on message volume rewards talking, not helping. In a program about therapeutic
 presence and listening, ranking people by how much they post works against the culture.
 Reward replies and reactions received on replies, not raw message count.
- Some of the best students read everything and rarely post. Any scoring system will make
 them look disengaged when they are not.
- Recommended sequence: build PRIVATE personal recaps first (which also builds the tracking
 infrastructure and is almost purely positive), then decide with Mark whether public ranking
 fits a clinical training cohort at all.

Parked unless a need appears:
- **Profile photo uploads** - needs an image backend (e.g. Cloudflare R2). Partially
 unblocked as of v61: `Avatar` now renders images end to end, so photos work today if
 image URLs are hosted somewhere (e.g. in the repo); what's missing is only the upload
 path and storage.
- **Weekly digest email to Mark** - a scheduled (cron) job.

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

- `PROJECT_KNOWLEDGE.md`: this document.
- `src/index.jsx`: the complete current app source (current version is in the version line at the top of this doc). The real working file. 1,586 lines as of v61.
- `webpack.config.js`: webpack build config (repo root).
- `package.json`: dependencies and versions (repo root).
- `cloudflare-workers/token-worker.js`: the JWT token worker (`mhms-chat-token`). Matches the deployed source as of the v61 reconciliation.
- `cloudflare-workers/notification-worker.js`: the email worker (`cats-notifications`). Matches the deployed source as of the v61 reconciliation (deployed source = production baseline + the v61 email-guard and HTML-escaping fixes).
- (HELD, not in repo) `ai-agent-worker.js` - the Atlas support agent. Built, on hold, lives in
 a prior session's outputs only. Not committed pending the Atlas scope decision.
- (HELD, not in repo) the Atlas-enabled `notification-worker.js` variant - predates v61; must
 be rebuilt on the v61 worker before use. See the Atlas section.
- (HELD, not in repo) `cats-assistant-test-bench.jsx` - offline test bench for the agent's
 prompt. Never part of the app.
- Atlas avatar image: Jonathan has his own, to be uploaded when Atlas is un-parked. The
 Avatar rendering prerequisite is done (v61). Not in the repo yet. One image, no poses.
- `SETUP.md`: how to rebuild the environment from scratch and the exact deploy steps. NOTE:
 update its `wc -l` sanity figure to 1,586 (it said ~1,100, which was stale since well
 before v59).
