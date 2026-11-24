# DJ's ERP - Accounting (XianFire / Express / Sequelize) as a container.
# Build and run with the compose file next to this one:  docker compose up -d --build
FROM node:20-bookworm-slim

# mysql / mysqldump: used by Admin > Backup and Restore inside the container.
RUN apt-get update \
 && apt-get install -y --no-install-recommends default-mysql-client \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
RUN mkdir -p storage/receipts storage/backups storage/logs \
 && chown -R node:node /app

# Runs as the unprivileged "node" user, not root.
USER node
ENV NODE_ENV=production \
    PORT=3000
EXPOSE 3000

# Healthy = the app answers and MySQL is online (the health check asks the database).
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["sh", "docker/entrypoint.sh"]
