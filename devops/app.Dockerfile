# Build context is the repo root: docker build -f devops/app.Dockerfile -t everletter-app .

FROM node:22-alpine AS base
RUN npm install -g pnpm@11.20.0

# deps and build run in one stage (not deps -> builder via COPY --from) because
# cross-stage COPY of the full node_modules tree hangs on this host's overlay2
# driver - COPY --from of small dirs works fine (proven below in the runner
# stage), it's specifically large/many-file directories that are affected.
# Caching is unaffected: this layer only reruns when package.json/pnpm-lock.yaml
# change, same as a separate deps stage would.
FROM base AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
