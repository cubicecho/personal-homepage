# syntax=docker/dockerfile:1

FROM node:26-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Generated files are not in the tree, so `build` runs codegen before Vite.
RUN npm run build

# Optional: docker build --target test
FROM builder AS test
CMD ["npm", "test"]

FROM node:26-slim AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The server isn't compiled. Its sources are the build output. Migrations run on boot.
COPY server server
COPY drizzle drizzle
COPY --from=builder /app/dist dist

ENV NODE_ENV=production
ENV PORT=3000
# The built-in database and caches. Created and owned by node before VOLUME, so a new named volume is writable.
ENV DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so node is PID 1 and gets SIGTERM itself (stopOnSignals).
CMD ["node", "server/index.ts"]
