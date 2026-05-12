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
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm install -g @openai/codex@0.130.0 @anthropic-ai/claude-code@2.1.139
COPY --from=build /app/dist dist/
COPY scripts/ scripts/
EXPOSE 3000
CMD ["node", "dist/src/index.js"]
