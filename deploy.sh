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

# Wait for containers to be running
echo "⏳ Waiting for containers to start..."
sleep 5

# Check if containers are running
if ! docker compose ps | grep -q "coinflip-app.*Up"; then
    echo "❌ coinflip-app container failed to start"
    docker compose logs --tail=50 coinflip-app
    exit 1
fi

# Test if the app is actually responding
echo "🔍 Testing application response..."
max_attempts=10
attempt=0
until curl -f http://localhost:80 > /dev/null 2>&1 || [ $attempt -eq $max_attempts ]; do
    attempt=$((attempt + 1))
    if [ $attempt -eq $max_attempts ]; then
        echo "❌ Application not responding on port 80"
        docker compose logs --tail=50 coinflip-app
        exit 1
    fi
    echo "   Attempt $attempt/$max_attempts..."
    sleep 2
done

echo "✅ Application is responding!"

# Clean up old Docker images to save space
echo "🧹 Cleaning up old images..."
docker image prune -f

echo "✅ Deployment complete!"
echo "📊 Service status:"
docker compose ps
