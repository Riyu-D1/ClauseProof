# ClauseProof — deployable demo image.
#
#   docker build -t clauseproof .
#   docker run -p 3000:3000 \
#     -e NEXT_PUBLIC_SUPABASE_URL=... \
#     -e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... \
#     clauseproof
#
# Node 20 runtime + Python 3 (the triage engine, system/run, is Python).
# The private dataset (institutions/) is deliberately NOT in the image —
# /api/play and /api/proof-run fall back to the bundled synthetic
# demo/institutions subset. Queue/case pages serve the pre-generated
# web/public/data traces. PORT env is honoured (Render injects it).

# ---------------------------------------------------------------- build
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci --no-audit --no-fund
COPY web ./web
RUN cd web && npm run build && npm prune --omit=dev

# ---------------------------------------------------------------- runtime
FROM node:20-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app
COPY --from=build /app/web ./web
COPY system ./system
COPY demo ./demo
RUN ln -s /app/demo/institutions /app/institutions
COPY output/traces ./output/traces
COPY output/repro.json ./output/repro.json

WORKDIR /app/web
EXPOSE 3000

# next start honours PORT; flag kept explicit so the contract is obvious
CMD ["sh", "-c", "exec node_modules/.bin/next start --hostname \"${HOSTNAME:-0.0.0.0}\" --port \"${PORT:-3000}\""]
