import { useState, useEffect, useCallback } from 'react';
import {
  Stepper, Button, Group, Container, Switch, Code, Flex, Paper, Stack, Divider, Text, Alert,
  Progress, ThemeIcon, Box, Badge, Loader, Title, SimpleGrid, Accordion
} from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  IconRefresh, IconInfoCircle, IconAlertTriangle, IconRocket, IconCheck,
  IconCloud, IconSettings, IconShield, IconDatabase, IconPlug,
  IconListDetails, IconChevronRight, IconChevronLeft, IconBulb,
  IconCircleCheck, IconPlayerPlay, IconLoader2
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { callGoApi } from '@/lib/k8s';
import YAML from 'yaml';

import Editor from "@monaco-editor/react";
import { useSession } from 'next-auth/react';

import DestinationStep from './steps/DestinationStep';
import DatabaseStep from './steps/DatabaseStep';
import HostnameStep from './steps/HostnameStep';
import ModulesStep from './steps/ModulesStep';
import AuthStep from './steps/AuthStep';
import YamlEditor from '../YamlEditor/YamlEditor';
import ConfigStep from './steps/ConfigStep';
import GlobalSettingsStep from './steps/GlobalSettingsStep';

const STEP_CONFIG = [
  { label: 'Destination', description: 'Cluster & namespace', icon: IconCloud, color: 'blue' },
  { label: 'Globals',     description: 'Core settings',      icon: IconSettings, color: 'violet' },
  { label: 'Hostname',    description: 'TLS & domain',        icon: IconShield, color: 'indigo' },
  { label: 'Database',    description: 'Postgres config',     icon: IconDatabase, color: 'green' },
  { label: 'Services',    description: 'Enable modules',      icon: IconPlug, color: 'orange' },
  { label: 'Auth',        description: 'OIDC / login',        icon: IconShield, color: 'red' },
  { label: 'Config',      description: 'Per-service detail',  icon: IconListDetails, color: 'grape' },
  { label: 'Deploy',      description: 'Review & launch',    icon: IconRocket, color: 'teal' },
];

const StepperForm = () => {
  const [active, setActive] = useState(0);
  const [clusters, setClusters] = useState([]);
  const [certs, setCerts] = useState([]);
  const [debugMode, setDebugMode] = useState(false);
  const { data: sessionData } = useSession();
  const accessToken = sessionData?.accessToken;

  // Deploy state
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState(null);
  const [deployError, setDeployError] = useState(null);
  const [releaseStatus, setReleaseStatus] = useState(null);
  const [namespaceStatus, setNamespaceStatus] = useState(null);
  const [deployComplete, setDeployComplete] = useState(false);

  const form = useForm({
    initialValues: {
      destination: {
        cluster: '',
        releaseName: 'gen3-test',
        namespace: '',
        useCustomNs: false,
        repoUrl: 'https://helm.gen3.org',
        chartName: 'gen3',
        chartVersion: '',
      },
      values: {
        // ── global (aligned with gen3-helm/helm/gen3/values.yaml lines 6-147) ──
        global: {
          environment: "default",
          clusterName: "default",
          hostname: "localhost",
          dev: true,

          // Cloud provider selection (UI-only helper, not sent to helm)
          _cloudProvider: "none",

          // GCP
          gcp: {
            enabled: false,
            projectID: "",
            secretStoreServiceAccount: "",
          },

          // AWS
          aws: {
            region: "us-east-1",
            enabled: false,
            awsAccessKeyId: "",
            awsSecretAccessKey: "",
            externalSecrets: {
              enabled: false,
              externalSecretAwsCreds: "",
              pushSecret: false,
            },
            secretStoreServiceAccount: {
              enabled: false,
              name: "secret-store-sa",
              roleArn: "",
            },
            useLocalSecret: {
              enabled: false,
              localSecretName: "",
            },
            _credStrategy: "keys", // UI-only: keys | irsa | localSecret | externalSecrets
          },

          // Crossplane
          crossplane: {
            enabled: false,
            providerConfigName: "provider-aws",
            oidcProviderUrl: "",
            accountId: "",
            s3: {
              kmsKeyId: "",
              versioningEnabled: false,
            },
          },

          // Postgres
          postgres: {
            dbCreate: true,
            externalSecret: "",
            master: {
              username: "postgres",
              password: "",
              host: "",
              port: "5432",
            },
          },

          // Core identity
          revproxyArn: "",
          dictionaryUrl: "https://s3.amazonaws.com/dictionary-artifacts/datadictionary/develop/schema.json",
          portalApp: "gitops",

          // Access control
          publicDataSets: true,
          tierAccessLevel: "private",
          tierAccessLimit: "1000",
          logoutInactiveUsers: true,
          workspaceTimeoutInMinutes: 480,
          maintenanceMode: "off",
          dataUploadBucket: "",

          // Networking
          netPolicy: {
            enabled: false,
            dbSubnets: [],
          },
          pdb: false,
          dispatcherJobNum: "10",

          // Frontend
          frontendRoot: "gen3ff",

          // Observability
          metricsEnabled: true,
          createSlackWebhookSecret: false,
          slackWebhook: "",

          // External Secrets (global)
          externalSecrets: {
            deploy: false,
            createLocalK8sSecret: false,
            clusterSecretStoreRef: "",
            createSlackWebhookSecret: false,
            slackWebhookSecretName: "",
          },

          // Topology Spread
          topologySpread: {
            enabled: false,
            topologyKey: "topology.kubernetes.io/zone",
            maxSkew: 1,
          },

          manifestGlobalExtraValues: {},
        },

        // ── Infrastructure charts ──
        postgresql: {
          image: {
            repository: "bitnamilegacy/postgresql",
            tag: "16.6.0-debian-12-r2",
          },
          primary: {
            persistence: { enabled: false },
          },
        },
        elasticsearch: {
          image: "quay.io/cdis/elasticsearch",
          imageTag: "7.10.2",
          clusterName: "gen3-elasticsearch",
          maxUnavailable: 0,
          singleNode: true,
          replicas: 1,
          clusterHealthCheckParams: "wait_for_status=yellow&timeout=1s",
          resources: { requests: { cpu: "500m" } },
        },

        // ── Service toggles (aligned with Chart.yaml conditions) ──
        // Core services — enabled by default
        ambassador: { enabled: false },
        arborist: { enabled: true },
        audit: { enabled: true },
        fence: {
          enabled: true,
          usersync: {
            usersync: false,
            schedule: "*/30 * * * *",
            custom_image: null,
            syncFromDbgap: false,
            addDbgap: false,
            onlyDbgap: false,
            userYamlS3Path: "s3://cdis-gen3-users/helm-test/user.yaml",
            slack_webhook: "None",
            slack_send_dbgap: false,
            env: null,
          },
          FENCE_CONFIG: {
            OPENID_CONNECT: {
              generic_oidc_idp: {
                enabled: false,
                name: '',
                client_id: '',
                client_secret: '',
                redirect_url: '',
                discovery_url: '',
                discovery: {
                  authorization_endpoint: '',
                  token_endpoint: '',
                  jwks_uri: '',
                },
                user_id_field: '',
                email_field: '',
                scope: '',
              },
              google: {
                enabled: false,
                discovery_url: 'https://accounts.google.com/.well-known/openid-configuration',
                client_id: '',
                client_secret: '',
                redirect_url: '{{BASE_URL}}/login/google/login/',
                scope: 'openid email',
                mock: '',
                mock_default_user: 'test@example.com',
              },
            },
          },
        },
        "frontend-framework": { enabled: true, image: { repository: "quay.io/cdis/commons-frontend-app", tag: "main" } },
        hatchery: {
          enabled: false,
          hatchery: {
            sidecarContainer: {
              "cpu-limit": "0.1",
              "memory-limit": "256Mi",
              image: "quay.io/cdis/ecs-ws-sidecar:master",
              env: {
                NAMESPACE: "{{ .Release.Namespace }}",
                HOSTNAME: "{{ .Values.global.hostname }}"
              },
              args: [],
              command: ["/bin/bash", "./sidecar.sh"],
              "lifecycle-pre-stop": ["su", "-c", "echo test", "-s", "/bin/sh", "root"],
            },
            containers: [
              {
                "target-port": 8888,
                "cpu-limit": "2",
                "memory-limit": "3Gi",
                name: "(Tutorials) Example Analysis Jupyter Lab Notebooks",
                image: "quay.io/cdis/jupyter-superslim:2.1.0",
                env: { FRAME_ANCESTORS: "https://{{ .Values.global.hostname }}" },
                args: ["--NotebookApp.base_url=/lw-workspace/proxy/", "--NotebookApp.default_url=/lab"],
                command: ["start-notebook.sh"],
                "path-rewrite": "/lw-workspace/proxy/",
                "use-tls": "false",
                "ready-probe": "/lw-workspace/proxy/",
                "lifecycle-post-start": ["/bin/sh", "-c", "export IAM=$(whoami); rm -rf /home/$IAM/pd/dockerHome; rm -rf /home/$IAM/pd/lost+found; ln -s /data /home/$IAM/pd; true"],
                "user-uid": 1010,
                "fs-gid": 100,
                "user-volume-location": "/home/jovyan/pd",
                "gen3-volume-location": "/home/jovyan/.gen3",
              },
            ],
            reaper: {
              enabled: true,
              suspendCronjob: false,
              schedule: "*/15 * * * *",
              idleTimeoutSeconds: 3600,
            },
          },
        },
        indexd: { enabled: true, defaultPrefix: "PREFIX/" },
        manifestservice: { enabled: false },
        metadata: { enabled: true },
        peregrine: { enabled: true },
        portal: { enabled: false },
        revproxy: {
          enabled: true,
          ingress: {
            enabled: false,
            annotations: {},
            hosts: [],
            tls: [],
          },
        },
        sheepdog: { enabled: true },
        wts: { enabled: true },
        etl: { enabled: true },

        // Data Explorer — disabled by default
        guppy: { enabled: false, esEndpoint: "" },

        // Workspace & Workflow — disabled by default
        "argo-wrapper": { enabled: false },
        "gen3-workflow": { enabled: false },

        // Medical Imaging — disabled by default
        "dicom-server": { enabled: false },
        orthanc: { enabled: false },
        "ohif-viewer": { enabled: false },

        // Observability & Security — disabled by default
        "aws-es-proxy": { enabled: false, esEndpoint: "", secrets: { awsAccessKeyId: "", awsSecretAccessKey: "" } },
        "aws-sigv4-proxy": { enabled: false },

        // OHDSI — disabled by default
        "ohdsi-atlas": { enabled: false },
        "ohdsi-webapi": { enabled: false },

        // Other Services — disabled by default
        "cohort-middleware": { enabled: false },
        dashboard: { enabled: false, dashboardConfig: { bucket: "generic-dashboard-bucket", prefix: "hostname.com" } },
        "embedding-management-service": { enabled: false },
        "gen3-analysis": { enabled: false },
        "gen3-user-data-library": { enabled: false },
        requestor: { enabled: false },
        sower: { enabled: false },
        "ssjdispatcher": { enabled: false },

        // Misc top-level values
        mutatingWebhook: { enabled: false, image: "quay.io/cdis/node-affinity-daemonset:feat_pods" },
        secrets: { awsAccessKeyId: "", awsSecretAccessKey: "" },
        tests: {
          TEST_LABEL: "",
          SERVICE_TO_TEST: "",
          resources: { requests: { memory: "6G" }, limits: { memory: "10G" } },
          image: { tag: "master" },
        },
        auroraRdsCopyJob: {
          enabled: false,
          auroraMasterSecret: "",
          sourceNamespace: "",
          targetNamespace: "",
          writeToK8sSecret: false,
          writeToAwsSecret: false,
          services: [],
        },
      },
    },
  });

  const fetchClusters = async () => {
    try {
      const data = await callGoApi('/agents', 'GET', null, null, accessToken);
      const clusterData = data.filter(c => c.connected).map(c => ({ label: c.name, value: c.name }));
      setClusters(clusterData);
    } catch (err) {
      console.error('Error fetching clusters', err);
    }
  };

  const fetchCerts = async () => {
    try {
      const data = await callGoApi('/aws/certificates', 'GET', null, null, accessToken);
      const certOptions = data.map((cert) => ({
        value: cert.arn,
        label: cert.domainName,
      }));
      setCerts(certOptions);
    } catch (err) {
      console.error('Error fetching certs', err);
    }
  };

  // Poll helm releases for deployment status
  const pollReleaseStatus = useCallback(() => {
    const dest = form.values.destination;
    const ns = dest.namespace || dest.releaseName;
    if (!dest.cluster) return;

    const interval = setInterval(async () => {
      try {
        // Poll helm release status
        const data = await callGoApi(`/agents/${dest.cluster}/helm/list`, 'GET', null, null, accessToken);
        if (Array.isArray(data)) {
          const release = data.find(r =>
            r.name === dest.releaseName && r.namespace === ns
          );
          if (release) {
            setReleaseStatus(release);
            if (release.status === 'deployed') {
              clearInterval(interval);
              setDeployComplete(true);
              setDeploying(false);
              notifications.show({
                title: 'Deployment Complete',
                message: `${dest.releaseName} is deployed and running!`,
                color: 'green',
              });
            }
          }
        }

        // Poll namespace deployment/pod status via agent
        try {
          const nsData = await callGoApi(`/agent/${dest.cluster}/namespace/${ns}/status`, 'GET', null, null, accessToken);
          if (nsData) {
            setNamespaceStatus(nsData);
          }
        } catch (nsErr) {
          console.error('Error polling namespace status:', nsErr);
        }
      } catch (err) {
        console.error('Error polling release status:', err);
      }
    }, 5000);

    // Timeout after 10 minutes
    setTimeout(() => {
      clearInterval(interval);
      if (!deployComplete) {
        setDeploying(false);
        notifications.show({
          title: 'Deployment Timeout',
          message: 'Deployment is still in progress. Check your cluster for status.',
          color: 'orange',
        });
      }
    }, 600000);

    return () => clearInterval(interval);
  }, [accessToken, form.values.destination, deployComplete]);

  const deploy = async () => {
    const dest = form.values.destination;
    setDeployError(null);
    setDeployResult(null);
    setReleaseStatus(null);
    setDeployComplete(false);
    setDeploying(true);

    const body = {
      repoUrl: dest.repoUrl || 'https://helm.gen3.org',
      chart: dest.chartName || 'gen3',
      version: dest.chartVersion || undefined,
      release: dest.releaseName,
      namespace: dest.namespace === '' ? dest.releaseName : dest.namespace,
      values: form.values.values,
    };
    try {
      const res = await callGoApi(`/agent/${dest.cluster}/helm/install`, 'POST', body, null, accessToken);
      setDeployResult(res);
      // Start polling for status
      pollReleaseStatus();
    } catch (err) {
      console.error('Deployment failed:', err);
      setDeployError(err.message || 'Deployment failed');
      setDeploying(false);
      notifications.show({
        title: 'Deployment Failed',
        message: err.message || 'Could not deploy Gen3. Check the configuration.',
        color: 'red',
      });
    }
  };

  useEffect(() => {
    if (!accessToken) return;
    const load = async () => {
      try { await fetchClusters(); } catch (err) { console.error('Error fetching clusters:', err); }
    };
    load();
  }, [accessToken]);

  // Build validation warnings for the review step
  const getValidationWarnings = () => {
    const v = form.values.values;
    const warnings = [];
    if (!v.global.hostname || v.global.hostname === 'localhost') {
      warnings.push('Hostname is still set to "localhost" — update it for a real deployment');
    }
    if (v.fence?.enabled && !v.fence?.FENCE_CONFIG?.OPENID_CONNECT?.google?.client_id && !v.fence?.FENCE_CONFIG?.OPENID_CONNECT?.generic_oidc_idp?.client_id) {
      warnings.push('Fence is enabled but no OIDC provider is configured — users will not be able to log in');
    }
    if (!v.global.dev && !v.global.postgres.master.host) {
      warnings.push('Production mode (dev=false) but no external Postgres host configured');
    }
    return warnings;
  };

  const progressPct = Math.round((active / (STEP_CONFIG.length - 1)) * 100);

  const dest = form.values.destination;
  const ns = dest.namespace || dest.releaseName;

  // Count enabled services
  const enabledServices = Object.entries(form.values.values)
    .filter(([key, val]) => typeof val === 'object' && val !== null && val.enabled === true)
    .map(([key]) => key);

  // ─── Step renderers ──────────────────────────────────────────────

  const renderReviewStep = () => (
    <Stack gap="lg">
      {/* Header */}
      <div ta="center">
        <ThemeIcon size={56} radius="xl" variant="light" color="teal">
          <IconRocket size={28} stroke={1.5} />
        </ThemeIcon>
        <Title order={3} mt="sm">Ready to Deploy</Title>
        <Text c="dimmed" mt={4} maw={500} mx="auto">
          Review your configuration below, then launch your Gen3 Data Commons.
        </Text>
      </div>

      {/* Validation warnings */}
      {(() => {
        const warnings = getValidationWarnings();
        return warnings.length > 0 ? (
          <Alert icon={<IconAlertTriangle size={18} />} variant="light" color="orange" radius="md">
            <Text size="sm" fw={600}>Configuration Warnings</Text>
            <Stack gap={4} mt="xs">
              {warnings.map((w, i) => <Text key={i} size="sm">{w}</Text>)}
            </Stack>
          </Alert>
        ) : null;
      })()}

      {/* Deployment summary cards */}
      <SimpleGrid cols={4} w="100%">
        <Paper withBorder p="md" radius="lg">
          <Text size="xs" c="dimmed" tt="uppercase" fw={700} ls="lg">Cluster</Text>
          <Text size="sm" fw={600} mt={4}>{dest.cluster || '(not selected)'}</Text>
        </Paper>
        <Paper withBorder p="md" radius="lg">
          <Text size="xs" c="dimmed" tt="uppercase" fw={700} ls="lg">Release</Text>
          <Text size="sm" fw={600} mt={4}>{dest.releaseName}</Text>
        </Paper>
        <Paper withBorder p="md" radius="lg">
          <Text size="xs" c="dimmed" tt="uppercase" fw={700} ls="lg">Namespace</Text>
          <Text size="sm" fw={600} mt={4}>{ns}</Text>
        </Paper>
        <Paper withBorder p="md" radius="lg">
          <Text size="xs" c="dimmed" tt="uppercase" fw={700} ls="lg">Services</Text>
          <Text size="sm" fw={600} mt={4}>{enabledServices.length} enabled</Text>
        </Paper>
      </SimpleGrid>

      {/* Not yet deploying — show review + deploy button */}
      {!deploying && !deployComplete && !deployResult && (
        <>
          <Paper withBorder p="lg" radius="lg">
            <Group justify="space-between" mb="sm">
              <Text size="sm" fw={600}>Generated Configuration</Text>
              <Badge size="xs" variant="light" color="gray">values.yaml</Badge>
            </Group>
            <Editor
              className='border rounded-lg'
              value={YAML.stringify(form.values.values, null, 2)}
              defaultLanguage='yaml'
              height={"400px"}
              readOnly={true}
              theme={'light'}
              options={{
                readOnly: true,
                scrollBeyondLastLine: false,
                minimap: { enabled: false },
                fontSize: 12,
              }}
            />
          </Paper>

          {deployError && (
            <Alert icon={<IconAlertTriangle size={18} />} variant="light" color="red" radius="md">
              <Text size="sm" fw={600}>Deployment Error</Text>
              <Text size="xs" mt={4}>{deployError}</Text>
            </Alert>
          )}

          <Flex justify="center">
            <Button
              onClick={deploy}
              size="xl"
              color="teal"
              leftSection={<IconRocket size={20} />}
              rightSection={<IconChevronRight size={18} />}
              disabled={!dest.cluster}
            >
              Deploy Gen3
            </Button>
          </Flex>
        </>
      )}

      {/* Deploying — show live status */}
      {(deploying || deployResult) && !deployComplete && (
        <Stack gap="md">
          <Paper withBorder p="xl" radius="lg" bg="blue.0">
            <Stack align="center" gap="md">
              <ThemeIcon size={64} radius="xl" variant="light" color="blue">
                <Loader size={32} color="blue" />
              </ThemeIcon>
              <Title order={4} ta="center">Deploying Gen3</Title>
              <Text c="dimmed" ta="center" size="sm">
                Sending configuration to <b>{dest.cluster}</b> — installing <b>{dest.releaseName}</b> into namespace <b>{ns}</b>...
              </Text>
              <Loader size="md" type="dots" color="blue" />
            </Stack>
          </Paper>

          {/* Release status from polling */}
          {releaseStatus ? (
            <Paper withBorder p="md" radius="lg">
              <Group justify="space-between" mb="sm">
                <Group gap="sm">
                  <ThemeIcon size="sm" radius="md" variant="filled" color={
                    releaseStatus.status === 'deployed' ? 'green' :
                    releaseStatus.status === 'failed' ? 'red' :
                    releaseStatus.status === 'pending-install' ? 'orange' : 'blue'
                  }>
                    {releaseStatus.status === 'deployed'
                      ? <IconCheck size={14} />
                      : <IconLoader2 size={14} />}
                  </ThemeIcon>
                  <Text size="sm" fw={600}>Release: {releaseStatus.name}</Text>
                </Group>
                <Badge
                  size="sm"
                  color={
                    releaseStatus.status === 'deployed' ? 'green' :
                    releaseStatus.status === 'failed' ? 'red' :
                    releaseStatus.status === 'pending-install' ? 'orange' : 'blue'
                  }
                  variant="filled"
                  radius="sm"
                >
                  {releaseStatus.status}
                </Badge>
              </Group>
              {releaseStatus.revision && (
                <Text size="xs" c="dimmed">Revision: {releaseStatus.revision} | Chart: {releaseStatus.chart} | Updated: {releaseStatus.updated}</Text>
              )}
            </Paper>
          ) : (
            <Paper withBorder p="md" radius="lg" bg="gray.0">
              <Group gap="sm">
                <Loader size="xs" type="dots" />
                <Text size="sm" c="dimmed">Waiting for Helm to register the release...</Text>
              </Group>
            </Paper>
          )}

          {/* Progress timeline */}
          <Stack gap="xs">
            <Group gap="sm">
              <ThemeIcon size="sm" radius="xl" variant="filled" color="green">
                <IconCheck size={12} />
              </ThemeIcon>
              <Text size="sm">Configuration submitted</Text>
            </Group>
            <Group gap="sm">
              <ThemeIcon size="sm" radius="xl" variant={deployResult ? 'filled' : 'outline'} color={deployResult ? 'green' : 'gray'}>
                {deployResult ? <IconCheck size={12} /> : <IconPlayerPlay size={12} />}
              </ThemeIcon>
              <Text size="sm" c={deployResult ? undefined : 'dimmed'}>Agent received install request</Text>
            </Group>
            <Group gap="sm">
              <ThemeIcon size="sm" radius="xl" variant={releaseStatus ? 'filled' : 'outline'} color={releaseStatus ? (releaseStatus.status === 'deployed' ? 'green' : 'blue') : 'gray'}>
                {releaseStatus
                  ? (releaseStatus.status === 'deployed' ? <IconCheck size={12} /> : <IconLoader2 size={12} />)
                  : <IconPlayerPlay size={12} />}
              </ThemeIcon>
              <Text size="sm" c={releaseStatus ? undefined : 'dimmed'}>
                {releaseStatus
                  ? `Helm ${releaseStatus.status} (${releaseStatus.chart})`
                  : 'Helm installing chart...'}
              </Text>
            </Group>
            <Group gap="sm">
              <ThemeIcon size="sm" radius="xl" variant={deployComplete ? 'filled' : 'outline'} color={deployComplete ? 'green' : 'gray'}>
                {deployComplete ? <IconCheck size={12} /> : <IconPlayerPlay size={12} />}
              </ThemeIcon>
              <Text size="sm" c={deployComplete ? undefined : 'dimmed'}>
                {deployComplete ? 'All services running' : 'Pods starting up...'}
              </Text>
            </Group>
          </Stack>
        </Stack>
      )}

      {/* Deploy complete */}
      {deployComplete && (
        <Stack align="center" gap="lg" py="md">
          <ThemeIcon size={80} radius="xl" variant="filled" gradient={{ from: 'teal', to: 'green', deg: 135 }}>
            <IconCircleCheck size={42} stroke={1.5} />
          </ThemeIcon>
          <Title order={3} ta="center">Gen3 Deployed Successfully!</Title>
          <Text c="dimmed" ta="center" maw={480}>
            Your Gen3 Data Commons <Code size="sm">{dest.releaseName}</Code> is running in namespace <Code size="sm">{ns}</Code> on cluster <Code size="sm">{dest.cluster}</Code>.
          </Text>

          {releaseStatus && (
            <Paper withBorder p="md" radius="lg" w="100%" maw={500}>
              <SimpleGrid cols={2}>
                <div>
                  <Text size="xs" c="dimmed">Status</Text>
                  <Text size="sm" fw={600}>{releaseStatus.status}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">Chart</Text>
                  <Text size="sm" fw={600}>{releaseStatus.chart}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">Revision</Text>
                  <Text size="sm" fw={600}>#{releaseStatus.revision}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">Updated</Text>
                  <Text size="sm" fw={600}>{releaseStatus.updated}</Text>
                </div>
              </SimpleGrid>
            </Paper>
          )}

          <Group gap="md" mt="md">
            <Button
              onClick={() => {
                setDeploying(false);
                setDeployResult(null);
                setDeployComplete(false);
                setReleaseStatus(null);
                setDeployError(null);
              }}
              variant="light"
              leftSection={<IconRefresh size={16} />}
            >
              Deploy Another
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );

  const steps = [
    { component: <DestinationStep form={form} clusters={clusters} fetchClusters={fetchClusters} /> },
    { component: <GlobalSettingsStep form={form} /> },
    { component: <HostnameStep form={form} certs={certs} fetchCerts={fetchCerts} /> },
    { component: <DatabaseStep form={form} /> },
    { component: <ModulesStep form={form} /> },
    { component: <AuthStep form={form} /> },
    { component: <ConfigStep form={form} /> },
    { component: renderReviewStep() },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', paddingTop: 24, paddingBottom: 48 }}>
      {/* Header bar */}
      <Paper p="xs" radius="lg" mb="lg" withBorder bg="gray.0">
        <Group justify="space-between">
          <Group gap="md">
            <ThemeIcon size="sm" radius="md" variant="filled" gradient={{ from: 'teal', to: 'green' }}>
              <IconRocket size={14} />
            </ThemeIcon>
            <Text size="sm" fw={600}>Gen3 Deployment Wizard</Text>
          </Group>
          <Group gap="md">
            <Text size="xs" c="dimmed">Step {active + 1} of {STEP_CONFIG.length}</Text>
            <Progress value={progressPct} size="xs" w={120} radius="xl" color="teal" />
          </Group>
        </Group>
      </Paper>

      <Paper shadow="xl" radius="xl" p={0} overflow="hidden">
        <div style={{ display: 'flex', minHeight: 560 }}>

          {/* Sidebar */}
          <div style={{
            width: 240,
            background: 'linear-gradient(180deg, #f8f9fc 0%, #f1f3f9 100%)',
            borderRight: '1px solid #e9ecf2',
            padding: '24px 12px',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <Stepper active={active} orientation="vertical" iconSize={28} size="sm"
              allowNextStepsSelect={true}
              onStepClick={setActive}
              styles={{
                stepBody: { paddingLeft: 10 },
                stepLabel: { fontWeight: 600, fontSize: 13, lineHeight: 1.2 },
                stepDescription: { fontSize: 11, color: '#868e96', marginTop: 2 },
                stepIcon: { borderWidth: 2, cursor: 'pointer' },
                completedIcon: { background: 'transparent' },
                step: { cursor: 'pointer' },
                stepCompleted: { '& .mantine-Stepper-stepIcon': { borderColor: '#40c057', color: '#40c057' } },
              }}
            >
              {STEP_CONFIG.map((step, i) => (
                <Stepper.Step
                  key={i}
                  label={step.label}
                  description={step.description}
                  icon={<step.icon size={14} stroke={2} />}
                />
              ))}
            </Stepper>

            <div style={{ flex: 1 }} />

            <Box mt="md">
              <Progress value={progressPct} size="xs" radius="xl" color="teal" />
              <Text size="xs" c="dimmed" ta="center" mt={4}>{progressPct}% complete</Text>
            </Box>
          </div>

          {/* Main content area */}
          <div style={{ flex: 1, padding: '32px 36px', overflowY: 'auto', background: '#fff' }}>
            {steps[active]?.component}

            {/* Bottom nav */}
            <Box mt="xl">
              <Divider my="lg" />
              <Group justify="space-between">
                <Button
                  variant="default"
                  onClick={() => setActive((c) => Math.max(c - 1, 0))}
                  disabled={active === 0}
                  leftSection={<IconChevronLeft size={16} />}
                >
                  Back
                </Button>
                {active < steps.length - 1 && (
                  <Button
                    onClick={() => setActive((c) => Math.min(c + 1, steps.length - 1))}
                    rightSection={<IconChevronRight size={16} />}
                  >
                    Next
                  </Button>
                )}
              </Group>
            </Box>
          </div>

        </div>
      </Paper>

      {/* Debug mode toggle */}
      <Container fluid mt="xl">
        <Switch label="Debug Mode" checked={debugMode} onChange={(e) => setDebugMode(e.currentTarget.checked)} />

        {debugMode && (
          <Accordion variant="separated" mt="md" defaultValue="">
            <Accordion.Item value="destination">
              <Accordion.Control>Destination Configuration</Accordion.Control>
              <Accordion.Panel>
                <YamlEditor data={form.values?.destination} button={false} readOnly={true} />
              </Accordion.Panel>
            </Accordion.Item>
            <Accordion.Item value="values">
              <Accordion.Control>Generated values.yaml</Accordion.Control>
              <Accordion.Panel>
                <YamlEditor data={form.values?.values} button={false} readOnly={true} />
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        )}
      </Container>
    </div>
  );
};

export default StepperForm;
