FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV BRIDGE_HOME=/data/cc-bridge-feishu
ENV CODEX_HOME=/data/cc-bridge-feishu/.codex
ENV CLAUDE_CONFIG_DIR=/data/cc-bridge-feishu/.claude
# Claude Code CLI refuses to run with --dangerously-skip-permissions under
# uid 0 even though our entrypoint drops to the `node` user. IS_SANDBOX=1
# is the documented escape hatch and keeps us safe if the drop ever fails.
ENV IS_SANDBOX=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm install -g @openai/codex@0.130.0 @anthropic-ai/claude-code@2.1.139
COPY --from=build /app/dist dist/
COPY scripts/ scripts/

RUN chmod +x scripts/docker-entrypoint.sh \
  && mkdir -p /data/cc-bridge-feishu \
  && chown -R node:node /app /data

EXPOSE 3000
ENTRYPOINT ["scripts/docker-entrypoint.sh"]
CMD ["node", "dist/src/index.js"]
