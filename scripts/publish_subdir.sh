#!/usr/bin/env bash
# Publish the built app into ONE subfolder of an existing GitHub Pages site —
# typically the user site, where Pages serves the branch root and every folder is
# a page:  tubiana.github.io  ->  tubiana.github.io/ORF1viewer/
#
# It never touches the rest of that site: only <subdir>/ is synced (--delete inside
# it), and only that path is committed.
#
#   scripts/publish_subdir.sh --site ~/git/tubiana.github.io
#   scripts/publish_subdir.sh --site ../tubiana.github.io --subdir ORF1viewer \
#       --data-url https://huggingface.co/datasets/ttubiana/HEV-ORF1-models/resolve/main --push
#
# Notes
#  * vite.config.ts uses base:'./', so asset URLs stay relative and the app works at
#    any sub-path — no per-deployment base needed.
#  * --data-url is baked in as VITE_DATA_BASE_URL; visitors can still override it
#    with ?dataBaseUrl=… or the ⚙ dialog. Omit it and the app shows the data-source
#    dialog (public/data/ is not committed).
#  * .nojekyll is written next to the app so Pages does not process the folder.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE="" SUBDIR="ORF1viewer" BRANCH="" DATA_URL="" PUSH=0 NO_BUILD=0 MSG="" STRIP_DATA=0

while [ $# -gt 0 ]; do
  case "$1" in
    --site)      SITE="$2"; shift 2;;
    --subdir)    SUBDIR="$2"; shift 2;;
    --branch)    BRANCH="$2"; shift 2;;
    --data-url)  DATA_URL="$2"; shift 2;;
    --message)   MSG="$2"; shift 2;;
    --push)      PUSH=1; shift;;
    --no-build)  NO_BUILD=1; shift;;
    --strip-data) STRIP_DATA=1; shift;;
    -h|--help)   sed -n '2,20p' "$0"; exit 0;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done

[ -n "$SITE" ] || { echo "error: --site <local clone of the Pages repository> is required" >&2; exit 2; }
[ -d "$SITE/.git" ] || { echo "error: $SITE is not a git repository (git clone git@github.com:tubiana/tubiana.github.io.git)" >&2; exit 2; }
SITE="$(cd "$SITE" && pwd)"
SUBDIR="${SUBDIR#/}"; SUBDIR="${SUBDIR%/}"
DEST="$SITE/$SUBDIR"

if [ "$NO_BUILD" = "0" ]; then
  echo "· building the app${DATA_URL:+ (data root: $DATA_URL)}"
  ( cd "$APP_DIR" && VITE_DATA_BASE_URL="$DATA_URL" npm run build >/dev/null )
fi
[ -f "$APP_DIR/dist/index.html" ] || { echo "error: $APP_DIR/dist/index.html missing — drop --no-build" >&2; exit 2; }

# Vite copies public/ verbatim, so dist/data carries the whole ~1 GB payload (that is
# the all-in-one Pages mode). With a remote data root it must not be pushed into git.
if [ -d "$APP_DIR/dist/data" ]; then
  if [ -n "$DATA_URL" ] || [ "$STRIP_DATA" = "1" ]; then
    echo "· dist/data removed ($(du -sh "$APP_DIR/dist/data" | cut -f1)) — served from the data root instead"
    rm -rf "$APP_DIR/dist/data"
  else
    echo "· ! dist/data still holds $(du -sh "$APP_DIR/dist/data" | cut -f1) (pass --data-url or --strip-data"
    echo "    to keep the Pages commit small; keeping it means committing the payload to git)"
  fi
fi

echo "· site          : $SITE"
echo "· target folder : $SUBDIR/  ($(find "$APP_DIR/dist" -type f | wc -l | tr -d ' ') files, $(du -sh "$APP_DIR/dist" | cut -f1))"
mkdir -p "$DEST"
if command -v rsync >/dev/null; then
  rsync -a --delete "$APP_DIR/dist/" "$DEST/"
else
  find "$DEST" -mindepth 1 -maxdepth 1 -exec rm -rf {} + && cp -r "$APP_DIR/dist/." "$DEST/"
fi
touch "$DEST/.nojekyll"

cd "$SITE"
[ -n "$BRANCH" ] && git switch "$BRANCH"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
DATA_TXT="${DATA_URL:-the data root set at runtime}"
[ -n "$MSG" ] || MSG="ORF1viewer: app build ($DATA_TXT)"
git add -- "$SUBDIR"
if git diff --cached --quiet; then
  echo "· nothing changed in $SUBDIR/ — no commit"
else
  git commit -q -m "$MSG" -- "$SUBDIR"
  echo "· committed on $CURRENT_BRANCH: $(git log --oneline -1 -- "$SUBDIR")"
fi
if [ "$PUSH" = "1" ]; then
  git push origin "HEAD:$CURRENT_BRANCH"
  echo "· pushed — https://<pages host>/$SUBDIR/ will update in ~1 min"
else
  echo "· not pushed. Check the rest of the site, then: cd $SITE && git push"
fi
echo "· data root baked in: $DATA_TXT"
echo "· verify once live:"
echo "    curl -sI https://tubiana.github.io/$SUBDIR/ | head -1"
echo "    curl -s  https://tubiana.github.io/$SUBDIR/ | grep -o '<title>[^<]*' "
