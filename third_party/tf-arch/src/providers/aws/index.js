import { CATEGORIES, ICONS } from './icons.js';

/**
 * Maps Terraform `aws_*` service tokens to icon keys. A token matches the
 * resource type of the same name and every type that extends it with `_…`;
 * the longest matching token wins, so `aws_rds_cluster_instance` resolves through
 * `aws_rds_cluster` before `aws_rds`. Types no token matches render
 * with the generic icon.
 */
const SERVICE_PREFIXES = {
  // Compute
  aws_instance: 'ec2',
  aws_ec2: 'ec2',
  aws_ami: 'ec2',
  aws_key_pair: 'ec2',
  aws_launch_template: 'ec2',
  aws_launch_configuration: 'ec2',
  aws_placement_group: 'ec2',
  aws_spot_instance_request: 'ec2',
  aws_spot_fleet_request: 'ec2',
  aws_autoscaling: 'autoscaling',
  aws_appautoscaling: 'app_autoscaling',
  aws_lambda: 'lambda',
  aws_serverlessapplicationrepository: 'serverless_repo',
  aws_batch: 'batch',
  aws_elastic_beanstalk: 'elastic_beanstalk',
  aws_lightsail: 'lightsail',
  aws_apprunner: 'app_runner',
  aws_imagebuilder: 'image_builder',
  aws_outposts: 'outposts',
  aws_amplify: 'amplify',
  aws_workspaces: 'workspaces',
  aws_workspacesweb: 'workspaces',
  aws_appstream: 'appstream',
  aws_gamelift: 'gamelift',
  aws_medialive: 'medialive',
  aws_media_convert: 'mediaconvert',
  aws_media_package: 'mediapackage',
  aws_media_packagev2: 'mediapackage',
  aws_ivs: 'ivs',
  aws_ivschat: 'ivs',
  aws_elastictranscoder: 'elastic_transcoder',

  // Containers
  aws_ecs: 'ecs',
  aws_eks: 'eks',
  aws_ecr: 'ecr',
  aws_ecrpublic: 'ecr',

  // Networking
  aws_vpc: 'vpc',
  aws_default_vpc: 'vpc',
  aws_route: 'vpc',
  aws_default_route_table: 'vpc',
  aws_main_route_table_association: 'vpc',
  aws_network_acl: 'vpc',
  aws_default_network_acl: 'vpc',
  aws_network_interface: 'vpc',
  aws_eip: 'vpc',
  aws_flow_log: 'vpc',
  aws_vpc_dhcp_options: 'vpc',
  aws_ec2_managed_prefix_list: 'vpc',
  aws_subnet: 'subnet',
  aws_default_subnet: 'subnet',
  aws_internet_gateway: 'internet_gateway',
  aws_egress_only_internet_gateway: 'internet_gateway',
  aws_nat_gateway: 'nat_gateway',
  aws_vpc_endpoint: 'privatelink',
  aws_ec2_transit_gateway: 'transit_gateway',
  aws_vpn: 'site_to_site_vpn',
  aws_customer_gateway: 'site_to_site_vpn',
  aws_ec2_client_vpn: 'client_vpn',
  aws_dx: 'direct_connect',
  aws_networkmanager: 'cloud_wan',
  aws_globalaccelerator: 'global_accelerator',
  aws_service_discovery: 'cloud_map',
  aws_appmesh: 'app_mesh',
  aws_vpclattice: 'vpc_lattice',
  aws_verifiedaccess: 'verified_access',
  aws_lb: 'alb',
  aws_alb: 'alb',
  aws_elb: 'alb',
  aws_load_balancer: 'alb',
  aws_app_cookie_stickiness_policy: 'alb',
  aws_proxy_protocol_policy: 'alb',
  aws_cloudfront: 'cloudfront',
  aws_route53: 'route53',
  aws_route53domains: 'route53',
  aws_route53recoverycontrolconfig: 'route53',
  aws_route53recoveryreadiness: 'route53',
  aws_api_gateway: 'apigateway',
  aws_apigatewayv2: 'apigateway',

  // Storage
  aws_s3: 's3',
  aws_s3control: 's3',
  aws_s3outposts: 's3_outposts',
  aws_glacier: 's3_glacier',
  aws_ebs: 'ebs',
  aws_volume_attachment: 'ebs',
  aws_snapshot_create_volume_permission: 'ebs',
  aws_efs: 'efs',
  aws_fsx: 'fsx',
  aws_fsx_lustre: 'fsx_lustre',
  aws_fsx_data_repository_association: 'fsx_lustre',
  aws_fsx_ontap: 'fsx_ontap',
  aws_fsx_openzfs: 'fsx_openzfs',
  aws_fsx_windows: 'fsx_windows',
  aws_fsx_file_cache: 'file_cache',
  aws_backup: 'backup',
  aws_storagegateway: 'storage_gateway',
  aws_drs: 'drs',
  aws_transfer: 'transfer_family',
  aws_datasync: 'datasync',
  aws_media_store: 'mediastore',

  // Database
  aws_db: 'rds',
  aws_rds: 'rds',
  aws_rds_cluster: 'aurora',
  aws_rds_global_cluster: 'aurora',
  aws_dynamodb: 'dynamodb',
  aws_dax: 'dynamodb',
  aws_elasticache: 'elasticache',
  aws_memorydb: 'memorydb',
  aws_docdb: 'documentdb',
  aws_docdbelastic: 'documentdb',
  aws_neptune: 'neptune',
  aws_keyspaces: 'keyspaces',
  aws_timestreamwrite: 'timestream',
  aws_timestreaminfluxdb: 'timestream',
  aws_qldb: 'qldb',
  aws_dms: 'dms',

  // Analytics
  aws_redshift: 'redshift',
  aws_redshiftserverless: 'redshift',
  aws_redshiftdata: 'redshift',
  aws_athena: 'athena',
  aws_glue: 'glue',
  aws_databrew: 'databrew',
  aws_emr: 'emr',
  aws_emrserverless: 'emr',
  aws_emrcontainers: 'emr',
  aws_kinesis_stream: 'kinesis_data_streams',
  aws_kinesis_resource_policy: 'kinesis_data_streams',
  aws_kinesis_firehose: 'kinesis_firehose',
  aws_kinesis_analytics: 'kinesis_analytics',
  aws_kinesisanalyticsv2: 'kinesis_analytics',
  aws_kinesis_video: 'kinesis_video',
  aws_msk: 'msk',
  aws_mskconnect: 'msk',
  aws_opensearch: 'opensearch',
  aws_opensearchserverless: 'opensearch',
  aws_elasticsearch: 'opensearch',
  aws_cloudsearch: 'cloudsearch',
  aws_quicksight: 'quicksight',
  aws_lakeformation: 'lake_formation',
  aws_dataexchange: 'data_exchange',
  aws_datapipeline: 'data_pipeline',
  aws_datazone: 'datazone',
  aws_cleanrooms: 'clean_rooms',
  aws_finspace: 'finspace',

  // Integration
  aws_sqs: 'sqs',
  aws_sns: 'sns',
  aws_cloudwatch_event: 'eventbridge',
  aws_scheduler: 'eventbridge',
  aws_pipes: 'eventbridge',
  aws_schemas: 'eventbridge',
  aws_sfn: 'step_functions',
  aws_appsync: 'appsync',
  aws_mq: 'mq',
  aws_appflow: 'appflow',
  aws_mwaa: 'mwaa',
  aws_ses: 'ses',
  aws_sesv2: 'ses',
  aws_pinpoint: 'pinpoint',
  aws_connect: 'connect',
  aws_chime: 'chime',
  aws_chimesdkmediapipelines: 'chime',
  aws_chimesdkvoice: 'chime',
  aws_workmail: 'workmail',
  aws_iot: 'iot_core',
  aws_iotanalytics: 'iot_analytics',
  aws_iotevents: 'iot_events',
  aws_greengrass: 'iot_greengrass',
  aws_iotsitewise: 'iot_sitewise',
  aws_iottwinmaker: 'iot_twinmaker',
  aws_iotfleetwise: 'iot_fleetwise',
  aws_location: 'location',

  // AI & machine learning
  aws_sagemaker: 'sagemaker',
  aws_comprehend: 'comprehend',
  aws_kendra: 'kendra',
  aws_lex: 'lex',
  aws_lexv2models: 'lex',
  aws_rekognition: 'rekognition',
  aws_transcribe: 'transcribe',
  aws_devopsguru: 'devops_guru',

  // Security & identity
  aws_security_group: 'security_group',
  aws_default_security_group: 'security_group',
  aws_vpc_security_group: 'security_group',
  aws_iam: 'iam',
  aws_ssoadmin: 'identity_center',
  aws_identitystore: 'identity_center',
  aws_verifiedpermissions: 'verified_permissions',
  aws_cognito: 'cognito',
  aws_directory_service: 'directory_service',
  aws_kms: 'kms',
  aws_cloudhsm_v2: 'cloudhsm',
  aws_secretsmanager: 'secretsmanager',
  aws_acm: 'acm',
  aws_acmpca: 'private_ca',
  aws_signer: 'signer',
  aws_waf: 'waf',
  aws_wafv2: 'waf',
  aws_wafregional: 'waf',
  aws_shield: 'shield',
  aws_fms: 'firewall_manager',
  aws_networkfirewall: 'network_firewall',
  aws_guardduty: 'guardduty',
  aws_inspector: 'inspector',
  aws_inspector2: 'inspector',
  aws_macie2: 'macie',
  aws_securityhub: 'security_hub',
  aws_securitylake: 'security_lake',
  aws_detective: 'detective',
  aws_auditmanager: 'audit_manager',
  aws_ram: 'ram',

  // Management & operations
  aws_autoscalingplans: 'autoscaling_plans',
  aws_cloudwatch: 'cloudwatch',
  aws_oam: 'cloudwatch',
  aws_rum: 'cloudwatch',
  aws_synthetics: 'cloudwatch',
  aws_internetmonitor: 'cloudwatch',
  aws_evidently: 'cloudwatch',
  aws_cloudtrail: 'cloudtrail',
  aws_config: 'config',
  aws_cloudformation: 'cloudformation',
  aws_ssm: 'systems_manager',
  aws_ssmcontacts: 'systems_manager',
  aws_ssmincidents: 'systems_manager',
  aws_ssmquicksetup: 'systems_manager',
  aws_organizations: 'organizations',
  aws_account: 'organizations',
  aws_controltower: 'control_tower',
  aws_servicecatalog: 'service_catalog',
  aws_servicecatalogappregistry: 'service_catalog',
  aws_appconfig: 'appconfig',
  aws_licensemanager: 'license_manager',
  aws_resiliencehub: 'resilience_hub',
  aws_resourceexplorer2: 'resource_explorer',
  aws_fis: 'fis',
  aws_chatbot: 'chatbot',
  aws_proton: 'proton',
  aws_grafana: 'grafana',
  aws_prometheus: 'prometheus',
  aws_opsworks: 'opsworks',
  aws_budgets: 'budgets',
  aws_ce: 'cost_explorer',
  aws_cur: 'cost_usage_report',
  aws_bcmdataexports: 'cost_usage_report',

  // Developer tools
  aws_devicefarm: 'device_farm',
  aws_codebuild: 'codebuild',
  aws_codecommit: 'codecommit',
  aws_codedeploy: 'codedeploy',
  aws_codepipeline: 'codepipeline',
  aws_codestarconnections: 'codepipeline',
  aws_codestarnotifications: 'codepipeline',
  aws_codeconnections: 'codepipeline',
  aws_codeartifact: 'codeartifact',
  aws_codecatalyst: 'codecatalyst',
  aws_codegurureviewer: 'codeguru',
  aws_codeguruprofiler: 'codeguru',
  aws_xray: 'xray',
  aws_cloud9: 'cloud9'
};

/** Exact resource type → icon key overrides, checked before SERVICE_PREFIXES. */
const RESOURCE_MAP = {
  // Compute
  aws_lambda_layer_version: 'lambda',

  // Networking
  aws_vpc_ipam: 'vpc',
  aws_lb_cookie_stickiness_policy: 'alb',

  // Analytics
  aws_kinesis_stream_consumer: 'kinesis_data_streams',

  // Integration
  aws_stepfunctions_state_machine: 'step_functions'
};

export const awsProvider = {
  id: 'aws',
  name: 'Amazon Web Services',
  shortName: 'AWS',
  accentColor: '#FF9900',
  typePrefixes: ['aws_'],
  categories: CATEGORIES,
  icons: ICONS,
  resourceMap: RESOURCE_MAP,
  servicePrefixes: SERVICE_PREFIXES,
  genericIconKey: 'generic',

  terms: {
    network: 'VPC',
    subnet: 'Subnet',
    zone: 'Availability Zone',
    region: 'Region',
    tags: 'Resource Tags',
    group: 'Account Scope'
  },

  hierarchy: {
    networkTypes: ['aws_vpc'],
    subnetTypes: ['aws_subnet'],
    networkRefKeys: ['vpc_id'],
    subnetRefKeys: ['subnet_id', 'subnet_ids.0', 'vpc_config.0.subnet_ids.0'],
    zoneKeys: ['availability_zone'],
    regionKeys: ['region'],
    cidrKeys: ['cidr_block'],
    tagKeys: ['tags'],
    groupKeys: [],
    publicSubnetHints: ['pub', 'dmz', 'edge', 'ingress'],
    isPublicSubnet: (attrs) => attrs.map_public_ip_on_launch === true
  },

  /**
   * Infer architectural traffic-flow edges between AWS resources.
   */
  inferEdges(nodes, addEdge) {
    const by = (fn) => nodes.filter(fn);
    const cloudfront = by(n => n.type === 'aws_cloudfront_distribution');
    const route53 = by(n => n.type.startsWith('aws_route53'));
    const albs = by(n => n.type === 'aws_lb' || n.type === 'aws_alb');
    const targetGroups = by(n => n.type === 'aws_lb_target_group' || n.type === 'aws_alb_target_group');
    const apigws = by(n => n.type.includes('apigateway') || n.type.includes('api_gateway') || n.type.includes('appsync'));
    const lambdas = by(n => n.type === 'aws_lambda_function');
    const ec2s = by(n => n.type === 'aws_instance' || n.type === 'aws_autoscaling_group');
    const rdss = by(n => n.type === 'aws_db_instance' || n.type === 'aws_rds_cluster');
    const dynamodbs = by(n => n.type === 'aws_dynamodb_table');
    const elasticaches = by(n => n.type.startsWith('aws_elasticache_cluster') || n.type.startsWith('aws_elasticache_replication_group'));
    const s3s = by(n => n.type === 'aws_s3_bucket');
    const igws = by(n => n.type === 'aws_internet_gateway');
    const natgws = by(n => n.type === 'aws_nat_gateway');
    const routeTables = by(n => n.type === 'aws_route_table');
    const sqsList = by(n => n.type === 'aws_sqs_queue');
    const snsList = by(n => n.type === 'aws_sns_topic');
    const events = by(n => n.type.includes('cloudwatch_event'));
    const alarms = by(n => n.type === 'aws_cloudwatch_metric_alarm');
    const sfnList = by(n => n.type.includes('stepfunctions') || n.type.includes('sfn'));
    const eksList = by(n => n.type === 'aws_eks_cluster');
    const nodeGroups = by(n => n.type === 'aws_eks_node_group');
    const ecsClusters = by(n => n.type === 'aws_ecs_cluster');
    const ecsServices = by(n => n.type === 'aws_ecs_service');
    const ecsTasks = by(n => n.type === 'aws_ecs_task_definition');
    const ecrList = by(n => n.type === 'aws_ecr_repository');
    const kmsKeys = by(n => n.type === 'aws_kms_key');
    const secrets = by(n => n.type === 'aws_secretsmanager_secret');
    const wafList = by(n => n.type.startsWith('aws_waf'));
    const certs = by(n => n.type.startsWith('aws_acm_certificate'));
    const cognitoList = by(n => n.type === 'aws_cognito_user_pool');
    const vpcList = by(n => n.type === 'aws_vpc');
    const peerings = by(n => n.type === 'aws_vpc_peering_connection');
    const tgws = by(n => n.type === 'aws_ec2_transit_gateway');

    route53.forEach(r => {
      cloudfront.forEach(cf => addEdge(r.id, cf.id, 'DNS'));
      albs.forEach(alb => addEdge(r.id, alb.id, 'DNS'));
      apigws.forEach(gw => addEdge(r.id, gw.id, 'DNS'));
    });

    wafList.forEach(waf => {
      cloudfront.forEach(cf => addEdge(waf.id, cf.id, 'WAF Shield', 'security'));
      albs.forEach(alb => addEdge(waf.id, alb.id, 'WAF Shield', 'security'));
      apigws.forEach(gw => addEdge(waf.id, gw.id, 'WAF Shield', 'security'));
    });

    certs.forEach(cert => {
      cloudfront.forEach(cf => addEdge(cert.id, cf.id, 'TLS Cert', 'security'));
      albs.forEach(alb => addEdge(cert.id, alb.id, 'TLS Cert', 'security'));
    });

    cloudfront.forEach(cf => {
      s3s.forEach(s3 => addEdge(cf.id, s3.id, 'Origin'));
      albs.forEach(alb => addEdge(cf.id, alb.id, 'Origin'));
      apigws.forEach(gw => addEdge(cf.id, gw.id, 'Origin'));
    });

    igws.forEach(igw => {
      albs.forEach(alb => addEdge(igw.id, alb.id, 'Traffic'));
      natgws.forEach(nat => addEdge(igw.id, nat.id, 'Egress'));
    });

    routeTables.forEach(rt => {
      natgws.forEach(nat => addEdge(rt.id, nat.id, 'Route', 'dependency'));
      igws.forEach(igw => addEdge(rt.id, igw.id, 'Route', 'dependency'));
    });

    albs.forEach(alb => {
      targetGroups.forEach(tg => addEdge(alb.id, tg.id, 'Forward'));
      ec2s.forEach(ec2 => addEdge(alb.id, ec2.id, 'HTTP/HTTPS'));
      nodeGroups.forEach(ng => addEdge(alb.id, ng.id, 'Forward'));
      ecsServices.forEach(svc => addEdge(alb.id, svc.id, 'Forward'));
    });

    targetGroups.forEach(tg => {
      ec2s.forEach(ec2 => addEdge(tg.id, ec2.id, 'Target'));
      ecsServices.forEach(svc => addEdge(tg.id, svc.id, 'Target'));
    });

    natgws.forEach(nat => {
      ec2s.forEach(ec2 => addEdge(nat.id, ec2.id, 'NAT'));
      nodeGroups.forEach(ng => addEdge(nat.id, ng.id, 'NAT'));
      ecsServices.forEach(svc => addEdge(nat.id, svc.id, 'NAT'));
    });

    apigws.forEach(gw => {
      lambdas.forEach(l => addEdge(gw.id, l.id, 'Invoke'));
      albs.forEach(alb => addEdge(gw.id, alb.id, 'Proxy'));
    });

    cognitoList.forEach(cog => {
      apigws.forEach(gw => addEdge(cog.id, gw.id, 'Auth', 'security'));
      albs.forEach(alb => addEdge(cog.id, alb.id, 'Auth', 'security'));
    });

    ecsClusters.forEach(cluster => {
      ecsServices.forEach(svc => addEdge(cluster.id, svc.id, 'Service', 'dependency'));
    });

    ecsServices.forEach(svc => {
      ecsTasks.forEach(task => addEdge(svc.id, task.id, 'Task Def', 'dependency'));
    });

    eksList.forEach(eks => nodeGroups.forEach(ng => addEdge(eks.id, ng.id, 'Managed', 'dependency')));

    ecrList.forEach(ecr => {
      nodeGroups.forEach(ng => addEdge(ecr.id, ng.id, 'Container Image'));
      eksList.forEach(eks => addEdge(ecr.id, eks.id, 'Container Image'));
      ecsServices.forEach(svc => addEdge(ecr.id, svc.id, 'Container Image'));
      lambdas.forEach(l => addEdge(ecr.id, l.id, 'Image'));
    });

    const computeWorkloads = [...lambdas, ...ec2s, ...ecsServices, ...nodeGroups];

    lambdas.forEach(l => {
      dynamodbs.forEach(d => addEdge(l.id, d.id, 'Read/Write'));
      rdss.forEach(r => addEdge(l.id, r.id, 'Query'));
      s3s.forEach(s => addEdge(l.id, s.id, 'Store'));
      sqsList.forEach(q => addEdge(l.id, q.id, 'Enqueue'));
      elasticaches.forEach(c => addEdge(l.id, c.id, 'Cache'));
    });

    snsList.forEach(sns => {
      sqsList.forEach(sqs => addEdge(sns.id, sqs.id, 'Subscribe'));
      lambdas.forEach(l => addEdge(sns.id, l.id, 'Trigger'));
    });

    events.forEach(ev => {
      lambdas.forEach(l => addEdge(ev.id, l.id, 'Rule Event'));
      sqsList.forEach(s => addEdge(ev.id, s.id, 'Target'));
      snsList.forEach(s => addEdge(ev.id, s.id, 'Target'));
    });

    alarms.forEach(alm => {
      snsList.forEach(sns => addEdge(alm.id, sns.id, 'Alarm Action'));
    });

    sfnList.forEach(sfn => {
      lambdas.forEach(l => addEdge(sfn.id, l.id, 'Step Invoke'));
      sqsList.forEach(s => addEdge(sfn.id, s.id, 'Step Enqueue'));
      snsList.forEach(s => addEdge(sfn.id, s.id, 'Step Notify'));
    });

    ec2s.forEach(ec2 => {
      rdss.forEach(rds => addEdge(ec2.id, rds.id, 'SQL TCP:5432/3306'));
      dynamodbs.forEach(d => addEdge(ec2.id, d.id, 'NoSQL'));
      s3s.forEach(s => addEdge(ec2.id, s.id, 'Assets'));
      elasticaches.forEach(c => addEdge(ec2.id, c.id, 'Cache'));
    });

    secrets.forEach(sec => {
      computeWorkloads.forEach(w => addEdge(w.id, sec.id, 'Secret', 'security'));
      rdss.forEach(r => addEdge(r.id, sec.id, 'Auth Creds', 'security'));
    });

    kmsKeys.forEach(key => {
      secrets.forEach(sec => addEdge(key.id, sec.id, 'KMS Encryption', 'security'));
      s3s.forEach(s => addEdge(key.id, s.id, 'SSE-KMS', 'security'));
      rdss.forEach(r => addEdge(key.id, r.id, 'Storage KMS', 'security'));
      eksList.forEach(eks => addEdge(key.id, eks.id, 'Envelope KMS', 'security'));
    });

    peerings.forEach(peer => {
      vpcList.forEach(vpc => addEdge(peer.id, vpc.id, 'VPC Peering', 'peering'));
    });

    tgws.forEach(tgw => {
      vpcList.forEach(vpc => addEdge(tgw.id, vpc.id, 'TGW Attachment', 'peering'));
    });
  },

  /** Resources that belong at the top of the diagram, outside any network. */
  isEntryResource(type) {
    return type.startsWith('aws_route53') ||
      type.includes('cloudfront') ||
      type.includes('cognito') ||
      type.includes('apigateway') ||
      type.includes('api_gateway') ||
      type.startsWith('aws_waf');
  }
};

export default awsProvider;
