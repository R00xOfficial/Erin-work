# Worker image for Railway. Build context must be the repository root:
#   docker build -f apps/worker/Dockerfile .
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @ajis/worker... --prod=false

FROM deps AS build
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm -r --filter @ajis/shared --filter @ajis/db --filter @ajis/worker build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
