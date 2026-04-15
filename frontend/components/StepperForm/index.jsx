import { useState, useEffect } from 'react';
import {
  Stepper, Button, Group, Container, Switch, Code, Flex, Paper, Stack, Divider, Text, Alert,
  useMantineColorScheme
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconRefresh, IconInfoCircle, IconAlertTriangle } from '@tabler/icons-react';
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

const StepperForm = () => {
  const [active, setActive] = useState(0);
  const [clusters, setClusters] = useState([]);
  const [certs, setCerts] = useState([]);
  const [debugMode, setDebugMode] = useState(false);
  const { data: sessionData } = useSession();
  const accessToken = sessionData?.accessToken;

  const { colorScheme } = useMantineColorScheme();
  const isDarkMode = colorScheme === 'dark';

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
        ambassador: { enabled: true },
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
        "frontend-framework": { enabled: false, image: { repository: "quay.io/cdis/commons-frontend-app", tag: "main" } },
        hatchery: {
          enabled: true,
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
                "lifecycle-post-start": ["/bin/sh", "-c", "export IAM=$(whoami); rm -rf /home/$IAM/pd/dockerHome; rm -rf /home/$IAM/pd/lost+found; ln -s /data /home/$IAM/pd/; true"],
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
        manifestservice: { enabled: true },
        metadata: { enabled: true },
        peregrine: { enabled: true },
        portal: { enabled: true },
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
        neuvector: {
          enabled: false,
          policies: { include: false, policyMode: "Monitor" },
          ingress: { controller: "nginx-ingress-controller", namespace: "nginx", class: "nginx" },
          DB_HOST: "development-gen3-postgresql",
          ES_HOST: "gen3-elasticsearch-master",
        },
        "aws-es-proxy": { enabled: false, esEndpoint: "", secrets: { awsAccessKeyId: "", awsSecretAccessKey: "" } },
        "aws-sigv4-proxy": { enabled: false },

        // OHDSI — disabled by default
        "ohdsi-atlas": { enabled: false },
        "ohdsi-webapi": { enabled: false },

        // Other Services — disabled by default
        cedar: { enabled: false },
        "cohort-middleware": { enabled: false },
        dashboard: { enabled: false, dashboardConfig: { bucket: "generic-dashboard-bucket", prefix: "hostname.com" } },
        "data-upload-cron": { enabled: false },
        datareplicate: { enabled: false },
        "embedding-management-service": { enabled: false },
        "gen3-analysis": { enabled: false },
        "gen3-user-data-library": { enabled: false },
        requestor: { enabled: false },
        sower: { enabled: false },
        "ssjdispatcher": { enabled: false },
        "access-backend": { enabled: false },
        pidgin: { enabled: false },

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

  const deploy = async () => {
    const dest = form.values.destination;
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
      console.log('Deployed', res);
      alert('Deployment started!');
    } catch (err) {
      console.error('Deployment failed', err);
      alert('Deployment failed. Check console.');
    }
  };

  useEffect(() => {
    if (!accessToken) return;
    const load = async () => {
      try { await fetchClusters(); } catch (err) { console.error('Error fetching clusters:', err); }
      try { await fetchCerts(); } catch (err) { console.error('Error fetching certs:', err); }
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

  const steps = [
    { label: 'Destination', content: <DestinationStep form={form} clusters={clusters} fetchClusters={fetchClusters} /> },
    { label: 'Global Settings', content: <GlobalSettingsStep form={form} /> },
    { label: 'Hostname & TLS', content: <HostnameStep form={form} certs={certs} fetchCerts={fetchCerts} /> },
    { label: 'Database', content: <DatabaseStep form={form} /> },
    { label: 'Services', content: <ModulesStep form={form} /> },
    { label: 'Authentication', content: <AuthStep form={form} /> },
    { label: 'Service Config', content: <ConfigStep form={form} /> },
    {
      label: 'Review & Deploy', content: (
        <Stack>
          {/* Validation Warnings */}
          {(() => {
            const warnings = getValidationWarnings();
            return warnings.length > 0 ? (
              <Alert icon={<IconAlertTriangle size={16} />} color="yellow" title="Configuration Warnings">
                <Stack gap="xs">
                  {warnings.map((w, i) => <Text key={i} size="sm">{w}</Text>)}
                </Stack>
              </Alert>
            ) : null;
          })()}

          {/* Deployment Target Summary */}
          <Paper withBorder p="md" radius="md">
            <Group grow>
              <div>
                <Text size="xs" c="dimmed">Cluster</Text>
                <Text fw={500}>{form.values.destination.cluster || '(not selected)'}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">Release</Text>
                <Text fw={500}>{form.values.destination.releaseName}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">Namespace</Text>
                <Text fw={500}>{form.values.destination.namespace || form.values.destination.releaseName}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">Chart</Text>
                <Text fw={500}>{form.values.destination.repoUrl}/{form.values.destination.chartName}</Text>
              </div>
            </Group>
          </Paper>

          <Text>Review the generated values.yaml below — this is what will be deployed.</Text>
          <Editor
            className='border rounded-lg'
            value={YAML.stringify(form.values.values, null, 2)}
            defaultLanguage='yaml'
            height={"600px"}
            readOnly={true}
            theme={isDarkMode ? 'vs-dark' : 'light'}
            options={{
              readOnly: true,
              scrollBeyondLastLine: false,
              minimap: { enabled: false },
            }}
          />
          <Button onClick={deploy} size="lg">Deploy</Button>
        </Stack>
      )
    }
  ];

  return (
    <>
      <form onSubmit={form.onSubmit(() => deploy())}>
        <Stepper active={active} onStepClick={setActive} breakpoint="sm" orientation="horizontal">
          {steps.map((step, idx) => (
            <Stepper.Step key={idx} label={step.label}>
              {step.content}
            </Stepper.Step>
          ))}
        </Stepper>

        <Group justify="center" mt="xl">
          {active > 0 && <Button variant="default" onClick={() => setActive((c) => c - 1)}>Back</Button>}
          {active < steps.length - 1 && <Button onClick={() => setActive((c) => c + 1)}>Next</Button>}
        </Group>
      </form>

      <Container fluid mt="xl">
        <Switch label="Debug Mode" checked={debugMode} onChange={(e) => setDebugMode(e.currentTarget.checked)} />

        {debugMode && (
          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
            <Paper withBorder p="md" style={{ flex: 1 }}>
              <Text size="sm" fw={500} mb="sm">Destination Configuration</Text>
              <YamlEditor data={form.values?.destination} button={false} readOnly={true} />
            </Paper>
            <Paper withBorder p="md" style={{ flex: 1 }}>
              <Text size="sm" fw={500} mb="sm">Generated values.yaml</Text>
              <YamlEditor data={form.values?.values} button={false} readOnly={true} />
            </Paper>
          </div>
        )}
      </Container>
    </>
  );
};

export default StepperForm;
