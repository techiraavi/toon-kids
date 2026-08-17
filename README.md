# Toon Kids 🎈

A kid-safe, age-filtered video app in a single self-contained web page — like a personal YouTube Kids, fully controlled by parents.

**Live app:** https://toon-kids-raavi.netlify.app

## Features

- **Age profiles (2–10):** content is tagged into three tiers (2–4, 5–7, 8–10); only the selected tier's videos are ever shown.
- **Curated catalog:** ~66 cartoons, nursery rhymes, learning videos and classic public-domain films — official channels only, every video validated as embeddable.
- **Shorts feed:** vertical swipe reels (portrait, full-bleed on phones, centered column on wide screens) with watch-aware rotation — frequently seen shorts sink back, fresh ones surface with a ✨ New badge.
- **Full player:** kid-simple controls, auto-play-next, continue-watching resume for long videos.
- **Parent Zone** (PIN-protected): keyword search (bring-your-own free YouTube API key), Quick Add packs, paste-a-link, local video files (IndexedDB), per-age tagging, daily screen-time limit, bedtime lock, eye comfort (warm filter, dimmer, auto evening mode, 20-20-20 blink breaks).
- **Device adaptive:** phone / tablet / laptop / TV layouts, safe-area aware, installable as a home-screen app (PWA).
- **Self-updating:** installed apps detect new deploys (ETag polling) and refresh themselves at a safe moment; a network-first service worker keeps launches instant and offline-tolerant.

## Structure

| File | Purpose |
|---|---|
| `index.html` | The entire app — UI, catalog, players, parental controls |
| `sw.js` | Service worker (network-first, offline shell fallback) |
| `manifest.webmanifest` | PWA manifest |
| `icon-180.png`, `icon-512.png` | App icons |

## Deploy

Any static host works. For the existing Netlify site:

```bash
npx netlify-cli deploy --prod --dir . --site 9168d97b-b789-4769-8355-ad76e7275478
```

## Notes

- YouTube embeds require the page to be served over http(s) — opening `index.html` directly from disk plays only the classics and local videos.
- Keyword search requires the parent's own YouTube Data API v3 key (free tier ≈ 100 searches/day), stored only on the device.
- No accounts, no tracking, no analytics: all state (age, favorites, watch history, PIN, settings) lives in the device's localStorage/IndexedDB.
