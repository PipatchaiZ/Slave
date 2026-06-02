# Multi-stage build — works on HF Spaces, Fly.io, Koyeb, Render (Docker), any container host.
FROM node:20-alpine AS build
WORKDIR /app
COPY . .
RUN npm install --include=dev && npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
# Runtime needs node_modules (express/socket.io/nanoid) + the built bundles.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
# HF Spaces (and good practice generally): run as non-root, uid 1000.
USER node
EXPOSE 3001
CMD ["node", "apps/server/dist/index.js"]
