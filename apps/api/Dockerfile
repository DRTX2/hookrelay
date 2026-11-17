FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter api
COPY apps/api apps/api
RUN pnpm --filter api build && pnpm --filter api deploy --prod --legacy /out

FROM node:24-alpine
# Runtime hardening: patch OS packages and drop package managers the app never uses at runtime
# (npm bundles its own dependencies, which is where most base-image CVEs live).
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/node_modules node_modules
COPY --from=build /repo/apps/api/dist dist
COPY apps/api/package.json .
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
