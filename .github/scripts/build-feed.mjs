#!/usr/bin/env node
// Builds feed.json: the app's daily feed of new videos and shorts.
//
// Runs once a day in GitHub Actions (.github/workflows/daily-feed.yml), with no API key:
//   1. reads the vetted channel list (.github/feed-sources.json) — the ONLY safety gate, because
//      nothing here is reviewed by a person before children see it;
//   2. asks YouTube's public RSS for each channel's newest shorts (playlist UUSH…) and newest
//      full videos (playlist UULF…);
//   3. drops anything too new, too little watched, or whose title looks like an ad, a trailer,
//      a live stream or (for the youngest group) anything spooky; checks the rest can be embedded;
//   4. keeps the newest few per channel and writes feed.json, which the app reads at launch.
// Every run also re-screens what is ALREADY in the feed with today's rules, so a new title rule
// or a hand takedown (.github/feed-block.json) removes a video that is already published; the ids
// taken out are listed in feed.json ("gone") so the app drops its copies too.
// (Ages 5-10 may see gentle seasonal songs and stories, e.g. Halloween costumes; a channel's own
// rules remove scare-bait and peril. Ages 2-4 get no spooky titles at all.)
//
// usage: node .github/scripts/build-feed.mjs [--dry] [--verbose]
//   --dry      work out the feed and print the summary, but do not write feed.json
//   --verbose  list every upload that was dropped and why
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCES_FILE = path.join(ROOT, '.github', 'feed-sources.json');
const BLOCK_FILE = path.join(ROOT, '.github', 'feed-block.json');
const FEED_FILE = path.join(ROOT, 'feed.json');
const DRY = process.argv.includes('--dry'), VERBOSE = process.argv.includes('--verbose');

const KEEP = { short: 12, video: 8 };   // newest uploads kept per channel
const INTAKE = { short: 3, video: 2 };  // most a channel may add in one run, so a burst cannot flush its shelf in a day
const MIN_AGE_HOURS = 36;               // gives YouTube (and the channel) time to pull a mistake
const MIN_VIEWS = 1000;                 // nobody-has-watched-it-yet uploads wait
const RECHECK_DAYS = 6;                 // every kept item is re-checked for availability this often
const MIN_SOURCES_OK = 0.6;             // below this share of channels answering, the run is abandoned
const MAX_GONE = 2000;                  // ids taken out that the app is told about
const TIERS = ['little', 'big', 'super'];
const CATS = ['cartoon', 'play', 'song', 'learn', 'quiz', 'telugu', 'hindi', 'story', 'move', 'craft', 'calm'];
const UA = 'Mozilla/5.0 (compatible; ToonKidsFeed/1.0; +https://github.com/techiraavi/toon-kids)';

// Titles that are never content for children, whatever the channel.
const DENY_ALL = new RegExp('\\b(' + [
  'trailer', '(?<!brain\\s)teasers?', 'promo', 'sneak\\s*peek', 'behind\\s+the\\s+scenes', 'live\\s*stream(ing)?', 'live\\s+now',
  '24\\s*\\/\\s*7', 'premieres?', 'giveaway', 'sponsored', 'coming\\s+soon', 'in\\s+(cinemas|theat(er|re)s)',
  '(buy|get|book)\\s+(your\\s+)?tickets?', 'tickets?\\s+(on\\s+sale|available|now)', 'now\\s+streaming', 'pre-?order', 'merch(andise)?',
  'horror', 'murder', 'gore', 'bloody', 'bloodshed', 'suicide', 'sexy', 'sex', 'naked', 'nude', 'nsfw', 'drunk', 'beer', 'alcohol',
  'vodka', 'whisk(e)?y', 'drugs?', 'weed', 'cocaine', 'marijuana', 'vape', 'vaping', 'cigarettes?', 'casino', 'gambl(e|ing)',
  'guns?', 'gunshot', 'kill(s|ed|ing|er)?(?!\\s+whales?)',
].join('|') + ')\\b|#ad\\b|18\\+|\\u{1F534}\\s*live|live\\s*\\u{1F534}', 'iu');
const DENY_LIVE = /\bLIVE\b/; // upper case only: "LIVE: ..." is a stream, "Live and Learn" is a song
// Extra care for channels that reach the 2-4 group: no spooky, scary or rough titles at all.
const DENY_LITTLE = /\b(scary|scar(e|ed|es|ing)|scariest|spooky|zombies?|ghost\w*|haunted|vampires?|witch(es)?|creepy|nightmares?|skeletons?|halloween|trick.{0,12}treat(s|ing)?|jack.{0,3}o.{0,3}lanterns?|fright\w*|terrif(y|ied|ying)|demons?|monsters|pranks?|fight(s|ing)?|battles?)\b|\u{1F47B}|\u{1F480}|\u{1F9DF}|\u{1F9DB}/iu;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const epochDay = d => Math.floor((d instanceof Date ? d.getTime() : d) / 86400000);
const TODAY = epochDay(Date.now());

async function get(url, { tries = 3 } = {}) {
  let last = 0;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
      last = r.status;
      if (r.status === 200) return { status: 200, text: await r.text() };
      if ([400, 401, 403, 404].includes(r.status)) return { status: r.status, text: '' };
    } catch (_) { last = 0; }
    await sleep(900 * (i + 1));
  }
  return { status: last || -1, text: '' };
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
const decode = s => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
  if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' '; }
  return NAMED[e.toLowerCase()] ?? m;
});
// A title a child (or a parent reading over a shoulder) can take in: no hashtags, no channel
// tagline after the first " | ", no control characters, at most 80 characters. Joiners (U+200C/D)
// stay: emoji sequences and Indic words need them. The title arrives already decoded.
function cleanTitle(raw) {
  let s = String(raw || '').replace(/[\u0000-\u001f\u007f​‎‏‪-‮⁦-⁩]/g, ' ')
    .replace(/#[\p{L}\p{M}\p{N}_]+/gu, ' ')
    .replace(/\s*[([]\s*(official|full)\s+(music\s+)?(video|episode|movie)s?\s*[)\]]/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  const parts = s.split(/\s+[|｜]\s+/).map(x => x.trim()).filter(Boolean);
  if (parts.length > 1) s = parts[0].length >= 8 ? parts[0] : parts.slice(0, 2).join(' | ');
  s = s.replace(/[\s\-–—|:•·]+$/u, '').trim();
  if ([...s].length > 80) s = [...s].slice(0, 78).join('').replace(/\s+\S*$/, '') + '…';
  return s;
}
function parseRss(xml) {
  return xml.split('<entry>').slice(1).map(e => {
    const g = re => (e.match(re) || [])[1];
    const published = Date.parse(g(/<published>([^<]+)/) || '');
    return { id: g(/<yt:videoId>([^<]+)/) || '', rawTitle: decode(g(/<title>([^<]*)/) || '').normalize('NFC'), published, views: +(g(/<media:statistics views="(\d+)"/) || 0) };
  }).filter(x => /^[A-Za-z0-9_-]{11}$/.test(x.id) && Number.isFinite(x.published));
}

// ---------- the channel list, the takedown list, the last feed ----------
function loadSources() {
  const list = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8'));
  if (!Array.isArray(list) || !list.length) throw new Error('feed-sources.json: expected a non-empty list');
  const seen = new Set();
  return list.map((s, i) => {
    const where = 'feed-sources.json entry ' + (i + 1) + ' (' + (s && s.ch) + ')';
    if (!s || !/^UC[\w-]{22}$/.test(s.cid || '')) throw new Error(where + ': bad channel id');
    if (seen.has(s.cid)) throw new Error(where + ': channel listed twice');
    seen.add(s.cid);
    if (typeof s.ch !== 'string' || !s.ch.trim() || s.ch.length > 40) throw new Error(where + ': bad name');
    if (!CATS.includes(s.cat)) throw new Error(where + ': bad category ' + s.cat);
    if (!Array.isArray(s.tiers) || !s.tiers.length || !s.tiers.every(t => TIERS.includes(t))) throw new Error(where + ': bad tiers');
    if (s.shorts === false && s.videos === false) throw new Error(where + ': takes neither shorts nor videos');
    const deny = (s.deny || []).map(p => { try { return new RegExp(String(p).normalize('NFC'), 'i'); } catch (e) { throw new Error(where + ': bad deny pattern ' + p); } });
    return { cid: s.cid, ch: s.ch.trim(), cat: s.cat, tiers: TIERS.filter(t => s.tiers.includes(t)), short: s.shorts !== false, video: s.videos !== false, deny, minViews: Number.isFinite(s.minViews) ? s.minViews : MIN_VIEWS };
  });
}
// Hand takedowns: video ids that must never be published, whatever their title. To pull one video,
// add its id to .github/feed-block.json and push; the next run takes it out everywhere.
function loadBlock() {
  if (!fs.existsSync(BLOCK_FILE)) return new Set();
  const j = JSON.parse(fs.readFileSync(BLOCK_FILE, 'utf8')); // a broken file must fail the run, not be ignored
  if (!Array.isArray(j) || !j.every(id => /^[A-Za-z0-9_-]{11}$/.test(id))) throw new Error('feed-block.json: expected a list of 11-character video ids');
  return new Set(j);
}
// feed.json as last published: { v, updated, sources: [{k, n, c, t}], items: [[source, short?, id, title, publishedDay, addedDay]], gone: [ids] }
function loadPrevious() {
  try {
    const j = JSON.parse(fs.readFileSync(FEED_FILE, 'utf8'));
    if (j && j.v === 1 && Array.isArray(j.items) && Array.isArray(j.sources)) {
      return {
        items: j.items.filter(it => Array.isArray(it) && j.sources[it[0]]).map(it => ({ cid: j.sources[it[0]].k, fmt: it[1] ? 'short' : 'video', id: it[2], title: it[3], p: it[4], a: it[5] })),
        gone: Array.isArray(j.gone) ? j.gone.filter(id => /^[A-Za-z0-9_-]{11}$/.test(id)) : [],
      };
    }
  } catch (_) {}
  return { items: [], gone: [] };
}
// The title rules, used on new uploads AND, every run, on everything already in the feed.
// raw = false for a stored (cleaned) title: allow-list rules "^(?!...)" test text that cleanTitle cut off.
function titleRule(t, src, raw) {
  t = String(t || '').normalize('NFC');
  if (DENY_ALL.test(t) || DENY_LIVE.test(t)) return 'title: ad/trailer/live/unsuitable word';
  if (src.tiers.includes('little') && DENY_LITTLE.test(t)) return 'title: too spooky or rough for ages 2-4';
  if (src.deny.some(re => (raw || !/^\^\(\?!/.test(re.source)) && re.test(t))) return 'title: channel rule';
  return null;
}
function whyDropped(e, src) {
  if (BLOCK.has(e.id)) return 'taken down by hand';
  if ((Date.now() - e.published) / 3600000 < MIN_AGE_HOURS) return 'too new';
  if (e.views < src.minViews) return 'under ' + src.minViews + ' views';
  const tr = titleRule(e.rawTitle, src, true);
  if (tr) return tr;
  // (marks count too: Telugu and Hindi words are letters interleaved with vowel signs)
  if (!/[\p{L}\p{M}]{3}/u.test(cleanTitle(e.rawTitle))) return 'title: nothing readable';
  return null;
}
// 'ok' = public and embeddable; 'off' = the owner switched embedding off (a real answer about that
// video); 'gone' = private, removed, or refused; null = could not tell.
async function embeddable(id) {
  const r = await get('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id), { tries: 2 });
  if (r.status === 200) return 'ok';
  if (r.status === 401) return 'off';
  if (r.status === 403 || r.status === 404 || r.status === 400) return 'gone';
  return null;
}

// ---------- the run ----------
const sources = loadSources();
const BLOCK = loadBlock();
const previous = loadPrevious();
const kept = new Map(); // cid -> { short: [...], video: [...] }
for (const s of sources) kept.set(s.cid, { short: [], video: [] });
for (const it of previous.items) { const k = kept.get(it.cid); if (k && k[it.fmt]) k[it.fmt].push(it); } // items of channels no longer listed are let go

const stats = { sourcesOk: 0, sourcesFailed: [], added: 0, removedDead: 0, takenDown: 0, dropped: {}, addedBy: [] };
const drop = (why, src, e) => { stats.dropped[why] = (stats.dropped[why] || 0) + 1; if (VERBOSE) console.log('  drop [' + why + '] ' + src.ch + ': ' + e.rawTitle); };
const goneToday = [];

// 1) newest uploads of every channel. A feed that answers 404 is asked once more (YouTube's feed
//    server sometimes answers 404 for hours); a 200 that is not an Atom feed counts as a failure.
let rssFetches = 0, rss404 = 0;
const fetched = await pool(sources, 6, async src => {
  const tail = src.cid.slice(2), res = {};
  for (const fmt of ['short', 'video']) {
    if (!src[fmt]) { res[fmt] = []; continue; }
    const url = 'https://www.youtube.com/feeds/videos.xml?playlist_id=' + (fmt === 'short' ? 'UUSH' : 'UULF') + tail;
    let r = await get(url);
    if (r.status === 404) { await sleep(2000); r = await get(url); }
    rssFetches++; if (r.status === 404) rss404++;
    res[fmt] = r.status === 200 && /<feed[\s>]/.test(r.text) ? parseRss(r.text) : r.status === 404 ? [] : null; // 404: the channel has none of this kind
    await sleep(120);
  }
  return res;
});
if (rssFetches >= 10 && rss404 > rssFetches * 0.5) {
  console.error('YouTube RSS answered 404 for ' + rss404 + ' of ' + rssFetches + ' feeds; leaving feed.json as it is.');
  process.exit(1);
}

// 2) everything already in the feed meets today's rules (the raw RSS title while it is still in the
//    channel's window, else the stored one), and nothing taken down by hand stays
sources.forEach((src, i) => {
  for (const fmt of ['short', 'video']) {
    const raw = new Map(((fetched[i] && fetched[i][fmt]) || []).map(e => [e.id, e.rawTitle]));
    const k = kept.get(src.cid);
    k[fmt] = k[fmt].filter(it => {
      const why = BLOCK.has(it.id) ? 'taken down by hand' : titleRule(raw.has(it.id) ? raw.get(it.id) : it.title, src, raw.has(it.id));
      if (!why) return true;
      stats.takenDown++; goneToday.push(it.id); drop('taken out, ' + why, src, { rawTitle: it.title });
      return false;
    });
  }
});

// 3) candidates: pass the filters, are not in the feed yet, and are newer than the oldest item kept
const candidates = [];
sources.forEach((src, i) => {
  const got = fetched[i];
  const wanted = ['short', 'video'].filter(f => src[f]);
  if (wanted.every(f => got[f] === null)) { stats.sourcesFailed.push(src.ch); return; }
  stats.sourcesOk++;
  for (const fmt of wanted) {
    if (!got[fmt]) continue;
    const have = kept.get(src.cid)[fmt];
    const haveIds = new Set(have.map(x => x.id));
    const full = have.length >= KEEP[fmt];
    const oldest = full ? Math.min(...have.map(x => x.p)) : -Infinity;
    const fresh = got[fmt].filter(e => !haveIds.has(e.id)).sort((a, b) => b.published - a.published);
    let room = have.length ? INTAKE[fmt] : KEEP[fmt]; // a channel new to the feed fills its shelf at once
    for (const e of fresh) {
      if (room <= 0) break;
      if (epochDay(e.published) <= oldest) continue; // would not make the shelf anyway (and must not flap in and out)
      const why = whyDropped(e, src);
      if (why) { drop(why, src, e); continue; }
      candidates.push({ src, fmt, e });
      room--;
    }
  }
});
if (stats.sourcesOk < sources.length * MIN_SOURCES_OK) {
  console.error('Only ' + stats.sourcesOk + ' of ' + sources.length + ' channels answered; leaving feed.json as it is. Failed: ' + stats.sourcesFailed.join(', '));
  process.exit(1);
}

// 4) every candidate must be public and embeddable; kept items are re-checked on a rota
const recheck = [];
for (const [cid, k] of kept) for (const fmt of ['short', 'video']) for (const it of k[fmt]) {
  let h = 0; for (const c of it.id) h = (h * 31 + c.charCodeAt(0)) % 9973;
  if ((it.a + h) % RECHECK_DAYS === TODAY % RECHECK_DAYS) recheck.push({ cid, fmt, it });
}
const checks = await pool([...candidates.map(c => c.e.id), ...recheck.map(r => r.it.id)], 4, async id => { const v = await embeddable(id); await sleep(80); return v; });
const unknown = checks.filter(v => v === null).length, refused = checks.filter(v => v === 'gone').length;
// Normally about 1 in 100 checks says "gone". Many more means YouTube is refusing this machine, not that
// the videos went away: then nothing is added AND nothing is removed by this check today.
const checkerDown = checks.length >= 10 && (unknown > checks.length * 0.3 || refused > Math.max(10, checks.length * 0.25));
if (checkerDown) console.warn('WARN: availability checks look unreliable (' + unknown + ' unanswered, ' + refused + ' refused of ' + checks.length + '); nothing is added or removed by them in this run.');
candidates.forEach((c, i) => {
  const v = checks[i];
  if (v !== 'ok' || checkerDown) { drop(v === 'gone' || v === 'off' ? 'not embeddable or gone' : 'could not be checked', c.src, c.e); return; }
  kept.get(c.src.cid)[c.fmt].push({ cid: c.src.cid, fmt: c.fmt, id: c.e.id, title: cleanTitle(c.e.rawTitle), p: epochDay(c.e.published), a: TODAY });
  stats.added++; stats.addedBy.push(c.src.ch);
});
recheck.forEach((r, i) => {
  const v = checks[candidates.length + i];
  if (checkerDown || (v !== 'gone' && v !== 'off')) return;
  const list = kept.get(r.cid)[r.fmt];
  list.splice(list.indexOf(r.it), 1);
  stats.removedDead++;
});

// 5) newest KEEP per channel (on a tie, the one added first keeps its place), newest-added first
const outSources = sources.map(s => ({ k: s.cid, n: s.ch, c: s.cat, t: s.tiers }));
const items = [];
sources.forEach((src, si) => {
  for (const fmt of ['short', 'video']) {
    const list = kept.get(src.cid)[fmt].sort((a, b) => b.p - a.p || a.a - b.a).slice(0, KEEP[fmt]);
    for (const it of list) if (src[fmt]) items.push([si, fmt === 'short' ? 1 : 0, it.id, it.title, it.p, it.a]);
  }
});
items.sort((x, y) => y[5] - x[5] || y[4] - x[4] || (x[2] < y[2] ? -1 : 1));
const seenIds = new Set();
const unique = items.filter(it => (seenIds.has(it[2]) ? false : (seenIds.add(it[2]), true))); // one video, one place
// The app drops its own copies (favourites, approvals) of anything taken down by hand or by a rule.
const gone = [...new Set([...previous.gone, ...BLOCK, ...goneToday])].filter(id => !seenIds.has(id)).slice(-MAX_GONE);

const perTier = Object.fromEntries(TIERS.map(t => [t, { video: 0, short: 0, newVideo: 0, newShort: 0 }]));
for (const it of unique) for (const t of outSources[it[0]].t) {
  perTier[t][it[1] ? 'short' : 'video']++;
  if (it[5] === TODAY) perTier[t][it[1] ? 'newShort' : 'newVideo']++;
}
const prevIds = new Map(previous.items.map(p => [p.id, p.title]));
const changed = unique.length !== previous.items.length || unique.some(it => prevIds.get(it[2]) !== it[3]) ||
  gone.length !== previous.gone.length || gone.some((id, i) => previous.gone[i] !== id);
// A day the checks could not be trusted (or many channels did not answer) still publishes what it
// safely can (takedowns included), but the run is marked failed so the repository owner hears of it.
const degraded = checkerDown || stats.sourcesFailed.length > sources.length * 0.2;

const lines = [
  'Daily feed: ' + unique.length + ' items from ' + stats.sourcesOk + ' of ' + sources.length + ' channels (' + stats.added + ' new, ' + stats.removedDead + ' removed as gone, ' + stats.takenDown + ' taken out by today\'s rules)',
  ...TIERS.map(t => '  ages ' + ({ little: '2-4 ', big: '5-7 ', super: '8-10' })[t] + ': ' + perTier[t].video + ' videos (' + perTier[t].newVideo + ' new), ' + perTier[t].short + ' shorts (' + perTier[t].newShort + ' new)'),
  '  not taken: ' + (Object.entries(stats.dropped).map(([k, n]) => n + ' ' + k).join('; ') || 'nothing'),
  stats.sourcesFailed.length ? '  channels that did not answer (their items are kept as they were): ' + stats.sourcesFailed.join(', ') : '',
  degraded ? '  ATTENTION: ' + (checkerDown ? 'availability checks were unreliable' : 'many channels did not answer') + ' (YouTube may be refusing GitHub\'s machines)' : '',
].filter(Boolean);
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + lines.join('\n') + '\n```\n'); } catch (_) {} }
if (process.env.GITHUB_OUTPUT && degraded) { try { fs.appendFileSync(process.env.GITHUB_OUTPUT, 'degraded=true\n'); } catch (_) {} }

if (!unique.length) { console.error('The feed came out empty; leaving feed.json as it is.'); process.exit(1); }
if (DRY) { console.log('(dry run: feed.json not written)'); process.exit(0); }
if (!changed && fs.existsSync(FEED_FILE)) { console.log('Nothing changed; feed.json left as it is.'); process.exit(0); }
// one item per line keeps the daily commit diff small and readable
const body = '{\n"v":1,\n"updated":' + JSON.stringify(new Date().toISOString()) + ',\n"sources":' + JSON.stringify(outSources) +
  ',\n"gone":' + JSON.stringify(gone) + ',\n"items":[\n' + unique.map(i => JSON.stringify(i)).join(',\n') + '\n]\n}\n';
fs.writeFileSync(FEED_FILE, body);
console.log('wrote feed.json (' + Math.round(body.length / 1024) + ' KB)');
