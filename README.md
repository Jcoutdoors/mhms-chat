# mhms-chat

Custom community chat for the MHMS / CATS cohort program. Live in production, embedded in
Squarespace at `https://www.mentalhealthmadesimple.life/catscourse#community` and served from
GitHub Pages at `https://jcoutdoors.github.io/mhms-chat/`.

Full context, architecture, and feature list: see `PROJECT_KNOWLEDGE.md`.
How to build and deploy: see `SETUP.md`.

## Repo layout

```
mhms-chat/
├── index.html            <- BUILT wrapper, served by GitHub Pages (root)
├── chat.bundle.js        <- BUILT bundle, served by Pages
├── *.chunk.js            <- BUILT lazy chunks (names change per build)
├── src/
│   └── index.jsx         <- THE editable source (edit this, then rebuild)
├── webpack.config.js     <- build config
├── package.json          <- dependencies
├── cloudflare-workers/
│   ├── token-worker.js          <- mhms-chat-token worker
│   └── notification-worker.js   <- cats-notifications worker
├── PROJECT_KNOWLEDGE.md  <- operating manual / current state
├── SETUP.md              <- build + deploy steps
└── README.md
```

The BUILT files at the repo root are what GitHub Pages serves. The `src/` folder holds the
editable source that produces them. Both live in the repo so the source and the deployed
output never drift apart, and so a Claude project connected to this repo always reads the
current source.

## The rule that keeps everything in sync

The built files are generated from `src/index.jsx`. Never hand-edit the built files. Edit the
source, rebuild, and commit the source AND the new built files together in the same change.
When you deploy, the repo is updated; then Sync the project so Claude sees the current source.

## Secrets

No secrets live in this repo. The Stream secret and Resend API key live only in the
Cloudflare worker environment variables. Do not commit secrets.
