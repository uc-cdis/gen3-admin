#!/bin/bash

set -e  # Exit on any error

# Check if grafana repo exists
if ! helm repo list | grep -q "grafana.github.io"; then
    echo "Adding grafana helm repository..."
    helm repo add grafana https://grafana.github.io/helm-charts
    helm repo update
fi

# Install or upgrade the monitoring release
echo "Installing/upgrading monitoring release..."
helm upgrade --install monitoring -n monitoring grafana/lgtm-distributed -f values.yaml --create-namespace
