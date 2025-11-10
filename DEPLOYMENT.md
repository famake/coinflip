# Coinflip Deployment Guide

Complete guide for setting up automated Docker-based deployment with SSL certificates and GitHub Actions self-hosted runner.

## 🎯 Overview

This setup provides:
- **Docker Compose** for container orchestration
- **SWAG** (Secure Web Application Gateway) for automatic SSL/TLS certificates via Let's Encrypt
- **GitHub Actions Self-Hosted Runner** for automated deployments
- **Zero-downtime deployments** when pushing to main branch

---

## 📋 Prerequisites

- Ubuntu Server (20.04 LTS or newer recommended)
- Domain name pointing to your server's IP address
- Ports 80 and 443 open in firewall
- Minimum 2GB RAM, 20GB disk space

---

## 🔧 Server Setup

### 1. Initial Server Preparation

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install -y curl git ufw

# Configure firewall
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
```

### 2. Install Docker

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to docker group (logout/login required after this)
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify installations
docker --version
docker-compose --version

# Log out and log back in for group changes to take effect
exit
# SSH back into your server
```

### 3. Clone Repository

```bash
# Create deployment directory
sudo mkdir -p /opt/coinflip
sudo chown $USER:$USER /opt/coinflip

# Clone your repository
cd /opt/coinflip
git clone https://github.com/famake/coinflip.git .
```

### 4. Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit with your domain and email
nano .env
```

Update these values in `.env`:
```env
DOMAIN=your-domain.com
SUBDOMAINS=www
EMAIL=your-email@example.com
```

**Important DNS Setup:**
- Ensure your domain's A record points to your server's public IP
- If using www subdomain, create a CNAME record: `www` → `your-domain.com`
- Wait for DNS propagation (can take 5-60 minutes)

### 5. Make Deploy Script Executable

```bash
chmod +x deploy.sh
```

---

## 🤖 GitHub Actions Self-Hosted Runner Setup

GitHub Actions supports self-hosted runners that run on your own infrastructure. This is similar to GitLab Runner.

### 1. Create Runner on GitHub

1. Go to your repository on GitHub: `https://github.com/famake/coinflip`
2. Navigate to **Settings** → **Actions** → **Runners**
3. Click **New self-hosted runner**
4. Select **Linux** and **x64** architecture
5. Follow the commands shown (or use the script below)

### 2. Install and Configure Runner

```bash
# Create a folder for the runner
cd /opt/coinflip
mkdir actions-runner && cd actions-runner

# Download the latest runner package
curl -o actions-runner-linux-x64-2.311.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.311.0/actions-runner-linux-x64-2.311.0.tar.gz

# Extract the installer
tar xzf ./actions-runner-linux-x64-2.311.0.tar.gz

# Create the runner and start the configuration
# Replace TOKEN with the token from GitHub's "New self-hosted runner" page
./config.sh --url https://github.com/famake/coinflip --token YOUR_RUNNER_TOKEN_HERE

# When prompted:
# - Enter runner name: coinflip-production
# - Enter runner labels (comma separated): self-hosted,linux,x64,production
# - Press Enter for default work folder
```

### 3. Install Runner as a Service

```bash
# Install the service (runs as systemd service)
sudo ./svc.sh install

# Start the service
sudo ./svc.sh start

# Check status
sudo ./svc.sh status

# Enable auto-start on boot
sudo systemctl enable actions.runner.famake-coinflip.coinflip-production.service
```

### 4. Verify Runner

1. Go back to GitHub → Settings → Actions → Runners
2. You should see your runner listed with a green "Idle" status
3. If it shows "Offline", check the service: `sudo ./svc.sh status`

---

## 🚀 Initial Deployment

### 1. First-Time Setup

```bash
# Navigate to project directory
cd /opt/coinflip

# Create necessary directories
mkdir -p swag-config

# Start services for the first time
docker-compose up -d

# Monitor logs to ensure SSL certificate is obtained
docker-compose logs -f swag

# Look for: "Server ready" and certificate generation messages
# Press Ctrl+C to stop following logs
```

**First Launch Notes:**
- SWAG will automatically request SSL certificates from Let's Encrypt
- This process can take 1-5 minutes
- Certificates are stored in `./swag-config` and auto-renewed

### 2. Verify Deployment

```bash
# Check container status
docker-compose ps

# Both containers should show "Up" and "healthy"

# Test HTTP redirect (should redirect to HTTPS)
curl -I http://your-domain.com

# Test HTTPS (should return 200 OK)
curl -I https://your-domain.com

# Open in browser
# https://your-domain.com
```

---

## 🔄 Automated Deployments

Once the runner is set up, deployments are automatic:

### How It Works

1. You push code to the `main` branch:
   ```bash
   git add .
   git commit -m "Update coin collection app"
   git push origin main
   ```

2. GitHub Actions detects the push and triggers the workflow

3. The self-hosted runner:
   - Checks out the latest code
   - Runs `deploy.sh` which:
     - Pulls latest changes
     - Rebuilds Docker images
     - Restarts containers
     - Waits for health checks
   - Verifies deployment succeeded

4. Your site is updated with zero downtime!

### Monitor Deployments

- View deployment logs: GitHub → Actions tab → Select workflow run
- View container logs: `docker-compose logs -f`
- Check runner logs: `sudo journalctl -u actions.runner.*.service -f`

---

## 🛠️ Maintenance Commands

### Docker Compose Commands

```bash
# View logs
docker-compose logs -f

# Restart services
docker-compose restart

# Stop services
docker-compose stop

# Start services
docker-compose start

# Rebuild and restart
docker-compose up -d --build

# View resource usage
docker stats
```

### Runner Management

```bash
cd /opt/coinflip/actions-runner

# Stop runner
sudo ./svc.sh stop

# Start runner
sudo ./svc.sh start

# Check status
sudo ./svc.sh status

# Uninstall runner (if needed)
sudo ./svc.sh uninstall
```

### SSL Certificate Management

```bash
# View certificate expiry
docker exec swag cat /config/etc/letsencrypt/live/YOUR_DOMAIN/README

# Force certificate renewal (SWAG auto-renews at 30 days remaining)
docker exec swag certbot renew --force-renewal
docker-compose restart swag

# View SWAG logs
docker-compose logs swag
```

### Troubleshooting

```bash
# Check if ports are open
sudo netstat -tlnp | grep -E ':(80|443)'

# Test DNS resolution
nslookup your-domain.com

# Check firewall
sudo ufw status

# View detailed container logs
docker-compose logs --tail=100 coinflip-app
docker-compose logs --tail=100 swag

# Restart everything
docker-compose down && docker-compose up -d

# Check disk space
df -h
docker system df

# Clean up old images/containers
docker system prune -a --volumes
```

---

## 🔒 Security Best Practices

### 1. Server Hardening

```bash
# Disable root SSH login
sudo nano /etc/ssh/sshd_config
# Set: PermitRootLogin no
sudo systemctl restart sshd

# Enable automatic security updates
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades

# Install fail2ban to prevent brute force attacks
sudo apt install fail2ban
sudo systemctl enable fail2ban
```

### 2. Docker Security

```bash
# Limit log file sizes (add to /etc/docker/daemon.json)
sudo nano /etc/docker/daemon.json
```

Add:
```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

```bash
sudo systemctl restart docker
```

### 3. SSL/TLS Configuration

SWAG uses Mozilla's modern SSL configuration by default, which includes:
- TLS 1.2 and 1.3 only
- Strong cipher suites
- HSTS headers
- OCSP stapling

Check your SSL rating: https://www.ssllabs.com/ssltest/

---

## 📊 Monitoring

### Basic Health Checks

```bash
# Create a monitoring script
cat > /opt/coinflip/health-check.sh << 'EOF'
#!/bin/bash
DOMAIN="your-domain.com"

if curl -sf https://$DOMAIN > /dev/null; then
    echo "✅ Site is UP"
else
    echo "❌ Site is DOWN"
    # Add notification here (email, Slack, Discord, etc.)
fi
EOF

chmod +x /opt/coinflip/health-check.sh

# Add to crontab (check every 5 minutes)
crontab -e
# Add line: */5 * * * * /opt/coinflip/health-check.sh
```

### Log Rotation

Docker Compose handles log rotation automatically with the settings in docker daemon.json.

---

## 🔄 Updating the System

### Update Application

Just push to GitHub:
```bash
git push origin main
# Automatic deployment happens via GitHub Actions
```

### Update Docker Images

```bash
cd /opt/coinflip

# Update SWAG
docker-compose pull swag
docker-compose up -d swag

# Rebuild app
docker-compose build --no-cache coinflip-app
docker-compose up -d coinflip-app
```

### Update Runner

```bash
cd /opt/coinflip/actions-runner
sudo ./svc.sh stop
./run.sh --once  # This will trigger auto-update if available
sudo ./svc.sh start
```

---

## 🆘 Emergency Procedures

### Rollback Deployment

```bash
cd /opt/coinflip

# Revert to previous commit
git log --oneline  # Find the commit hash
git reset --hard <previous-commit-hash>

# Redeploy
./deploy.sh
```

### Complete Reset

```bash
cd /opt/coinflip

# Stop and remove everything
docker-compose down -v

# Pull latest code
git fetch origin
git reset --hard origin/main

# Start fresh
docker-compose up -d
```

---

## 📞 Support

If you encounter issues:

1. Check logs: `docker-compose logs -f`
2. Verify DNS: `nslookup your-domain.com`
3. Test firewall: `sudo ufw status`
4. Check runner: `sudo ./svc.sh status` (in actions-runner directory)
5. Review GitHub Actions logs in the Actions tab

---

## 📚 Additional Resources

- [Docker Docs](https://docs.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/)
- [SWAG Documentation](https://docs.linuxserver.io/images/docker-swag)
- [GitHub Actions Self-Hosted Runners](https://docs.github.com/en/actions/hosting-your-own-runners)
- [Let's Encrypt](https://letsencrypt.org/docs/)

---

## ✅ Quick Reference

```bash
# Start everything
docker-compose up -d

# View logs
docker-compose logs -f

# Restart app only
docker-compose restart coinflip-app

# Full rebuild
docker-compose down && docker-compose up -d --build

# Runner status
cd /opt/coinflip/actions-runner && sudo ./svc.sh status

# Manual deployment
cd /opt/coinflip && ./deploy.sh
```

**Congratulations!** Your coinflip app is now deployed with automatic SSL certificates and CI/CD! 🎉
