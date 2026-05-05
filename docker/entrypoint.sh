#!/bin/sh
set -e

mkdir -p plugins/Interfaze

cat > plugins/Interfaze/config.yml <<EOF
server_key: "${INTERFAZE_SERVER_KEY:-}"
ws_url: "${INTERFAZE_WS_URL:-ws://backend:3001/ws/plugin}"
packs_dir: "plugins/Interfaze/packs"
EOF

exec java -Xmx1G -Xms1G -jar paper.jar nogui
