# Deploying Chess Clock UNO

This guide covers deploying Chess Clock UNO using Nix flakes and Docker Compose.

## Prerequisites

- [Nix](https://nixos.org/download.html) with flakes enabled
- Docker and Docker Compose (for containerized deployment)

## Quick Start with Nix

### Development Environment

```bash
# Enter development shell with all dependencies
nix develop

# Install dependencies
bun install

# Start server (terminal 1)
cd server && bun run dev

# Start client (terminal 2)
cd client && bun run dev
```

### Build Packages

```bash
# Build server
nix build .#serverBuild

# Build client (static files)
nix build .#clientBuild
```

## Docker Deployment

### Option 1: Build Images with Nix (Recommended)

Nix builds reproducible Docker images without needing Dockerfiles.

```bash
# Build Docker images
nix build .#serverImage
nix build .#clientImage

# Load images into Docker
docker load < result  # Run after each nix build command

# Or build and load in one step
nix build .#serverImage && docker load < result
nix build .#clientImage && docker load < result

# Verify images are loaded
docker images | grep ccu
```

### Option 2: Start with Docker Compose

After building and loading the images:

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Service URLs

- **Client**: http://localhost:80
- **Server**: http://localhost:3000

## Configuration

### Environment Variables

**Server:**
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `AVATAR_DIR` | `/app/avatars` | Directory for avatar uploads |

### Client Configuration

The client connects to the server URL specified by the user in the UI. For production, users should enter your server's public URL (e.g., `https://api.yourdomain.com`).

## Production Deployment

### With Reverse Proxy (Caddy)

1. Build and deploy the containers
2. Configure Caddy to:
   - Serve client on your domain (e.g., `ccu.vc`)
   - Proxy WebSocket connections to server (e.g., `api.ccu.vc` -> `localhost:3000`)

A `Caddyfile` is included in this repository. Edit it to replace `YOUR_DOMAIN` with your actual domain:

```bash
# Edit the Caddyfile
sed -i 's/YOUR_DOMAIN/ccu.vc/g' Caddyfile

# Reload Caddy
caddy reload
```

Or use the Caddyfile directly in your Caddy config:

```caddyfile
ccu.vc {
    root * /path/to/client/dist
    file_server
    try_files {path} /index.html
    encode gzip
}

api.ccu.vc {
    reverse_proxy localhost:3000
}
```

Caddy automatically handles HTTPS certificates via Let's Encrypt.

### Persistent Storage

The `docker-compose.yml` includes a volume for avatar storage. For production, ensure this volume is backed up.

## Updating

```bash
# Pull latest changes
git pull

# Rebuild images
nix build .#serverImage && docker load < result
nix build .#clientImage && docker load < result

# Restart services
docker-compose down
docker-compose up -d
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker-compose logs server
docker-compose logs client
```

### WebSocket connection fails

Caddy v2 handles WebSocket upgrades automatically. If you're using an older version or custom config, ensure WebSocket support is enabled. Check that your client is connecting to the correct server URL (e.g., `https://api.ccu.vc`).

### Nix build fails

```bash
# Update flake inputs
nix flake update

# Clear Nix cache if needed
nix-collect-garbage -d
```
