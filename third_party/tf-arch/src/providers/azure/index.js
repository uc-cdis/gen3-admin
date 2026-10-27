import { CATEGORIES, ICONS } from './icons.js';

/**
 * Maps Terraform `azurerm_* / azuread_*` service tokens to icon keys. A token matches the
 * resource type of the same name and every type that extends it with `_…`;
 * the longest matching token wins, so `azurerm_eventgrid_system_topic` resolves through
 * `azurerm_eventgrid` before `azurerm`. Types no token matches render
 * with the generic icon.
 */
const SERVICE_PREFIXES = {
  // Compute
  azurerm_virtual_machine: 'virtual_machine',
  azurerm_linux_virtual_machine: 'virtual_machine',
  azurerm_windows_virtual_machine: 'virtual_machine',
  azurerm_virtual_machine_extension: 'virtual_machine',
  azurerm_virtual_machine_run_command: 'virtual_machine',
  azurerm_virtual_machine_scale_set: 'vm_scale_set',
  azurerm_linux_virtual_machine_scale_set: 'vm_scale_set',
  azurerm_windows_virtual_machine_scale_set: 'vm_scale_set',
  azurerm_orchestrated_virtual_machine_scale_set: 'vm_scale_set',
  azurerm_availability_set: 'availability_set',
  azurerm_proximity_placement_group: 'proximity_placement_group',
  azurerm_dedicated_host: 'dedicated_host',
  azurerm_dedicated_host_group: 'host_group',
  azurerm_capacity_reservation: 'capacity_reservation',
  azurerm_capacity_reservation_group: 'capacity_reservation',
  azurerm_image: 'image',
  azurerm_shared_image: 'compute_gallery',
  azurerm_gallery_application: 'compute_gallery',
  azurerm_batch: 'batch',
  azurerm_function_app: 'functions',
  azurerm_linux_function_app: 'functions',
  azurerm_windows_function_app: 'functions',
  azurerm_function_app_function: 'functions',
  azurerm_function_app_flex_consumption: 'functions',
  azurerm_app_service: 'app_service',
  azurerm_linux_web_app: 'app_service',
  azurerm_windows_web_app: 'app_service',
  azurerm_web_app: 'app_service',
  azurerm_app_service_source_control: 'app_service',
  azurerm_app_service_connection: 'app_service',
  azurerm_app_service_virtual_network_swift_connection: 'app_service',
  azurerm_app_service_custom_hostname_binding: 'app_service',
  azurerm_app_service_slot: 'web_app_slot',
  azurerm_linux_web_app_slot: 'web_app_slot',
  azurerm_windows_web_app_slot: 'web_app_slot',
  azurerm_linux_function_app_slot: 'web_app_slot',
  azurerm_windows_function_app_slot: 'web_app_slot',
  azurerm_function_app_slot: 'web_app_slot',
  azurerm_web_app_active_slot: 'web_app_slot',
  azurerm_app_service_active_slot: 'web_app_slot',
  azurerm_app_service_plan: 'app_service_plan',
  azurerm_service_plan: 'app_service_plan',
  azurerm_app_service_environment: 'app_service_environment',
  azurerm_app_service_environment_v3: 'app_service_environment',
  azurerm_static_site: 'static_web_app',
  azurerm_static_web_app: 'static_web_app',
  azurerm_spring_cloud: 'spring_apps',
  azurerm_service_fabric_cluster: 'service_fabric',
  azurerm_service_fabric_managed_cluster: 'managed_service_fabric',
  azurerm_virtual_desktop: 'virtual_desktop',
  azurerm_virtual_desktop_host_pool: 'host_pool',
  azurerm_virtual_desktop_workspace: 'avd_workspace',
  azurerm_virtual_desktop_application_group: 'avd_application_group',
  azurerm_virtual_desktop_application: 'avd_application_group',
  azurerm_vmware: 'vmware_solution',

  // Containers
  azurerm_kubernetes: 'aks',
  azurerm_kubernetes_fleet: 'kubernetes_fleet',
  azurerm_arc_kubernetes: 'arc_kubernetes',
  azurerm_container_app: 'container_app',
  azurerm_container_app_environment: 'container_app_environment',
  azurerm_container_group: 'container_instances',
  azurerm_container_registry: 'container_registry',
  azurerm_container_connected_registry: 'container_registry',
  azurerm_redhat_openshift: 'openshift',

  // Networking
  azurerm_virtual_network: 'virtual_network',
  azurerm_network_ddos: 'virtual_network',
  azurerm_network_profile: 'virtual_network',
  azurerm_network_connection_monitor: 'virtual_network',
  azurerm_subnet: 'subnet',
  azurerm_network_interface: 'network_interface',
  azurerm_route: 'route_table',
  azurerm_route_table: 'route_table',
  azurerm_subnet_route_table_association: 'route_table',
  azurerm_route_filter: 'route_filter',
  azurerm_public_ip: 'public_ip',
  azurerm_public_ip_prefix: 'public_ip_prefix',
  azurerm_custom_ip_prefix: 'public_ip_prefix',
  azurerm_ip_group: 'ip_group',
  azurerm_nat_gateway: 'nat_gateway',
  azurerm_subnet_nat_gateway_association: 'nat_gateway',
  azurerm_lb: 'load_balancer',
  azurerm_application_gateway: 'application_gateway',
  azurerm_network_interface_application_gateway_backend_address_pool_association: 'application_gateway',
  azurerm_cdn: 'front_door',
  azurerm_cdn_frontdoor: 'front_door',
  azurerm_frontdoor: 'front_door',
  azurerm_traffic_manager: 'traffic_manager',
  azurerm_dns: 'dns',
  azurerm_private_dns: 'dns',
  azurerm_private_dns_resolver: 'dns_resolver',
  azurerm_private_endpoint: 'private_endpoint',
  azurerm_private_link_service: 'private_link_service',
  azurerm_virtual_network_gateway: 'virtual_network_gateway',
  azurerm_vpn_gateway: 'virtual_network_gateway',
  azurerm_point_to_site_vpn_gateway: 'virtual_network_gateway',
  azurerm_vpn_server_configuration: 'virtual_network_gateway',
  azurerm_vpn_site: 'virtual_network_gateway',
  azurerm_local_network_gateway: 'local_network_gateway',
  azurerm_express_route: 'expressroute',
  azurerm_express_route_port: 'expressroute_direct',
  azurerm_virtual_wan: 'virtual_wan',
  azurerm_virtual_hub: 'virtual_hub',
  azurerm_bastion_host: 'bastion',
  azurerm_network_manager: 'network_manager',
  azurerm_subnet_service_endpoint_storage_policy: 'service_endpoint_policy',

  // Storage
  azurerm_managed_disk: 'managed_disk',
  azurerm_virtual_machine_data_disk_attachment: 'managed_disk',
  azurerm_disk_access: 'managed_disk',
  azurerm_snapshot: 'disk_snapshot',
  azurerm_storage: 'storage_account',
  azurerm_storage_account: 'storage_account',
  azurerm_storage_container: 'blob_container',
  azurerm_storage_blob: 'blob_container',
  azurerm_storage_share: 'file_share',
  azurerm_storage_queue: 'storage_queue',
  azurerm_storage_table: 'storage_table',
  azurerm_storage_data_lake_gen2: 'data_lake_storage',
  azurerm_data_lake: 'data_lake_storage',
  azurerm_storage_sync: 'storage_sync',
  azurerm_storage_mover: 'storage_mover',
  azurerm_elastic_san: 'elastic_san',
  azurerm_netapp: 'netapp_files',
  azurerm_hpc_cache: 'hpc_cache',
  azurerm_data_share: 'data_share',
  azurerm_recovery_services_vault: 'recovery_vault',
  azurerm_backup: 'recovery_vault',
  azurerm_site_recovery: 'recovery_vault',
  azurerm_data_protection: 'backup_vault',

  // Database
  azurerm_mssql_server: 'sql_server',
  azurerm_sql_server: 'sql_server',
  azurerm_mssql_firewall_rule: 'sql_server',
  azurerm_mssql_virtual_network_rule: 'sql_server',
  azurerm_mssql_server_security_alert_policy: 'sql_server',
  azurerm_mssql_server_vulnerability_assessment: 'sql_server',
  azurerm_mssql_server_extended_auditing_policy: 'sql_server',
  azurerm_mssql_outbound_firewall_rule: 'sql_server',
  azurerm_mssql_server_transparent_data_encryption: 'sql_server',
  azurerm_mssql_server_dns_alias: 'sql_server',
  azurerm_mssql_failover_group: 'sql_server',
  azurerm_mssql: 'sql_database',
  azurerm_mssql_database: 'sql_database',
  azurerm_sql_database: 'sql_database',
  azurerm_sql: 'sql_database',
  azurerm_mssql_elasticpool: 'sql_elastic_pool',
  azurerm_sql_elasticpool: 'sql_elastic_pool',
  azurerm_mssql_managed_instance: 'sql_managed_instance',
  azurerm_mssql_managed_database: 'sql_managed_instance',
  azurerm_sql_managed_instance: 'sql_managed_instance',
  azurerm_sql_managed_database: 'sql_managed_instance',
  azurerm_mssql_virtual_machine: 'sql_vm',
  azurerm_mssql_job_agent: 'elastic_job_agent',
  azurerm_mssql_job_credential: 'elastic_job_agent',
  azurerm_cosmosdb: 'cosmos_db',
  azurerm_cosmosdb_cassandra_cluster: 'cassandra',
  azurerm_cosmosdb_cassandra_datacenter: 'cassandra',
  azurerm_postgresql: 'postgresql',
  azurerm_cosmosdb_postgresql: 'postgresql_cluster',
  azurerm_mysql: 'mysql',
  azurerm_mariadb: 'mariadb',
  azurerm_redis: 'redis_cache',
  azurerm_managed_redis: 'redis_cache',
  azurerm_database_migration: 'database_migration',
  azurerm_confidential_ledger: 'confidential_ledger',

  // Analytics
  azurerm_synapse: 'synapse',
  azurerm_data_factory: 'data_factory',
  azurerm_databricks: 'databricks',
  azurerm_kusto: 'data_explorer',
  azurerm_hdinsight: 'hdinsight',
  azurerm_stream_analytics: 'stream_analytics',
  azurerm_analysis_services: 'analysis_services',
  azurerm_powerbi_embedded: 'power_bi_embedded',
  azurerm_purview: 'purview',
  azurerm_eventhub: 'event_hub',
  azurerm_eventhub_cluster: 'event_hub_cluster',

  // Integration
  azurerm_api_management: 'api_management',
  azurerm_api_connection: 'api_connection',
  azurerm_managed_api: 'api_connection',
  azurerm_servicebus: 'service_bus',
  azurerm_eventgrid: 'event_grid',
  azurerm_eventgrid_domain: 'event_grid_domain',
  azurerm_eventgrid_system_topic: 'event_grid_system_topic',
  azurerm_eventgrid_event_subscription: 'event_grid_subscription',
  azurerm_eventgrid_system_topic_event_subscription: 'event_grid_subscription',
  azurerm_logic_app: 'logic_app',
  azurerm_logic_app_integration_account: 'integration_account',
  azurerm_app_configuration: 'app_configuration',
  azurerm_relay: 'relay',
  azurerm_signalr: 'signalr',
  azurerm_web_pubsub: 'signalr',
  azurerm_notification_hub: 'notification_hub',
  azurerm_communication: 'communication_services',
  azurerm_email_communication_service: 'communication_services',
  azurerm_media: 'media_services',
  azurerm_iothub: 'iot_hub',
  azurerm_iothub_dps: 'iot_dps',
  azurerm_iotcentral: 'iot_central',
  azurerm_digital_twins: 'digital_twins',
  azurerm_maps: 'maps',
  azurerm_healthcare: 'fhir',

  // AI & machine learning
  azurerm_cognitive: 'cognitive_services',
  azurerm_ai_services: 'cognitive_services',
  azurerm_ai_foundry: 'cognitive_services',
  azurerm_machine_learning: 'machine_learning',
  azurerm_search: 'search',
  azurerm_bot: 'bot_service',

  // Security & identity
  azurerm_disk_encryption_set: 'disk_encryption_set',
  azurerm_ssh_public_key: 'ssh_key',
  azurerm_app_service_certificate: 'app_service_certificate',
  azurerm_app_service_managed_certificate: 'app_service_certificate',
  azurerm_app_service_certificate_order: 'app_service_certificate',
  azurerm_app_service_certificate_binding: 'app_service_certificate',
  azurerm_network_security: 'nsg',
  azurerm_network_interface_security_group_association: 'nsg',
  azurerm_subnet_network_security_group_association: 'nsg',
  azurerm_application_security_group: 'asg',
  azurerm_network_interface_application_security_group_association: 'asg',
  azurerm_firewall: 'firewall',
  azurerm_firewall_policy: 'firewall_policy',
  azurerm_web_application_firewall_policy: 'waf_policy',
  azurerm_cdn_frontdoor_firewall_policy: 'waf_policy',
  azurerm_frontdoor_firewall_policy: 'waf_policy',
  azurerm_network_ddos_protection_plan: 'ddos_protection',
  azurerm_key_vault: 'key_vault',
  azurerm_dedicated_hardware_security_module: 'dedicated_hsm',
  azurerm_key_vault_managed_hardware_security_module: 'dedicated_hsm',
  azurerm_user_assigned_identity: 'managed_identity',
  azurerm_federated_identity_credential: 'managed_identity',
  azurerm_role: 'role_assignment',
  azurerm_pim: 'role_assignment',
  azuread_directory_role: 'role_assignment',
  azuread: 'entra_id',
  azuread_application: 'app_registration',
  azuread_service_principal: 'enterprise_app',
  azuread_group: 'entra_group',
  azuread_user: 'entra_user',
  azuread_invitation: 'entra_user',
  azuread_administrative_unit: 'administrative_unit',
  azuread_conditional_access_policy: 'conditional_access',
  azuread_named_location: 'conditional_access',
  azurerm_aadb2c_directory: 'aad_b2c',
  azurerm_active_directory_domain_service: 'aad_domain_services',
  azurerm_sentinel: 'sentinel',
  azurerm_security_center: 'defender',
  azurerm_advanced_threat_protection: 'defender',
  azurerm_attestation: 'attestation',

  // Management & operations
  azurerm_maintenance: 'maintenance_configuration',
  azurerm_network_watcher: 'network_watcher',
  azurerm_network_packet_capture: 'network_watcher',
  azurerm_virtual_machine_packet_capture: 'network_watcher',
  azurerm_monitor: 'monitor',
  azurerm_monitor_private_link_scope: 'monitor',
  azurerm_monitor_metric_alert: 'alerts',
  azurerm_monitor_activity_log_alert: 'alerts',
  azurerm_monitor_scheduled_query_rules_alert: 'alerts',
  azurerm_monitor_scheduled_query_rules_alert_v2: 'alerts',
  azurerm_monitor_scheduled_query_rules_log: 'alerts',
  azurerm_monitor_action_group: 'alerts',
  azurerm_monitor_alert_processing_rule: 'alerts',
  azurerm_monitor_smart_detector_alert_rule: 'alerts',
  azurerm_monitor_alert_prometheus_rule_group: 'alerts',
  azurerm_monitor_diagnostic_setting: 'diagnostic_setting',
  azurerm_monitor_aad_diagnostic_setting: 'diagnostic_setting',
  azurerm_monitor_autoscale_setting: 'autoscale',
  azurerm_monitor_data_collection: 'data_collection_rule',
  azurerm_application_insights: 'application_insights',
  azurerm_application_insights_workbook: 'workbook',
  azurerm_log_analytics: 'log_analytics',
  azurerm_log_analytics_query_pack: 'log_analytics_query_pack',
  azurerm_dashboard_grafana: 'managed_grafana',
  azurerm_portal_dashboard: 'dashboard',
  azurerm_dashboard: 'dashboard',
  azurerm_automation: 'automation',
  azurerm_policy: 'policy',
  azurerm_management_group_policy: 'policy',
  azurerm_subscription_policy: 'policy',
  azurerm_resource_group_policy: 'policy',
  azurerm_resource_policy: 'policy',
  azurerm_management_group: 'management_group',
  azurerm_subscription: 'subscription',
  azurerm_management_lock: 'management_lock',
  azurerm_template_spec: 'template_spec',
  azurerm_resource_group_template_deployment: 'deployment',
  azurerm_subscription_template_deployment: 'deployment',
  azurerm_management_group_template_deployment: 'deployment',
  azurerm_tenant_template_deployment: 'deployment',
  azurerm_resource_deployment_script: 'deployment',
  azurerm_consumption_budget: 'cost_budget',
  azurerm_cost_management: 'cost_export',
  azurerm_billing_account_cost_management_export: 'cost_export',
  azurerm_subscription_cost_management_export: 'cost_export',
  azurerm_resource_group_cost_management_export: 'cost_export',
  azurerm_advisor: 'advisor',
  azurerm_lighthouse: 'lighthouse',
  azurerm_arc: 'azure_arc',
  azurerm_arc_machine: 'arc_machine',
  azurerm_hybrid_compute: 'arc_machine',
  azurerm_chaos_studio: 'chaos_studio',

  // Developer tools
  azurerm_dev_center: 'dev_box',
  azurerm_load_test: 'load_testing',
  azurerm_dev_test: 'devtest_labs',
  azurerm_lab_service: 'lab_services',

  // General
  azurerm_resource_group: 'resource_group'
};

/** Exact resource type → icon key overrides, checked before SERVICE_PREFIXES. */
const RESOURCE_MAP = {
  // Networking
  azurerm_virtual_network_peering: 'virtual_network',
  azurerm_virtual_network_gateway_connection: 'connection',
  azurerm_express_route_connection: 'connection',
  azurerm_virtual_hub_connection: 'virtual_hub'
};

export const azureProvider = {
  id: 'azure',
  name: 'Microsoft Azure',
  shortName: 'Azure',
  accentColor: '#0078D4',
  // Official Azure glyphs are drawn for light surfaces; the renderer puts this
  // tile behind them so they stay legible on the dark node card.
  iconBackdrop: '#f8fafc',
  typePrefixes: ['azurerm_', 'azuread_', 'azapi_', 'azurestack_'],
  categories: CATEGORIES,
  icons: ICONS,
  resourceMap: RESOURCE_MAP,
  servicePrefixes: SERVICE_PREFIXES,
  genericIconKey: 'generic',

  terms: {
    network: 'Virtual Network',
    subnet: 'Subnet',
    zone: 'Availability Zone',
    region: 'Location',
    tags: 'Resource Tags',
    group: 'Resource Group'
  },

  hierarchy: {
    networkTypes: ['azurerm_virtual_network'],
    subnetTypes: ['azurerm_subnet'],
    networkRefKeys: ['virtual_network_name', 'virtual_network_id'],
    subnetRefKeys: [
      'subnet_id',
      'ip_configuration.0.subnet_id',
      'subnet',
      'default_node_pool.0.vnet_subnet_id',
      'vnet_subnet_id',
      'gateway_ip_configuration.0.subnet_id'
    ],
    zoneKeys: ['zone', 'zones.0', 'availability_zone'],
    regionKeys: ['location'],
    cidrKeys: ['address_prefixes.0', 'address_prefix', 'address_space.0'],
    tagKeys: ['tags'],
    groupKeys: ['resource_group_name'],
    publicSubnetHints: ['pub', 'dmz', 'edge', 'ingress', 'gateway', 'frontend'],
    isPublicSubnet: () => false
  },

  inferEdges(nodes, addEdge) {
    const by = (fn) => nodes.filter(fn);
    const dns = by(n => n.type.startsWith('azurerm_dns') || n.type.startsWith('azurerm_private_dns'));
    const frontDoors = by(n => n.type.includes('frontdoor') || n.type.startsWith('azurerm_cdn'));
    const appGateways = by(n => n.type === 'azurerm_application_gateway');
    const lbs = by(n => n.type === 'azurerm_lb');
    const apims = by(n => n.type.startsWith('azurerm_api_management'));
    const publicIps = by(n => n.type === 'azurerm_public_ip');
    const nats = by(n => n.type === 'azurerm_nat_gateway');
    const vms = by(n => n.type.endsWith('_virtual_machine') || n.type === 'azurerm_virtual_machine');
    const scaleSets = by(n => n.type.includes('virtual_machine_scale_set'));
    const nics = by(n => n.type === 'azurerm_network_interface');
    const aks = by(n => n.type === 'azurerm_kubernetes_cluster');
    const nodePools = by(n => n.type === 'azurerm_kubernetes_cluster_node_pool');
    const webApps = by(n => n.type === 'azurerm_app_service' || n.type.endsWith('_web_app'));
    const funcApps = by(n => n.type.includes('function_app'));
    const containerApps = by(n => n.type === 'azurerm_container_app');
    const sql = by(n => n.type === 'azurerm_mssql_database' || n.type === 'azurerm_sql_database');
    const sqlServers = by(n => n.type === 'azurerm_mssql_server' || n.type === 'azurerm_sql_server');
    const cosmos = by(n => n.type === 'azurerm_cosmosdb_account');
    const pg = by(n => n.type.includes('postgresql') || n.type.includes('mysql'));
    const redis = by(n => n.type === 'azurerm_redis_cache');
    const storage = by(n => n.type === 'azurerm_storage_account');
    const containers = by(n => n.type === 'azurerm_storage_container');
    const sbQueues = by(n => n.type === 'azurerm_servicebus_queue');
    const sbTopics = by(n => n.type === 'azurerm_servicebus_topic');
    const eventGrid = by(n => n.type.startsWith('azurerm_eventgrid'));
    const eventHubs = by(n => n.type === 'azurerm_eventhub');
    const keyVaults = by(n => n.type === 'azurerm_key_vault');
    const privateEndpoints = by(n => n.type === 'azurerm_private_endpoint');
    const registries = by(n => n.type === 'azurerm_container_registry');
    const backendPools = by(n => n.type === 'azurerm_lb_backend_address_pool');
    const nsgs = by(n => n.type === 'azurerm_network_security_group');
    const vnets = by(n => n.type === 'azurerm_virtual_network');
    const peerings = by(n => n.type === 'azurerm_virtual_network_peering');
    const logAnalytics = by(n => n.type === 'azurerm_log_analytics_workspace');
    const appInsights = by(n => n.type === 'azurerm_application_insights');

    const workloads = [...vms, ...scaleSets, ...webApps, ...funcApps, ...containerApps, ...nodePools];
    const frontEnds = [...appGateways, ...lbs, ...apims, ...webApps, ...funcApps];

    dns.forEach(d => {
      frontDoors.forEach(fd => addEdge(d.id, fd.id, 'DNS'));
      appGateways.forEach(ag => addEdge(d.id, ag.id, 'DNS'));
      webApps.forEach(wa => addEdge(d.id, wa.id, 'DNS'));
      apims.forEach(a => addEdge(d.id, a.id, 'DNS'));
    });

    frontDoors.forEach(fd => {
      appGateways.forEach(ag => addEdge(fd.id, ag.id, 'Origin'));
      webApps.forEach(wa => addEdge(fd.id, wa.id, 'Origin'));
      containers.forEach(c => addEdge(fd.id, c.id, 'Static Origin'));
    });

    publicIps.forEach(ip => {
      appGateways.forEach(ag => addEdge(ip.id, ag.id, 'Frontend IP'));
      lbs.forEach(lb => addEdge(ip.id, lb.id, 'Frontend IP'));
      nats.forEach(nat => addEdge(ip.id, nat.id, 'Outbound'));
    });

    appGateways.forEach(ag => {
      scaleSets.forEach(ss => addEdge(ag.id, ss.id, 'HTTP/HTTPS'));
      nodePools.forEach(np => addEdge(ag.id, np.id, 'Ingress'));
      webApps.forEach(wa => addEdge(ag.id, wa.id, 'HTTP/HTTPS'));
    });

    lbs.forEach(lb => {
      backendPools.forEach(bp => addEdge(lb.id, bp.id, 'Backend Pool'));
      vms.forEach(vm => addEdge(lb.id, vm.id, 'Balance'));
      scaleSets.forEach(ss => addEdge(lb.id, ss.id, 'Balance'));
    });

    backendPools.forEach(bp => {
      vms.forEach(vm => addEdge(bp.id, vm.id, 'Pool Member'));
      scaleSets.forEach(ss => addEdge(bp.id, ss.id, 'Pool Member'));
      nics.forEach(nic => addEdge(bp.id, nic.id, 'Pool Member'));
    });

    apims.forEach(a => {
      funcApps.forEach(f => addEdge(a.id, f.id, 'Backend'));
      containerApps.forEach(c => addEdge(a.id, c.id, 'Backend'));
      webApps.forEach(w => addEdge(a.id, w.id, 'Backend'));
    });

    nics.forEach(nic => vms.forEach(vm => addEdge(nic.id, vm.id, 'Attached', 'dependency')));

    aks.forEach(c => nodePools.forEach(np => addEdge(c.id, np.id, 'Managed', 'dependency')));

    registries.forEach(reg => {
      nodePools.forEach(np => addEdge(reg.id, np.id, 'Container Image'));
      aks.forEach(c => addEdge(reg.id, c.id, 'Container Image'));
      containerApps.forEach(ca => addEdge(reg.id, ca.id, 'Container Image'));
      funcApps.forEach(f => addEdge(reg.id, f.id, 'Container Image'));
    });

    nats.forEach(nat => {
      scaleSets.forEach(ss => addEdge(nat.id, ss.id, 'Egress NAT'));
      nodePools.forEach(np => addEdge(nat.id, np.id, 'Egress NAT'));
    });

    sqlServers.forEach(s => sql.forEach(d => addEdge(s.id, d.id, 'Hosts', 'dependency')));

    privateEndpoints.forEach(pe => {
      storage.forEach(s => addEdge(pe.id, s.id, 'Private Link', 'security'));
      keyVaults.forEach(kv => addEdge(pe.id, kv.id, 'Private Link', 'security'));
      sqlServers.forEach(s => addEdge(pe.id, s.id, 'Private Link', 'security'));
      cosmos.forEach(c => addEdge(pe.id, c.id, 'Private Link', 'security'));
    });

    nsgs.forEach(nsg => {
      nics.forEach(nic => addEdge(nsg.id, nic.id, 'NSG Rule', 'security'));
    });

    workloads.forEach(w => {
      sql.forEach(s => addEdge(w.id, s.id, 'TDS TCP:1433'));
      cosmos.forEach(c => addEdge(w.id, c.id, 'Cosmos API'));
      pg.forEach(p => addEdge(w.id, p.id, 'SQL TCP:5432/3306'));
      redis.forEach(r => addEdge(w.id, r.id, 'Cache'));
      storage.forEach(s => addEdge(w.id, s.id, 'Blobs/Queues'));
      keyVaults.forEach(kv => addEdge(w.id, kv.id, 'Secrets', 'security'));
      sbQueues.forEach(q => addEdge(w.id, q.id, 'Enqueue'));
      sbTopics.forEach(t => addEdge(w.id, t.id, 'Publish'));
    });

    peerings.forEach(peer => {
      vnets.forEach(vnet => addEdge(peer.id, vnet.id, 'VNet Peering', 'peering'));
    });

    sbTopics.forEach(t => funcApps.forEach(f => addEdge(t.id, f.id, 'Trigger')));
    eventGrid.forEach(eg => {
      funcApps.forEach(f => addEdge(eg.id, f.id, 'Event'));
      containerApps.forEach(c => addEdge(eg.id, c.id, 'Event'));
      sbQueues.forEach(q => addEdge(eg.id, q.id, 'Target'));
    });
    eventHubs.forEach(eh => funcApps.forEach(f => addEdge(eh.id, f.id, 'Stream')));

    appInsights.forEach(ai => logAnalytics.forEach(la => addEdge(ai.id, la.id, 'Workspace')));
    frontEnds.forEach(fe => appInsights.forEach(ai => addEdge(fe.id, ai.id, 'Telemetry')));
  },

  isEntryResource(type) {
    return type.startsWith('azurerm_dns') ||
      type.startsWith('azurerm_private_dns') ||
      type.startsWith('azurerm_cdn') ||
      type.includes('frontdoor') ||
      type.startsWith('azurerm_api_management') ||
      type === 'azurerm_public_ip';
  }
};

export default azureProvider;
