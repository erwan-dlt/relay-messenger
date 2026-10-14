FROM node:22.16.0-bookworm-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22.16.0-bookworm-slim
ENV NODE_ENV=development
WORKDIR /app
COPY backend/package.json ./backend/
RUN cd backend && npm install --omit=dev --no-audit --no-fund
COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
RUN mkdir -p /app/backend/data && chown -R node:node /app/backend/data
USER node
EXPOSE 3000
CMD ["node", "backend/src/index.js"]
