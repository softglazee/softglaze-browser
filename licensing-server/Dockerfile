# SoftGlaze licensing server image.
FROM node:20-alpine
WORKDIR /app

# Install deps (prisma CLI is a devDep, needed for `prisma generate`/`db push`).
COPY package.json ./
RUN npm install

# Generate the Prisma client against the schema.
COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
COPY scripts ./scripts

ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "src/server.js"]
