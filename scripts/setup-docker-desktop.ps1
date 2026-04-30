<#
.SYNOPSIS
    Deploy the CSOC portal to Docker Desktop's built-in Kubernetes cluster on Windows 11.

.DESCRIPTION
    Equivalent of setup-minikube.ps1 but targets the Kubernetes cluster that ships
    with Docker Desktop (kubeconfig context: "docker-desktop").  No Minikube required.

    The Docker Desktop cluster is always managed by Docker Desktop itself — this
    script does not start or stop it.  Enable Kubernetes in Docker Desktop Settings
    before running.

    Requires an elevated (Administrator) PowerShell session to modify the Windows
    hosts file.  All external tools (kubectl, helm, docker) must already be on the PATH.

.PARAMETER Teardown
    Uninstall the Helm release, clean hosts entries, and optionally remove ingress-nginx.
    Does NOT stop or reset the Docker Desktop cluster.

.PARAMETER Status
    Show the current environment status without making any changes.

.PARAMETER ClusterOnly
    Switch kubectl context and install ingress-nginx only; skip the Helm deploy.

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

.PARAMETER KubeContext
    kubectl context name for Docker Desktop's cluster (default: docker-desktop).

.PARAMETER Help
    Show this help message.

.EXAMPLE
    .\setup-docker-desktop.ps1                        # Full setup + deploy
    .\setup-docker-desktop.ps1 -Keycloak              # Setup with Keycloak operator
    .\setup-docker-desktop.ps1 -ClusterOnly           # Switch context + ingress only
    .\setup-docker-desktop.ps1 -ApiTag latest         # Use 'latest' tag for API
    .\setup-docker-desktop.ps1 -Teardown              # Tear down
    .\setup-docker-desktop.ps1 -Status                # Show status
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
    [string]$KubeContext = '',
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
if ([string]::IsNullOrEmpty($KubeContext)) { $KubeContext = Get-EnvDefault 'KUBE_CONTEXT'        'docker-desktop' }

# ── Config ────────────────────────────────────────────────────────────────────
$Script:HelmChart         = Get-EnvDefault 'CHART_PATH' '.\helm\csoc'
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
# Docker Desktop's Kubernetes binds the ingress load-balancer to localhost.
$Script:ClusterIP         = '127.0.0.1'
# ingress-nginx version to deploy (cloud/LoadBalancer manifest)
$Script:IngressNginxUrl   = 'https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.1/deploy/static/provider/cloud/deploy.yaml'

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
    foreach ($tool in @('kubectl', 'helm', 'docker')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            $missing += $tool
        }
    }
    if ($missing.Count -gt 0) {
        Write-Die "Missing tools: $($missing -join ', '). Install them first."
    }

    # Verify Docker Desktop Kubernetes context exists.
    # get-contexts returns one name per line as a string array; use -contains for
    # exact per-element matching (unlike -notmatch which filters the array).
    $contexts = @(kubectl config get-contexts -o name 2>$null)
    if ($contexts -notcontains $KubeContext) {
        Write-Die "kubectl context '$KubeContext' not found. Enable Kubernetes in Docker Desktop Settings."
    }

    # Verify Docker Desktop cluster is reachable
    Write-Log "Checking cluster connectivity (context: $KubeContext)..."
    kubectl --context $KubeContext cluster-info 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Die "Cannot reach cluster '$KubeContext'. Make sure Docker Desktop Kubernetes is running."
    }

    Write-Ok "Docker Desktop cluster '$KubeContext' is reachable"
}

# ── Switch kubectl context ────────────────────────────────────────────────────
function Set-KubeContext {
    $current = (kubectl config current-context 2>$null).Trim()
    if ($current -eq $KubeContext) {
        Write-Ok "kubectl context is already '$KubeContext'"
        return
    }
    Write-Log "Switching kubectl context to '$KubeContext'..."
    Invoke-Native kubectl @('config', 'use-context', $KubeContext)
    Write-Ok "kubectl context set to '$KubeContext'"
}

# ── ingress-nginx ─────────────────────────────────────────────────────────────
function Install-IngressNginx {
    # Check if the ingress-nginx controller deployment already exists and is ready
    $deploy = kubectl get deployment ingress-nginx-controller -n ingress-nginx 2>$null
    if ($deploy -match 'ingress-nginx-controller') {
        Write-Warn "ingress-nginx already installed, skipping"
        return
    }

    Write-Log "Installing ingress-nginx (cloud/LoadBalancer variant for Docker Desktop)..."
    Invoke-Native kubectl @('apply', '-f', $Script:IngressNginxUrl)

    # Wait for the controller deployment to roll out
    Write-Log "Waiting for ingress-nginx controller..."
    Invoke-Native kubectl @(
        'rollout', 'status', 'deployment/ingress-nginx-controller',
        '-n', 'ingress-nginx', '--timeout=120s'
    )

    # Wait for the admission webhook endpoint to be ready before Helm runs
    Write-Log "Waiting for ingress-nginx admission webhook endpoint..."
    $maxWait = 120; $waited = 0
    while ($waited -lt $maxWait) {
        $ep = kubectl get endpoints ingress-nginx-controller-admission -n ingress-nginx 2>$null
        if ($ep -match '\d+\.\d+\.\d+\.\d+') { break }
        Start-Sleep -Seconds 3
        $waited += 3
    }

    Write-Ok "ingress-nginx is ready"
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
    Set-HostsEntry -HostName $Script:Hostname     -IP $Script:ClusterIP
    Set-HostsEntry -HostName $Script:Gen3Hostname -IP $Script:ClusterIP
}

function Set-KeycloakHosts {
    Set-HostsEntry -HostName $Script:KeycloakHostname -IP $Script:ClusterIP
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
            '--kube-context', $KubeContext,
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
            $releaseExists = helm status $Release -n $Namespace --kube-context $KubeContext 2>$null
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

        $releaseExists = helm status $Release -n $Namespace --kube-context $KubeContext 2>$null
        if ($releaseExists) {
            Write-Log "Uninstalling Helm release '$Release'..."
            Invoke-Native helm @('uninstall', $Release, '-n', $Namespace, '--kube-context', $KubeContext)
            Write-Ok "Helm release uninstalled"
        }

        Remove-HostsEntry -HostName $Script:Hostname
        Remove-HostsEntry -HostName $Script:Gen3Hostname

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

        # Offer to remove ingress-nginx
        $ingressExists = kubectl get deployment ingress-nginx-controller -n ingress-nginx 2>$null
        if ($ingressExists -match 'ingress-nginx-controller') {
            $ans = Read-Host "Remove ingress-nginx from the cluster? [y/N]"
            if ($ans -match '^[Yy]$') {
                Write-Log "Removing ingress-nginx..."
                kubectl delete -f $Script:IngressNginxUrl --ignore-not-found=true 2>$null
                Write-Ok "ingress-nginx removed"
            }
        }

        Write-Ok "Teardown complete"
        Write-Warn "Docker Desktop Kubernetes is still running — manage it via Docker Desktop Settings."
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
        Write-Host "  CSOC Portal — Docker Desktop Environment"
        Write-Host "============================================"
        Write-Host ""

        $clusterInfo = kubectl --context $KubeContext cluster-info 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  Cluster:   $KubeContext  Running"
        } else {
            Write-Host "  Cluster:   $KubeContext  NOT REACHABLE"
        }

        $ingressExists = kubectl get deployment ingress-nginx-controller -n ingress-nginx 2>$null
        if ($ingressExists -match 'ingress-nginx-controller') {
            Write-Host "  Ingress:   ingress-nginx installed"
        } else {
            Write-Host "  Ingress:   NOT installed (will be installed on next run)"
        }

        Write-Host "  Context:   $KubeContext"
        Write-Host "  Namespace: $Namespace"
        Write-Host "  Release:   $Release"
        Write-Host "  Hostname:  http://$($Script:Hostname)  (-> $($Script:ClusterIP))"
        Write-Host "  Gen3:      http://$($Script:Gen3Hostname)  (-> $($Script:ClusterIP))"
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
Usage: .\setup-docker-desktop.ps1 [OPTIONS]

Options:
  -Teardown              Uninstall Helm release, clean hosts entries
                         (does NOT stop the Docker Desktop cluster)
  -Status                Show current environment status
  -ClusterOnly           Switch context and install ingress-nginx only; skip Helm deploy
  -Keycloak              Install Keycloak via operator (default: off, uses MOCK_AUTH)
  -ApiTag TAG            Override API Docker image tag (default: $ApiTag)
  -FrontendTag TAG       Override Frontend Docker image tag (default: $FrontendTag)
  -Namespace NS          Kubernetes namespace (default: $Namespace)
  -Release NAME          Helm release name (default: $Release)
  -KubeContext CTX       kubectl context name (default: docker-desktop)
  -Help                  Show this help message

Examples:
  .\setup-docker-desktop.ps1                          # Full setup + deploy
  .\setup-docker-desktop.ps1 -Keycloak               # Setup with Keycloak operator
  .\setup-docker-desktop.ps1 -ClusterOnly            # Context switch + ingress only
  .\setup-docker-desktop.ps1 -ApiTag latest          # Use 'latest' tag for API
  .\setup-docker-desktop.ps1 -Teardown               # Tear down
  .\setup-docker-desktop.ps1 -Status                 # Show status

Prerequisites:
  - Docker Desktop with Kubernetes enabled (Settings > Kubernetes > Enable Kubernetes)
  - kubectl, helm on PATH
  - Elevated (Administrator) shell for hosts file modifications

Note: The Docker Desktop cluster runs on 127.0.0.1. Ingress hostnames
      (csoc.local, gen3.local, keycloak.local) are mapped to 127.0.0.1 in the
      Windows hosts file.
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
        Write-Host "║   CSOC Portal — Docker Desktop Setup     ║"
        Write-Host "╚══════════════════════════════════════════╝"
        Write-Host ""

        Test-Prerequisites
        Set-KubeContext
        Install-IngressNginx
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
            Write-Ok "Cluster ready. Deploy with:  .\setup-docker-desktop.ps1 -Namespace $Namespace"
        }
        Write-Host ""
        Write-Host "To tear down later:  .\setup-docker-desktop.ps1 -Teardown"
        Write-Host "To check status:     .\setup-docker-desktop.ps1 -Status"
        Write-Host ""
    } finally {
        Pop-Location
    }
}

Main

