#!/bin/zsh
# Re-adds each show's Spotify follow button once its open.spotify.com page is live (checks every 20 min, up to 2 days).
cd ~/leaseendlive
typeset -A URLS; URLS=(lease-end-minute https://open.spotify.com/show/0Ej4GtuRwgNJeIMsilCrvv keys-or-keep https://open.spotify.com/show/1nmYp5ZNaff4LBfMEURhzx)
for i in $(seq 1 144); do
  left=0
  for slug url in ${(kv)URLS}; do
    has=$(python3 -c "import json;print(int('spotify' in [s for s in json.load(open('content/site.json'))['shows'] if s['slug']=='$slug'][0]['platforms']))")
    [ "$has" = 1 ] && continue
    if [ "$(curl -s -o /dev/null -w '%{http_code}' -L $url)" = 200 ]; then
      python3 - "$slug" "$url" <<'PY'
import json,sys
p="content/site.json"; d=json.load(open(p))
for s in d["shows"]:
    if s["slug"]==sys.argv[1]: s["platforms"]["spotify"]=sys.argv[2]
json.dump(d,open(p,"w"),indent=2)
PY
      while [ -f .git/index.lock ]; do sleep 2; done
      git add content/site.json && git commit -q -m "Spotify is live for $slug: show its follow button

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
      T=$(gh auth token -u holdsudo); git -c credential.helper= -c "credential.helper=!f(){ echo username=x-access-token; echo password=$T; }; f" push -q
      echo "$(date) spotify live: $slug"
    else left=1; fi
  done
  [ $left = 0 ] && { echo "both live"; exit 0; }
  sleep 1200
done
