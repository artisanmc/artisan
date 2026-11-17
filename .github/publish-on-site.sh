#!/usr/bin/env bash
# Publishes one built jar as a version of a module on the Artisan site (its /modules/<id>/versions/
# page; website README, "Versions and downloads"). The site reads the channel off the version:
# 1.2.3 is a release, anything with a suffix (1.2.3-dev.45) a development build.
#
#   publish-on-site.sh <module id> <version> <jar>
#
# Needs RELEASE_TOKEN. Notes: the annotation of the tag being built, else the commits of the push
# (BEFORE = github.event.before, with a full checkout), else the last commit.
set -euo pipefail

MODULE="$1"
VERSION="$2"
JAR="$3"
SITE="${SITE:-https://artisanmc.net}"

[ -n "${RELEASE_TOKEN:-}" ] || { echo "RELEASE_TOKEN is not set: add it to this repository's Actions secrets" >&2; exit 1; }
[ -f "$JAR" ] || { echo "no jar at $JAR" >&2; exit 1; }

if [ "${GITHUB_REF_TYPE:-}" = "tag" ]; then
  git fetch --force origin "refs/tags/$GITHUB_REF_NAME:refs/tags/$GITHUB_REF_NAME"
  NOTES="$(git tag -l --format='%(contents)' "$GITHUB_REF_NAME")"
elif [ -n "${BEFORE:-}" ] && git cat-file -e "$BEFORE^{commit}" 2>/dev/null; then
  NOTES="$(git log --no-merges --format='- %s' "$BEFORE..HEAD")"
else
  NOTES="$(git log --no-merges --format='- %s' -1)"
fi

SHA="$(sha256sum "$JAR" | cut -d' ' -f1)"
URL="$SITE/api/releases/$MODULE/$VERSION/"
curl --fail-with-body -sS -X PUT -H "Authorization: Bearer $RELEASE_TOKEN" -H "X-Sha256: $SHA" \
  -H "Content-Type: application/java-archive" --data-binary "@$JAR" "$URL"
echo
curl --fail-with-body -sS -X POST -H "Authorization: Bearer $RELEASE_TOKEN" -H "Content-Type: application/json" \
  -d "$(jq -n --arg sha256 "$SHA" --arg changelog "$NOTES" --arg commit "$(git rev-parse HEAD)" '$ARGS.named')" "$URL"
echo
