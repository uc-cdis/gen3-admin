#!/bin/bash

# Build images in the background
docker build -t quay.io/cdis/csoc-frontend -f Dockerfile.frontend . --platform linux/amd64 &
docker build -t quay.io/cdis/csoc-api -f Dockerfile.api . --platform linux/amd64 &
docker build -t quay.io/cdis/csoc-agent -f Dockerfile.agent . --platform linux/amd64 &

# Wait for all background jobs to finish
wait

echo "All images built successfully. Pushing to registry..."

# Push images to the registry
docker push quay.io/cdis/csoc-frontend &
docker push quay.io/cdis/csoc-api &
docker push quay.io/cdis/csoc-agent &

# Wait for all push operations to finish
wait

echo "All images pushed successfully."
