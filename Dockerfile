# ---- Build Stage ----
FROM node:20-alpine AS builder

ENV TZ=Asia/Shanghai
ENV CI=true

WORKDIR /usr/src/app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files first for better layer caching
COPY package.json pnpm-lock.yaml .npmrc ./
COPY prisma ./prisma/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma client and build
RUN pnpm run build

# ---- Production Stage ----
FROM node:20-alpine

ENV TZ=Asia/Shanghai
ENV NODE_ENV=production

WORKDIR /usr/src/app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files and install production deps only
COPY package.json pnpm-lock.yaml .npmrc ./
COPY prisma ./prisma/
RUN pnpm install --frozen-lockfile --prod
RUN npx prisma generate

# Copy build output from builder stage
COPY --from=builder /usr/src/app/dist ./dist

# Create upload directory
RUN mkdir -p upload

EXPOSE 3000

CMD ["node", "dist/src/main.js"]
