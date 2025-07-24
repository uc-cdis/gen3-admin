#!/bin/bash

set -e  # Exit on any error

# Check if grafana repo exists
if ! helm repo list | grep -q "helm.gen3.org"; then
    echo "Adding gen3 helm repository..."
    helm repo add gen3 https://helm.gen3.org
    helm repo update
fi

# Install or upgrade the monitoring release
echo "Installing/upgrading alloy release..."
helm upgrade --install cluster-level-resources -n monitoring gen3/cluster-level-resources -f values.yaml --create-namespace
