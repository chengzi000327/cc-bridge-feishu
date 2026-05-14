#!/bin/sh
# Container entrypoint. Runs as root just long enough to prepare the
# Railway volume, then drops to the non-root `node` user before exec-ing
# the actual service. The drop matters because Claude Code CLI refuses
# to run with --dangerously-skip-permissions under uid 0.

set -e

: "${BRIDGE_HOME:=/data/cc-bridge-feishu}"
: "${CODEX_HOME:=$BRIDGE_HOME/.codex}"
: "${CLAUDE_CONFIG_DIR:=$BRIDGE_HOME/.claude}"

mkdir -p "$BRIDGE_HOME" "$CODEX_HOME" "$CLAUDE_CONFIG_DIR"

if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$BRIDGE_HOME"
  exec gosu node "$@"
fi

exec "$@"
