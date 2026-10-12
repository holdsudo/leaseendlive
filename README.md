# leaseendlive.com

Podcast site for **The Lease End Minute** and **Keys or Keep**, hosted by Joe (Managing Director,
Champion Auto Finance). Static site, built by `build.py` (Python stdlib only) and deployed to
GitHub Pages by `.github/workflows/pages.yml` on every push and daily at 6:05 AM ET.

## Add an episode
1. Write the script in `~/caf-podcast/<show>/epNN.txt` (paragraphs separated by blank lines; `---` = section break).
2. Render in Joe's voice: `cd ~/caf-podcast/<show> && python3 ../gen.py epNN.txt epNN`
   (writes `epNN.mp3` + `epNN.segments.json`; paragraphs are cached in `~/caf-podcast/.tts-cache`).
3. Import: `python3 tools/import_episode.py <show> <number> <ISO date with offset> <slug> <mp3> <segments.json> --title "..." --summary "..."`
4. Preview: `python3 build.py --preview && python3 tools/serve.py` → http://localhost:8765 ; test: `node tools/test.mjs`
5. Commit + push. An episode dated in the future stays hidden until the daily build after its date.

## Where the numbers are
- **On-site listening** (plays, % listened, seconds listened, seeks, speed, shares, platform clicks,
  Ask Joe submissions): GA4, ID in `content/site.json` → `ga4_id`. Event list at the top of `src/assets/analytics.js`.
- **Downloads in every podcast app**: OP3 (open, free, no account). Every enclosure is prefixed
  `https://op3.dev/e,pg=<show guid>/...`. Show stats appear at op3.dev a few days after the first downloads.
- **Platform dashboards** (no public API): Apple Podcasts Connect, Spotify for Creators, Amazon Music for Podcasters.
  YouTube has an API (YouTube Analytics).

## Show links
After each show is approved on a platform, put its URL in `content/site.json` → `shows[].platforms`
(`apple`, `spotify`, `youtube`, `amazon`, `iheart`, `pocketcasts`). The "Follow" buttons appear automatically.

## Feeds
`/feeds/lease-end-minute.xml`, `/feeds/keys-or-keep.xml`. GUIDs are fixed in `content/site.json`;
never change a show's GUID or an episode's `guid` after publishing (apps would re-download everything).
