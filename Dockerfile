# Single-service image for deployment (Render): builds the React app, then runs the
# Express API, which also serves those built files. Local development keeps using
# docker-compose.yml with separate api/web containers.

# 1. Build the frontend into static files.
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2. The API, plus the built frontend in ./public.
FROM node:22-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
COPY --from=web /web/dist ./public
ENV STATIC_DIR=/app/public
EXPOSE 3000
CMD ["npm", "start"]
