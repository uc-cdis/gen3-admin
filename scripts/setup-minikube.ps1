<#
.SYNOPSIS
    Spin up Minikube and deploy the CSOC portal via Helm on Windows 11.

.DESCRIPTION
    PowerShell equivalent of setup-minikube.sh.
    Requires an elevated (Administrator) PowerShell session to modify the
    Windows hosts file.  All external tools (minikube, kubectl, helm, docker)
    must already be installed and on the PATH.

.PARAMETER Teardown
    Tear everything down: uninstall Helm release, clean hosts entries, stop Minikube.

.PARAMETER Status
    Show the current environment status without making any changes.

.PARAMETER ClusterOnly
    Start Minikube only; skip the Helm deploy.

.PARAMETER Keycloak
    Install Keycloak via the Keycloak operator (default: off, uses MOCK_AUTH).

.PARAMETER ApiTag
    Override the API Docker image tag (default: feat_bootstrap-onboarding-impl).

.PARAMETER FrontendTag
    Override the Frontend Docker image tag (default: feat_bootstrap-onboarding-impl).

.PARAMETER Namespace
    Kubernetes namespace (default: csoc).

.PARAMETER Release
    Helm release name (default: csoc).

.PARAMETER Help
    Show this help message.

.EXAMPLE
    .\setup-minikube.ps1                         # Full setup + deploy
    .\setup-minikube.ps1 -Keycloak               # Setup with Keycloak operator
    .\setup-minikube.ps1 -ClusterOnly            # Only start Minikube
    .\setup-minikube.ps1 -ApiTag latest          # Use 'latest' tag for API
    .\setup-minikube.ps1 -Teardown               # Tear down
    .\setup-minikube.ps1 -Status                 # Show status
#>
[CmdletBinding()]
param(
    [switch]$Teardown,
    [switch]$Status,
    [switch]$ClusterOnly,
    [switch]$Keycloak,
    # Defaults are resolved after the param block to support PS 5.1 and to treat
    # empty env vars the same as unset (unlike the ?? operator which only handles $null).
    [string]$ApiTag      = '',
    [string]$FrontendTag = '',
    [string]$Namespace   = '',
    [string]$Release     = '',
    [switch]$Help
)

$ErrorActionPreference = 'Stop'
# Prevent probe-style native calls (kubectl get … 2>$null) from terminating the
# script when $PSNativeCommandUseErrorActionPreference is enabled in the session.
if (Test-Path Variable:\PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $false
}

# Helper: return env var value when non-empty, otherwise return $Default.
function Get-EnvDefault { param([string]$EnvVar, [string]$Default)
    $v = [System.Environment]::GetEnvironmentVariable($EnvVar)
    if ([string]::IsNullOrEmpty($v)) { $Default } else { $v }
}

# Apply env-var overrides / hardcoded defaults for parameters that were not set.
if ([string]::IsNullOrEmpty($ApiTag))      { $ApiTag      = Get-EnvDefault 'API_IMAGE_TAG'      'feat_bootstrap-onboarding-impl' }
if ([string]::IsNullOrEmpty($FrontendTag)) { $FrontendTag = Get-EnvDefault 'FRONTEND_IMAGE_TAG' 'feat_bootstrap-onboarding-impl' }
if ([string]::IsNullOrEmpty($Namespace))   { $Namespace   = Get-EnvDefault 'NAMESPACE'          'csoc' }
if ([string]::IsNullOrEmpty($Release))     { $Release     = Get-EnvDefault 'RELEASE_NAME'       'csoc' }

# ── Config ────────────────────────────────────────────────────────────────────
$Script:MinikubeProfile   = Get-EnvDefault 'MINIKUBE_PROFILE' 'minikube'
$Script:HelmChart         = Get-EnvDefault 'CHART_PATH'       '.\helm\csoc'
$Script:ValuesFile        = '.\helm\csoc\values-test.yaml'
$Script:Hostname          = 'csoc.local'
$Script:Gen3Hostname      = 'gen3.local'
$Script:KeycloakHostname  = 'keycloak.local'
$Script:KeycloakOpDir     = '.\helm\keycloak-operator'
$Script:KeycloakCRDFile   = '.\helm\keycloak-bootstrap-operator\keycloak.yaml'
$Script:CnpgVersion       = '1.29.0'
$Script:ScriptDir         = $PSScriptRoot
$Script:ProjectRoot       = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Script:InstallKeycloak   = $Keycloak.IsPresent

# ── Logging helpers ───────────────────────────────────────────────────────────
function Write-Log  { param([string]$Msg) Write-Host "[setup] $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "  OK  $Msg"   -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "  !!  $Msg"   -ForegroundColor Yellow }
function Write-Die  {
    param([string]$Msg)
    Write-Host "  XX  $Msg" -ForegroundColor Red
    exit 1
}

# ── Elevation check ───────────────────────────────────────────────────────────
function Test-Elevated {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object System.Security.Principal.WindowsPrincipal($id)
    return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ── Invoke a native command and stop on non-zero exit ─────────────────────────
function Invoke-Native {
    param([string]$Cmd, [string[]]$CmdArgs)
    & $Cmd @CmdArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Die "'$Cmd $($CmdArgs -join ' ')' exited with code $LASTEXITCODE"
    }
}

# ── Pre-flight checks ─────────────────────────────────────────────────────────
function Test-Prerequisites {
    Write-Log "Checking prerequisites..."

    $missing = @()
    foreach ($tool in @('minikube', 'kubectl', 'helm', 'docker')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            $missing += $tool
        }
    }
    if ($missing.Count -gt 0) {
        Write-Die "Missing tools: $($missing -join ', '). Install them first."
    }

    $statusOut = minikube status -p $Script:MinikubeProfile 2>$null
    if ($statusOut -match 'Running') {
        Write-Ok "Minikube profile '$($Script:MinikubeProfile)' is already running"
    } else {
        Write-Log "Will start Minikube profile '$($Script:MinikubeProfile)'"
    }
}

# ── Minikube start ────────────────────────────────────────────────────────────
function Start-MinikubeCluster {
    $statusOut = minikube status -p $Script:MinikubeProfile 2>$null
    if ($statusOut -match 'Running') {
        Write-Warn "Minikube already running, skipping start"
        return
    }

    Write-Log "Starting Minikube (profile: $($Script:MinikubeProfile))..."
    # Note: --driver=docker requires Docker Desktop running on Windows.
    # Alternatively use --driver=hyperv if Hyper-V is preferred.
    Invoke-Native minikube @(
        'start',
        '-p', $Script:MinikubeProfile,
        '--driver=docker',
        '--cpus=4',
        '--memory=8192',
        '--disk-size=40g',
        '--kubernetes-version=v1.35',
        '--container-runtime=docker'
    )

    # Enable required addons
    Write-Log "Enabling addons..."
    minikube addons enable metrics-server -p $Script:MinikubeProfile 2>$null
    minikube addons enable ingress         -p $Script:MinikubeProfile 2>$null

    # Wait for ingress controller pod
    Write-Log "Waiting for nginx ingress controller pod..."
    $maxWait = 120; $waited = 0
    while ($waited -lt $maxWait) {
        $pods = kubectl get pods -n ingress-nginx 2>$null
        if ($pods -match 'Running') { break }
        Start-Sleep -Seconds 5
        $waited += 5
    }

    # Wait for the ingress admission webhook endpoint to be ready
    Write-Log "Waiting for nginx ingress admission webhook..."
    $maxWait = 120; $waited = 0
    while ($waited -lt $maxWait) {
        $ep = kubectl get endpoints ingress-nginx-controller-admission -n ingress-nginx 2>$null
        if ($ep -match '\d+\.\d+\.\d+\.\d+') { break }
        Start-Sleep -Seconds 3
        $waited += 3
    }

    Write-Ok "Minikube is ready"
}

# ── /etc/hosts helpers ────────────────────────────────────────────────────────
$Script:HostsFile = 'C:\Windows\System32\drivers\etc\hosts'

function Set-HostsEntry {
    param([string]$HostName, [string]$IP)

    if (-not (Test-Elevated)) {
        Write-Warn "Not running as Administrator — cannot modify $($Script:HostsFile)."
        Write-Warn "Add manually:  $IP  $HostName"
        return
    }

    $lines = Get-Content $Script:HostsFile
    $lines = $lines | Where-Object { $_ -notmatch "\s$([regex]::Escape($HostName))$" }
    $lines += "$IP  $HostName"
    Set-Content -Path $Script:HostsFile -Value $lines -Encoding ASCII
    Write-Ok "Added $HostName -> $IP to $($Script:HostsFile)"
}

function Remove-HostsEntry {
    param([string]$HostName)

    if (-not (Test-Elevated)) {
        Write-Warn "Not running as Administrator — cannot modify $($Script:HostsFile)."
        Write-Warn "Remove manually:  $HostName"
        return
    }

    $lines = Get-Content $Script:HostsFile -ErrorAction SilentlyContinue
    if (-not $lines) { return }
    $before = $lines.Count
    $lines = $lines | Where-Object { $_ -notmatch "\s$([regex]::Escape($HostName))$" }
    if ($lines.Count -lt $before) {
        Set-Content -Path $Script:HostsFile -Value $lines -Encoding ASCII
        Write-Ok "Removed $HostName from $($Script:HostsFile)"
    }
}

function Set-CSOCHosts {
    $ip = (minikube ip -p $Script:MinikubeProfile).Trim()
    Set-HostsEntry -HostName $Script:Hostname     -IP $ip
    Set-HostsEntry -HostName $Script:Gen3Hostname -IP $ip
}

function Set-KeycloakHosts {
    $ip = (minikube ip -p $Script:MinikubeProfile).Trim()
    Set-HostsEntry -HostName $Script:KeycloakHostname -IP $ip
}

# ── CloudNativePG operator ────────────────────────────────────────────────────
function Install-CNPG {
    $nsExists  = kubectl get namespace cnpg-system 2>$null
    $podsReady = kubectl get pods -n cnpg-system -l 'app.kubernetes.io/name=cloudnative-pg' 2>$null
    if ($nsExists -and ($podsReady -match 'Running')) {
        Write-Warn "CloudNativePG operator already installed"
        return
    }

    Write-Log "Installing CloudNativePG operator v$($Script:CnpgVersion)..."
    Invoke-Native kubectl @(
        'apply', '--server-side', '-f',
        "https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.29/releases/cnpg-$($Script:CnpgVersion).yaml"
    )

    Write-Log "Waiting for CloudNativePG controller..."
    Invoke-Native kubectl @(
        'rollout', 'status', 'deployment',
        '-n', 'cnpg-system', 'cnpg-controller-manager', '--timeout=120s'
    )

    Write-Ok "CloudNativePG operator ready"
}

# ── Keycloak via Operator (opt-in) ────────────────────────────────────────────
function Start-Keycloak {
    if (-not $Script:InstallKeycloak) {
        Write-Log "Keycloak not requested (-Keycloak to enable), using MOCK_AUTH mode"
        return
    }

    $kcExists  = kubectl get keycloak keycloak -n $Namespace 2>$null
    $kcRunning = kubectl get pods -n $Namespace -l 'app=keycloak' 2>$null
    if ($kcExists -and ($kcRunning -match 'Running')) {
        Write-Warn "Keycloak already running in cluster"
        Set-KeycloakHosts
        return
    }

    Write-Log "Installing Keycloak via Operator..."

    Install-CNPG

    $kcVersion = '26.6.1'
    Write-Log "Installing Keycloak Operator $kcVersion in namespace '$Namespace'..."
    kubectl create namespace $Namespace --dry-run=client -o yaml | kubectl apply -f - 2>$null
    Invoke-Native kubectl @('apply', '-f', "https://raw.githubusercontent.com/keycloak/keycloak-k8s-resources/$kcVersion/kubernetes/keycloaks.k8s.keycloak.org-v1.yml")
    Invoke-Native kubectl @('apply', '-f', "https://raw.githubusercontent.com/keycloak/keycloak-k8s-resources/$kcVersion/kubernetes/keycloakrealmimports.k8s.keycloak.org-v1.yml")
    Invoke-Native kubectl @('-n', $Namespace, 'apply', '-f', "https://raw.githubusercontent.com/keycloak/keycloak-k8s-resources/$kcVersion/kubernetes/kubernetes.yml")
    kubectl patch clusterrolebinding keycloak-operator-clusterrole-binding `
        --type='json' `
        -p="[{`"op`": `"replace`", `"path`": `"/subjects/0/namespace`", `"value`":`"$Namespace`"}]" 2>$null
    kubectl rollout restart deployment/keycloak-operator -n $Namespace 2>$null

    Write-Log "Waiting for Keycloak operator..."
    Invoke-Native kubectl @('rollout', 'status', 'deployment/keycloak-operator', '-n', $Namespace, '--timeout=120s')

    if (-not (Test-Path $Script:KeycloakCRDFile)) {
        Write-Die "Keycloak resource file not found: $($Script:KeycloakCRDFile)"
    }

    if ($Namespace -ne 'csoc') {
        $tmpFile = [System.IO.Path]::GetTempFileName()
        try {
            (Get-Content $Script:KeycloakCRDFile) -replace 'namespace: csoc', "namespace: $Namespace" |
                Set-Content $tmpFile -Encoding UTF8
            Invoke-Native kubectl @('apply', '-f', $tmpFile)
        } finally {
            Remove-Item $tmpFile -ErrorAction SilentlyContinue
        }
    } else {
        Invoke-Native kubectl @('apply', '-f', $Script:KeycloakCRDFile)
    }

    Write-Log "Waiting for PostgreSQL cluster (keycloak-db) to be ready..."
    Invoke-Native kubectl @('wait', '--for=condition=Ready', 'cluster/keycloak-db', '-n', $Namespace, '--timeout=300s')

    Write-Log "Waiting for Keycloak server pod..."
    Invoke-Native kubectl @('wait', '--for=condition=ready', 'pod', '-l', 'app=keycloak', '-n', $Namespace, '--timeout=300s')

    Write-Ok "Keycloak is ready"
    Set-KeycloakHosts
}

# ── Helm deploy ───────────────────────────────────────────────────────────────
function Deploy-CSOC {
    Push-Location $Script:ProjectRoot
    try {
        if (-not (Test-Path $Script:ValuesFile)) {
            Write-Die "Values file not found: $($Script:ValuesFile)"
        }

        Write-Log "Deploying CSOC portal via Helm..."
        Write-Log "  Chart:    $($Script:HelmChart)"
        Write-Log "  Values:   $($Script:ValuesFile)"
        Write-Log "  API tag:  $ApiTag"
        Write-Log "  FE tag:   $FrontendTag"

        $nsOut = kubectl get namespace $Namespace 2>$null
        if (-not ($nsOut -match $Namespace)) {
            Invoke-Native kubectl @('create', 'namespace', $Namespace)
            Write-Ok "Created namespace: $Namespace"
        }

        $helmArgs = @(
            '--namespace', $Namespace,
            '-f', $Script:ValuesFile,
            '--set', "image.api.tag=$ApiTag",
            '--set', "image.frontend.tag=$FrontendTag",
            '--set', "frontend.env.NEXTAUTH_URL=http://$($Script:Hostname)"
        )

        if ($Script:InstallKeycloak) {
            Write-Log "Configuring CSOC portal to use Keycloak (http://keycloak.local)..."

            Write-Log "Creating keycloak-http service (port 80 -> keycloak pod:8080)..."
            $keycloakSvcYaml = @"
apiVersion: v1
kind: Service
metadata:
  name: keycloak-http
  labels:
    app: keycloak
spec:
  type: ClusterIP
  ports:
    - name: http
      port: 80
      targetPort: 8080
  selector:
    app: keycloak
    app.kubernetes.io/instance: keycloak
    app.kubernetes.io/managed-by: keycloak-operator
"@
            $keycloakSvcYaml | kubectl apply -n $Namespace -f - 2>$null

            $keycloakIp = ''
            $waited = 0
            while ($waited -lt 30 -and -not $keycloakIp) {
                $keycloakIp = kubectl get svc keycloak-http -n $Namespace -o jsonpath='{.spec.clusterIP}' 2>$null
                Start-Sleep -Seconds 2
                $waited += 2
            }
            if (-not $keycloakIp) {
                Write-Die "Failed to create keycloak-http service in namespace '$Namespace'"
            }
            Write-Ok "keycloak-http service ready at $keycloakIp"

            $helmArgs += @(
                '--set', 'api.env.MOCK_AUTH=false',
                '--set', 'api.env.KEYCLOAK_URL=http://keycloak.local',
                '--set', 'api.env.KEYCLOAK_REALM=csoc-realm',
                '--set', 'frontend.env.MOCK_AUTH=false',
                '--set', 'frontend.env.ENABLE_MOCK_AUTH=false',
                '--set', 'frontend.env.NEXT_PUBLIC_KEYCLOAK_URL=http://keycloak.local',
                '--set', 'frontend.env.NEXT_PUBLIC_KEYCLOAK_REALM=csoc-realm',
                '--set', 'frontend.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=csoc-client',
                '--set', "frontend.env.NEXT_PUBLIC_KEYCLOAK_ISSUER=http://keycloak.local/realms/csoc-realm",
                '--set', "frontend.hostAliases[0].ip=$keycloakIp",
                '--set', 'frontend.hostAliases[0].hostnames[0]=keycloak.local'
            )
        }

        $maxRetries = 5; $retryDelay = 10; $attempt = 1
        while ($attempt -le $maxRetries) {
            $releaseExists = helm status $Release -n $Namespace 2>$null
            $action = if ($releaseExists) { 'upgrade' } else { 'install' }
            if ($attempt -gt 1) {
                Write-Log "Helm $action (attempt $attempt/$maxRetries)..."
            } else {
                Write-Log "Helm $action..."
            }

            & helm $action $Release $Script:HelmChart @helmArgs
            if ($LASTEXITCODE -eq 0) { break }

            if ($attempt -eq $maxRetries) {
                Write-Die "Helm $action failed after $maxRetries attempts"
            }
            Write-Warn "Helm failed (attempt $attempt/$maxRetries), retrying in ${retryDelay}s..."
            Start-Sleep -Seconds $retryDelay
            $attempt++
        }

        Write-Ok "Helm release '$Release' deployed to namespace '$Namespace'"
    } finally {
        Pop-Location
    }
}

# ── Wait for pods ─────────────────────────────────────────────────────────────
function Wait-ForPods {
    Write-Log "Waiting for CSOC pods to become ready..."

    Invoke-Native kubectl @(
        'wait',
        '--for=condition=ready', 'pod',
        '-l', "app.kubernetes.io/instance=$Release",
        '-n', $Namespace,
        '--timeout=300s'
    )

    Write-Ok "All CSOC pods are ready"

    Write-Host ""
    Write-Log "Pod status:"
    kubectl get pods -l "app.kubernetes.io/instance=$Release" -n $Namespace -o wide
    Write-Host ""

    Write-Log "Services:"
    kubectl get svc $Release -n $Namespace
}

# ── Teardown ──────────────────────────────────────────────────────────────────
function Remove-Setup {
    Push-Location $Script:ProjectRoot
    try {
        Write-Log "Tearing down..."

        $releaseExists = helm status $Release -n $Namespace 2>$null
        if ($releaseExists) {
            Write-Log "Uninstalling Helm release '$Release'..."
            Invoke-Native helm @('uninstall', $Release, '-n', $Namespace)
            Write-Ok "Helm release uninstalled"
        }

        Remove-HostsEntry -HostName $Script:Hostname
        Remove-HostsEntry -HostName $Script:Gen3Hostname

        # Stop Minikube
        $statusOut = minikube status -p $Script:MinikubeProfile 2>$null
        if ($statusOut -match 'Running') {
            Write-Log "Stopping Minikube..."
            Invoke-Native minikube @('stop', '-p', $Script:MinikubeProfile)
            Write-Ok "Minikube stopped"
        }

        # Optionally remove Keycloak + CNPG
        if ($Script:InstallKeycloak) {
            $kcExists = kubectl get keycloak keycloak -n $Namespace 2>$null
            if ($kcExists) {
                $ans = Read-Host "Remove Keycloak + CloudNativePG resources? [y/N]"
                if ($ans -match '^[Yy]$') {
                    Write-Log "Removing Keycloak resources..."
                    kubectl delete -f $Script:KeycloakCRDFile --ignore-not-found=true 2>$null
                    kubectl delete cluster keycloak-db -n $Namespace --ignore-not-found=true 2>$null
                    Write-Ok "Keycloak + PostgreSQL removed from namespace '$Namespace'"
                }
            }

            $ans = Read-Host "Uninstall CloudNativePG operator too? [y/N]"
            if ($ans -match '^[Yy]$') {
                Write-Log "Removing CloudNativePG operator..."
                kubectl delete -f "https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.29/releases/cnpg-$($Script:CnpgVersion).yaml" `
                    --ignore-not-found=true 2>$null
                Write-Ok "CloudNativePG operator removed"
            }

            $ans = Read-Host "Remove Keycloak operator too? [y/N]"
            if ($ans -match '^[Yy]$') {
                Write-Log "Removing Keycloak operator..."
                kubectl delete deployment/keycloak-operator -n $Namespace --ignore-not-found=true 2>$null
                kubectl delete crds keycloaks.k8s.keycloak.org keycloakrealmimports.k8s.keycloak.org --ignore-not-found=true 2>$null
                Write-Ok "Keycloak operator removed"
            }
        }

        Remove-HostsEntry -HostName $Script:KeycloakHostname

        Write-Ok "Teardown complete"
    } finally {
        Pop-Location
    }
}

# ── Status check ──────────────────────────────────────────────────────────────
function Show-Status {
    Push-Location $Script:ProjectRoot
    try {
        Write-Host ""
        Write-Host "============================================"
        Write-Host "  CSOC Portal — Local Minikube Environment"
        Write-Host "============================================"
        Write-Host ""

        $statusOut = minikube status -p $Script:MinikubeProfile 2>$null
        if ($statusOut -match 'Running') {
            $ip = (minikube ip -p $Script:MinikubeProfile 2>$null).Trim()
            Write-Host "  Minikube:  $ip  Running"
        } else {
            Write-Host "  Minikube:  NOT RUNNING"
        }

        Write-Host "  Profile:   $($Script:MinikubeProfile)"
        Write-Host "  Namespace: $Namespace"
        Write-Host "  Release:   $Release"
        Write-Host "  Hostname:  http://$($Script:Hostname)"
        Write-Host "  Gen3:      http://$($Script:Gen3Hostname)"
        Write-Host ""

        $svcOut = kubectl get svc $Release -n $Namespace 2>$null
        if ($svcOut) {
            Write-Host "  Services:"
            $svcOut | ForEach-Object { Write-Host "    $_" }
            Write-Host ""
            Write-Host "  Pods:"
            $pods = kubectl get pods -l "app.kubernetes.io/instance=$Release" -n $Namespace 2>$null
            $pods | ForEach-Object { Write-Host "    $_" }
        } else {
            Write-Host "  Helm release NOT installed yet (run without -Status to deploy)"
        }

        Write-Host ""
        Write-Host "  Quick access:"
        Write-Host "    Frontend:  http://localhost:3000"
        Write-Host "    API:       http://localhost:8002/ping"
        Write-Host "    Ingress:   http://$($Script:Hostname)"
        Write-Host "    Gen3:      http://$($Script:Gen3Hostname)"
        Write-Host ""

        $kcExists = kubectl get keycloak keycloak -n $Namespace 2>$null
        if ($kcExists) {
            Write-Host "  Keycloak:   http://$($Script:KeycloakHostname)  (admin / admin)"
            Write-Host "  Keycloak pods:"
            $kcPods = kubectl get pods -n $Namespace 2>$null | Where-Object { $_ -match 'keycloak|keycloak-db' }
            $kcPods | ForEach-Object { Write-Host "    $_" }
            Write-Host ""
            Write-Host "  Realm:      csoc-realm"
            Write-Host "  Client:     csoc-client"
            Write-Host "  Users:      admin/admin (superadmin), devuser/dev (csoc-role)"
        } else {
            Write-Host "  Keycloak:   NOT INSTALLED (use -Keycloak to enable)"
        }
        Write-Host ""
    } finally {
        Pop-Location
    }
}

# ── Usage ──────────────────────────────────────────────────────────────────────
function Show-Usage {
    Write-Host @"
Usage: .\setup-minikube.ps1 [OPTIONS]

Options:
  -Teardown              Tear down everything (stop services, cleanup hosts)
  -Status                Show current environment status
  -ClusterOnly           Only start Minikube, skip Helm deploy
  -Keycloak              Install Keycloak via operator (default: off, uses MOCK_AUTH)
  -ApiTag TAG            Override API Docker image tag (default: $ApiTag)
  -FrontendTag TAG       Override Frontend Docker image tag (default: $FrontendTag)
  -Namespace NS          Kubernetes namespace (default: $Namespace)
  -Release NAME          Helm release name (default: $Release)
  -Help                  Show this help message

Examples:
  .\setup-minikube.ps1                          # Full setup + deploy
  .\setup-minikube.ps1 -Keycloak               # Setup with Keycloak operator
  .\setup-minikube.ps1 -ClusterOnly            # Only start Minikube
  .\setup-minikube.ps1 -ApiTag latest          # Use 'latest' tag for API
  .\setup-minikube.ps1 -Teardown               # Tear down
  .\setup-minikube.ps1 -Status                 # Show status

Note: Modifying the Windows hosts file requires an elevated (Administrator) shell.
"@
}

# ── Main ───────────────────────────────────────────────────────────────────────
function Main {
    if ($Help) {
        Show-Usage
        return
    }

    if ($Teardown) {
        Remove-Setup
        return
    }

    if ($Status) {
        Show-Status
        return
    }

    Push-Location $Script:ProjectRoot
    try {
        Write-Host ""
        Write-Host "╔══════════════════════════════════════════╗"
        Write-Host "║   CSOC Portal — Minikube Setup           ║"
        Write-Host "╚══════════════════════════════════════════╝"
        Write-Host ""

        Test-Prerequisites
        Start-MinikubeCluster
        Set-CSOCHosts
        Start-Keycloak

        if (-not $ClusterOnly) {
            Deploy-CSOC
            Wait-ForPods
        }

        Show-Status

        if (-not $ClusterOnly) {
            Write-Host ""
            Write-Ok "Setup complete! Open http://$($Script:Hostname) in your browser"
        } else {
            Write-Host ""
            Write-Ok "Minikube ready. Deploy with:  .\setup-minikube.ps1 -Namespace $Namespace"
        }
        Write-Host ""
        Write-Host "To tear down later:  .\setup-minikube.ps1 -Teardown"
        Write-Host "To check status:     .\setup-minikube.ps1 -Status"
        Write-Host ""
    } finally {
        Pop-Location
    }
}

Main

