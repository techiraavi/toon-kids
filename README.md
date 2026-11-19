# Toon Kids 🎈

A kid-safe, age-filtered video app in a single self-contained web page — like a personal YouTube Kids, fully controlled by parents.

**Live app:** https://techiraavi.github.io/toon-kids/

Open it on any phone, tablet or laptop — no install, no account. To use it like an app, add it to your home screen (Safari: Share → Add to Home Screen; Chrome: ⋮ → Add to Home screen).

## Features

- **Age profiles (2–10):** content is tagged into three tiers (2–4, 5–7, 8–10); only the selected tier's videos are ever shown.
- **Curated catalog:** 500+ hand-picked videos and shorts — cartoons, nursery rhymes, learning, quizzes, stories, real-world play, dance, bedtime songs, Telugu and Hindi rhymes, and classic public-domain films — official channels only, every video validated as embeddable.
- **New videos and shorts every day, automatically:** each morning a scheduled job takes the newest uploads of the official channels vetted for each age group, skips trailers, live streams, ads and anything spooky for the youngest, checks every video can be played, and publishes them as `feed.json`. The app picks them up by itself (no API key, nothing to set up), shows them in a **🆕 New this week** shelf and mixes them into every shelf and the Shorts feed, and keeps the last feed for offline use. Nobody previews these uploads first, so parents get controls in the Parent Zone: switch any channel off, remove any video from the newest list, make new ones wait for approval, or turn the daily feed off entirely. Favourites from the feed are kept on the device and still obey all of these.
- **Shorts feed:** vertical swipe reels (portrait, full-bleed on phones, centered column on wide screens) with watch-aware rotation — frequently seen shorts sink back, fresh ones surface with a ✨ New badge.
- **Full player:** kid-simple controls, continue-watching resume for long videos. When a video ends, ages 2–4 get a calm **All done** card (Again / Next, shown by its picture / Home) instead of an endless chain; ages 5–10 play on, and parents can choose "always ask", "up to 2 more, then ask" or "always play on" (Parent Zone → screen time). Shorts follow the same rule (↻ again / ⬆ next). If YouTube is slow to arrive, videos start as soon as it does, and a failed video has a big Try again button.
- **Last one:** a rest, bedtime or blink break that comes due in the middle of a video waits for that video to end (up to 5 minutes; 90 seconds for a short) instead of cutting a song in half, with a heads-up that it is the last one. Switching to another video brings the rest at once; parents can switch the grace off.
- **Again! shelf (ages 2–4):** the videos a pre-reader keeps coming back to stay first on Home, in a steady order. Videos added from the device (and the classic films) play in their own shape: an upright phone video fills a phone screen top to bottom, a square or 4:3 video is never stretched or cropped, and each one grows to the largest size the screen allows. Their thumbnails show the whole frame too. A file the device cannot decode says so plainly (and suggests adding an MP4 copy).
- **Dark mode:** Parent Zone → Appearance: same as the device (the default; follows the device into dark mode at sunset), light, or dark. Every screen and menu of the app turns dark; videos, the shorts feed, the player and the games' play boards keep their own colours.
- **Games (2–10):** 14 calm mini games, seven for each age group, harder as the child grows. Ages 2–4: Bubble Pop, Animal Friends, Colour Match, Count with Me, Shape Sorter, Memory Match, What's Next?. Ages 5–7: Shape Sorter, Memory Match, First Letter, Maths Fun, 123 Telugu Hindi, Tic-Tac-Toe, What's Next?. Ages 8–10: Memory Match, Maths Fun, 123 Telugu Hindi, Word Scramble, Tic-Tac-Toe, Mini Sudoku, Fun Facts Quiz. Every game ends after a fixed number of rounds — no scores, streaks, countdowns or ads — a wrong tap gets a kind second try, and play time counts toward the daily screen-time limit. Parents can switch games off in the Parent Zone.
- **Parent Zone** (PIN-protected): keyword search (bring-your-own free YouTube API key), Quick Add packs, paste-a-link, local video files (IndexedDB), per-age tagging, daily screen-time limit, bedtime lock, eye comfort (warm filter, dimmer, auto evening mode, 20-20-20 blink breaks).
- **Device adaptive:** phone / tablet / laptop / TV layouts, safe-area aware, installable as a home-screen app (PWA).
- **Self-updating:** installed apps detect new deploys (ETag polling) and refresh themselves at a safe moment; a network-first service worker keeps launches instant and offline-tolerant.

## Structure

| File | Purpose |
|---|---|
| `index.html` | The entire app — UI, catalog, players, parental controls, the games framework and Bubble Pop |
| `games.js` | The other games, fetched the first time the Games tab opens (never slows app launch) and cached for offline play |
| `feed.json` | Today's new videos and shorts, rewritten every morning by the daily job |
| `sw.js` | Service worker (network-first, offline shell fallback) |
| `manifest.webmanifest` | PWA manifest |
| `icon-180.png`, `icon-192.png`, `icon-512.png` | App icons |
| `.github/feed-sources.json` | The vetted channels the daily feed takes from, each with its age groups, category and any title rules |
| `.github/feed-block.json` | Video ids taken down by hand: never published, and removed from devices that kept a copy |
| `.github/scripts/build-feed.mjs` | Builds `feed.json` from those channels' public YouTube feeds (no API key); `--dry --verbose` shows what it would take and why it skipped the rest |
| `.github/workflows/daily-feed.yml` | Runs it every day at 00:17 UTC and publishes the result; also has a "Run workflow" button on the Actions tab |

## Deploy

The live app is served by **GitHub Pages** from the `main` branch — every push to `main` goes live within about a minute, no build step.

Any static host works. To run your own copy, fork this repo and enable Pages (Settings → Pages → Deploy from a branch → `main` / root).

## Notes

- YouTube embeds require the page to be served over http(s) — opening `index.html` directly from disk plays only the classics and local videos.
- Keyword search requires the parent's own YouTube Data API v3 key (free tier ≈ 100 searches/day), stored only on the device. The daily feed does not.
- To change which channels feed the app, edit `.github/feed-sources.json` and push; the next daily run follows the new list. To take one video out everywhere, add its 11-character id to `.github/feed-block.json` and push (then press "Run workflow" on the Actions tab to apply it at once). New title rules and takedowns also apply to videos already in the feed. Copies of the app on other hosts (a fork, the single-file edition) read the feed from the live GitHub Pages address.
- GitHub pauses scheduled jobs in a public repository after 60 days without any activity there. The daily feed commits keep it active; if it ever stops, re-enable it on the Actions tab.
- No accounts, no tracking, no analytics: all state (age, favorites, watch history, PIN, settings) lives in the device's localStorage/IndexedDB.
