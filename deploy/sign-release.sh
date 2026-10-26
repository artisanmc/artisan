#!/usr/bin/env bash
# Signs a plugin jar for Artisan's updater and writes release.json beside it:
# {plugin, version, sha256, signature}. The signature is Ed25519 over
#   "artisan-release\n<plugin>\n<version>\n<sha256>"
# with the private key in ARTISAN_SIGNING_KEY (PEM). Artisan verifies it with the
# public key it pins before it puts the jar in plugins/update/.
# Usage: sign-release.sh <jar> <expected version>
set -euo pipefail

jar="$1"
expected="$2"
: "${ARTISAN_SIGNING_KEY:?ARTISAN_SIGNING_KEY is not set}"

descriptor=$(unzip -p "$jar" plugin.yml 2>/dev/null || unzip -p "$jar" paper-plugin.yml)
field() { printf '%s\n' "$descriptor" | sed -n "s/^$1:[[:space:]]*['\"]\{0,1\}\([^'\"]*\)['\"]\{0,1\}[[:space:]]*$/\1/p" | head -n 1; }
plugin=$(field name)
version=$(field version)
if [ -z "$plugin" ] || [ "$version" != "$expected" ]; then
  echo "The jar says name '$plugin', version '$version'; the release is $expected" >&2
  exit 1
fi

sha=$(sha256sum "$jar" | cut -d ' ' -f 1)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
printf '%s\n' "$ARTISAN_SIGNING_KEY" > "$work/key.pem"
printf 'artisan-release\n%s\n%s\n%s' "$plugin" "$version" "$sha" > "$work/message"
openssl pkeyutl -sign -inkey "$work/key.pem" -rawin -in "$work/message" -out "$work/signature"
# The signature checks against the key's own public half before anything is published.
openssl pkey -in "$work/key.pem" -pubout -out "$work/public.pem"
openssl pkeyutl -verify -pubin -inkey "$work/public.pem" -rawin -in "$work/message" -sigfile "$work/signature" >/dev/null

jq -n --arg plugin "$plugin" --arg version "$version" --arg sha256 "$sha" \
  --arg signature "$(base64 -w 0 "$work/signature")" \
  '{plugin: $plugin, version: $version, sha256: $sha256, signature: $signature}' \
  > "$(dirname "$jar")/release.json"
echo "Signed $plugin $version ($sha)"
