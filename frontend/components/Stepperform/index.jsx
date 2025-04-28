import { useState, useEffect } from 'react';
import {
  Stepper, Button, Group, Container, Switch, Code, Grid, Flex, Paper, Stack, Divider, Text,
  useMantineColorScheme
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconRefresh, IconInfoCircle } from '@tabler/icons-react';
import { callGoApi } from '@/lib/k8s';
import YAML from 'yaml';

import Editor from "@monaco-editor/react";
import { useSession } from 'next-auth/react';

import DestinationStep from './steps/DestinationStep';
import HostnameStep from './steps/HostnameStep';
import ModulesStep from './steps/ModulesStep';
import AuthStep from './steps/AuthStep';
import WorkspacesStep from './steps/WorkspacesStep';
import YamlEditor from '../YamlEditor/YamlEditor';
import ConfigStep from './steps/ConfigStep';

const StepperForm = () => {
  const [active, setActive] = useState(0);
  const [clusters, setClusters] = useState([]);
  const [certs, setCerts] = useState([]);
  const [debugMode, setDebugMode] = useState(false);
  const { data: sessionData } = useSession();
  const accessToken = sessionData?.accessToken;

  const { colorScheme, setColorScheme } = useMantineColorScheme();

  const isDarkMode = colorScheme === 'dark';

  const form = useForm({
    initialValues: {
      destination: {
        cluster: '',
        releaseName: 'gen3-test',
        namespace: '',
        useCustomNs: false,

      },
      values: {
        global: {
          // environment: "test",
          aws: {
            enabled: true,
            scheme: "internet-facing",
            // wafv2: {
            //   enabled: false
            // }
          },
          tls: { cert: '', key: '' },
          hostname: 'gen3.example.com',
          dev: true,
          revproxyArn: '',
          frontendRoot: 'gen3ff',
          netPolicy: { enabled: false, dbSubnet: '0.0.0.0/0' },
        },
        arborist: { enabled: true },
        audit: { enabled: true },
        fence: {
          enabled: true,
          "usersync": {
            "usersync": false,
            "schedule": "*/30 * * * *",
            "custom_image": null,
            "syncFromDbgap": false,
            "addDbgap": false,
            "onlyDbgap": false,
            "userYamlS3Path": "s3://cdis-gen3-users/helm-test/user.yaml",
            "slack_webhook": "None",
            "slack_send_dbgap": false,
            "env": null
          },
          // "USER_YAML": "cloud_providers: {}\nauthz:\n  # policies automatically given to anyone, even if they are not authenticated\n  anonymous_policies:\n  - open_data_reader\n\n  # policies automatically given to authenticated users (in addition to their other policies)\n  all_users_policies: []\n\n  groups:\n  # can CRUD programs and projects and upload data files\n  - name: data_submitters\n    policies:\n    - services.sheepdog-admin\n    - data_upload\n    - MyFirstProject_submitter\n    users:\n    - username1@gmail.com\n\n  # can create/update/delete indexd records\n  - name: indexd_admins\n    policies:\n    - indexd_admin\n    users:\n    - username1@gmail.com\n\n  resources:\n  - name: workspace\n  - name: data_file\n  - name: services\n    subresources:\n    - name: sheepdog\n      subresources:\n      - name: submission\n        subresources:\n        - name: program\n        - name: project\n    - name: 'indexd'\n      subresources:\n        - name: 'admin'\n    - name: audit\n      subresources:\n        - name: presigned_url\n        - name: login\n  - name: open\n  - name: programs\n    subresources:\n    - name: MyFirstProgram\n      subresources:\n      - name: projects\n        subresources:\n        - name: MyFirstProject\n\n  policies:\n  - id: workspace\n    description: be able to use workspace\n    resource_paths:\n    - /workspace\n    role_ids:\n    - workspace_user\n  - id: data_upload\n    description: upload raw data files to S3\n    role_ids:\n    - file_uploader\n    resource_paths:\n    - /data_file\n  - id: services.sheepdog-admin\n    description: CRUD access to programs and projects\n    role_ids:\n      - sheepdog_admin\n    resource_paths:\n      - /services/sheepdog/submission/program\n      - /services/sheepdog/submission/project\n  - id: indexd_admin\n    description: full access to indexd API\n    role_ids:\n      - indexd_admin\n    resource_paths:\n      - /programs\n  - id: open_data_reader\n    role_ids:\n      - peregrine_reader\n      - guppy_reader\n      - fence_storage_reader\n    resource_paths:\n    - /open\n  - id: all_programs_reader\n    role_ids:\n    - peregrine_reader\n    - guppy_reader\n    - fence_storage_reader\n    resource_paths:\n    - /programs\n  - id: MyFirstProject_submitter\n    role_ids:\n    - reader\n    - creator\n    - updater\n    - deleter\n    - storage_reader\n    - storage_writer\n    resource_paths:\n    - /programs/MyFirstProgram/projects/MyFirstProject\n\n  roles:\n  - id: file_uploader\n    permissions:\n    - id: file_upload\n      action:\n        service: fence\n        method: file_upload\n  - id: workspace_user\n    permissions:\n    - id: workspace_access\n      action:\n        service: jupyterhub\n        method: access\n  - id: sheepdog_admin\n    description: CRUD access to programs and projects\n    permissions:\n    - id: sheepdog_admin_action\n      action:\n        service: sheepdog\n        method: '*'\n  - id: indexd_admin\n    description: full access to indexd API\n    permissions:\n    - id: indexd_admin\n      action:\n        service: indexd\n        method: '*'\n  - id: admin\n    permissions:\n      - id: admin\n        action:\n          service: '*'\n          method: '*'\n  - id: creator\n    permissions:\n      - id: creator\n        action:\n          service: '*'\n          method: create\n  - id: reader\n    permissions:\n      - id: reader\n        action:\n          service: '*'\n          method: read\n  - id: updater\n    permissions:\n      - id: updater\n        action:\n          service: '*'\n          method: update\n  - id: deleter\n    permissions:\n      - id: deleter\n        action:\n          service: '*'\n          method: delete\n  - id: storage_writer\n    permissions:\n      - id: storage_creator\n        action:\n          service: '*'\n          method: write-storage\n  - id: storage_reader\n    permissions:\n      - id: storage_reader\n        action:\n          service: '*'\n          method: read-storage\n  - id: peregrine_reader\n    permissions:\n    - id: peregrine_reader\n      action:\n        method: read\n        service: peregrine\n  - id: guppy_reader\n    permissions:\n    - id: guppy_reader\n      action:\n        method: read\n        service: guppy\n  - id: fence_storage_reader\n    permissions:\n    - id: fence_storage_reader\n      action:\n        method: read-storage\n        service: fence\n\nclients:\n  wts:\n    policies:\n    - all_programs_reader\n    - open_data_reader\n\nusers:\n  username1@gmail.com: {}\n  username2:\n    tags:\n      name: John Doe\n      email: johndoe@gmail.com\n    policies:\n    - MyFirstProject_submitter\n\ncloud_providers: {}\ngroups: {}\n",
          FENCE_CONFIG: {
            OPENID_CONNECT: {
              generic_oidc_idp: {
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
                discovery_url: 'https://accounts.google.com/.well-known/openid-configuration',
                client_id: '',
                client_secret: '',
                redirect_url: '{{BASE_URL}}/login/google/login/',
                scope: 'openid email',
                mock: '',
                mock_default_user: 'test@example.com',
              },
            },
          }
        },
        "frontend-framework": { enabled: true },
        guppy: { enabled: false },
        hatchery: {
          enabled: true,
          sidecarContainer: {
            cpuLimit: "0.1",
            memoryLimit: "256Mi",
            image: "quay.io/cdis/ecs-ws-sidecar:master",
            env: {
              NAMESPACE: "{{ .Release.Namespace }}",
              HOSTNAME: "{{ .Values.global.hostname }}"
            },
            args: [],
            command: [
              "/bin/bash",
              "./sidecar.sh"
            ],
            lifecyclePreStop: [
              "su",
              "-c",
              "echo test",
              "-s",
              "/bin/sh",
              "root"
            ]
          },
          containers: [
            {
              targetPort: 8888,
              cpuLimit: "1.0",
              memoryLimit: "2Gi",
              name: "(Tutorials) Example Analysis Jupyter Lab Notebooks",
              image: "quay.io/cdis/heal-notebooks:combined_tutorials__latest",
              env: {
                FRAME_ANCESTORS: "https://{{ .Values.global.hostname }}"
              },
              args: [
                "--NotebookApp.base_url=/lw-workspace/proxy/",
                "--NotebookApp.default_url=/lab",
                "--NotebookApp.password=''",
                "--NotebookApp.token=''",
                "--NotebookApp.shutdown_no_activity_timeout=5400",
                "--NotebookApp.quit_button=False"
              ],
              command: [
                "start-notebook.sh"
              ],
              pathRewrite: "/lw-workspace/proxy/",
              useTls: false,
              readyProbe: "/lw-workspace/proxy/",
              lifecyclePostStart: [
                "/bin/sh",
                "-c",
                "export IAM=$(whoami); rm -rf /home/$IAM/pd/dockerHome; rm -rf /home/$IAM/pd/lost+found; ln -s /data /home/$IAM/pd/; true"
              ],
              userUid: 1000,
              fsGid: 100,
              userVolumeLocation: "/home/jovyan/pd",
              gen3VolumeLocation: "/home/jovyan/.gen3"
            }
          ]
        },
        indexd: { enabled: true },
        metadata: { enabled: true },
        portal: { enabled: false },
        peregrine: { enabled: false },
        sheepdog: { enabled: false },
        elasticsearch: {
          volumeClaimTemplate: {
            resources: {
              requests: {
                storage: "10Gi"
              }
            }
          }
        },
      },
    }
  });

  const fetchClusters = async () => {
    try {
      const data = await callGoApi('/agents', 'GET');
      const clusterData = data.filter(c => c.connected).map(c => ({ label: c.name, value: c.name }));
      setClusters(clusterData);
    } catch (err) {
      console.error('Error fetching clusters', err);
    }
  };

  const fetchCerts = async () => {
    try {
      const data = await callGoApi('/aws/certificates', 'GET');
      console.log(data)
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
    const body = {
      repoUrl: 'https://helm.gen3.org',
      chart: 'gen3',
      release: form.values.destination.releaseName,
      namespace: form.values.destination.namespace === '' ? form.values.destination.releaseName : form.values.destination.namespace,
      values: form.values.values,
    };
    try {
      const res = await callGoApi(`/agent/${form.values.destination.cluster}/helm/install`, 'POST', body, null, accessToken);
      console.log('Deployed', res);
      alert('Deployment started!');
    } catch (err) {
      console.error('Deployment failed', err);
      alert('Deployment failed. Check console.');
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        await fetchClusters();
      } catch (err) {
        console.error('Error fetching clusters:', err);
      }

      try {
        await fetchCerts();
      } catch (err) {
        console.error('Error fetching certs:', err);
      }
    };
    load();
  }, []);


  const steps = [
    // { label: 'Cloud', content: <CloudStep /> },
    { label: 'Destination', content: <DestinationStep form={form} clusters={clusters} fetchClusters={fetchClusters} /> },
    { label: 'Hostname', content: <HostnameStep form={form} certs={certs} fetchCerts={fetchCerts} /> },
    { label: 'Database', content: <>Database Configurations will show up here.</> },
    { label: 'Modules', content: <ModulesStep form={form} /> },
    { label: 'Configuration', content: <ConfigStep form={form} /> },
    // { label: 'Authentication', content: <AuthStep form={form} /> },
    // { label: 'Workspaces', content: <WorkspacesStep form={form} /> },
    {
      label: 'Review & Deploy', content: (
        <Stack>
          <Text> Please review the values.yaml - This is what's going to be deployed to <b>cluster: {form.values.cluster}</b> in <b>namespace: {form.values.namespace}</b></Text>
          <Editor
            className='border rounded-lg h-screen'
            value={YAML.stringify(form.values.values, null, 2)}
            defaultLanguage='yaml'
            height={"500px"}
            readOnly={true}
            theme={isDarkMode ? 'vs-dark' : 'light'}
            options={{
              readOnly: true,
              scrollBeyondLastLine: false,
              minimap: {
                enabled: false,
              },
            }}
          />
          <Button onClick={deploy}>Deploy</Button>
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

        <Group position="center" mt="xl">
          {active > 0 && <Button variant="default" onClick={() => setActive((c) => c - 1)}>Back</Button>}
          {active < steps.length - 1 && <Button onClick={() => setActive((c) => c + 1)}>Next</Button>}
        </Group>
      </form>

      <Container fluid mt="xl">
        <Switch label="Debug Mode" checked={debugMode} onChange={(e) => setDebugMode(e.currentTarget.checked)} />

        {debugMode && (
          <Grid mt="xl" gutter="xl">
            <Grid.Col span={6}>
              <Paper withBorder p="md">
                <Text size="sm" weight={500} mb="sm">Destination Configuration</Text>
                {/* <Code block>{JSON.stringify(form.values, null, 2)}</Code> */}
                <YamlEditor data={form.values?.destination} button={false} readOnly={true} />
              </Paper>
            </Grid.Col>
            <Grid.Col span={6}>
              <Paper withBorder p="md">
                <Text size="sm" weight={500} mb="sm">Generated values.yaml</Text>
                <YamlEditor data={form.values?.values} button={false} readOnly={true} />
              </Paper>
            </Grid.Col>
          </Grid>
        )}
      </Container>
    </>
  );
};

export default StepperForm;
