FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter api
COPY apps/api apps/api
RUN pnpm --filter api build && pnpm --filter api deploy --prod --legacy /out

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/node_modules node_modules
COPY --from=build /repo/apps/api/dist dist
COPY apps/api/package.json .
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
