import { CATEGORIES, ICONS } from './icons.js';

/**
 * Maps Terraform `google_*` service tokens to icon keys. A token matches the
 * resource type of the same name and every type that extends it with `_…`;
 * the longest matching token wins, so `google_compute_router_nat` resolves through
 * `google_compute_router` before `google_compute`. Types no token matches render
 * with the generic icon.
 */
const SERVICE_PREFIXES = {
  // Compute
  google_compute: 'compute_engine',
  google_compute_instance: 'compute_engine',
  google_compute_project_metadata: 'compute_engine',
  google_os_login: 'compute_engine',
  google_compute_instance_group: 'instance_group',
  google_compute_region_instance_group_manager: 'instance_group',
  google_compute_autoscaler: 'instance_group',
  google_compute_region_autoscaler: 'instance_group',
  google_tpu: 'cloud_tpu',
  google_tpu_v2: 'cloud_tpu',
  google_cloudfunctions: 'cloud_functions',
  google_cloudfunctions2: 'cloud_functions',
  google_cloud_run: 'cloud_run',
  google_cloud_run_v2: 'cloud_run',
  google_app_engine: 'app_engine',
  google_vmwareengine: 'vmware_engine',

  // Containers
  google_container: 'gke',
  google_gkeonprem: 'gke_on_prem',
  google_gke_hub: 'anthos',
  google_gkehub: 'anthos',
  google_artifact_registry: 'artifact_registry',
  google_container_registry: 'container_registry',

  // Networking
  google_compute_network: 'vpc_network',
  google_compute_shared_vpc: 'vpc_network',
  google_compute_global_network_endpoint: 'vpc_network',
  google_vpc_access: 'vpc_network',
  google_compute_subnetwork: 'subnetwork',
  google_compute_address: 'external_ip',
  google_compute_global_address: 'external_ip',
  google_compute_public_advertised_prefix: 'external_ip',
  google_compute_public_delegated_prefix: 'external_ip',
  google_compute_router: 'cloud_router',
  google_compute_route: 'cloud_routes',
  google_compute_router_nat: 'cloud_nat',
  google_compute_vpn: 'cloud_vpn',
  google_compute_ha_vpn_gateway: 'cloud_vpn',
  google_compute_external_vpn_gateway: 'cloud_vpn',
  google_compute_interconnect: 'interconnect',
  google_compute_service_attachment: 'private_service_connect',
  google_service_networking: 'private_connectivity',
  google_network_connectivity: 'network_connectivity_center',
  google_network_management: 'network_intelligence',
  google_compute_forwarding_rule: 'load_balancer',
  google_compute_global_forwarding_rule: 'load_balancer',
  google_compute_target_http_proxy: 'load_balancer',
  google_compute_target_https_proxy: 'load_balancer',
  google_compute_target_tcp_proxy: 'load_balancer',
  google_compute_target_ssl_proxy: 'load_balancer',
  google_compute_target_grpc_proxy: 'load_balancer',
  google_compute_target_pool: 'load_balancer',
  google_compute_target_instance: 'load_balancer',
  google_compute_region_target_http_proxy: 'load_balancer',
  google_compute_region_target_https_proxy: 'load_balancer',
  google_compute_region_target_tcp_proxy: 'load_balancer',
  google_compute_url_map: 'load_balancer',
  google_compute_region_url_map: 'load_balancer',
  google_compute_backend_service: 'load_balancer',
  google_compute_region_backend_service: 'load_balancer',
  google_compute_health_check: 'load_balancer',
  google_compute_region_health_check: 'load_balancer',
  google_compute_http_health_check: 'load_balancer',
  google_compute_https_health_check: 'load_balancer',
  google_compute_network_endpoint: 'load_balancer',
  google_compute_network_endpoint_group: 'load_balancer',
  google_compute_region_network_endpoint_group: 'load_balancer',
  google_compute_global_network_endpoint_group: 'load_balancer',
  google_compute_backend_bucket: 'cloud_cdn',
  google_network_services_edge_cache: 'cloud_cdn',
  google_dns: 'cloud_dns',
  google_clouddomains: 'cloud_domains',
  google_network_services: 'traffic_director',
  google_api_gateway: 'api_gateway',
  google_endpoints: 'cloud_endpoints',
  google_apigee: 'apigee',

  // Storage
  google_compute_disk: 'persistent_disk',
  google_compute_region_disk: 'persistent_disk',
  google_compute_snapshot: 'persistent_disk',
  google_compute_resource_policy: 'persistent_disk',
  google_compute_attached_disk: 'persistent_disk',
  google_storage: 'cloud_storage',
  google_storage_transfer: 'storage_transfer',
  google_filestore: 'filestore',
  google_backup_dr: 'backup_dr',

  // Database
  google_sql: 'cloud_sql',
  google_spanner: 'spanner',
  google_firestore: 'firestore',
  google_firebaserules: 'firestore',
  google_datastore: 'datastore',
  google_bigtable: 'bigtable',
  google_redis: 'memorystore',
  google_memcache: 'memorystore',
  google_memorystore: 'memorystore',
  google_database_migration_service: 'database_migration',

  // Analytics
  google_bigquery: 'bigquery',
  google_bigquery_connection: 'bigquery',
  google_bigquery_reservation: 'bigquery',
  google_bigquery_data_transfer: 'bigquery_transfer',
  google_bigquery_analytics_hub: 'analytics_hub',
  google_dataflow: 'dataflow',
  google_dataproc: 'dataproc',
  google_dataproc_metastore: 'dataproc_metastore',
  google_composer: 'composer',
  google_data_fusion: 'data_fusion',
  google_datastream: 'datastream',
  google_dataplex: 'dataplex',
  google_data_catalog: 'data_catalog',
  google_looker: 'looker',

  // Integration
  google_pubsub: 'pubsub',
  google_pubsub_lite: 'pubsub',
  google_cloud_tasks: 'cloud_tasks',
  google_cloud_scheduler: 'cloud_scheduler',
  google_workflows: 'workflows',
  google_eventarc: 'eventarc',
  google_healthcare: 'healthcare_api',
  google_integration_connectors: 'connectors',
  google_integrations: 'connectors',

  // AI & machine learning
  google_vertex_ai: 'vertex_ai',
  google_notebooks: 'vertex_ai',
  google_workbench: 'vertex_ai',
  google_colab: 'vertex_ai',
  google_ml_engine: 'ai_platform',
  google_dialogflow: 'dialogflow',
  google_dialogflow_cx: 'dialogflow_cx',
  google_document_ai: 'document_ai',
  google_document_ai_warehouse: 'document_ai',
  google_speech: 'speech_to_text',
  google_contact_center_insights: 'contact_center_ai',

  // Security & identity
  google_binary_authorization: 'binary_authorization',
  google_compute_firewall: 'firewall',
  google_compute_network_firewall_policy: 'firewall',
  google_compute_region_network_firewall_policy: 'firewall',
  google_compute_firewall_policy: 'firewall',
  google_project_iam: 'iam',
  google_organization_iam: 'iam',
  google_folder_iam: 'iam',
  google_iam: 'iam',
  google_billing_account_iam: 'iam',
  google_service_account: 'service_account',
  google_iam_workload_identity_pool: 'workload_identity',
  google_iam_workforce_pool: 'workload_identity',
  google_identity_platform: 'identity_platform',
  google_iap: 'iap',
  google_access_context_manager: 'access_context_manager',
  google_kms: 'kms',
  google_kms_ekm_connection: 'cloud_ekm',
  google_secret_manager: 'secret_manager',
  google_certificate_manager: 'certificate_manager',
  google_compute_ssl_certificate: 'certificate_manager',
  google_compute_managed_ssl_certificate: 'certificate_manager',
  google_compute_region_ssl_certificate: 'certificate_manager',
  google_compute_ssl_policy: 'certificate_manager',
  google_compute_region_ssl_policy: 'certificate_manager',
  google_privateca: 'certificate_authority',
  google_compute_security_policy: 'cloud_armor',
  google_compute_region_security_policy: 'cloud_armor',
  google_cloud_ids: 'cloud_ids',
  google_network_security: 'network_security',
  google_scc: 'security_command_center',
  google_scc_v2: 'security_command_center',
  google_data_loss_prevention: 'dlp',
  google_assured_workloads: 'assured_workloads',
  google_beyondcorp: 'beyondcorp',
  google_active_directory: 'managed_ad',

  // Management & operations
  google_monitoring: 'monitoring',
  google_logging: 'logging',
  google_project_iam_audit_config: 'cloud_audit_logs',
  google_organization_iam_audit_config: 'cloud_audit_logs',
  google_folder_iam_audit_config: 'cloud_audit_logs',
  google_cloud_asset: 'asset_inventory',
  google_os_config: 'os_config',
  google_os_config_v2: 'os_config',
  google_deployment_manager: 'deployment_manager',
  google_runtimeconfig: 'runtime_config',
  google_billing: 'billing',
  google_cloud_quotas: 'quotas',

  // Developer tools
  google_cloudbuild: 'cloud_build',
  google_cloudbuildv2: 'cloud_build',
  google_clouddeploy: 'cloud_deploy',
  google_sourcerepo: 'source_repositories',

  // General
  google_project: 'project',
  google_folder: 'project',
  google_organization: 'project',
  google_tags: 'project',
  google_resource_manager_lien: 'project',
  google_essential_contacts: 'project'
};

/** Exact resource type → icon key overrides, checked before SERVICE_PREFIXES. */
const RESOURCE_MAP = {};

export const gcpProvider = {
  id: 'gcp',
  name: 'Google Cloud',
  shortName: 'GCP',
  accentColor: '#4285F4',
  // Official GCP glyphs are drawn for light surfaces; the renderer puts this
  // tile behind them so they stay legible on the dark node card.
  iconBackdrop: '#f8fafc',
  typePrefixes: ['google_'],
  categories: CATEGORIES,
  icons: ICONS,
  resourceMap: RESOURCE_MAP,
  servicePrefixes: SERVICE_PREFIXES,
  genericIconKey: 'generic',

  terms: {
    network: 'VPC Network',
    subnet: 'Subnetwork',
    zone: 'Zone',
    region: 'Region',
    tags: 'Labels',
    group: 'Project'
  },

  hierarchy: {
    networkTypes: ['google_compute_network'],
    subnetTypes: ['google_compute_subnetwork'],
    networkRefKeys: ['network', 'network_interface.0.network'],
    subnetRefKeys: ['subnetwork', 'network_interface.0.subnetwork', 'subnetwork_id'],
    zoneKeys: ['zone', 'location'],
    regionKeys: ['region'],
    cidrKeys: ['ip_cidr_range'],
    tagKeys: ['labels'],
    groupKeys: ['project'],
    publicSubnetHints: ['pub', 'dmz', 'edge', 'ingress', 'external'],
    // A GCP subnetwork with Private Google Access off and no NAT hint reads as public-facing.
    isPublicSubnet: (attrs) => attrs.private_ip_google_access === false
  },

  inferEdges(nodes, addEdge) {
    const by = (fn) => nodes.filter(fn);
    const dns = by(n => n.type.startsWith('google_dns'));
    const globalLbs = by(n => n.type === 'google_compute_global_forwarding_rule' || n.type === 'google_compute_forwarding_rule');
    const urlMaps = by(n => n.type === 'google_compute_url_map');
    const backends = by(n => n.type === 'google_compute_backend_service');
    const backendBuckets = by(n => n.type === 'google_compute_backend_bucket');
    const armorList = by(n => n.type.includes('security_policy'));
    const apigws = by(n => n.type.startsWith('google_api_gateway'));
    const instanceGroups = by(n => n.type.includes('instance_group_manager'));
    const instances = by(n => n.type === 'google_compute_instance');
    const cloudRun = by(n => n.type.startsWith('google_cloud_run'));
    const functions = by(n => n.type.startsWith('google_cloudfunctions'));
    const gkeClusters = by(n => n.type === 'google_container_cluster');
    const nodePools = by(n => n.type === 'google_container_node_pool');
    const artifacts = by(n => n.type === 'google_artifact_registry_repository');
    const sql = by(n => n.type === 'google_sql_database_instance');
    const spanner = by(n => n.type === 'google_spanner_instance');
    const firestore = by(n => n.type === 'google_firestore_database');
    const bigtable = by(n => n.type === 'google_bigtable_instance');
    const redis = by(n => n.type === 'google_redis_instance');
    const buckets = by(n => n.type === 'google_storage_bucket');
    const topics = by(n => n.type === 'google_pubsub_topic');
    const subscriptions = by(n => n.type === 'google_pubsub_subscription');
    const scheduler = by(n => n.type === 'google_cloud_scheduler_job');
    const tasks = by(n => n.type === 'google_cloud_tasks_queue');
    const workflows = by(n => n.type.includes('workflow'));
    const eventarc = by(n => n.type === 'google_eventarc_trigger');
    const bq = by(n => n.type === 'google_bigquery_dataset');
    const nats = by(n => n.type === 'google_compute_router_nat');
    const secrets = by(n => n.type === 'google_secret_manager_secret');
    const kmsKeys = by(n => n.type === 'google_kms_crypto_key');
    const vpcConnectors = by(n => n.type === 'google_vpc_access_connector');
    const networks = by(n => n.type === 'google_compute_network');
    const peerings = by(n => n.type === 'google_compute_network_peering');

    dns.forEach(d => {
      globalLbs.forEach(lb => addEdge(d.id, lb.id, 'DNS'));
      apigws.forEach(gw => addEdge(d.id, gw.id, 'DNS'));
      cloudRun.forEach(cr => addEdge(d.id, cr.id, 'DNS'));
    });

    globalLbs.forEach(lb => urlMaps.forEach(um => addEdge(lb.id, um.id, 'Route')));

    urlMaps.forEach(um => {
      backends.forEach(b => addEdge(um.id, b.id, 'Path Rule'));
      backendBuckets.forEach(b => addEdge(um.id, b.id, 'Static'));
    });

    armorList.forEach(arm => {
      backends.forEach(b => addEdge(arm.id, b.id, 'Cloud Armor', 'security'));
    });

    backendBuckets.forEach(b => buckets.forEach(bk => addEdge(b.id, bk.id, 'Origin')));

    backends.forEach(b => {
      instanceGroups.forEach(ig => addEdge(b.id, ig.id, 'Backend'));
      cloudRun.forEach(cr => addEdge(b.id, cr.id, 'Serverless NEG'));
      nodePools.forEach(np => addEdge(b.id, np.id, 'NEG'));
    });

    instanceGroups.forEach(ig => instances.forEach(i => addEdge(ig.id, i.id, 'Manages', 'dependency')));

    apigws.forEach(gw => {
      functions.forEach(f => addEdge(gw.id, f.id, 'Invoke'));
      cloudRun.forEach(cr => addEdge(gw.id, cr.id, 'Invoke'));
    });

    gkeClusters.forEach(c => nodePools.forEach(np => addEdge(c.id, np.id, 'Managed', 'dependency')));

    artifacts.forEach(ar => {
      nodePools.forEach(np => addEdge(ar.id, np.id, 'Container Image'));
      gkeClusters.forEach(c => addEdge(ar.id, c.id, 'Container Image'));
      cloudRun.forEach(cr => addEdge(ar.id, cr.id, 'Container Image'));
    });

    nats.forEach(nat => {
      instances.forEach(i => addEdge(nat.id, i.id, 'Egress NAT'));
      nodePools.forEach(np => addEdge(nat.id, np.id, 'Egress NAT'));
    });

    vpcConnectors.forEach(vc => {
      cloudRun.forEach(cr => addEdge(cr.id, vc.id, 'Serverless VPC'));
      functions.forEach(f => addEdge(f.id, vc.id, 'Serverless VPC'));
    });

    const workloads = [...functions, ...cloudRun, ...instances, ...nodePools];
    workloads.forEach(w => {
      sql.forEach(s => addEdge(w.id, s.id, 'SQL TCP:5432/3306'));
      spanner.forEach(s => addEdge(w.id, s.id, 'Spanner API'));
      firestore.forEach(f => addEdge(w.id, f.id, 'Read/Write'));
      bigtable.forEach(b => addEdge(w.id, b.id, 'Read/Write'));
      redis.forEach(r => addEdge(w.id, r.id, 'Cache'));
      buckets.forEach(b => addEdge(w.id, b.id, 'Objects'));
      topics.forEach(t => addEdge(w.id, t.id, 'Publish'));
      secrets.forEach(s => addEdge(w.id, s.id, 'Secrets', 'security'));
    });

    kmsKeys.forEach(key => {
      buckets.forEach(b => addEdge(key.id, b.id, 'CMEK Encryption', 'security'));
      sql.forEach(s => addEdge(key.id, s.id, 'CMEK Encryption', 'security'));
      secrets.forEach(s => addEdge(key.id, s.id, 'KMS Encryption', 'security'));
    });

    topics.forEach(t => {
      subscriptions.forEach(s => addEdge(t.id, s.id, 'Subscribe'));
      bq.forEach(d => addEdge(t.id, d.id, 'Stream'));
    });

    subscriptions.forEach(s => {
      functions.forEach(f => addEdge(s.id, f.id, 'Push'));
      cloudRun.forEach(cr => addEdge(s.id, cr.id, 'Push'));
    });

    scheduler.forEach(sc => {
      topics.forEach(t => addEdge(sc.id, t.id, 'Schedule'));
      functions.forEach(f => addEdge(sc.id, f.id, 'Schedule'));
    });

    tasks.forEach(t => {
      cloudRun.forEach(cr => addEdge(t.id, cr.id, 'Task Worker'));
      functions.forEach(f => addEdge(t.id, f.id, 'Task Worker'));
    });

    workflows.forEach(wf => {
      cloudRun.forEach(cr => addEdge(wf.id, cr.id, 'Orchestrates'));
      functions.forEach(f => addEdge(wf.id, f.id, 'Orchestrates'));
    });

    eventarc.forEach(ev => {
      cloudRun.forEach(cr => addEdge(ev.id, cr.id, 'Event'));
      functions.forEach(f => addEdge(ev.id, f.id, 'Event'));
    });

    peerings.forEach(peer => {
      networks.forEach(net => addEdge(peer.id, net.id, 'VPC Peering', 'peering'));
    });
  },

  isEntryResource(type) {
    return type.startsWith('google_dns') ||
      type.startsWith('google_api_gateway') ||
      type === 'google_compute_global_forwarding_rule' ||
      type === 'google_compute_forwarding_rule' ||
      type === 'google_compute_url_map' ||
      type === 'google_compute_target_http_proxy' ||
      type === 'google_compute_target_https_proxy' ||
      type === 'google_compute_managed_ssl_certificate' ||
      type === 'google_compute_security_policy';
  }
};

export default gcpProvider;
