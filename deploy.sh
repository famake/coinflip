#!/bin/bash
set -euo pipefail

# Deployment script for coinflip application
# This script is called by GitHub Actions runner after code is pulled

echo "🚀 Starting deployment..."

# Navigate to project directory (should already be there but ensure it)
cd /opt/coinflip

# Pull latest changes (should already be done by Actions, but safety check)
echo "📥 Ensuring latest code..."
git fetch origin
git reset --hard origin/main

# Verify .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please create .env from .env.example with your domain and email"
    exit 1
fi

# Build and deploy with Docker Compose
echo "🐳 Building Docker images..."
docker compose build --no-cache coinflip-app

echo "🔄 Restarting services..."
docker compose up -d

# Wait for health check
echo "⏳ Waiting for application to be healthy..."
for i in {1..30}; do
    if docker inspect --format='{{.State.Health.Status}}' coinflip-app 2>/dev/null | grep -q "healthy"; then
        echo "✅ Application is healthy!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Application failed to become healthy"
        docker compose logs --tail=50 coinflip-app
        exit 1
    fi
    echo "   Attempt $i/30..."
    sleep 2
done

# Clean up old Docker images to save space
echo "🧹 Cleaning up old images..."
docker image prune -f

echo "✅ Deployment complete!"
echo "📊 Service status:"
docker compose ps
