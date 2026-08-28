package argocd

// Types mirroring the subset of the ArgoCD API this console consumes.
//
// Decoding is deliberately permissive -- pointers and omitempty throughout, no
// required fields -- because the deployed ArgoCD version varies per cluster (the
// installer applies the unpinned `stable` manifest). A field missing on an older
// release should degrade that one value, not fail the whole response.

type ApplicationList struct {
	Items []Application `json:"items"`
}

type Application struct {
	Metadata ObjectMeta        `json:"metadata"`
	Spec     ApplicationSpec   `json:"spec"`
	Status   ApplicationStatus `json:"status"`
}

type ObjectMeta struct {
	Name              string            `json:"name"`
	Namespace         string            `json:"namespace,omitempty"`
	UID               string            `json:"uid,omitempty"`
	ResourceVersion   string            `json:"resourceVersion,omitempty"`
	CreationTimestamp string            `json:"creationTimestamp,omitempty"`
	Labels            map[string]string `json:"labels,omitempty"`
	Annotations       map[string]string `json:"annotations,omitempty"`
	OwnerReferences   []OwnerReference  `json:"ownerReferences,omitempty"`
	DeletionTimestamp string            `json:"deletionTimestamp,omitempty"`
}

// OwnerReference matters for the UI: an Application owned by an ApplicationSet
// will have manual spec edits reverted by its generator, so the UI warns first.
type OwnerReference struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	UID        string `json:"uid,omitempty"`
}

type ApplicationSpec struct {
	Project string `json:"project,omitempty"`
	// Single-source apps populate Source; multi-source apps populate Sources.
	// Conflating the two caused a real bug in the previous CRD lister, so both
	// are kept distinct here and callers use PrimarySource().
	Source      *ApplicationSource  `json:"source,omitempty"`
	Sources     []ApplicationSource `json:"sources,omitempty"`
	Destination Destination         `json:"destination,omitempty"`
	SyncPolicy  *SyncPolicy         `json:"syncPolicy,omitempty"`
	Info        []Info              `json:"info,omitempty"`
	RevisionHistoryLimit *int64     `json:"revisionHistoryLimit,omitempty"`
}

type ApplicationSource struct {
	RepoURL        string       `json:"repoURL,omitempty"`
	Path           string       `json:"path,omitempty"`
	TargetRevision string       `json:"targetRevision,omitempty"`
	Chart          string       `json:"chart,omitempty"`
	Helm           *HelmSource  `json:"helm,omitempty"`
	Kustomize      *KustomizeSource `json:"kustomize,omitempty"`
	Ref            string       `json:"ref,omitempty"`
}

type HelmSource struct {
	ValueFiles  []string      `json:"valueFiles,omitempty"`
	Values      string        `json:"values,omitempty"`
	ReleaseName string        `json:"releaseName,omitempty"`
	Parameters  []HelmParam   `json:"parameters,omitempty"`
	Version     string        `json:"version,omitempty"`
}

type HelmParam struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type KustomizeSource struct {
	NamePrefix string   `json:"namePrefix,omitempty"`
	NameSuffix string   `json:"nameSuffix,omitempty"`
	Images     []string `json:"images,omitempty"`
	Version    string   `json:"version,omitempty"`
}

type Destination struct {
	Server    string `json:"server,omitempty"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name,omitempty"`
}

type SyncPolicy struct {
	Automated   *SyncPolicyAutomated `json:"automated,omitempty"`
	SyncOptions []string             `json:"syncOptions,omitempty"`
	Retry       *RetryStrategy       `json:"retry,omitempty"`
}

type SyncPolicyAutomated struct {
	Prune      bool `json:"prune,omitempty"`
	SelfHeal   bool `json:"selfHeal,omitempty"`
	AllowEmpty bool `json:"allowEmpty,omitempty"`
}

type RetryStrategy struct {
	Limit   int64    `json:"limit,omitempty"`
	Backoff *Backoff `json:"backoff,omitempty"`
}

type Backoff struct {
	Duration    string `json:"duration,omitempty"`
	Factor      *int64 `json:"factor,omitempty"`
	MaxDuration string `json:"maxDuration,omitempty"`
}

type Info struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type ApplicationStatus struct {
	Sync           SyncStatus        `json:"sync,omitempty"`
	Health         HealthStatus      `json:"health,omitempty"`
	Resources      []ResourceStatus  `json:"resources,omitempty"`
	History        []RevisionHistory `json:"history,omitempty"`
	Conditions     []Condition       `json:"conditions,omitempty"`
	OperationState *OperationState   `json:"operationState,omitempty"`
	ReconciledAt   string            `json:"reconciledAt,omitempty"`
	SourceType     string            `json:"sourceType,omitempty"`
	Summary        *Summary          `json:"summary,omitempty"`
}

type SyncStatus struct {
	Status    string `json:"status,omitempty"`
	Revision  string `json:"revision,omitempty"`
	Revisions []string `json:"revisions,omitempty"`
}

type HealthStatus struct {
	Status  string `json:"status,omitempty"`
	Message string `json:"message,omitempty"`
}

type ResourceStatus struct {
	Group           string        `json:"group,omitempty"`
	Version         string        `json:"version,omitempty"`
	Kind            string        `json:"kind,omitempty"`
	Namespace       string        `json:"namespace,omitempty"`
	Name            string        `json:"name,omitempty"`
	Status          string        `json:"status,omitempty"`
	Health          *HealthStatus `json:"health,omitempty"`
	Hook            bool          `json:"hook,omitempty"`
	RequiresPruning bool          `json:"requiresPruning,omitempty"`
	SyncWave        int64         `json:"syncWave,omitempty"`
}

type RevisionHistory struct {
	ID         int64               `json:"id"`
	Revision   string              `json:"revision,omitempty"`
	Revisions  []string            `json:"revisions,omitempty"`
	DeployedAt string              `json:"deployedAt,omitempty"`
	DeployStartedAt string         `json:"deployStartedAt,omitempty"`
	Source     *ApplicationSource  `json:"source,omitempty"`
	Sources    []ApplicationSource `json:"sources,omitempty"`
	// Populated by this API, not ArgoCD: commit metadata resolved server-side so
	// the browser does not make one request per history entry.
	Metadata *RevisionMetadata `json:"metadata,omitempty"`
}

type Condition struct {
	Type               string `json:"type,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime string `json:"lastTransitionTime,omitempty"`
}

type OperationState struct {
	Phase      string     `json:"phase,omitempty"`
	Message    string     `json:"message,omitempty"`
	StartedAt  string     `json:"startedAt,omitempty"`
	FinishedAt string     `json:"finishedAt,omitempty"`
	Operation  *Operation `json:"operation,omitempty"`
	SyncResult *SyncResult `json:"syncResult,omitempty"`
	RetryCount int64      `json:"retryCount,omitempty"`
}

type Operation struct {
	Sync     *SyncOperation `json:"sync,omitempty"`
	InitiatedBy *OperationInitiator `json:"initiatedBy,omitempty"`
}

type OperationInitiator struct {
	Username  string `json:"username,omitempty"`
	Automated bool   `json:"automated,omitempty"`
}

type SyncOperation struct {
	Revision    string   `json:"revision,omitempty"`
	Prune       bool     `json:"prune,omitempty"`
	DryRun      bool     `json:"dryRun,omitempty"`
	SyncOptions []string `json:"syncOptions,omitempty"`
}

type SyncResult struct {
	Revision  string           `json:"revision,omitempty"`
	Resources []ResourceResult `json:"resources,omitempty"`
}

type ResourceResult struct {
	Group     string `json:"group,omitempty"`
	Kind      string `json:"kind,omitempty"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name,omitempty"`
	Status    string `json:"status,omitempty"`
	Message   string `json:"message,omitempty"`
	HookPhase string `json:"hookPhase,omitempty"`
	SyncPhase string `json:"syncPhase,omitempty"`
}

type Summary struct {
	ExternalURLs []string `json:"externalURLs,omitempty"`
	Images       []string `json:"images,omitempty"`
}

// ── Resource tree ────────────────────────────────────────────────────────────

// ResourceTree is the parent/child graph of everything the application manages.
// Only available from the ArgoCD API; the Application CRD does not contain it.
type ResourceTree struct {
	Nodes       []ResourceNode `json:"nodes,omitempty"`
	OrphanedNodes []ResourceNode `json:"orphanedNodes,omitempty"`
	Hosts       []HostInfo     `json:"hosts,omitempty"`
}

type ResourceNode struct {
	UID             string            `json:"uid,omitempty"`
	Group           string            `json:"group,omitempty"`
	Version         string            `json:"version,omitempty"`
	Kind            string            `json:"kind,omitempty"`
	Namespace       string            `json:"namespace,omitempty"`
	Name            string            `json:"name,omitempty"`
	ParentRefs      []ResourceRef     `json:"parentRefs,omitempty"`
	Info            []InfoItem        `json:"info,omitempty"`
	Health          *HealthStatus     `json:"health,omitempty"`
	Images          []string          `json:"images,omitempty"`
	ResourceVersion string            `json:"resourceVersion,omitempty"`
	CreatedAt       string            `json:"createdAt,omitempty"`
	NetworkingInfo  *NetworkingInfo   `json:"networkingInfo,omitempty"`
}

type ResourceRef struct {
	UID       string `json:"uid,omitempty"`
	Group     string `json:"group,omitempty"`
	Kind      string `json:"kind,omitempty"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name,omitempty"`
}

type InfoItem struct {
	Name  string `json:"name,omitempty"`
	Value string `json:"value,omitempty"`
}

type NetworkingInfo struct {
	TargetLabels map[string]string `json:"targetLabels,omitempty"`
	Ingress      []interface{}     `json:"ingress,omitempty"`
	ExternalURLs []string          `json:"externalURLs,omitempty"`
}

type HostInfo struct {
	Name          string        `json:"name,omitempty"`
	SystemInfo    interface{}   `json:"systemInfo,omitempty"`
	ResourcesInfo []interface{} `json:"resourcesInfo,omitempty"`
}

// ── Managed resources (diff) ─────────────────────────────────────────────────

type ManagedResourceList struct {
	Items []ManagedResource `json:"items"`
}

// ManagedResource carries live vs desired state. TargetState and LiveState are
// JSON *strings* in the API response, not nested objects.
type ManagedResource struct {
	Group     string `json:"group,omitempty"`
	Kind      string `json:"kind,omitempty"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name,omitempty"`
	TargetState string `json:"targetState,omitempty"`
	LiveState   string `json:"liveState,omitempty"`
	Diff        string `json:"diff,omitempty"`
	NormalizedLiveState string `json:"normalizedLiveState,omitempty"`
	PredictedLiveState  string `json:"predictedLiveState,omitempty"`
}

// ── Misc responses ───────────────────────────────────────────────────────────

type ManifestResponse struct {
	Manifests []string `json:"manifests,omitempty"`
	Namespace string   `json:"namespace,omitempty"`
	Server    string   `json:"server,omitempty"`
	Revision  string   `json:"revision,omitempty"`
}

type RevisionMetadata struct {
	Author  string   `json:"author,omitempty"`
	Date    string   `json:"date,omitempty"`
	Tags    []string `json:"tags,omitempty"`
	Message string   `json:"message,omitempty"`
	SignatureInfo string `json:"signatureInfo,omitempty"`
}

type VersionInfo struct {
	Version      string `json:"Version,omitempty"`
	BuildDate    string `json:"BuildDate,omitempty"`
	GitCommit    string `json:"GitCommit,omitempty"`
	KubeVersion  string `json:"KubeVersion,omitempty"`
	HelmVersion  string `json:"HelmVersion,omitempty"`
}

type SessionRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type SessionResponse struct {
	Token string `json:"token"`
}

// ── Request payloads ─────────────────────────────────────────────────────────

// SyncRequest is the real sync API payload, as opposed to the CRD `.operation`
// patch the frontend used to perform. Notably it supports a target revision,
// resource subsets and a dry run, none of which the patch approach could express.
type SyncRequest struct {
	Revision     string          `json:"revision,omitempty"`
	Prune        bool            `json:"prune,omitempty"`
	DryRun       bool            `json:"dryRun,omitempty"`
	Strategy     *SyncStrategy   `json:"strategy,omitempty"`
	Resources    []SyncResource  `json:"resources,omitempty"`
	SyncOptions  *SyncOptions    `json:"syncOptions,omitempty"`
	RetryStrategy *RetryStrategy `json:"retryStrategy,omitempty"`
	AppNamespace string          `json:"appNamespace,omitempty"`
}

type SyncStrategy struct {
	Apply *SyncStrategyApply `json:"apply,omitempty"`
	Hook  *SyncStrategyHook  `json:"hook,omitempty"`
}

type SyncStrategyApply struct {
	Force bool `json:"force,omitempty"`
}

type SyncStrategyHook struct {
	SyncStrategyApply `json:",inline"`
}

type SyncOptions struct {
	Items []string `json:"items,omitempty"`
}

type SyncResource struct {
	Group     string `json:"group,omitempty"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace,omitempty"`
}

type RollbackRequest struct {
	ID           int64  `json:"id"`
	Name         string `json:"name,omitempty"`
	AppNamespace string `json:"appNamespace,omitempty"`
	DryRun       bool   `json:"dryRun,omitempty"`
	Prune        bool   `json:"prune,omitempty"`
}

// ── Repositories / projects / clusters ───────────────────────────────────────

type RepositoryList struct {
	Items []Repository `json:"items"`
}

type Repository struct {
	Repo            string           `json:"repo,omitempty"`
	Name            string           `json:"name,omitempty"`
	Type            string           `json:"type,omitempty"`
	Project         string           `json:"project,omitempty"`
	Username        string           `json:"username,omitempty"`
	ConnectionState *ConnectionState `json:"connectionState,omitempty"`
	InsecureIgnoreHostKey bool       `json:"insecureIgnoreHostKey,omitempty"`
	EnableLFS       bool             `json:"enableLfs,omitempty"`
}

type ConnectionState struct {
	Status     string `json:"status,omitempty"`
	Message    string `json:"message,omitempty"`
	AttemptedAt string `json:"attemptedAt,omitempty"`
}

type AppProjectList struct {
	Items []AppProject `json:"items"`
}

type AppProject struct {
	Metadata ObjectMeta      `json:"metadata"`
	Spec     AppProjectSpec  `json:"spec"`
}

type AppProjectSpec struct {
	Description              string        `json:"description,omitempty"`
	SourceRepos              []string      `json:"sourceRepos,omitempty"`
	Destinations             []Destination `json:"destinations,omitempty"`
	ClusterResourceWhitelist []GroupKind   `json:"clusterResourceWhitelist,omitempty"`
	NamespaceResourceBlacklist []GroupKind `json:"namespaceResourceBlacklist,omitempty"`
	Roles                    []ProjectRole `json:"roles,omitempty"`
}

type GroupKind struct {
	Group string `json:"group,omitempty"`
	Kind  string `json:"kind,omitempty"`
}

type ProjectRole struct {
	Name        string   `json:"name,omitempty"`
	Description string   `json:"description,omitempty"`
	Policies    []string `json:"policies,omitempty"`
	Groups      []string `json:"groups,omitempty"`
}

type ClusterList struct {
	Items []Cluster `json:"items"`
}

type Cluster struct {
	Server          string           `json:"server,omitempty"`
	Name            string           `json:"name,omitempty"`
	Namespaces      []string         `json:"namespaces,omitempty"`
	ConnectionState *ConnectionState `json:"connectionState,omitempty"`
	ServerVersion   string           `json:"serverVersion,omitempty"`
	Project         string           `json:"project,omitempty"`
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// PrimarySource returns the source to display for an application, handling both
// single- and multi-source specs. Reading `Sources[0]` for some fields and
// `Source` for others is exactly the bug that shipped in the old CRD lister.
func (s ApplicationSpec) PrimarySource() ApplicationSource {
	if s.Source != nil {
		return *s.Source
	}
	if len(s.Sources) > 0 {
		return s.Sources[0]
	}
	return ApplicationSource{}
}

// IsMultiSource reports whether the app uses the multi-source form, so the UI can
// show every source rather than silently editing only the first.
func (s ApplicationSpec) IsMultiSource() bool {
	return s.Source == nil && len(s.Sources) > 1
}

// OwnedByApplicationSet reports whether an ApplicationSet generates this app. A
// manual spec edit will be reverted by the generator, so the UI warns first.
func (a Application) OwnedByApplicationSet() bool {
	for _, ref := range a.Metadata.OwnerReferences {
		if ref.Kind == "ApplicationSet" {
			return true
		}
	}
	return false
}

// HasAutomatedSync reports whether ArgoCD will re-sync on its own, which makes a
// rollback pointless: it would immediately roll forward again.
func (a Application) HasAutomatedSync() bool {
	return a.Spec.SyncPolicy != nil && a.Spec.SyncPolicy.Automated != nil
}
