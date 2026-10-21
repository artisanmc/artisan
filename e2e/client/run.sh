#!/usr/bin/env bash
# Joue les scénarios du mod client de test contre un vrai serveur Paper :
# monte un serveur jetable (plugin + projet de test), lance le client Fabric via
# HeadlessMC avec un compte offline, puis lit le fichier résultat écrit par le mod.
#
# Variables (toutes obligatoires sauf WORK, JAVA et EXTRA_PLUGINS) :
#   PAPER_JAR   JAR du serveur Paper (même version Minecraft que le mod)
#   PLUGIN_JAR  plugin/build/libs/artisan-plugin-*-all.jar
#   MOD_JAR     e2e/client/mod/build/libs/artisan-e2e-client-*.jar
#   HMC_JAR     JAR « runner » de HeadlessMC
#   MC_VERSION  version Minecraft à lancer (ex. 26.2)
#   JAVA        java 25+ (défaut : java du PATH)
#   WORK        dossier de travail (défaut : e2e/client/build)
#   EXTRA_PLUGINS  JARs à installer à côté d'Artisan, séparés par des espaces
#                  (ex. le plugin PacketEvents autonome)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
: "${PAPER_JAR:?}" "${PLUGIN_JAR:?}" "${MOD_JAR:?}" "${HMC_JAR:?}" "${MC_VERSION:?}"
JAVA="${JAVA:-java}"
WORK="${WORK:-$HERE/build}"
SERVER="$WORK/server"
CLIENT="$WORK/client"
RESULT="$WORK/result.txt"
# Compte offline par défaut de HeadlessMC : nom « Offline », UUID offline Paper.
PLAYER_NAME="Offline"
PLAYER_UUID="912c6f84-446d-3039-8711-7608ef7feac4"

rm -rf "$SERVER" "$CLIENT/mods" "$RESULT"
mkdir -p "$SERVER/plugins/Artisan/projects" "$CLIENT/mods"

# --- Serveur ---------------------------------------------------------------
cp "$PAPER_JAR" "$SERVER/paper.jar"
cp "$PLUGIN_JAR" "$SERVER/plugins/"
for jar in ${EXTRA_PLUGINS:-}; do cp "$jar" "$SERVER/plugins/"; done
cp -r "$HERE/fixtures/projects/." "$SERVER/plugins/Artisan/projects/"
echo "eula=true" > "$SERVER/eula.txt"
cat > "$SERVER/server.properties" <<EOF
online-mode=false
enforce-secure-profile=false
spawn-protection=0
view-distance=2
simulation-distance=2
generate-structures=false
EOF
# Le scénario se donne ses objets avec /give : le joueur doit être op.
cat > "$SERVER/ops.json" <<EOF
[{"uuid":"$PLAYER_UUID","name":"$PLAYER_NAME","level":4,"bypassesPlayerLimit":false}]
EOF

SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

start=$(date +%s)
(cd "$SERVER" && exec "$JAVA" -Xmx1G -jar paper.jar --nogui < /dev/null > server.log 2>&1) &
SERVER_PID=$!

for _ in $(seq 1 300); do
  grep -aq 'Done (' "$SERVER/server.log" 2>/dev/null && break
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "Paper stopped during startup"; tail -50 "$SERVER/server.log"; exit 1; }
  sleep 1
done
grep -aq 'Done (' "$SERVER/server.log" || { echo "Paper did not start in 300 s"; tail -50 "$SERVER/server.log"; exit 1; }
grep -aq 'Artisan .* enabled' "$SERVER/server.log" || { echo "Artisan did not enable"; tail -80 "$SERVER/server.log"; exit 1; }
echo "server ready in $(( $(date +%s) - start )) s"

# --- Client ----------------------------------------------------------------
cp "$MOD_JAR" "$CLIENT/mods/"
HMC=("$JAVA" -Dhmc.jline.enabled=false "-Dhmc.files.game=$CLIENT" -jar "$HMC_JAR")
"${HMC[@]}" install fabric "$MC_VERSION"

client_start=$(date +%s)
# -lwjgl : aucun rendu, pas besoin d'écran ni de GPU.
timeout 600 "${HMC[@]}" launch fabric "$MC_VERSION" -lwjgl --offline \
  --jvm "-Xmx2G -Dartisan.e2e.server=localhost:25565 -Dartisan.e2e.result=$RESULT" \
  > "$WORK/client.log" 2>&1 || true
echo "client ran for $(( $(date +%s) - client_start )) s"

# --- Verdict ---------------------------------------------------------------
if [ ! -f "$RESULT" ]; then
  echo "no result file: the client never finished its scenario"
  tail -80 "$WORK/client.log"
  exit 1
fi
cat "$RESULT"
tail -1 "$RESULT" | grep -q '^RESULT PASS$'
