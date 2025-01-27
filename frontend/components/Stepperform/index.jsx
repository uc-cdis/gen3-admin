// components/StepperForm.js
import { useState, useEffect } from 'react';
import {
  Stepper,
  Button,
  Group,
  Code,
  Flex,
  Select,
  Box,
  Grid,
  Checkbox,
  Stack,
  Paper,
  Title,
  Tooltip,
  ActionIcon,
  Divider,
  SimpleGrid,
  Text,
  TextInput,
  Container,
  Collapse,
  Switch,
  Radio,
  Textarea,
  PasswordInput,
  Alert,
  List,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  IconPencil,
  IconRefresh,
  IconBrandGoogle,
  IconFingerprint,
  IconWorld,
  IconShieldLock,
  IconId,
  IconKey,
  IconShieldCheck,
  IconLink,
  IconInfoCircle,
  IconExternalLink,
  IconTerminal2,
  IconBox,
  IconHelp,
  IconCpu,
  IconDatabase,
  IconTrash,
  IconPlus,
  IconBrandDocker,
} from '@tabler/icons-react';

import { callGoApi } from '@/lib/k8s';

import YamlEditor from '@/components/YamlEditor/YamlEditor';

import { useSession } from 'next-auth/react';
import { request } from 'http';

const StepperForm = () => {
  const [active, setActive] = useState(0);
  const [clusters, setClusters] = useState([]);
  const [cluster, setCluster] = useState('');

  const [useCustomNs, setUseCustomNs] = useState(false);

  const [releaseName, setReleaseName] = useState('gen3-test');
  const [namespace, setNamespace] = useState(releaseName);

  const { data: sessionData } = useSession();
  const accessToken = sessionData?.accessToken;

  const [debugMode, setDebugMode] = useState(false);

  // Initialize Mantine's useForm with initial values
  const form = useForm({
    initialValues: {
      modules: [],
      auth: {
        ras: {
          enabled: false,
          clientID: '',
          clientSecret: '',
          issuerURL: '',
        },
        oidc: {
          enabled: false,
          clientID: '',
          clientSecret: '',
          issuerURL: '',
        },
        google: {
          enabled: false,
          clientID: '',
          clientSecret: '',
        }
      },
      authz: {
        yamlSource: 'external',
        yaml: '',
        yamlPath: '',
      },
      workspaces: {
        useDefaults: true,
        flavors: [
          {
            name: 'jupyter-small',
            image: 'quay.io/cdis/jupyter-notebook:latest',
            cpu: '500m',
            memory: '2Gi',
            port: '8888'
          },
          {
            name: 'jupyter-medium',
            image: 'quay.io/cdis/jupyter-notebook:latest',
            cpu: '1',
            memory: '4Gi',
            port: '8888'
          },
          {
            name: 'jupyter-large',
            image: 'quay.io/cdis/jupyter-notebook:latest',
            cpu: '2',
            memory: '8Gi',
            port: '8888'
          },
          {
            name: 'rstudio-small',
            image: 'quay.io/cdis/rstudio-notebook:latest',
            cpu: '500m',
            memory: '2Gi',
            port: '8888'
          },
          {
            name: 'rstudio-medium',
            image: 'quay.io/cdis/rstudio-notebook:latest',
            cpu: '1',
            memory: '4Gi',
            port: '8888'
          },
          {
            name: 'rstudio-large',
            image: 'quay.io/cdis/rstudio-notebook:latest',
            cpu: '2',
            memory: '8Gi',
            port: '8888'
          }
        ],
        containerImage: '',
        cpu: '',
        memory: '',
        useDefault: true,
      },
      // Placeholder for future steps
    },
  });

  const form2 = useForm({
    initialValues: {
      destination: {
        name: 'test',
        namespace: 'test',
        cluster: 'test',
        releaseName: 'test',
      },
      modules: [
        'framework',
        'workspaces',
        'workflows',
        'dicom',
        'omop',
      ],
      values: {
        global: {
          aws: {
            enabled: false,
            acm: '',
          },
          hostname: 'gen3.example.com',
        },
        arborist: {
          enabled: true,
          resources: {
            requests: {
              memory: '105Mi',
              cpu: '15m'
            }
          },
          image: {
            tag: 'chore_nobody'
          }
        },
        fence: {
          enabled: true,
          FENCE_CONFIG: {
            AWS_CREDENTIALS: {

            },
            S3_BUCKETS: {

            }
          }
        },
        hatchery: {
          enabled: true,
          hatchery: {
            sidecarContainer: {
              image: 'quay.io/cdis/gen3-ecs-sidecar:master'
            },
            containers: [
              {
                targetPort: 8888,
                cpuLimit: '2',
                memoryLimit: '3Gi',
                name: '(Tutorials) Example Analysis Jupyter Lab Notebooks',
                image: 'quay.io/cdis/jupyter-superslim:1.0.5',
                env: {
                  FRAME_ANCESTORS: 'https://{{ .Values.global.hostname }}'
                },
              }
            ]
          }
        },
      },
    }
  });


  const defResources = {
    requests: {
      memory: "105Mi",
      cpu: "15m"
    }
  }

  const [hostname, setHostname] = useState('gen3.example.com');
  const [tls, setTls] = useState({
    cert: '',
    key: ''
  });

  const [aws, setAws] = useState({
    enabled: false,
    region: '',
    awsAcccessKeyId: '',
    awsSecretAccessKey: '',
    secretStoreServiceAccount: {
      enabled: false,
      name: '',
      roleArn: '',
    },
    useLocalSecret: {
      enabled: false,
      localSecretName: '',
    }
  });

  const [dev, setDev] = useState(false);

  const [arborist, setArborist] = useState({
    enabled: true,
    resources: defResources,
    image: {
      tag: 'master'
    }
  });

  const [ambassador, setAmbassador] = useState({
    enabled: false,
    resources: defResources,
    image: {
      tag: 'master'
    }
  });

  const [audit, setAudit] = useState({
    enabled: true,
    resources: defResources,
    image: {
      tag: 'master'
    }
  });

  const [awsEsProxy, setAwsEsProxy] = useState({
    enabled: aws?.enabled ? true : false,
    resources: defResources,
    image: {
      tag: 'master'
    }
  });
  const [etl, setEtl] = useState({ enabled: false });
  const [fence, setFence] = useState({ enabled: false });
  const [guppy, setGuppy] = useState({ enabled: false });
  const [hatchery, setHatchery] = useState({ enabled: false });
  const [indexd, setIndexd] = useState({ enabled: false });
  const [manifestService, setManifestService] = useState({ enabled: false });
  const [metadata, setMetadata] = useState({ enabled: false });
  const [peregrine, setPeregrine] = useState({ enabled: false });
  const [portal, setPortal] = useState({ enabled: false });
  const [requestor, setRequestor] = useState({ enabled: false });
  const [revproxy, setRevproxy] = useState({ enabled: false });
  const [sheepdog, setSheepdog] = useState({ enabled: false });
  const [ssjdispatcher, setSsjdispatcher] = useState({ enabled: false });
  const [wts, setWts] = useState({ enabled: false });
  const [posgresql, setPosgresql] = useState({ enabled: false });
  const [elasticsearch, setElasticsearch] = useState({ enabled: false });
  const [neuvector, setNeuvector] = useState({ enabled: false });

  const [global, setGlobal] = useState({
    hostname: hostname,
    aws: aws,
    dev: dev,
    revproxyArn: '',
    postgres: {
      dbCreate: true,
      master: {
        host: '',
        port: '5432',
        username: 'postgres',
        password: '',
      },
    },
    environment: '',
    frontendRoot: 'portal',
    netPolicy: {
      enabled: false,
      dbSubnet: '',
    }
  });


  const values = {
    global: global,
    ambassador: ambassador,
    arborist: arborist,
    audit: audit,
    "aws-es-proxy": awsEsProxy,
    etl: etl,
    fence: fence,
    guppy: guppy,
    hatchery: hatchery,
    indexd: indexd,
    manifestService: manifestService,
    metadata: metadata,
    peregrine: peregrine,
    portal: portal,
    requestor: requestor,
    revproxy: revproxy,
    sheepdog: sheepdog,
    ssjdispatcher: ssjdispatcher,
    wts: wts,
    posgresql: posgresql,
    elasticsearch: elasticsearch,
    neuvector: neuvector,
  }

  // const form = useForm({
  //   initialValues: {

  //   }
  // }
  // );

  const modules = [
    { label: 'Framework Services', value: 'framework', tooltip: 'Configure Gen3 services such as the metadata catalog, indexd, peregrine, and guppy', required: true },
    { label: 'Workspaces', value: 'workspaces', tooltip: 'Configure workspaces and resource allocations for your Gen3 deployment' },
    { label: 'Workflows', value: 'workflows', tooltip: 'Configure workflows and their dependencies' },
    { label: 'Frontend', value: 'frontend', tooltip: 'Configure the frontend for your Gen3 deployment' },
  ];

  const modulesNew = [
    { label: 'indexd', value: 'indexd', tooltip: '' },
    { label: 'peregrine', value: 'peregrine', tooltip: 'GraphQL API for Gen3 structured data' },
    { label: 'guppy', value: 'guppy', tooltip: 'GraphQL api for flattened Gen3 Structured Data in Elasticsearch' },
    { label: 'metadata', value: 'metadata', tooltip: 'Gen3 metadata catalog' },
    { label: 'portal', value: 'portal', tooltip: 'Gen3 portal' },
    { label: 'arborist', value: 'arborist', tooltip: 'Gen3 authorization service' },
    { label: 'fence', value: 'fence', tooltip: 'Gen3 authorization service' },
    { label: 'hatchery', value: 'hatchery', tooltip: 'Gen3 workspaces' },
    { label: 'Frontend Framework', value: 'frontend', tooltip: 'Configure the new frontend for your Gen3 deployment' },

  ]

  const fetchClusters = async () => {
    try {
      const data = await callGoApi('/agents', 'GET', null, null, null);
      // Only show clusters that are active
      const clusterdata = data.filter(cluster => cluster.connected).map(cluster => ({ label: cluster.name, value: cluster.name }));
      setClusters(clusterdata);
    } catch (error) {
      console.error('Failed to fetch clusters:', error);
    }
  };

  const deploy = async () => {
    console.log("deploying", releaseName, namespace, cluster)
    console.log("values", values)
    // call go api to get the values
    // then open a modal with the values
    const body = {
      repoUrl: "https://helm.gen3.org",
      chart: "gen3",
      release: releaseName,
      namespace: namespace,
      values: values
    }
    const response = await callGoApi(`/agent/${cluster}/helm/install`, 'POST', body, null, accessToken, null)
    console.log("values", response)

    alert("Deployed")

  }

  useEffect(() => {
    fetchClusters();
  }, []);

  const selectedModules = form.values.modules;

  const nextStep = () =>
    setActive((current) => (current < steps.length - 1 ? current + 1 : current));
  const prevStep = () =>
    setActive((current) => (current > 0 ? current - 1 : current));

  const onSubmit = (values) => {
    console.log('Form Data:', values);
    // Handle final submission, e.g., generate values.yaml
  };

  const steps = [
    {
      label: 'Select Destination',
      content: (
        <Container size="xl" px="md">
          <Stack spacing="xl">
            {/* Cluster Selection */}
            <Paper p="md" radius="md" withBorder>
              <Stack spacing="md">
                <Group position="apart" align="flex-end">
                  <Select
                    label="Cluster"
                    description="Select your Kubernetes cluster"
                    placeholder="e.g., my-cluster"
                    data={clusters}
                    sx={{ flexGrow: 1 }}
                    onChange={(value) => setCluster(value)}
                  />
                  <Tooltip label="Refresh clusters list">
                    <ActionIcon
                      onClick={fetchClusters}
                      variant="light"
                      size="lg"
                      color="blue"
                    >
                      <IconRefresh size={20} />
                    </ActionIcon>
                  </Tooltip>

                  <Select
                    label="Cloud Provider"
                    placeholder="e.g., aws"
                    data={[
                      { value: 'local', label: 'Local Dev' },
                      { value: 'aws', label: 'AWS' },
                      { value: 'gcp', label: 'GCP (Coming Soon)', disabled: true },
                      { value: 'azure', label: 'Azure (Coming Soon)', disabled: true },
                      { value: 'do', label: 'Digital Ocean (Coming Soon)', disabled: true },
                    ]}
                  >
                  </Select>
                </Group>


                <Divider label="Release Configuration" labelPosition="center" />
                <Group grow align="flex-start">
                  <TextInput
                    label="Release Name"
                    value={releaseName}
                    onChange={(event) => { setReleaseName(event.target.value); setNamespace(event.target.value) }}
                    placeholder="e.g., my-release"
                    rightSection={<IconPencil size={16} />}
                  />
                </Group>
                <Divider label="Namespace Configuration" labelPosition="center" />
                <Group grow align="flex-start">
                  {useCustomNs ? (
                    <TextInput
                      label="Custom Namespace"
                      value={namespace}
                      onChange={(event) => setNamespace(event.target.value)}
                      placeholder="e.g., default"
                      rightSection={<IconPencil size={16} />}
                    />
                  ) : (
                    <Select
                      label="Namespace"
                      placeholder={releaseName}
                      disabled
                      // data={releaseName}
                      {...form.getInputProps('namespace')}
                    />
                  )}
                  <Switch
                    label="Use custom namespace"
                    description="Toggle to input a custom namespace"
                    checked={useCustomNs}
                    onChange={(event) => setUseCustomNs(event.currentTarget.checked)}
                    size="md"
                    pt={20}
                  />
                </Group>
              </Stack>
            </Paper>
          </Stack>
        </Container>
      )

    },
    {
      label: 'Configure Hostname',
      content: (
        <Container size="xl" px="md">
          <Stack spacing="xl">
            <Paper p="xl" radius="md" withBorder >
              <Stack spacing="lg">
                <Divider label="Hostname Configuration" labelPosition="center" />
                <Group position="apart">
                  <div>
                    <Group spacing="xs">
                      <IconTerminal2 size={20} color="#4DABF7" />
                      <Text size="lg" weight={500}>Hostname Configuration</Text>
                    </Group>
                    <Text size="sm" c="dimmed" mt={4}>
                      Configure the hostname for your Gen3 deployment
                    </Text>
                  </div>

                </Group>

                <Stack spacing="xl">
                  <TextInput
                    label="Hostname"
                    placeholder="e.g., gen3.example.com"
                    value={hostname}
                    onChange={(event) => setHostname(event.target.value)}
                    withAsterisk
                  />
                </Stack>

                <Divider variant="dashed" label="SSL Certificate" labelPosition="center" />

                <Stack spacing="md">
                  <Text size="sm">
                    Configure SSL certificate for your Gen3 deployment
                  </Text>
                  <Text size="sm" c="dimmed">
                    You can use a self-signed certificate for testing purposes. For production deployments, you should use a valid certificate from a trusted certificate authority.
                  </Text>
                  <Switch label="AWS Certificate Manager (ACM)?" {...form2.getInputProps('values.global.aws.enabled', { type: 'checkbox' })} />
                  <Collapse in={form2.values.values.global.aws.enabled}>
                    <Stack spacing="md">
                      <TextInput
                        label="AWS Certificate Manager (ACM) ARN"
                        placeholder="e.g., arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012"
                        value={aws.revproxyArn}
                        onChange={(event) => setAws({ ...aws, revproxyArn: event.target.value })}
                        withAsterisk
                      />
                      <Text size="sm" c="dimmed">
                        If you are using AWS Certificate Manager (ACM), you can use the ARN of an existing certificate. If you are using a self-signed certificate, you can leave this field blank.
                      </Text>
                    </Stack>
                  </Collapse>
                </Stack>

              </Stack>
            </Paper>
          </Stack>
        </Container>

      ),
    },
    {
      label: 'Select Modules',
      content: (
        <Container size="xl" px="md">
          <Stack spacing="xl">

            {/* Modules Selection */}
            <Paper p="md" radius="md" withBorder>
              <Stack spacing="md">
                <Title order={4}>Gen3 Modules</Title>
                <Text size="sm" color="dimmed">
                  Select the modules of Gen3 you want to deploy. Each module provides different functionality for your deployment.
                </Text>

                <Checkbox.Group
                  {...form.getInputProps('modules', { type: 'checkbox' })}
                >
                  <SimpleGrid
                    cols={3}
                    spacing="lg"
                    breakpoints={[
                      { maxWidth: 'md', cols: 2 },
                      { maxWidth: 'sm', cols: 1 },
                    ]}
                  >
                    {modulesNew.map((module) => (

                      <Flex align="center" justify="between">
                        <Checkbox
                          key={module.value}
                          value={module.value}
                          label={module.label}
                          disabled={module.required}
                          checked={module.required}
                          description={module.description}
                          size="md"
                        />
                        <Tooltip label={module.tooltip} key={module.value} ml="lg">
                          <IconHelp size={16} m="lg" />
                        </Tooltip>
                      </Flex>


                    ))}
                  </SimpleGrid>
                </Checkbox.Group>
              </Stack>
            </Paper>
          </Stack>
        </Container>

      ),
    },
    {
      label: 'Configure Auth',
      // selectedModules.includes('auth') 
      content: (
        <Container size="xl" px="md">
          <Stack spacing="xl">
            {/* Google Auth */}
            <Paper p="xl" radius="md" withBorder >
              <Stack spacing="md">
                <Group position="apart">
                  <div>
                    <Group spacing="xs">
                      <IconBrandGoogle size={20} color="#4285F4" />
                      <Text size="lg" weight={500}>Google Authentication</Text>
                    </Group>
                    <Text size="sm" color="dimmed" mt={4}>
                      Enable authentication using Google OAuth 2.0
                    </Text>
                  </div>
                  <Switch
                    size="lg"
                    {...form.getInputProps('auth.google.enabled', { type: 'checkbox' })}
                  />
                </Group>

                <Collapse in={form.values.auth.google.enabled}>
                  <Stack spacing="md" mt="md">
                    <TextInput
                      label="Client ID"
                      description="OAuth 2.0 Client ID from Google Cloud Console"
                      placeholder="xxx.apps.googleusercontent.com"
                      icon={<IconId size={16} />}
                      {...form.getInputProps('auth.google.clientID')}
                      error={form.errors.auth?.google?.clientID}
                      withAsterisk
                    />
                    <Tooltip
                      label="Never share your client secret. It should be kept secure and private."
                      position="right"
                      multiline
                      width={220}
                    >
                      <PasswordInput
                        label="Client Secret"
                        description="OAuth 2.0 Client Secret from Google Cloud Console"
                        placeholder="GOCSPX-xxxxxxxxxxxxxxxxx"
                        icon={<IconKey size={16} />}
                        {...form.getInputProps('auth.google.clientSecret')}
                        error={form.errors.auth?.google?.clientSecret}
                        withAsterisk
                      />
                    </Tooltip>
                  </Stack>
                </Collapse>
              </Stack>
            </Paper>

            {/* OIDC Auth */}
            <Paper p="xl" radius="md" withBorder >
              <Stack spacing="md">
                <Group position="apart">
                  <div>
                    <Group spacing="xs">
                      <IconFingerprint size={20} color="#FF6B6B" />
                      <Text size="lg" weight={500}>Generic OIDC</Text>
                    </Group>
                    <Text size="sm" color="dimmed" mt={4}>
                      Configure OpenID Connect authentication
                    </Text>
                  </div>
                  <Switch
                    size="lg"
                    {...form.getInputProps('auth.oidc.enabled', { type: 'checkbox' })}
                  />
                </Group>

                <Collapse in={form.values.auth.oidc.enabled}>
                  <Stack spacing="md" mt="md">
                    <TextInput
                      label="Issuer URL"
                      description="The URL of your OpenID Connect provider"
                      placeholder="https://example.com/issuer"
                      icon={<IconWorld size={16} />}
                      {...form.getInputProps('auth.oidc.issuerURL')}
                      error={form.errors.auth?.oidc?.issuerURL}
                      withAsterisk
                    />
                    <Tooltip
                      label="The client identifier issued by your OIDC provider"
                      position="right"
                      multiline
                      width={220}
                    >
                      <TextInput
                        label="Client ID"
                        description="OIDC Client identifier"
                        placeholder="your-client-id"
                        icon={<IconId size={16} />}
                        {...form.getInputProps('auth.oidc.clientID')}
                        error={form.errors.auth?.oidc?.clientID}
                        withAsterisk
                      />
                    </Tooltip>
                    <Tooltip
                      label="Never share your client secret. It should be kept secure and private."
                      position="right"
                      multiline
                      width={220}
                    >
                      <PasswordInput
                        label="Client Secret"
                        description="OIDC Client Secret"
                        placeholder="your-client-secret"
                        icon={<IconKey size={16} />}
                        {...form.getInputProps('auth.oidc.clientSecret')}
                        error={form.errors.auth?.oidc?.clientSecret}
                        withAsterisk
                      />
                    </Tooltip>
                  </Stack>
                </Collapse>
              </Stack>
            </Paper>

            {/* RAS Auth */}
            <Paper p="xl" radius="md" withBorder >
              <Stack spacing="md">
                <Group position="apart">
                  <div>
                    <Group spacing="xs">
                      <IconShieldLock size={20} color="#82C91E" />
                      <Text size="lg" weight={500}>RAS Authentication</Text>
                    </Group>
                    <Text size="sm" color="dimmed" mt={4}>
                      Configure Research Authentication Service
                    </Text>
                  </div>
                  <Switch
                    size="lg"
                    {...form.getInputProps('auth.ras.enabled', { type: 'checkbox' })}
                  />
                </Group>

                <Collapse in={form.values.auth.ras.enabled}>
                  <Stack spacing="md" mt="md">
                    <TextInput
                      label="Issuer URL"
                      description="The URL of your RAS provider"
                      placeholder="https://ras.example.com"
                      icon={<IconWorld size={16} />}
                      {...form.getInputProps('auth.ras.issuerURL')}
                      error={form.errors.auth?.ras?.issuerURL}
                      withAsterisk
                    />
                    <Tooltip
                      label="The client identifier issued by your RAS provider"
                      position="right"
                      multiline
                      width={220}
                    >
                      <TextInput
                        label="Client ID"
                        description="RAS Client identifier"
                        placeholder="your-ras-client-id"
                        icon={<IconId size={16} />}
                        {...form.getInputProps('auth.ras.clientID')}
                        error={form.errors.auth?.ras?.clientID}
                        withAsterisk
                      />
                    </Tooltip>
                    <Tooltip
                      label="Never share your client secret. It should be kept secure and private."
                      position="right"
                      multiline
                      width={220}
                    >
                      <PasswordInput
                        label="Client Secret"
                        description="RAS Client Secret"
                        placeholder="your-ras-client-secret"
                        icon={<IconKey size={16} />}
                        {...form.getInputProps('auth.ras.clientSecret')}
                        error={form.errors.auth?.ras?.clientSecret}
                        withAsterisk
                      />
                    </Tooltip>
                  </Stack>
                </Collapse>
              </Stack>
            </Paper>
          </Stack>
          <Stack spacing="xl" mt="xl">
            <Paper p="xl" radius="md" withBorder >
              <Stack spacing="lg">
                <div>
                  <Group spacing="xs" mb="xs">
                    <IconShieldCheck size={20} color="#82C91E" />
                    <Text size="lg" weight={500}>Authorization Configuration</Text>
                  </Group>
                  <Text size="sm" color="dimmed">
                    Configure user authorization settings and role definitions for Gen3
                  </Text>
                </div>

                <Divider variant="dashed" />

                <Radio.Group
                  name="yamlSource"
                  label="Select source of user.yaml for AuthZ"
                  description="Choose how you want to provide user authorization configuration"
                  required
                  {...form.getInputProps('authz.yamlSource')}
                  withAsterisk
                >
                  <Stack spacing="xs" mt="xs">
                    <Tooltip
                      label="Load user.yaml from an external URL (GitHub, S3, etc.)"
                      position="right"
                      multiline
                      width={220}
                    >
                      <Radio
                        value="external"
                        label="External"
                        description="Use an existing user.yaml file from a URL"
                      />
                    </Tooltip>

                    <Tooltip
                      label="Define custom roles and permissions directly"
                      position="right"
                      multiline
                      width={220}
                    >
                      <Radio
                        value="customUserYaml"
                        label="Custom"
                        description="Define your own roles and permissions"
                      />
                    </Tooltip>
                  </Stack>
                </Radio.Group>

                <Collapse in={form.values.authz.yamlSource === 'external'}>
                  <Stack spacing="xs">
                    <TextInput
                      label="Path to user.yaml"
                      description="URL to your authorization configuration file"
                      placeholder="e.g., https://raw.github.com/org/repo/main/user.yaml"
                      icon={<IconLink size={16} />}
                      {...form.getInputProps('authz.yamlPath')}
                      error={form.errors.authz?.yamlPath}
                      withAsterisk
                    />
                    <Text size="xs" color="dimmed">
                      Supported formats: HTTPS URLs (GitHub, GitLab) or S3 URLs (s3://bucket/path/to/user.yaml)
                    </Text>
                  </Stack>
                </Collapse>

                <Collapse in={form.values.authz.yamlSource === 'customUserYaml'}>
                  <Stack spacing="xs">
                    <Tooltip
                      label="Define roles and their permissions using YAML format"
                      position="top"
                      multiline
                      width={250}
                    >
                      <Textarea
                        label="Custom Role Definitions"
                        description="Define user roles and their permissions in YAML format"
                        placeholder={`users:
  admin:
    policies:
      - all_programs
      - services
  user:
    policies:
      - data_upload
      - read_only`}
                        autosize
                        minRows={20}
                        {...form.getInputProps('authz.yaml')}
                        error={form.errors.authz?.yaml}
                        withAsterisk
                        styles={{
                          input: {
                            fontFamily: 'monospace'
                          }
                        }}
                      />
                    </Tooltip>
                    <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
                      <Text size="sm" weight={500}>YAML Format Tips</Text>
                      <List size="sm" spacing="xs" mt={4}>
                        <List.Item>Use proper YAML indentation (2 spaces)</List.Item>
                        <List.Item>Define roles under the 'users' section</List.Item>
                        <List.Item>Each role should have a 'policies' list</List.Item>
                        <List.Item>Common policies: all_programs, services, data_upload, read_only</List.Item>
                      </List>
                    </Alert>
                  </Stack>
                </Collapse>
              </Stack>
            </Paper>
          </Stack>
        </Container>
      ),
    },
    {
      label: 'Configure Workspaces',
      content: selectedModules.includes('workspaces') && (
        <Container size="xl" px="md">
          <Stack spacing="xl">
            <Paper p="xl" radius="md" withBorder >
              <Stack spacing="lg">
                <Group position="apart">
                  <div>
                    <Group spacing="xs">
                      <IconTerminal2 size={20} color="#4DABF7" />
                      <Text size="lg" weight={500}>Workspace Configuration</Text>
                    </Group>
                    <Text size="sm" color="dimmed" mt={4}>
                      Configure workspaces and resource allocations for your Gen3 deployment
                    </Text>
                  </div>
                  <Switch
                    label="Use Default Settings?"
                    {...form.getInputProps('workspaces.useDefaults', { type: 'checkbox' })}
                  />
                </Group>

                <Collapse in={!form.values.workspaces.useDefaults}>
                  <Stack spacing="xl">
                    {/* Quick Start Templates */}
                    <div>
                      <Text weight={500} mb="xs">Quick Start Templates</Text>
                      <SimpleGrid cols={3} breakpoints={[{ maxWidth: 'sm', cols: 1 }]} spacing="lg">
                        {form.values.workspaces.flavors.map((image) => (
                          <Paper key={image.value} p="md" radius="md" withBorder>
                            <Stack spacing="xs">
                              <Group spacing="xs">
                                <IconBox size={16} />
                                <Text weight={500}>{image.label}</Text>
                              </Group>
                              <Text size="xs" color="dimmed">{image.description}</Text>
                              <Text size="xs">CPU: {image.cpu} | Memory: {image.memory}</Text>
                              <Button
                                variant="light"
                                size="xs"
                                onClick={() => {
                                  const currentFlavors = form.values.workspaces.flavors || [];
                                  form.setFieldValue('workspaces.flavors', [
                                    ...currentFlavors,
                                    {
                                      name: image.label.toLowerCase(),
                                      image: image.value,
                                      cpu: image.cpu,
                                      memory: image.memory,
                                      port: '8888'
                                    }
                                  ]);
                                }}
                              >
                                Add Template
                              </Button>
                            </Stack>
                          </Paper>
                        ))}
                      </SimpleGrid>
                    </div>

                    <Divider variant="dashed" label="Custom Flavors" labelPosition="center" />

                    {/* Custom Flavors */}
                    <Stack spacing="md">
                      {(form.values.workspaces.flavors || []).map((flavor, index) => (
                        <Paper key={index} p="md" radius="md" withBorder>
                          <Stack spacing="md">
                            <Group position="apart">
                              <Text weight={500}>Flavor #{index + 1}</Text>
                              <ActionIcon
                                color="red"
                                onClick={() => removeFlavor(index)}
                                variant="light"
                              >
                                <IconTrash size={16} />
                              </ActionIcon>
                            </Group>
                            <SimpleGrid cols={2} breakpoints={[{ maxWidth: 'sm', cols: 1 }]} spacing="md">
                              <TextInput
                                label="Flavor Name"
                                placeholder="e.g., jupyter-small"
                                {...form.getInputProps(`workspaces.flavors.${index}.name`)}
                                withAsterisk
                              />
                              <TextInput
                                label="Container Port"
                                placeholder="e.g., 8888"
                                {...form.getInputProps(`workspaces.flavors.${index}.port`)}
                                withAsterisk
                              />
                              <TextInput
                                label="Container Image"
                                placeholder="e.g., quay.io/cdis/jupyter-notebook:latest"
                                {...form.getInputProps(`workspaces.flavors.${index}.image`)}
                                withAsterisk
                                icon={<IconBrandDocker size={16} />}
                              />
                              <Group grow>
                                <TextInput
                                  label="CPU Request"
                                  placeholder="e.g., 500m"
                                  {...form.getInputProps(`workspaces.flavors.${index}.cpu`)}
                                  withAsterisk
                                  icon={<IconCpu size={16} />}
                                />
                                <TextInput
                                  label="Memory Request"
                                  placeholder="e.g., 2Gi"
                                  {...form.getInputProps(`workspaces.flavors.${index}.memory`)}
                                  withAsterisk
                                  icon={<IconDatabase size={16} />}
                                />
                              </Group>
                            </SimpleGrid>
                          </Stack>
                        </Paper>
                      ))}

                      <Button
                        // onClick={addNewFlavor}
                        leftIcon={<IconPlus size={16} />}
                        variant="light"
                      >
                        Add New Flavor
                      </Button>
                    </Stack>

                    {/* Help Section */}
                    <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
                      <Text size="sm" weight={500} mb="xs">Custom Workspace Images</Text>
                      <Text size="sm" color="dimmed">
                        You can create your own custom workspace images to use with Gen3. Custom images should:
                      </Text>
                      <List size="sm" spacing="xs" mt="xs">
                        <List.Item>Be based on official Jupyter or RStudio images</List.Item>
                        <List.Item>Include necessary authentication packages</List.Item>
                        <List.Item>Expose the correct ports (default: 8888)</List.Item>
                        <List.Item>Be hosted in a container registry (e.g., Docker Hub, Quay.io)</List.Item>
                      </List>
                      <Button
                        variant="subtle"
                        size="xs"
                        mt="md"
                        component="a"
                        href="https://gen3.org/resources/user/custom-workspace"
                        target="_blank"
                        leftIcon={<IconExternalLink size={14} />}
                      >
                        Learn more about custom workspaces
                      </Button>
                    </Alert>
                  </Stack>
                </Collapse>
              </Stack>
            </Paper>
          </Stack>
        </Container>

      ),
    },
    // {
    //   label: 'Placeholder Step',
    //   content: (
    //     <Box>
    //       <p>This step is under construction. Stay tuned!</p>
    //     </Box>
    //   ),
    // },
    {
      label: 'Review & Generate',
      content: (
        <Box>
          <pre>{/* You can display a preview of values.yaml here */}</pre>
          <Button onClick={deploy}>Deploy</Button>
        </Box>
      ),
    },
  ];



  return (
    <>

      <form onSubmit={form.onSubmit(onSubmit)}>
        <Stepper size="xs" active={active} onStepClick={setActive} orientation="horizontal" sx={{ marginBottom: 20 }}>

          {steps
            .filter((step) => {
              // Always render steps without 'module' or check if the module is selected
              return !step.module || selectedModules.includes(step.module);
            })
            .map((step, index) => (
              <Stepper.Step key={index} label={step.label} description="" allowStepSelect={true}>
                {step.content}
              </Stepper.Step>
            ))}

        </Stepper>

        <Group position="center" mt="xl">
          {active > 0 && (
            <Button variant="default" onClick={prevStep}>
              Back
            </Button>
          )}
          {active < steps.length - 1 && (
            <Button onClick={nextStep} disabled={false}>
              Next
            </Button>
          )}
          {active === steps.length - 1 && (
            <Button type="submit">Submit</Button>
          )}
        </Group>
      </form>

      {/* Code block to display current form values and generated user.yaml */}
      <Container fluid m="xl">
        {/* toggle switch to enable debug mode */}
        <Switch label="Debug Mode" checked={debugMode} onChange={(event) => setDebugMode(event.currentTarget.checked)} />

        {debugMode ?
          <>
            <Text m="xl">Debug values</Text>
            <Grid gutter="xl">
              <Grid.Col span={6}>
                <Flex direction={{ base: 'column', sm: 'row' }} // Stacks vertically on small screens, side-by-side on larger screens
                  gap="md"  // Adds spacing between the code blocks
                  justify="space-between"
                  style={{ width: '100%' }}
                >
                </Flex>
                <Code block>
                  {JSON.stringify(form2.values, null, 2)}
                </Code>
              </Grid.Col>
              <Grid.Col span={6}>
                <YamlEditor data={values} button={false} readOnly={true} />
                {/* </Flex> */}
              </Grid.Col>
            </Grid>
          </>
          : null}
      </Container >
    </>
  );
};

export default StepperForm;
