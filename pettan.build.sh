#!/bin/sh
set -e

cd "$(dirname "$0")"

echo "=== Building server image ==="
nix build .#serverImage
echo "Loading server image..."
docker load -i result

echo ""
echo "=== Building client image ==="
nix build .#clientImage
echo "Loading client image..."
docker load -i result

echo ""
echo "=== Retagging as latest ==="
# Extract version from flake.nix
VERSION=$(grep 'version = "' flake.nix | head -1 | sed 's/.*version = "\([^"]*\)".*/\1/')

echo "Tagging ccu-server:${VERSION} as ccu-server:latest"
docker tag "ccu-server:${VERSION}" ccu-server:latest

echo "Tagging ccu-client:${VERSION} as ccu-client:latest"
docker tag "ccu-client:${VERSION}" ccu-client:latest

echo ""
echo "=== Cleanup (optional - remove old <none> images) ==="
docker image prune -f

echo ""
echo "Done! Images:"
docker image ls ccu-client ccu-server
