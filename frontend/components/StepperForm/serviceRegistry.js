// Service catalog for the Gen3 deployment wizard.
// Maps 1:1 to subchart dependencies in gen3-helm/helm/gen3/Chart.yaml
// and top-level enabled toggles in gen3-helm/helm/gen3/values.yaml

export const SERVICE_CATEGORIES = [
  {
    id: 'core',
    label: 'Core Services',
    description: 'Essential Gen3 services for a functional deployment',
    defaultEnabled: true,
    services: [
      { key: 'ambassador', label: 'Ambassador', tooltip: 'API gateway / Envoy proxy for workspaces' },
      { key: 'arborist', label: 'Arborist', tooltip: 'Authorization policy engine (RBAC)' },
      { key: 'audit', label: 'Audit', tooltip: 'Audit logging service' },
      { key: 'fence', label: 'Fence', tooltip: 'Authentication and authorization (OAuth2/OIDC)' },
      { key: 'indexd', label: 'Indexd', tooltip: 'File indexing service (GUIDs)' },
      { key: 'manifestservice', label: 'Manifest Service', tooltip: 'Workspace file manifest service' },
      { key: 'metadata', label: 'Metadata', tooltip: 'Metadata catalog API (semi-structured JSON)' },
      { key: 'peregrine', label: 'Peregrine', tooltip: 'GraphQL API for structured data queries' },
      { key: 'portal', label: 'Portal', tooltip: 'Gen3 portal frontend (React SPA)' },
      { key: 'revproxy', label: 'Revproxy', tooltip: 'Nginx reverse proxy / ingress' },
      { key: 'sheepdog', label: 'Sheepdog', tooltip: 'Data submission service' },
      { key: 'wts', label: 'WTS', tooltip: 'Workspace Token Service' },
      { key: 'hatchery', label: 'Hatchery', tooltip: 'Workspace management (Jupyter, RStudio notebooks)' },
      { key: 'etl', label: 'ETL', tooltip: 'Extract-transform-load pipeline runner' },
    ],
  },
  {
    id: 'data-explorer',
    label: 'Data Explorer',
    description: 'Services for data exploration, search, and alternative frontends',
    defaultEnabled: false,
    services: [
      { key: 'guppy', label: 'Guppy', tooltip: 'Elasticsearch-based data explorer / flattened GraphQL' },
      { key: 'frontend-framework', label: 'Frontend Framework', tooltip: 'Alternative React-based frontend (gen3ff)' },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace & Workflow',
    description: 'Computational workspace and workflow engines',
    defaultEnabled: false,
    services: [
      { key: 'argo-wrapper', label: 'Argo Wrapper', tooltip: 'Argo Workflows integration layer' },
      { key: 'gen3-workflow', label: 'Gen3 Workflow', tooltip: 'Gen3 workflow engine (enables funnel sub-dependency)' },
    ],
  },
  {
    id: 'medical-imaging',
    label: 'Medical Imaging',
    description: 'DICOM medical imaging servers and viewers',
    defaultEnabled: false,
    services: [
      { key: 'dicom-server', label: 'DICOM Server', tooltip: 'DICOM data server' },
      { key: 'orthanc', label: 'Orthanc', tooltip: 'DICOM PACS server for medical imaging' },
      { key: 'ohif-viewer', label: 'OHIF Viewer', tooltip: 'Open Health Imaging Foundation DICOM viewer' },
    ],
  },
  {
    id: 'observability',
    label: 'Observability & Security',
    description: 'Monitoring proxies and container security',
    defaultEnabled: false,
    services: [
      { key: 'neuvector', label: 'NeuVector', tooltip: 'Container security policies (requires separate NeuVector install)' },
      { key: 'aws-es-proxy', label: 'AWS ES Proxy', tooltip: 'Proxy for AWS Elasticsearch with SIGv4 signing' },
      { key: 'aws-sigv4-proxy', label: 'AWS SIGv4 Proxy', tooltip: 'AWS Signature V4 proxy (newer ES proxy)' },
    ],
  },
  {
    id: 'ohdsi',
    label: 'OHDSI',
    description: 'Observational Health Data Sciences and Informatics platform',
    defaultEnabled: false,
    services: [
      { key: 'ohdsi-atlas', label: 'OHDSI Atlas', tooltip: 'OHDSI Atlas analytics platform' },
      { key: 'ohdsi-webapi', label: 'OHDSI WebAPI', tooltip: 'OHDSI Web API backend' },
    ],
  },
  {
    id: 'other',
    label: 'Other Services',
    description: 'Additional optional Gen3 services',
    defaultEnabled: false,
    services: [
      { key: 'cedar', label: 'Cedar', tooltip: 'User data report service' },
      { key: 'cohort-middleware', label: 'Cohort Middleware', tooltip: 'Cohort discovery middleware' },
      { key: 'dashboard', label: 'Dashboard', tooltip: 'Gen3 dashboard service' },
      { key: 'data-upload-cron', label: 'Data Upload Cron', tooltip: 'Scheduled data upload jobs' },
      { key: 'datareplicate', label: 'Data Replicate', tooltip: 'Data replication service' },
      { key: 'embedding-management-service', label: 'Embedding Mgmt', tooltip: 'Embedding management service' },
      { key: 'gen3-analysis', label: 'Gen3 Analysis', tooltip: 'Gen3 analysis service' },
      { key: 'gen3-user-data-library', label: 'User Data Library', tooltip: 'User-managed data library' },
      { key: 'requestor', label: 'Requestor', tooltip: 'Data access request service' },
      { key: 'sower', label: 'Sower', tooltip: 'Job dispatching service' },
      { key: 'ssjdispatcher', label: 'SSJ Dispatcher', tooltip: 'Study-specific job dispatcher' },
      { key: 'access-backend', label: 'Access Backend', tooltip: 'Access control backend' },
      { key: 'pidgin', label: 'Pidgin', tooltip: 'Notification/messaging service' },
    ],
  },
];

// Build a flat lookup map: serviceName -> { category, label, tooltip, defaultEnabled }
export const SERVICE_MAP = Object.fromEntries(
  SERVICE_CATEGORIES.flatMap(cat =>
    cat.services.map(svc => [svc.key, { ...svc, categoryId: cat.id, categoryLabel: cat.label, defaultEnabled: cat.defaultEnabled }])
  )
);
