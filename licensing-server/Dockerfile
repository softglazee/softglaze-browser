# SoftGlaze licensing server image.
# Audit L14: reproducible installs from the lockfile, no dev dependencies in the
# runtime image, and the server does not run as root.

# --- Build stage -------------------------------------------------------------
# Full install from the lockfile: the prisma CLI is a devDependency and is needed to
# generate the client (npm ci runs the postinstall `prisma generate`, so the schema
# is copied first). docker-compose also runs this stage once as the `migrate`
# service (`prisma migrate deploy`), so the runtime image never carries the CLI.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci && npx prisma generate
USER node

# --- Runtime stage -----------------------------------------------------------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# --ignore-scripts: the postinstall `prisma generate` needs the CLI, which is not
# installed here; the generated client (with its engine) comes from the build stage.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts

USER node
EXPOSE 8787
CMD ["node", "src/server.js"]
