#!/bin/bash
set -euo pipefail

# Simplified deployment script for static coinflip site (nginx + coin-images)
# Assumes this repo contains docker-compose.yml with a single 'web' service

SERVICE=web
PORT=80
PROJECT_DIR=/opt/coinflip

echo "🚀 Starting deployment (service: $SERVICE, port: $PORT)..."

cd "$PROJECT_DIR"

echo "📥 Updating source..."
git fetch origin
git reset --hard origin/main

# Ensure required files exist
for f in docker-compose.yml nginx.conf index.html app.js styles.css; do
    if [ ! -f "$f" ]; then
        echo "❌ Missing required file: $f"; exit 1
    fi
done

# Ensure coin-images directory exists
if [ ! -d coin-images ]; then
    echo "📁 Creating coin-images directory..."
    mkdir -p coin-images
fi

echo "🐳 Pulling latest image(s)..."
docker compose pull "$SERVICE" || true

echo "🔄 Starting / updating container..."
docker compose up -d "$SERVICE"

echo "⏳ Waiting for container to report 'Up'..."
sleep 4
if ! docker compose ps | grep -q "$SERVICE.*Up"; then
    echo "❌ $SERVICE container not Up"
    docker compose logs --tail=80 "$SERVICE"
    exit 1
fi

echo "🔍 Health check on http://localhost:$PORT/index.html"
max_attempts=10
attempt=0
until curl -fsS "http://localhost:$PORT/index.html" > /dev/null 2>&1 || [ $attempt -ge $max_attempts ]; do
    attempt=$((attempt+1))
    echo "   Attempt $attempt/$max_attempts..."
    sleep 2
done

if [ $attempt -ge $max_attempts ]; then
    echo "❌ Site did not respond on port $PORT"
    docker compose logs --tail=80 "$SERVICE"
    exit 1
fi

echo "✅ Site responding. Listing coin-images (if any):"
ls -1 coin-images || true

echo "🧹 Pruning unused images..."
docker image prune -f >/dev/null || true

echo "📊 Service status:"
docker compose ps

echo "✅ Deployment complete! Access: http://<host>:$PORT/"
echo "📄 To add images: copy files into coin-images/ then 'docker compose restart $SERVICE' (or they appear immediately if volume mounted)."
