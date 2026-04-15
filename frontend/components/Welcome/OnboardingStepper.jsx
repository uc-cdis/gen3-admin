import { useState, useEffect, useCallback } from 'react';
import {
  Stepper, Button, Text, Group, Paper, Container, Stack,
  Loader, Alert, Title, Code, Box, TextInput, Badge, Select, SimpleGrid, Switch
} from '@mantine/core';
import { IconCheck, IconAlertTriangle, IconServer, IconRocket, IconPlug, IconSearch, IconGitBranch, IconDatabase, IconCloud } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { callGoApi } from '@/lib/k8s';

export function OnboardingStepper({ accessToken, onComplete }) {
  const [active, setActive] = useState(0);
  const [envInfo, setEnvInfo] = useState(null);
  const [envLoading, setEnvLoading] = useState(true);
  const [agentName, setAgentName] = useState('local-agent');
  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState(null);
  const [polling, setPolling] = useState(false);
  const [agentConnected, setAgentConnected] = useState(false);
  const [deployStatus, setDeployStatus] = useState(null);

  // ArgoCD state
  const [argocdInstalling, setArgocdInstalling] = useState(false);
  const [argocdResult, setArgocdResult] = useState(null);
  const [argocdStatus, setArgocdStatus] = useState(null);
  const [argocdReady, setArgocdReady] = useState(false);

  // Apps state
  const [appsStorageType, setAppsStorageType] = useState('pvc');
  const [skipMonitoring, setSkipMonitoring] = useState(false);
  const [s3Config, setS3Config] = useState({ bucket: '', region: '', accessKeyID: '', secretAccessKey: '' });
  const [appsDeploying, setAppsDeploying] = useState(false);
  const [appsResult, setAppsResult] = useState(null);
  const [appsStatus, setAppsStatus] = useState(null); // live component status
  const [appsReady, setAppsReady] = useState(false);

  // Alloy state
  const [alloyDeploying, setAlloyDeploying] = useState(false);
  const [alloyResult, setAlloyResult] = useState(null);
  const [alloyStatus, setAlloyStatus] = useState(null);
  const [alloyReady, setAlloyReady] = useState(false);
  const [lokiAddress, setLokiAddress] = useState('http://monitoring-loki-distributor.monitoring:3100/loki/api/v1/push');

  // Verify state
  const [verifyStatus, setVerifyStatus] = useState(null);

  // Check if ArgoCD is already deployed when entering step 3
  useEffect(() => {
    if (active !== 3) return;
    callGoApi('/bootstrap/status', 'GET', null, null, accessToken)
      .then(status => {
        if (status?.argocd?.ready) {
          setArgocdStatus(status.argocd);
          setArgocdResult({ message: 'Already installed' });
          setArgocdReady(true);
        } else if (status?.argocd?.components) {
          setArgocdStatus(status.argocd);
          setArgocdResult({ message: 'Resuming...' });
          pollForArgoCD();
        }
      })
      .catch(() => {});
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll bootstrap status when on verify step (step 5)
  useEffect(() => {
    if (active !== 6) return;
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const data = await callGoApi('/bootstrap/status', 'GET', null, null, accessToken);
        if (!cancelled) setVerifyStatus(data);
      } catch (err) {
        console.error('Failed to fetch status:', err);
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [active, accessToken]);

  const allReady = verifyStatus?.agent?.ready && verifyStatus?.argocd?.ready &&
    (skipMonitoring || verifyStatus?.apps?.ready) &&
    (!alloyResult || verifyStatus?.alloy?.ready || !verifyStatus?.alloy); // alloy optional if not deployed

  useEffect(() => {
    if (allReady && active === 6) {
      const timer = setTimeout(() => setActive(7), 1500);
      return () => clearTimeout(timer);
    }
  }, [allReady, active]);

  // Step 0: Detect environment
  useEffect(() => {
    if (!accessToken) return;
    callGoApi('/environment', 'GET', null, null, accessToken)
      .then(data => {
        setEnvInfo(data);
        setEnvLoading(false);
      })
      .catch(err => {
        console.error('Failed to detect environment:', err);
        setEnvLoading(false);
      });
  }, [accessToken]);

  // Poll for agent connection after deploy
  const pollForAgent = useCallback((name) => {
    setPolling(true);
    const interval = setInterval(async () => {
      try {
        const agents = await callGoApi('/agents', 'GET', null, null, accessToken);
        const found = agents.find(a => a.name === name && a.connected);
        if (found) {
          clearInterval(interval);
          setPolling(false);
          setAgentConnected(true);
          setActive(3); // move to ArgoCD step
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }, 3000);

    setTimeout(() => {
      clearInterval(interval);
      if (!agentConnected) {
        setPolling(false);
        notifications.show({
          title: 'Agent connection timeout',
          message: 'The agent did not connect within 2 minutes. Check the pod logs.',
          color: 'orange',
        });
      }
    }, 120000);

    return () => clearInterval(interval);
  }, [accessToken, agentConnected]);

  const handleDeploy = async () => {
    setDeploying(true);
    setActive(2);
    try {
      setDeployStatus({ phase: 'generating', text: 'Generating TLS certificates and agent configuration...' });
      const result = await callGoApi('/agents/local', 'POST', { name: agentName }, null, accessToken);
      setDeployResult(result);
      setDeploying(false);
      setDeployStatus({ phase: 'applied', text: `Applied resources to cluster (server address: ${result.serverAddress})` });
      pollForAgent(agentName);
    } catch (err) {
      console.error('Failed to deploy agent:', err);
      setDeployStatus({ phase: 'error', text: `Failed: ${err.message || 'Could not deploy agent'}` });
      notifications.show({
        title: 'Deployment failed',
        message: err.message || 'Could not deploy agent to cluster',
        color: 'red',
      });
      setDeploying(false);
    }
  };

  const handleInstallArgoCD = async () => {
    setArgocdInstalling(true);
    try {
      const result = await callGoApi('/bootstrap/argocd', 'POST', {}, null, accessToken);
      setArgocdResult(result);
      setArgocdInstalling(false);
      pollForArgoCD();
    } catch (err) {
      console.error('Failed to install ArgoCD:', err);
      notifications.show({
        title: 'ArgoCD installation failed',
        message: err.message || 'Could not install ArgoCD',
        color: 'red',
      });
      setArgocdInstalling(false);
    }
  };

  const pollForArgoCD = useCallback(() => {
    const interval = setInterval(async () => {
      try {
        const status = await callGoApi('/bootstrap/status', 'GET', null, null, accessToken);
        setArgocdStatus(status?.argocd || null);
        if (status?.argocd?.ready) {
          clearInterval(interval);
          setArgocdReady(true);
          setActive(4); // move to Apps step
        }
      } catch (err) {
        console.error('ArgoCD status poll error:', err);
      }
    }, 5000);

    setTimeout(() => {
      clearInterval(interval);
      if (!argocdReady) {
        notifications.show({
          title: 'ArgoCD ready timeout',
          message: 'ArgoCD did not become ready within 5 minutes.',
          color: 'orange',
        });
      }
    }, 300000);

    return () => clearInterval(interval);
  }, [accessToken, argocdReady]);

  const handleDeployApps = async () => {
    setAppsDeploying(true);
    try {
      const body = {
        storageType: appsStorageType,
        skip: skipMonitoring,
      };
      if (appsStorageType === 's3') {
        body.s3Bucket = s3Config.bucket;
        body.s3Region = s3Config.region;
        body.awsAccessKeyID = s3Config.accessKeyID;
        body.awsSecretAccessKey = s3Config.secretAccessKey;
      }
      const result = await callGoApi('/bootstrap/apps', 'POST', body, null, accessToken);
      setAppsResult(result);
      setAppsDeploying(false);
      if (skipMonitoring) {
        setAppsReady(true); // skipped counts as ready
        setActive(5); // jump to Alloy step
      } else {
        pollForApps();
      }
    } catch (err) {
      console.error('Failed to deploy apps:', err);
      notifications.show({
        title: 'App deployment failed',
        message: err.message || 'Could not deploy monitoring stack',
        color: 'red',
      });
      setAppsDeploying(false);
    }
  };

  const pollForApps = useCallback(() => {
    const interval = setInterval(async () => {
      try {
        const status = await callGoApi('/bootstrap/status', 'GET', null, null, accessToken);
        setAppsStatus(status?.apps || null);
        if (status?.apps?.ready) {
          clearInterval(interval);
          setAppsReady(true);
          setActive(5); // move to Verify step
        }
      } catch (err) {
        console.error('Apps status poll error:', err);
      }
    }, 5000);

    setTimeout(() => {
      clearInterval(interval);
      if (!appsReady) {
        notifications.show({
          title: 'App sync timeout',
          message: 'Monitoring stack did not become healthy within 10 minutes.',
          color: 'orange',
        });
      }
    }, 600000);

    return () => clearInterval(interval);
  }, [accessToken, appsReady]);

  const handleDeployAlloy = async () => {
    setAlloyDeploying(true);
    try {
      const result = await callGoApi('/bootstrap/alloy', 'POST', {
        lokiAddress,
        cluster: 'csoc',
        project: 'csoc',
      }, null, accessToken);
      setAlloyResult(result);
      setAlloyDeploying(false);
      pollForAlloy();
    } catch (err) {
      console.error('Failed to deploy Alloy:', err);
      notifications.show({
        title: 'Alloy deployment failed',
        message: err.message || 'Could not deploy Grafana Alloy',
        color: 'red',
      });
      setAlloyDeploying(false);
    }
  };

  const pollForAlloy = useCallback(() => {
    const interval = setInterval(async () => {
      try {
        const status = await callGoApi('/bootstrap/status', 'GET', null, null, accessToken);
        setAlloyStatus(status?.alloy || null);
        if (status?.alloy?.ready) {
          clearInterval(interval);
          setAlloyReady(true);
          setActive(6); // move to Verify step
        }
      } catch (err) {
        console.error('Alloy status poll error:', err);
      }
    }, 5000);

    setTimeout(() => {
      clearInterval(interval);
      if (!alloyReady) {
        notifications.show({
          title: 'Alloy ready timeout',
          message: 'Grafana Alloy did not become healthy within 5 minutes.',
          color: 'orange',
        });
      }
    }, 300000);

    return () => clearInterval(interval);
  }, [accessToken, alloyReady]);

  const handleComplete = () => {
    if (onComplete) onComplete(agentName);
  };

  const nextStep = () => setActive(prev => Math.min(prev + 1, 6));
  const prevStep = () => setActive(prev => Math.max(prev - 1, 0));

  // Step content renderers
  const renderDetectStep = () => (
    <Stack align="center" gap="md" py="xl">
      {envLoading ? (
        <>
          <Loader size="lg" />
          <Text c="dimmed">Detecting your Kubernetes environment...</Text>
        </>
      ) : envInfo ? (
        <>
          <Title order={3}>Environment Detected</Title>
          <Group gap="md" my="md">
            <Badge size="lg" variant="filled" color={envInfo.inCluster ? 'green' : 'blue'} leftSection={<IconServer size={16} />}>
              {envInfo.inCluster ? 'Running in Kubernetes' : 'Connected via kubeconfig'}
            </Badge>
            <Badge size="lg" variant={envInfo.connected !== false ? 'outline' : 'outline'} color={envInfo.connected !== false ? 'blue' : 'red'} leftSection={<IconSearch size={16} />}>
              {envInfo.provider}
            </Badge>
            <Badge size="lg" variant="outline">K8s {envInfo.version}</Badge>
            <Badge size="lg" variant="filled" color={envInfo.connected ? 'green' : 'red'}>
              {envInfo.connected ? 'API Connected' : 'API Unreachable'}
            </Badge>
          </Group>
          {envInfo.namespace && <Text c="dimmed" size="sm">Namespace: {envInfo.namespace}</Text>}
          {!envInfo.hasAgents && (
            <Alert icon={<IconPlug size={16} />} color="blue" mt="md">
              No agents registered. You can set up a single-cluster CSOC to get started.
            </Alert>
          )}
          <Button onClick={nextStep} mt="md" size="lg">Continue</Button>
        </>
      ) : (
        <Alert icon={<IconAlertTriangle size={16} />} color="red">
          Failed to detect environment. Make sure your Kubernetes cluster is accessible.
        </Alert>
      )}
    </Stack>
  );

  const renderSetupStep = () => (
    <Stack gap="lg" py="xl">
      <Title order={3}>Set Up Single-Cluster CSOC</Title>
      <Text c="dimmed">
        Deploy an agent into your local Kubernetes cluster. This creates a single-cluster
        setup where the agent runs in the same cluster as your CSOC API.
      </Text>
      <Paper withBorder p="md" radius="md">
        <TextInput label="Agent Name" description="A unique name for this agent"
          value={agentName} onChange={(e) => setAgentName(e.currentTarget.value)}
          placeholder="local-agent" leftSection={<IconRocket size={16} />}
        />
      </Paper>
      <Group justify="flex-end" mt="md">
        <Button onClick={prevStep} variant="default">Back</Button>
        <Button onClick={handleDeploy} loading={deploying} size="lg" color="green">Deploy Agent to Cluster</Button>
      </Group>
      {deployResult && (
        <Paper withBorder p="sm" radius="md" bg="gray.0">
          <Text size="sm" fw={500}>Deployment initiated:</Text>
          <Code block mt="xs">{JSON.stringify(deployResult, null, 2)}</Code>
        </Paper>
      )}
    </Stack>
  );

  const renderDeployStep = () => (
    <Stack align="center" gap="md" py="xl">
      <Title order={3}>Deploying Agent</Title>
      {deploying && (
        <Stack align="center" gap="sm">
          <Loader size="lg" type="dots" />
          <Text c="dimmed" size="sm">{deployStatus?.text || 'Generating TLS certificates and agent configuration...'}</Text>
        </Stack>
      )}
      {deployResult && !agentConnected && (
        <>
          <Alert icon={<IconCheck size={16} />} color="green" w="100%">
            <Text size="sm">Resources applied to cluster</Text>
            <Text size="xs" c="dimmed">Server address: {deployResult.serverAddress}</Text>
          </Alert>
          <Stack align="center" gap="sm">
            <Loader size="lg" type="dots" />
            <Text c="dimmed" size="sm">Waiting for agent pod to start and connect...</Text>
            <Text c="dimmed" size="xs">This may take 30-60 seconds while the image pulls.</Text>
          </Stack>
        </>
      )}
      {deployStatus?.phase === 'error' && (
        <Alert icon={<IconAlertTriangle size={16} />} color="red" w="100%">{deployStatus.text}</Alert>
      )}
      {!polling && deployStatus?.phase !== 'error' && !deploying && !agentConnected && (
        <Button onClick={() => pollForAgent(agentName)} variant="light">Check Connection Status</Button>
      )}
      <Group justify="center" mt="xl">
        <Button onClick={prevStep} variant="default" disabled={polling || deploying}>Back</Button>
      </Group>
    </Stack>
  );

  const renderArgoCDStep = () => {
    const componentLabels = {
      'argocd-server': 'Server', 'argocd-repo-server': 'Repo Server',
      'argocd-applicationset-controller': 'ApplicationSet', 'argocd-dex-server': 'Dex (SSO)',
      'argocd-redis': 'Redis', 'argocd-notifications-controller': 'Notifications',
      'crds': 'CRDs',
    };

    return (
      <Stack gap="md" py="xl">
        <Title order={3} ta="center">Install ArgoCD</Title>
        <Text c="dimmed" ta="center" maw={500}>
          ArgoCD is a GitOps continuous delivery tool. It will manage all future application deployments in your cluster.
        </Text>

        {!argocdResult && !argocdInstalling && (
          <Stack align="center" mt="md">
            <Button onClick={handleInstallArgoCD} size="lg" color="indigo" leftSection={<IconGitBranch size={20} />}>
              Install ArgoCD
            </Button>
          </Stack>
        )}

        {argocdInstalling && (
          <Stack align="center" gap="sm" mt="md">
            <Loader size="lg" type="dots" />
            <Text c="dimmed" size="sm">Installing ArgoCD to cluster...</Text>
            <Text c="dimmed" size="xs">Applying manifests and creating resources...</Text>
          </Stack>
        )}

        {argocdResult && !argocdReady && (
          <Stack gap="sm" w="100%" maw={500} mx="auto">
            <Alert icon={<IconCheck size={16} />} color="green">
              <Text size="sm">ArgoCD manifest applied — waiting for components...</Text>
            </Alert>
            {argocdStatus?.components ? (
              <>
                <Text size="xs" c="dimmed" ta="center">{argocdStatus.totalReady}/{argocdStatus.totalCount} components ready</Text>
                {Object.entries(argocdStatus.components).map(([key, comp]) => (
                  <Paper key={key} withBorder p="xs" radius="sm" bg={comp.ready ? 'green.0' : 'gray.0'}>
                    <Group justify="space-between">
                      <Group gap="xs">
                        {comp.ready ? <IconCheck size={14} color="#40c057" /> : <Loader size="xs" type="dots" />}
                        <Text size="sm">{componentLabels[key] || key}</Text>
                      </Group>
                      <Text size="xs" c="dimmed">{comp.ready ? 'Ready' : `${comp.readyReplicas ?? 0}/${comp.totalReplicas ?? 1} pods`}</Text>
                    </Group>
                  </Paper>
                ))}
              </>
            ) : (
              <Stack align="center" gap="sm"><Loader size="lg" type="dots" /><Text c="dimmed" size="sm">Checking status...</Text></Stack>
            )}
          </Stack>
        )}

        {argocdReady && (
          <Alert icon={<IconCheck size={16} />} color="green" w="100%">
            <Text size="sm" fw={500}>All ArgoCD components are running!</Text>
          </Alert>
        )}

        <Group justify="center" mt="md">
          <Button onClick={prevStep} variant="default" disabled={argocdInstalling}>Back</Button>
          {argocdReady && <Button onClick={nextStep} size="lg">Continue</Button>}
        </Group>
      </Stack>
    );
  };

  const renderAppsStep = () => (
    <Stack gap="md" py="xl">
      <Title order={3} ta="center">Deploy Monitoring Stack</Title>
      <Text c="dimmed" ta="center" maw={500}>
        Deploy Grafana + Loki for observability. Choose where Loki stores its data.
      </Text>

      {/* Skip monitoring option */}
      {!appsResult && !appsDeploying && (
        <Paper withBorder p="sm" radius="md" maw={550} mx="auto"
          style={{ borderColor: skipMonitoring ? '#fd7e14' : undefined, backgroundColor: skipMonitoring ? '#fff4e5' : undefined }}
        >
          <Group justify="space-between" align="center">
            <div>
              <Text size="sm" fw={500}>Skip Monitoring Stack</Text>
              <Text size="xs" c="dimmed">Deploy without Grafana/Loki. You can add it later.</Text>
            </div>
            <Switch checked={skipMonitoring} onChange={(e) => setSkipMonitoring(e.currentTarget.checked)} />
          </Group>
        </Paper>
      )}

      {skipMonitoring && !appsResult && !appsDeploying && (
        <Stack align="center" mt="md">
          <Button onClick={handleDeployApps} size="lg" variant="outline" color="gray" leftSection={<IconRocket size={20} />}>
            Continue Without Monitoring
          </Button>
        </Stack>
      )}

      {/* Storage choice */}
      {!skipMonitoring && !appsResult && !appsDeploying && (
        <SimpleGrid cols={2} maw={550} mx="auto" mt="md">
          <Paper withBorder p="md" radius="md"
            style={{ cursor: 'pointer', borderColor: appsStorageType === 'pvc' ? '#228be6' : undefined,
              backgroundColor: appsStorageType === 'pvc' ? '#e7f5ff' : undefined }}
            onClick={() => setAppsStorageType('pvc')}
          >
            <Stack align="center" gap="xs">
              <IconDatabase size={32} color={appsStorageType === 'pvc' ? '#228be6' : '#868e96'} />
              <Text size="sm" fw={500}>Local Storage (PVC)</Text>
              <Text size="xs" c="dimmed" ta="center">Uses cluster PersistentVolumes. Best for Minikube and workshops.</Text>
              {appsStorageType === 'pvc' && <Badge size="sm" color="blue" variant="filled">Selected</Badge>}
            </Stack>
          </Paper>

          <Paper withBorder p="md" radius="md"
            style={{ cursor: 'pointer', borderColor: appsStorageType === 's3' ? '#228be6' : undefined,
              backgroundColor: appsStorageType === 's3' ? '#e7f5ff' : undefined }}
            onClick={() => setAppsStorageType('s3')}
          >
            <Stack align="center" gap="xs">
              <IconCloud size={32} color={appsStorageType === 's3' ? '#228be6' : '#868e96'} />
              <Text size="sm" fw={500}>Amazon S3</Text>
              <Text size="xs" c="dimmed" ta="center">Persistent cloud storage. Production-ready.</Text>
              {appsStorageType === 's3' && <Badge size="sm" color="blue" variant="filled">Selected</Badge>}
            </Stack>
          </Paper>
        </SimpleGrid>
      )}

      {/* S3 config form */}
      {!skipMonitoring && appsStorageType === 's3' && !appsResult && !appsDeploying && (
        <Paper withBorder p="md" radius="md" maw={450} mx="auto">
          <Stack gap="sm">
            <TextInput label="S3 Bucket Name" placeholder="my-loki-bucket"
              value={s3Config.bucket} onChange={(e) => setS3Config(s => ({ ...s, bucket: e.currentTarget.value }))} required />
            <TextInput label="Region" placeholder="us-west-2"
              value={s3Config.region} onChange={(e) => setS3Config(s => ({ ...s, region: e.currentTarget.value }))} required />
            <TextInput label="Access Key ID" placeholder="AKIA..."
              value={s3Config.accessKeyID} onChange={(e) => setS3Config(s => ({ ...s, accessKeyID: e.currentTarget.value }))} required />
            <TextInput label="Secret Access Key" type="password" placeholder="..."
              value={s3Config.secretAccessKey} onChange={(e) => setS3Config(s => ({ ...s, secretAccessKey: e.currentTarget.value }))} required />
            <Button onClick={handleDeployApps} size="lg" color="indigo" fullWidth
              disabled={!s3Config.bucket || !s3Config.region || !s3Config.accessKeyID || !s3Config.secretAccessKey}
            >
              Validate & Deploy
            </Button>
          </Stack>
        </Paper>
      )}

      {/* PVC deploy button */}
      {!skipMonitoring && appsStorageType === 'pvc' && !appsResult && !appsDeploying && (
        <Stack align="center" mt="md">
          <Button onClick={handleDeployApps} size="lg" color="indigo" leftSection={<IconGitBranch size={20} />}>
            Deploy Monitoring Stack
          </Button>
        </Stack>
      )}

      {/* Deploying state */}
      {appsDeploying && (
        <Stack align="center" gap="sm" mt="md">
          <Loader size="lg" type="dots" />
          <Text c="dimmed" size="sm">Creating ArgoCD Application for monitoring stack...</Text>
          <Text c="dimmed" size="xs">ArgoCD will deploy Grafana + Loki to the monitoring namespace.</Text>
        </Stack>
      )}

      {/* Done / syncing state */}
      {appsResult && !appsReady && (
        <Stack gap="sm" w="100%" maw={500} mx="auto">
          <Alert icon={<IconCheck size={16} />} color="green">
            <Text size="sm">ArgoCD Application created — deploying to monitoring namespace...</Text>
          </Alert>

          {appsStatus?.components ? (
            <>
              <Text size="xs" c="dimmed" ta="center" mt="xs">
                {appsStatus.syncStatus === 'Synced' ? 'Synced' : appsStatus.syncStatus || 'Syncing...'} | {appsStatus.health || 'Checking'}
                {' | '}
                {appsStatus.totalReady ?? 0}/{appsStatus.totalCount ?? 0} pods ready
              </Text>
              {Object.entries(appsStatus.components).map(([name, comp]) => (
                <Paper key={name} withBorder p="xs" radius="sm" bg={comp.ready ? 'green.0' : 'gray.0'}>
                  <Group justify="space-between">
                    <Group gap="xs">
                      {comp.ready
                        ? <IconCheck size={14} color="#40c057" />
                        : <Loader size="xs" type="dots" />
                      }
                      <Text size="sm">{name}</Text>
                    </Group>
                    <Text size="xs" c="dimmed">
                      {comp.ready ? 'Ready' : `${comp.readyReplicas ?? 0}/${comp.totalReplicas ?? 1} pods`}
                    </Text>
                  </Group>
                </Paper>
              ))}
            </>
          ) : (
            <Stack align="center" gap="sm">
              <Loader size="lg" type="dots" />
              <Text c="dimmed" size="sm">Waiting for pods to start...</Text>
            </Stack>
          )}
        </Stack>
      )}

      {appsReady && (
        <Alert icon={<IconCheck size={16} />} color="green" w="100%">
          <Text size="sm" fw={500}>Monitoring stack is healthy! Grafana + Loki are running.</Text>
        </Alert>
      )}

      <Group justify="center" mt="md">
        <Button onClick={prevStep} variant="default" disabled={appsDeploying}>Back</Button>
        {appsReady && <Button onClick={nextStep} size="lg">Continue</Button>}
      </Group>
    </Stack>
  );

  const renderAlloyStep = () => (
    <Stack gap="md" py="xl">
      <Title order={3} ta="center">Deploy Grafana Alloy</Title>
      <Text c="dimmed" ta="center" maw={500}>
        Alloy collects metrics, logs, and traces from all pods in your cluster.
        Configure where it sends log data.
      </Text>

      {!alloyResult && !alloyDeploying && (
        <Paper withBorder p="md" radius="md" maw={500} mx="auto">
          <Stack gap="md">
            <TextInput
              label="Loki Push URL"
              description="Where Alloy sends collected logs"
              placeholder="http://monitoring-loki-distributor.monitoring:3100/loki/api/v1/push"
              value={lokiAddress}
              onChange={(e) => setLokiAddress(e.currentTarget.value)}
              leftSection={<IconSearch size={16} />}
            />
            {skipMonitoring && (
              <Alert icon={<IconAlertTriangle size={16} />} color="orange" variant="light">
                <Text size="sm">You skipped the LGTM stack. Make sure this Loki endpoint is reachable from the cluster.</Text>
              </Alert>
            )}
            <Button onClick={handleDeployAlloy} size="lg" color="indigo" fullWidth leftSection={<IconPlug size={20} />}>
              Deploy Alloy
            </Button>
          </Stack>
        </Paper>
      )}

      {alloyDeploying && (
        <Stack align="center" gap="sm" mt="md">
          <Loader size="lg" type="dots" />
          <Text c="dimmed" size="sm">Creating ArgoCD Application for Grafana Alloy...</Text>
          <Text c="dimmed" size="xs">ArgoCD will deploy Alloy with ConfigMap to the monitoring namespace.</Text>
        </Stack>
      )}

      {alloyResult && !alloyReady && (
        <Stack gap="sm" w="100%" maw={500} mx="auto">
          <Alert icon={<IconCheck size={16} />} color="green">
            <Text size="sm">ArgoCD Application created — deploying Alloy to monitoring namespace...</Text>
          </Alert>

          {alloyStatus?.components ? (
            <>
              <Text size="xs" c="dimmed" ta="center" mt="xs">
                {alloyStatus.syncStatus === 'Synced' ? 'Synced' : alloyStatus.syncStatus || 'Syncing...'} | {alloyStatus.health || 'Checking'}
                {' | '}
                {alloyStatus.totalReady ?? 0}/{alloyStatus.totalCount ?? 0} pods ready
              </Text>
              {Object.entries(alloyStatus.components).map(([name, comp]) => (
                <Paper key={name} withBorder p="xs" radius="sm" bg={comp.ready ? 'green.0' : 'gray.0'}>
                  <Group justify="space-between">
                    <Group gap="xs">
                      {comp.ready ? <IconCheck size={14} color="#40c057" /> : <Loader size="xs" type="dots" />}
                      <Text size="sm">{name}</Text>
                    </Group>
                    <Text size="xs" c="dimmed">{comp.ready ? 'Ready' : `${comp.readyReplicas ?? 0}/${comp.totalReplicas ?? 1} pods`}</Text>
                  </Group>
                </Paper>
              ))}
            </>
          ) : (
            <Stack align="center" gap="sm"><Loader size="lg" type="dots" /><Text c="dimmed" size="sm">Waiting for pods to start...</Text></Stack>
          )}
        </Stack>
      )}

      {alloyReady && (
        <Alert icon={<IconCheck size={16} />} color="green" w="100%">
          <Text size="sm" fw={500}>Grafana Alloy is running! Logs are being collected.</Text>
          {alloyStatus?.lokiURL && <Text size="xs" c="dimmed" mt={4}>Loki endpoint: {alloyStatus.lokiURL}</Text>}
        </Alert>
      )}

      <Group justify="center" mt="md">
        <Button onClick={prevStep} variant="default" disabled={alloyDeploying}>Back</Button>
        {alloyReady && <Button onClick={nextStep} size="lg">Continue</Button>}
      </Group>
    </Stack>
  );

  const renderVerifyStep = () => {
    const argocdComponentLabels = {
      'argocd-server': 'Server', 'argocd-repo-server': 'Repo Server',
      'argocd-applicationset-controller': 'ApplicationSet', 'argocd-dex-server': 'Dex (SSO)',
      'argocd-redis': 'Redis', 'argocd-notifications-controller': 'Notifications',
      'crds': 'CRDs',
    };

    return (
      <Stack align="center" gap="md" py="xl">
        <Title order={3}>Verifying Components</Title>
        <Text c="dimmed" ta="center" maw={500}>Checking that all bootstrapped components are running and healthy...</Text>

        {!verifyStatus && <Loader size="lg" />}

        {verifyStatus && (
          <Stack gap="sm" w="100%" maw={450}>
            {/* Agent */}
            <Paper withBorder p="sm" radius="md" bg={verifyStatus.agent?.ready ? 'green.0' : 'orange.0'}>
              <Group justify="space-between">
                <Group gap="sm"><IconRocket size={18} color={verifyStatus.agent?.ready ? '#40c057' : '#fd7e14'} /><Text size="sm" fw={500}>Agent ({agentName})</Text></Group>
                <Badge size="sm" color={verifyStatus.agent?.ready ? 'green' : 'orange'} variant="filled">{verifyStatus.agent?.ready ? 'Connected' : 'Waiting'}</Badge>
              </Group>
            </Paper>

            {/* ArgoCD */}
            <Paper withBorder p="sm" radius="md" bg={verifyStatus.argocd?.ready ? 'green.0' : 'orange.0'}>
              <Group justify="space-between">
                <Group gap="sm"><IconGitBranch size={18} color={verifyStatus.argocd?.ready ? '#40c057' : '#fd7e14'} /><Text size="sm" fw={500}>ArgoCD</Text></Group>
                <Badge size="sm" color={verifyStatus.argocd?.ready ? 'green' : 'orange'} variant="filled">
                  {verifyStatus.argocd?.ready ? 'Ready' : `${verifyStatus.argocd?.totalReady ?? 0}/${verifyStatus.argocd?.totalCount ?? 6}`}
                </Badge>
              </Group>
              {verifyStatus.argocd?.components && (
                <Stack gap={2} mt="xs">
                  {Object.entries(verifyStatus.argocd.components).map(([key, comp]) => (
                    <Group key={key} justify="space-between" px="xs">
                      <Group gap={4}>{comp.ready ? <IconCheck size={12} color="#40c057" /> : <Loader size="xs" type="dots" />}<Text size="xs" c="dimmed">{argocdComponentLabels[key] || key}</Text></Group>
                      <Text size="xs" c="dimmed">{comp.ready ? 'Ready' : `${comp.readyReplicas ?? 0}/${comp.totalReplicas ?? 1}`}</Text>
                    </Group>
                  ))}
                </Stack>
              )}
            </Paper>

            {/* Apps (Monitoring) */}
            <Paper withBorder p="sm" radius="md" bg={verifyStatus.apps?.ready ? 'green.0' : 'orange.0'}>
              <Group justify="space-between">
                <Group gap="sm"><IconDatabase size={18} color={verifyStatus.apps?.ready ? '#40c057' : '#fd7e14'} /><Text size="sm" fw={500}>Monitoring (Grafana + Loki)</Text></Group>
                <Badge size="sm" color={verifyStatus.apps?.ready ? 'green' : 'orange'} variant="filled">
                  {verifyStatus.apps?.ready ? 'Healthy' : `${verifyStatus.apps?.totalReady ?? 0}/${verifyStatus.apps?.totalCount ?? 0}`}
                </Badge>
              </Group>
              {verifyStatus.apps?.components && (
                <Stack gap={2} mt="xs">
                  {Object.entries(verifyStatus.apps.components).map(([name, comp]) => (
                    <Group key={name} justify="space-between" px="xs">
                      <Group gap={4}>{comp.ready ? <IconCheck size={12} color="#40c057" /> : <Loader size="xs" type="dots" />}<Text size="xs" c="dimmed">{name}</Text></Group>
                      <Text size="xs" c="dimmed">{comp.ready ? 'Ready' : `${comp.readyReplicas ?? 0}/${comp.totalReplicas ?? 1}`}</Text>
                    </Group>
                  ))}
                </Stack>
              )}
              {(!verifyStatus.apps?.components || Object.keys(verifyStatus.apps?.components || {}).length === 0) && verifyStatus.apps?.syncDetails && (
                <Text size="xs" c="dimmed" mt={4}>{verifyStatus.apps.syncDetails}</Text>
              )}
            </Paper>

            {/* Alloy */}
            <Paper withBorder p="sm" radius="md" bg={verifyStatus.alloy?.ready ? 'green.0' : (alloyResult ? 'orange.0' : undefined)}>
              <Group justify="space-between">
                <Group gap="sm"><IconPlug size={18} color={verifyStatus.alloy?.ready ? '#40c057' : alloyResult ? '#fd7e14' : '#868e96'} /><Text size="sm" fw={500}>Grafana Alloy</Text></Group>
                <Badge size="sm" color={verifyStatus.alloy?.ready ? 'green' : alloyResult ? 'orange' : 'gray'} variant="filled">
                  {!alloyResult ? 'Not Deployed' : verifyStatus.alloy?.ready ? 'Healthy' : `${verifyStatus.alloy?.totalReady ?? 0}/${verifyStatus.alloy?.totalCount ?? 0}`}
                </Badge>
              </Group>
              {verifyStatus.alloy?.lokiURL && (
                <Text size="xs" c="dimmed" mt={4} style={{ fontFamily: 'monospace' }}>Logs → {verifyStatus.alloy.lokiURL}</Text>
              )}
              {verifyStatus.alloy?.components && (
                <Stack gap={2} mt="xs">
                  {Object.entries(verifyStatus.alloy.components).map(([name, comp]) => (
                    <Group key={name} justify="space-between" px="xs">
                      <Group gap={4}>{comp.ready ? <IconCheck size={12} color="#40c057" /> : <Loader size="xs" type="dots" />}<Text size="xs" c="dimmed">{name}</Text></Group>
                      <Text size="xs" c="dimmed">{comp.ready ? 'Ready' : `${comp.readyReplicas ?? 0}/${comp.totalReplicas ?? 1}`}</Text>
                    </Group>
                  ))}
                </Stack>
              )}
            </Paper>

            {allReady && (
              <Alert icon={<IconCheck size={16} />} color="green" mt="sm">All systems go! Redirecting to dashboard...</Alert>
            )}
          </Stack>
        )}

        <Group justify="center" mt="xl">
          <Button onClick={prevStep} variant="default">Back</Button>
        </Group>
      </Stack>
    );
  };

  const renderReadyStep = () => (
    <Stack align="center" gap="md" py="xl">
      <IconCheck size={64} color="green" stroke={1.5} />
      <Title order={3} c="green">You're All Set!</Title>
      <Text c="dimmed" ta="center" maw={400}>
        Your single-cluster CSOC is ready. The agent <b>{agentName}</b> has connected successfully{envInfo ? ` on ${envInfo.provider}` : ''},
        ArgoCD is installed{!skipMonitoring ? ', and the monitoring stack (Grafana + Loki) is deployed' : ''}{alloyResult ? ', and Grafana Alloy is collecting metrics & logs' : ''}.
      </Text>
      <Group gap="md" mt="md">
        <Button onClick={handleComplete} size="lg" color="green">Go to Dashboard</Button>
      </Group>
    </Stack>
  );

  const contentForStep = (step) => {
    switch (step) {
      case 0: return renderDetectStep();
      case 1: return renderSetupStep();
      case 2: return renderDeployStep();
      case 3: return renderArgoCDStep();
      case 4: return renderAppsStep();
      case 5: return renderAlloyStep();
      case 6: return renderVerifyStep();
      case 7: return renderReadyStep();
      default: return null;
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', paddingTop: 40 }}>
      <Container size="lg">

        {/* Navigation buttons */}
        <Box mb="md" style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Group spacing="md">
            <Button variant="default" onClick={prevStep}
              disabled={active === 0 || active === 2 || active === 4 || active === 5 || active === 6 || active === 7}
            >Back</Button>
            {active === 0 && !envLoading && envInfo && (<Button onClick={nextStep}>Next</Button>)}
          </Group>
        </Box>

        <Paper p="lg" radius="md" shadow="sm">
          <div style={{ display: 'flex', gap: 24 }}>

            {/* Sidebar - Stepper */}
            <div style={{ width: 240, borderRight: '1px solid #e5e7eb', paddingRight: 16 }}>
              <Stepper active={active} orientation="vertical" iconSize={28} size="sm" allowNextStepsSelect={false}>
                <Stepper.Step label="Detect" description="Environment check" />
                <Stepper.Step label="Setup" description="Choose mode" />
                <Stepper.Step label="Deploy" description="Install agent" />
                <Stepper.Step label="ArgoCD" description="Install GitOps" />
                <Stepper.Step label="Apps" description="Monitoring" />
                <Stepper.Step label="Alloy" description="Log collector" />
                <Stepper.Step label="Verify" description="Health check" />
                <Stepper.Step label="Ready" description="All done" />
              </Stepper>
            </div>

            {/* Main content */}
            <div style={{ flex: 1 }}>{contentForStep(active)}</div>

          </div>
        </Paper>

      </Container>
    </div>
  );
}
