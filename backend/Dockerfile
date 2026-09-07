FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --production --no-audit --no-fund
COPY backend/ ./
COPY tariff-rules/ /tariff-rules/
ENV PORT=8080
ENV NODE_OPTIONS=--max-old-space-size=1536
EXPOSE 8080
CMD ["npx", "tsx", "src/index.ts"]
