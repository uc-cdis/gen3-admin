import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Stepper, Button, Text, Group, Paper, Container, Stack,
  Loader, Alert, Title, Code, Box, TextInput, Badge, Select, SimpleGrid, Switch,
  Anchor, ThemeIcon, Progress, Divider, Flex
} from '@mantine/core';
import {
  IconCheck, IconAlertTriangle, IconServer, IconRocket, IconPlug, IconSearch,
  IconGitBranch, IconDatabase, IconCloud, IconShield, IconChartLine, IconSettings,
  IconCircleCheck, IconBulb, IconChevronRight
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { callGoApi } from '@/lib/k8s';

const STEP_CONFIG = [
  { label: 'Welcome', description: "Let's get started", icon: IconBulb, color: 'blue' },
  { label: 'Setup',   description: 'Configure agent',  icon: IconSettings, color: 'violet' },
  { label: 'Deploy',  description: 'Install into cluster', icon: IconRocket, color: 'green' },
  { label: 'ArgoCD',  description: 'Install deployment tool', icon: IconGitBranch, color: 'indigo' },
  { label: 'Monitor', description: 'Set up Grafana & Loki', icon: IconChartLine, color: 'orange' },
  { label: 'Alloy',   description: 'Enable log collection', icon: IconPlug, color: 'teal' },
  { label: 'Verify',  description: 'Check everything works', icon: IconShield, color: 'pink' },
  { label: 'Done',    description: "You're all set!",      icon: IconCircleCheck, color: 'green' },
];

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
  const [deployMode, setDeployMode] = useState('lightweight');
  const [skipMonitoring, setSkipMonitoring] = useState(false);
  const [s3Config, setS3Config] = useState({ bucket: '', region: '', accessKeyID: '', secretAccessKey: '' });
  const [appsDeploying, setAppsDeploying] = useState(false);
  const [appsResult, setAppsResult] = useState(null);
  const [appsStatus, setAppsStatus] = useState(null);
  const [appsReady, setAppsReady] = useState(false);

  // Alloy state
  const [alloyDeploying, setAlloyDeploying] = useState(false);
  const [alloyResult, setAlloyResult] = useState(null);
  const [alloyStatus, setAlloyStatus] = useState(null);
  const [alloyReady, setAlloyReady] = useState(false);
  const [lokiAddress, setLokiAddress] = useState('http://monitoring-loki-gateway.monitoring:8080/loki/api/v1/push');

  // Verify state
  const [verifyStatus, setVerifyStatus] = useState(null);

  // Auto-skip state
  const [autoSkipped, setAutoSkipped] = useState(false);
  const [minStep, setMinStep] = useState(0);

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

  // Poll bootstrap status when on verify step (step 6)
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
    (!alloyResult || verifyStatus?.alloy?.ready || !verifyStatus?.alloy);

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
        // Pre-fill agent name from detected provider if still on default
        if (data?.provider && data.provider !== 'Unknown' && agentName === 'local-agent') {
          setAgentName(data.provider.toLowerCase());
        }
      })
      .catch(err => {
        console.error('Failed to detect environment:', err);
        setEnvLoading(false);
      });
  }, [accessToken]);

  // Auto-skip to the correct step based on existing bootstrap state
  useEffect(() => {
    if (!envInfo || autoSkipped) return;
    callGoApi('/bootstrap/status', 'GET', null, null, accessToken)
      .then(status => {
        if (!status) return;
        setAutoSkipped(true);

        if (status.agent?.ready) {
          setAgentConnected(true);
          setAgentName(status.agent.name || 'local-agent');
        }

        if (status.argocd?.ready) {
          setArgocdStatus(status.argocd);
          setArgocdResult({ message: 'Already installed' });
          setArgocdReady(true);
        } else if (status.argocd?.components) {
          setArgocdStatus(status.argocd);
          setArgocdResult({ message: 'Resuming...' });
        }

        if (status.apps?.ready) {
          setAppsStatus(status.apps);
          setAppsResult({ message: 'Already deployed' });
          setAppsReady(true);
        }

        if (status.alloy?.ready) {
          setAlloyStatus(status.alloy);
          setAlloyResult({ message: 'Already deployed' });
          setAlloyReady(true);
        }

        let targetStep = 0;
        if (status.alloy?.ready || (!status.alloy && status.apps?.ready)) {
          targetStep = 7;
        } else if (status.apps?.ready) {
          targetStep = 5;
        } else if (status.argocd?.ready) {
          targetStep = 4;
        } else if (status.agent?.ready) {
          targetStep = 3;
        }
        setActive(targetStep);
        setMinStep(targetStep);
      })
      .catch(() => {});
  }, [envInfo, accessToken]);

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
          setActive(3);
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
          setActive(4);
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
        mode: deployMode,
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

      if (result?.lokiEndpoint) {
        setLokiAddress(result.lokiEndpoint);
      }

      if (skipMonitoring) {
        setAppsReady(true);
        setActive(5);
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
          setActive(5);
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
          setActive(6);
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

  const nextStep = () => setActive(prev => Math.min(prev + 1, 7));
  const prevStep = () => setActive(prev => Math.max(prev - 1, minStep));

  // ─── Step content renderers ──────────────────────────────────────

  const renderDetectStep = () => {
    if (envLoading) {
      return (
        <Stack align="center" gap="md" py="xl">
          <Loader size="lg" type="dots" color="indigo" />
          <Text c="dimmed" size="lg">Connecting to your cluster...</Text>
        </Stack>
      );
    }

    if (!envInfo) {
      return (
        <Stack align="center" gap="lg" py="xl">
          <Alert icon={<IconAlertTriangle size={20} />} variant="light" color="red" radius="md" w="100%" maw={480}>
            <Title order={5}>Connection Failed</Title>
            <Text size="sm" mt={4}>Could not reach your Kubernetes cluster. Verify your kubeconfig or in-cluster service account.</Text>
          </Alert>
        </Stack>
      );
    }

    const steps = [
      { icon: IconRocket, label: 'Deploy Agent', desc: 'Install the CSOC agent into your cluster so it can manage resources on your behalf.' },
      { icon: IconGitBranch, label: 'Install ArgoCD', desc: 'Set up GitOps-based continuous delivery to handle all future deployments.' },
      { icon: IconChartLine, label: 'Add Monitoring', desc: 'Deploy Grafana and Loki for dashboards, metrics, and log aggregation.' },
      { icon: IconPlug, label: 'Enable Alloy', desc: 'Collect logs and metrics from every pod in your cluster.' },
    ];

    return (
      <Stack gap="xl" py="md">
        {/* Welcome header */}
        <div ta="center">
          <ThemeIcon size={64} radius="xl" variant="filled" gradient={{ from: 'indigo', to: 'cyan', deg: 135 }}>
            <IconBulb size={32} stroke={1.5} />
          </ThemeIcon>
          <Title order={2} ta="center" mt="sm">Welcome to CSOC</Title>
          <Text c="dimmed" ta="center" mt="xs" size="lg" maw={500} mx="auto">
            This wizard will set up your cluster with everything needed to deploy and manage Gen3 Data Commons.
          </Text>
        </div>

        {/* Cluster status — subtle */}
        {envInfo.connected && (
          <Group justify="center" gap="xs">
            <IconCheck size={14} color="#40c057" />
            <Text size="sm" c="dimmed">
              Connected{envInfo.provider && envInfo.provider !== 'Unknown' ? ` to ${envInfo.provider}` : ''}{envInfo.version && envInfo.version !== 'Unknown' ? ` (v${envInfo.version})` : ''}
            </Text>
          </Group>
        )}

        {/* What we'll do */}
        <Stack gap="sm" w="100%" maw={540} mx="auto" mt="sm">
          {steps.map((step, i) => (
            <Group key={i} gap="md" p="sm">
              <ThemeIcon size={36} radius="md" variant="light" color={STEP_CONFIG[i + 2].color}>
                <step.icon size={18} stroke={1.5} />
              </ThemeIcon>
              <div style={{ flex: 1 }}>
                <Text size="sm" fw={600}>{i + 1}. {step.label}</Text>
                <Text size="xs" c="dimmed">{step.desc}</Text>
              </div>
            </Group>
          ))}
        </Stack>

        {/* Start button */}
        <div ta="center">
          <Button onClick={nextStep} size="lg" rightSection={<IconChevronRight size={18} />}>
            Get Started
          </Button>
        </div>
      </Stack>
    );
  };

  const renderSetupStep = () => (
    <Stack gap="xl" py="xl">
      <div ta="center">
        <ThemeIcon size={56} radius="xl" variant="light" color="violet">
          <IconRocket size={28} stroke={1.5} />
        </ThemeIcon>
        <Title order={3} mt="sm">Configure Your Agent</Title>
        <Text c="dimmed" mt={4} maw={480} mx="auto">
          This agent will deploy into your <b>{envInfo?.provider && envInfo.provider !== 'Unknown' ? envInfo.provider : 'Kubernetes'}</b> cluster
          and run all deployment commands on your behalf. It connects back to this portal so you can manage everything from here.
        </Text>
      </div>

      <Paper withBorder p="xl" radius="lg" maw={480} mx="auto">
        <TextInput
          label="Agent Name"
          description={`A name to identify this cluster in the portal (auto-filled from your ${envInfo?.provider || 'environment'})`}
          value={agentName}
          onChange={(e) => setAgentName(e.currentTarget.value)}
          placeholder="local-agent"
          leftSection={<IconRocket size={16} />}
          size="md"
        />
      </Paper>

      <Flex justify="flex-end" maw={480} mx="auto" w="100%">
        <Group>
          <Button onClick={prevStep} variant="default">Back</Button>
          <Button onClick={handleDeploy} loading={deploying} size="lg" color="green" leftSection={<IconRocket size={18} />}>
            Deploy Agent
          </Button>
        </Group>
      </Flex>

      {deployResult && (
        <Paper withBorder p="md" radius="lg" bg="dark.0" maw={480} mx="auto">
          <Group gap="xs" mb="xs">
            <IconCheck size={14} color="#40c057" />
            <Text size="sm" fw={500} c="white">Resources applied</Text>
          </Group>
          <Code block style={{ fontSize: 12 }}>{JSON.stringify(deployResult, null, 2)}</Code>
        </Paper>
      )}
    </Stack>
  );

  const renderDeployStep = () => (
    <Stack align="center" gap="lg" py="xl">
      <ThemeIcon size={56} radius="xl" variant="light" color="green">
        <IconRocket size={28} stroke={1.5} />
      </ThemeIcon>
      <Title order={3}>Installing Agent</Title>

      {deploying && (
        <Stack align="center" gap="sm" w="100%" maw={420}>
          <Paper withBorder p="xl" radius="lg" bg="blue.0">
            <Stack align="center" gap="md">
              <Loader size="lg" type="dots" color="blue" />
              <Text size="sm" fw={500} ta="center">{deployStatus?.text || 'Generating TLS certificates...'}</Text>
            </Stack>
          </Paper>
        </Stack>
      )}

      {deployResult && !agentConnected && (
        <Stack align="center" gap="md" w="100%" maw={420}>
          <Paper withBorder p="lg" radius="lg" bg="green.0">
            <Group gap="sm" justify="center">
              <IconCheck size={20} color="#40c057" />
              <Text size="sm" fw={500}>Resources applied to cluster</Text>
            </Group>
            <Text size="xs" c="dimmed" ta="center" mt={4}>Server: {deployResult.serverAddress}</Text>
          </Paper>

          <Paper withBorder p="xl" radius="lg" w="100%">
            <Stack align="center" gap="md">
              <Loader size="lg" type="dots" />
              <Text size="sm" ta="center">Waiting for agent pod to start...</Text>
              <Text size="xs" c="dimmed" ta="center">This may take 30-60 seconds while the image pulls.</Text>
            </Stack>
          </Paper>
        </Stack>
      )}

      {deployStatus?.phase === 'error' && (
        <Alert icon={<IconAlertTriangle size={20} />} variant="light" color="red" radius="md" w="100%" maw={420}>
          <Text size="sm">{deployStatus.text}</Text>
        </Alert>
      )}

      {!polling && deployStatus?.phase !== 'error' && !deploying && !agentConnected && (
        <Button onClick={() => pollForAgent(agentName)} variant="light">
          Check Connection Status
        </Button>
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
      <Stack gap="lg" py="xl">
        <div ta="center">
          <ThemeIcon size={56} radius="xl" variant="light" color="indigo">
            <IconGitBranch size={28} stroke={1.5} />
          </ThemeIcon>
          <Title order={3} mt="sm">Install ArgoCD</Title>
          <Text c="dimmed" mt={4} maw={480} mx="auto">
            GitOps continuous delivery tool that manages all future application deployments.
          </Text>
        </div>

        {!argocdResult && !argocdInstalling && (
          <Stack align="center" mt="md">
            <Button onClick={handleInstallArgoCD} size="lg" color="indigo" leftSection={<IconGitBranch size={20} />}>
              Install ArgoCD
            </Button>
          </Stack>
        )}

        {argocdInstalling && (
          <Stack align="center" gap="sm" mt="md">
            <Loader size="lg" type="dots" color="indigo" />
            <Text c="dimmed" size="sm">Installing ArgoCD to cluster...</Text>
            <Text c="dimmed" size="xs">Applying manifests and creating resources...</Text>
          </Stack>
        )}

        {argocdResult && !argocdReady && (
          <Stack gap="sm" w="100%" maw={520} mx="auto">
            <Paper withBorder p="md" radius="lg" bg="green.0">
              <Group gap="sm">
                <IconCheck size={18} color="#40c057" />
                <Text size="sm" fw={500}>Manifest applied — waiting for components...</Text>
              </Group>
            </Paper>

            {argocdStatus?.components ? (
              <>
                <Text size="xs" c="dimmed" ta="center" mt="xs" fw={500}>
                  {argocdStatus.totalReady}/{argocdStatus.totalCount} components ready
                </Text>
                {Object.entries(argocdStatus.components).map(([key, comp]) => (
                  <Paper key={key} withBorder p="sm" radius="md" bg={comp.ready ? 'green.0' : 'gray.0'}>
                    <Group justify="space-between">
                      <Group gap="xs">
                        {comp.ready
                          ? <IconCheck size={14} color="#40c057" />
                          : <Loader size="xs" type="dots" />}
                        <Text size="sm">{componentLabels[key] || key}</Text>
                      </Group>
                      <Badge size="xs" color={comp.ready ? 'green' : 'gray'} variant="filled" radius="sm">
                        {comp.ready ? 'Ready' : `${comp.readyReplicas ?? 0}/${comp.totalReplicas ?? 1}`}
                      </Badge>
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
          <Paper withBorder p="md" radius="lg" bg="green.0" w="100%" maw={400} mx="auto">
            <Group gap="sm" justify="center">
              <IconCheck size={20} color="#40c057" />
              <Text size="sm" fw={500}>All ArgoCD components are running!</Text>
            </Group>
          </Paper>
        )}

        <Group justify="center" mt="md">
          <Button onClick={prevStep} variant="default" disabled={argocdInstalling}>Back</Button>
          {argocdReady && <Button onClick={nextStep} size="lg" rightSection={<IconChevronRight size={18} />}>Continue</Button>}
        </Group>
      </Stack>
    );
  };

  const renderAppsStep = () => (
    <Stack gap="lg" py="xl">
      <div ta="center">
        <ThemeIcon size={56} radius="xl" variant="light" color="orange">
          <IconChartLine size={28} stroke={1.5} />
        </ThemeIcon>
        <Title order={3} mt="sm">Set Up Monitoring</Title>
        <Text c="dimmed" mt={4} maw={480} mx="auto">
          Deploy Grafana + Loki for observability. Choose where Loki stores its data.
        </Text>
      </div>

      {/* Skip option */}
      {!appsResult && !appsDeploying && (
        <Paper withBorder p="md" radius="lg" maw={520} mx="auto"
          style={{
            borderColor: skipMonitoring ? '#fd7e14' : undefined,
            backgroundColor: skipMonitoring ? '#fff8f0' : undefined,
          }}
        >
          <Group justify="space-between" align="center">
            <div>
              <Text size="sm" fw={600}>Skip Monitoring Stack</Text>
              <Text size="xs" c="dimmed">Deploy without Grafana/Loki. Add it later.</Text>
            </div>
            <Switch checked={skipMonitoring} onChange={(e) => setSkipMonitoring(e.currentTarget.checked)} color="orange" />
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

      {/* Deployment mode cards */}
      {!skipMonitoring && !appsResult && !appsDeploying && (
        <SimpleGrid cols={3} maw={720} mx="auto" mt="md">
          <Paper withBorder p="lg" radius="lg"
            style={{
              cursor: 'pointer',
              borderColor: deployMode === 'lightweight' ? '#40c057' : undefined,
              backgroundColor: deployMode === 'lightweight' ? '#f0fff4' : undefined,
              boxShadow: deployMode === 'lightweight' ? '0 0 0 2px #40c05722' : undefined,
            }}
            onClick={() => { setDeployMode('lightweight'); setAppsStorageType('pvc'); }}
          >
            <Stack align="center" gap="xs">
              <ThemeIcon size={44} radius="md" variant={deployMode === 'lightweight' ? 'filled' : 'light'} color="green">
                <IconRocket size={22} />
              </ThemeIcon>
              <Text size="sm" fw={600}>Lightweight</Text>
              <Text size="xs" c="dimmed" ta="center">Loki SingleBinary + Grafana. ~4 pods. Best for workshops.</Text>
              {deployMode === 'lightweight' && <Badge size="sm" color="green" variant="filled" radius="sm">Selected</Badge>}
            </Stack>
          </Paper>

          <Paper withBorder p="lg" radius="lg"
            style={{
              cursor: 'pointer',
              borderColor: deployMode === 'full' && appsStorageType === 'pvc' ? '#228be6' : undefined,
              backgroundColor: deployMode === 'full' && appsStorageType === 'pvc' ? '#ebf5ff' : undefined,
              boxShadow: deployMode === 'full' && appsStorageType === 'pvc' ? '0 0 0 2px #228be622' : undefined,
            }}
            onClick={() => { setDeployMode('full'); setAppsStorageType('pvc'); }}
          >
            <Stack align="center" gap="xs">
              <ThemeIcon size={44} radius="md" variant={deployMode === 'full' && appsStorageType === 'pvc' ? 'filled' : 'light'} color="blue">
                <IconDatabase size={22} />
              </ThemeIcon>
              <Text size="sm" fw={600}>Full Stack (PVC)</Text>
              <Text size="xs" c="dimmed" ta="center">LGTM distributed. Loki+Mimir+Grafana+Tempo. Local storage.</Text>
              {deployMode === 'full' && appsStorageType === 'pvc' && <Badge size="sm" color="blue" variant="filled" radius="sm">Selected</Badge>}
            </Stack>
          </Paper>

          <Paper withBorder p="lg" radius="lg"
            style={{
              cursor: 'pointer',
              borderColor: deployMode === 'full' && appsStorageType === 's3' ? '#228be6' : undefined,
              backgroundColor: deployMode === 'full' && appsStorageType === 's3' ? '#ebf5ff' : undefined,
              boxShadow: deployMode === 'full' && appsStorageType === 's3' ? '0 0 0 2px #228be622' : undefined,
            }}
            onClick={() => { setDeployMode('full'); setAppsStorageType('s3'); }}
          >
            <Stack align="center" gap="xs">
              <ThemeIcon size={44} radius="md" variant={deployMode === 'full' && appsStorageType === 's3' ? 'filled' : 'light'} color="blue">
                <IconCloud size={22} />
              </ThemeIcon>
              <Text size="sm" fw={600}>Full Stack (S3)</Text>
              <Text size="xs" c="dimmed" ta="center">LGTM distributed with S3 backend. Production-ready.</Text>
              {deployMode === 'full' && appsStorageType === 's3' && <Badge size="sm" color="blue" variant="filled" radius="sm">Selected</Badge>}
            </Stack>
          </Paper>
        </SimpleGrid>
      )}

      {!skipMonitoring && !appsResult && !appsDeploying && (
        <Text size="xs" c="dimmed" ta="center" mt="xs">
          {deployMode === 'lightweight'
            ? 'SingleBinary Loki (~2 pods) + Grafana (~1 pod)'
            : `Full LGTM stack — Loki (${appsStorageType === 's3' ? 'S3' : 'PVC'}) + Mimir + Tempo + Grafana`}
        </Text>
      )}

      {/* S3 config */}
      {!skipMonitoring && deployMode === 'full' && appsStorageType === 's3' && !appsResult && !appsDeploying && (
        <Paper withBorder p="xl" radius="lg" maw={450} mx="auto">
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

      {/* Deploy button */}
      {!skipMonitoring && !appsResult && !appsDeploying && !(deployMode === 'full' && appsStorageType === 's3') && (
        <Stack align="center" mt="md">
          <Button onClick={handleDeployApps} size="lg" color="indigo" leftSection={<IconGitBranch size={20} />}>
            Deploy {deployMode === 'lightweight' ? 'Lightweight Stack' : 'Monitoring Stack'}
          </Button>
        </Stack>
      )}

      {/* Deploying state */}
      {appsDeploying && (
        <Stack align="center" gap="sm" mt="md">
          <Loader size="lg" type="dots" color="indigo" />
          <Text c="dimmed" size="sm">Creating ArgoCD Application{deployMode === 'lightweight' ? ' (Lightweight)' : ''}...</Text>
          <Text c="dimmed" size="xs">
            {deployMode === 'lightweight'
              ? 'ArgoCD will deploy Loki SingleBinary + Grafana (~4 pods).'
              : 'ArgoCD will deploy LGTM stack (Loki + Mimir + Tempo + Grafana) to monitoring.'}
          </Text>
        </Stack>
      )}

      {/* Syncing / done state */}
      {appsResult && !appsReady && (
        <Stack gap="sm" w="100%" maw={600} mx="auto">
          <Paper withBorder p="md" radius="lg" bg="green.0">
            <Group gap="sm">
              <IconCheck size={18} color="#40c057" />
              <Text size="sm" fw={500}>ArgoCD Application created — deploying to monitoring namespace...</Text>
            </Group>
          </Paper>

          {(appsStatus?.syncStatus === 'Unknown' || appsStatus?.syncStatus === 'OutOfSync' || appsStatus?.syncDetails) && (
            <Alert icon={<IconAlertTriangle size={16} />} variant="light" color={appsStatus?.syncStatus === 'Synced' ? 'green' : 'red'} radius="md">
              <Text size="sm" fw={500}>Sync: {appsStatus?.syncStatus || 'Unknown'}</Text>
              {appsStatus?.syncDetails && (
                <Code block size="xs" mt={4}>{appsStatus.syncDetails}</Code>
              )}
            </Alert>
          )}

          {appsStatus?.healthMessage && appsStatus?.health !== 'Healthy' && (
            <Alert icon={<IconAlertTriangle size={16} />} variant="light" color="orange" radius="md">
              <Code block size="xs">{appsStatus.healthMessage}</Code>
            </Alert>
          )}

          {appsStatus?.components ? (
            <>
              <Text size="xs" c="dimmed" ta="center" mt="xs" fw={500}>
                {appsStatus.syncStatus === 'Synced' ? 'Synced' : appsStatus.syncStatus || 'Syncing...'} | {appsStatus.health || 'Checking'}
                {' | '}
                {appsStatus.totalReady ?? 0}/{appsStatus.totalCount ?? 0} pods ready
              </Text>
              {Object.entries(appsStatus.components).map(([name, comp]) => (
                <Paper key={name} withBorder p="xs" radius="md" bg={comp.ready ? 'green.0' : 'gray.0'}>
                  <Group justify="space-between">
                    <Group gap="xs">
                      {comp.ready
                        ? <IconCheck size={14} color="#40c057" />
                        : <Loader size="xs" type="dots" />}
                      <Text size="sm">{name}</Text>
                    </Group>
                    <Badge size="xs" color={comp.ready ? 'green' : 'gray'} variant="filled" radius="sm">
                      {comp.ready ? 'Ready' : `${comp.readyReplicas ?? 0}/${comp.totalReplicas ?? 1}`}
                    </Badge>
                  </Group>
                </Paper>
              ))}
            </>
          ) : (
            <Stack align="center" gap="sm"><Loader size="lg" type="dots" /><Text c="dimmed" size="sm">Waiting for pods to start...</Text></Stack>
          )}
        </Stack>
      )}

      {appsReady && (
        <Paper withBorder p="md" radius="lg" bg="green.0" w="100%" maw={500} mx="auto">
          <Group gap="sm" justify="center">
            <IconCheck size={20} color="#40c057" />
            <Text size="sm" fw={500}>
              {skipMonitoring
                ? 'Monitoring skipped.'
                : deployMode === 'lightweight'
                  ? 'Lightweight stack healthy! Loki + Grafana are running.'
                  : 'Full LGTM stack healthy! All components are running.'}
            </Text>
          </Group>
        </Paper>
      )}

      <Group justify="center" mt="md">
        <Button onClick={prevStep} variant="default" disabled={appsDeploying}>Back</Button>
        {!appsReady && (
          <Button onClick={() => { setAppsResult(null); setAppsStatus(null); setAppsReady(false); handleDeployApps(); }}
            loading={appsDeploying} color="orange" leftSection={<IconRocket size={16} />}>
            Redeploy
          </Button>
        )}
        {appsReady && <Button onClick={nextStep} size="lg" rightSection={<IconChevronRight size={18} />}>Continue</Button>}
      </Group>
    </Stack>
  );

  const renderAlloyStep = () => (
    <Stack gap="lg" py="xl">
      <div ta="center">
        <ThemeIcon size={56} radius="xl" variant="light" color="teal">
          <IconPlug size={28} stroke={1.5} />
        </ThemeIcon>
        <Title order={3} mt="sm">Set Up Log Collection</Title>
        <Text c="dimmed" mt={4} maw={480} mx="auto">
          Alloy collects metrics, logs, and traces from all pods in your cluster.
        </Text>
      </div>

      {!alloyResult && !alloyDeploying && (
        <Paper withBorder p="xl" radius="lg" maw={500} mx="auto">
          <Stack gap="md">
            <TextInput
              label="Loki Push URL"
              description={
                skipMonitoring
                  ? "External Loki endpoint (you skipped local monitoring)"
                  : deployMode === 'lightweight'
                    ? "Auto-detected from your Lightweight deployment"
                    : "Auto-detected from your Full LGTM stack deployment"
              }
              placeholder="http://monitoring-loki-gateway.monitoring:8080/loki/api/v1/push"
              value={lokiAddress}
              onChange={(e) => setLokiAddress(e.currentTarget.value)}
              leftSection={<IconSearch size={16} />}
              size="md"
            />
            {skipMonitoring && (
              <Alert icon={<IconAlertTriangle size={16} />} variant="light" color="orange" radius="md">
                <Text size="sm">Make sure this Loki endpoint is reachable from the cluster.</Text>
              </Alert>
            )}
            {!skipMonitoring && (
              <Group gap="xs">
                <Text size="xs" c="dimmed">Mode:</Text>
                <Badge size="xs" variant="filled" color={deployMode === 'lightweight' ? 'green' : 'blue'} radius="sm">
                  {deployMode === 'lightweight' ? 'Lightweight' : 'Full'}
                </Badge>
                <Text size="xs" c="dimmed">— Auto-filled from Apps step.</Text>
              </Group>
            )}
            <Button onClick={handleDeployAlloy} size="lg" color="indigo" fullWidth leftSection={<IconPlug size={20} />}>
              Deploy Alloy
            </Button>
          </Stack>
        </Paper>
      )}

      {alloyDeploying && (
        <Stack align="center" gap="sm" mt="md">
          <Loader size="lg" type="dots" color="teal" />
          <Text c="dimmed" size="sm">Creating ArgoCD Application for Grafana Alloy...</Text>
          <Text c="dimmed" size="xs">ArgoCD will deploy Alloy with ConfigMap to the monitoring namespace.</Text>
        </Stack>
      )}

      {alloyResult && !alloyReady && (
        <Stack gap="sm" w="100%" maw={600} mx="auto">
          <Paper withBorder p="md" radius="lg" bg="green.0">
            <Group gap="sm">
              <IconCheck size={18} color="#40c057" />
              <Text size="sm" fw={500}>ArgoCD Application created — deploying Alloy...</Text>
            </Group>
          </Paper>

          <SimpleGrid cols={3} mt="xs">
            <Paper withBorder p="sm" radius="md" bg={alloyStatus?.configMap ? 'green.0' : 'orange.0'}>
              <Group gap={6}>
                {alloyStatus?.configMap ? <IconCheck size={14} color="#40c057" /> : <Loader size="xs" type="dots" />}
                <div>
                  <Text size="xs" fw={600}>ConfigMap</Text>
                  <Text size="xs" c="dimmed">alloy-gen3</Text>
                </div>
              </Group>
            </Paper>
            <Paper withBorder p="sm" radius="md" bg={alloyStatus?.appCR ? 'green.0' : 'orange.0'}>
              <Group gap={6}>
                {alloyStatus?.appCR ? <IconCheck size={14} color="#40c057" /> : <Loader size="xs" type="dots" />}
                <div>
                  <Text size="xs" fw={600}>App CR</Text>
                  <Text size="xs" c="dimmed">grafana-alloy</Text>
                </div>
              </Group>
            </Paper>
            <Paper withBorder p="sm" radius="md" bg={(alloyStatus?.totalCount ?? 0) > 0 && (alloyStatus?.totalReady ?? 0) >= (alloyStatus?.totalCount ?? 1) ? 'green.0' : (alloyStatus?.totalCount ?? 0) > 0 ? 'orange.0' : 'gray.0'}>
              <Group gap={6}>
                {(alloyStatus?.totalCount ?? 0) > 0 && (alloyStatus?.totalReady ?? 0) >= (alloyStatus?.totalCount ?? 1)
                  ? <IconCheck size={14} color="#40c057" />
                  : (alloyStatus?.totalCount ?? 0) > 0
                    ? <Loader size="xs" type="dots" />
                    : <IconSearch size={14} c="dimmed" />}
                <div>
                  <Text size="xs" fw={600}>Deployment</Text>
                  <Text size="xs" c="dimmed">{(alloyStatus?.totalCount ?? 0) > 0 ? `${alloyStatus.totalReady}/${alloyStatus.totalCount} pods` : 'Waiting...'}</Text>
                </div>
              </Group>
            </Paper>
          </SimpleGrid>

          {alloyStatus?.components ? (
            <>
              <Text size="xs" c="dimmed" ta="center" mt="xs" fw={500}>
                {alloyStatus.syncStatus === 'Synced' ? 'Synced' : alloyStatus.syncStatus || 'Syncing...'} | {alloyStatus.health || 'Checking'}
                {' | '}
                {alloyStatus.totalReady ?? 0}/{alloyStatus.totalCount ?? 0} pods ready
              </Text>
              {Object.entries(alloyStatus.components).map(([name, comp]) => (
                <Paper key={name} withBorder p="xs" radius="md" bg={comp.ready ? 'green.0' : 'gray.0'}>
                  <Group justify="space-between">
                    <Group gap="xs">
                      {comp.ready ? <IconCheck size={14} color="#40c057" /> : <Loader size="xs" type="dots" />}
                      <Text size="se">{name}</Text>
                    </Group>
                    <Badge size="xs" color={comp.ready ? 'green' : 'gray'} variant="filled" radius="sm">
                      {comp.ready ? 'Ready' : `${comp.readyReplicas ?? 0}/${comp.totalReplicas ?? 1}`}
                    </Badge>
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
        <Paper withBorder p="md" radius="lg" bg="green.0" w="100%" maw={500} mx="auto">
          <Group gap="sm" justify="center">
            <IconCheck size={20} color="#40c057" />
            <Text size="sm" fw={500}>Grafana Alloy is running! Logs are being collected.</Text>
          </Group>
          {alloyStatus?.lokiURL && <Text size="xs" c="dimmed" ta="center" mt={4} style={{ fontFamily: 'monospace' }}>Loki endpoint: {alloyStatus.lokiURL}</Text>}
        </Paper>
      )}

      <Group justify="center" mt="md">
        <Button onClick={prevStep} variant="default" disabled={alloyDeploying}>Back</Button>
        {!alloyReady && (
          <Button onClick={() => { setAlloyResult(null); setAlloyStatus(null); setAlloyReady(false); handleDeployAlloy(); }}
            loading={alloyDeploying} color="orange" leftSection={<IconPlug size={16} />}>
            Redeploy
          </Button>
        )}
        {alloyReady && <Button onClick={nextStep} size="lg" rightSection={<IconChevronRight size={18} />}>Continue</Button>}
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

    const StatusCard = ({ icon: IconComp, label, sublabel, ready, badgeText, badgeColor, children, muted }) => (
      <Paper withBorder p="md" radius="lg" bg={muted ? undefined : ready ? 'green.0' : 'orange.0'}>
        <Group justify="space-between" mb={children ? 'xs' : 0}>
          <Group gap="sm">
            <ThemeIcon size="sm" radius="md" variant="filled" color={muted ? 'gray' : ready ? 'green' : 'orange'}>
              <IconComp size={14} />
            </ThemeIcon>
            <Text size="sm" fw={600}>{label}{sublabel && <Text span c="dimmed" fw={400}> ({sublabel})</Text>}</Text>
          </Group>
          <Badge size="sm" color={muted ? 'gray' : badgeColor || (ready ? 'green' : 'orange')} variant="filled" radius="sm">
            {badgeText}
          </Badge>
        </Group>
        {children}
      </Paper>
    );

    return (
      <Stack align="center" gap="lg" py="xl">
        <ThemeIcon size={56} radius="xl" variant="light" color="pink">
          <IconShield size={28} stroke={1.5} />
        </ThemeIcon>
        <Title order={3}>Verify Installation</Title>
        <Text c="dimmed" ta="center" maw={480}>Checking that all bootstrapped components are running and healthy...</Text>

        {!verifyStatus && <Loader size="lg" />}

        {verifyStatus && (
          <Stack gap="sm" w="100%" maw={500}>
            <StatusCard
              icon={IconRocket} label="Agent" sublabel={agentName}
              ready={verifyStatus.agent?.ready}
              badgeText={verifyStatus.agent?.ready ? 'Connected' : 'Waiting'}
            />

            <StatusCard
              icon={IconGitBranch} label="ArgoCD"
              ready={verifyStatus.argocd?.ready}
              badgeText={verifyStatus.argocd?.ready ? 'Ready' : `${verifyStatus.argocd?.totalReady ?? 0}/${verifyStatus.argocd?.totalCount ?? 6}`}
            >
              {verifyStatus.argocd?.components && (
                <Stack gap={2} mt="xs">
                  <Divider />
                  {Object.entries(verifyStatus.argocd.components).map(([key, comp]) => (
                    <Group key={key} justify="space-between" px="xs">
                      <Group gap={4}>{comp.ready ? <IconCheck size={12} color="#40c057" /> : <Loader size="xs" type="dots" />}<Text size="xs" c="dimmed">{argocdComponentLabels[key] || key}</Text></Group>
                      <Text size="xs" c="dimmed">{comp.ready ? 'Ready' : `${comp.readyReplicas ?? 0}/${comp.totalReplicas ?? 1}`}</Text>
                    </Group>
                  ))}
                </Stack>
              )}
            </StatusCard>

            <StatusCard
              icon={IconDatabase}
              label={skipMonitoring ? 'Monitoring (Skipped)' : deployMode === 'lightweight' ? 'Monitoring (Loki + Grafana)' : 'Monitoring (LGTM Full Stack)'}
              ready={skipMonitoring || verifyStatus.apps?.ready}
              badgeText={skipMonitoring ? 'Skipped' : verifyStatus.apps?.ready ? 'Healthy' : `${verifyStatus.apps?.totalReady ?? 0}/${verifyStatus.apps?.totalCount ?? 0}`}
              muted={skipMonitoring}
            >
              {verifyStatus.apps?.components && (
                <Stack gap={2} mt="xs">
                  <Divider />
                  {Object.entries(verifyStatus.apps.components).map(([name, comp]) => (
                    <Group key={name} justify="space-between" px="xs">
                      <Group gap={4}>{comp.ready ? <IconCheck size={12} color="#40c057" /> : <Loader size="xs" type="dots" />}<Text size="xs" c="dimmed">{name}</Text></Group>
                      <Text size="xs" c="dimmed">{comp.ready ? 'Ready' : `${comp.readyReplicas ?? 0}/${comp.totalReplicas ?? 1}`}</Text>
                    </Group>
                  ))}
                </Stack>
              )}
              {(!verifyStatus.apps?.components || Object.keys(verifyStatus.apps?.components || {}).length === 0) && verifyStatus?.apps?.syncDetails && (
                <Text size="xs" c="dimmed" mt={4}>{verifyStatus.apps.syncDetails}</Text>
              )}
            </StatusCard>

            <StatusCard
              icon={IconPlug} label="Grafana Alloy"
              ready={verifyStatus.alloy?.ready}
              badgeText={!alloyResult ? 'Not Deployed' : verifyStatus.alloy?.ready ? 'Healthy' : `${verifyStatus.alloy?.totalReady ?? 0}/${verifyStatus.alloy?.totalCount ?? 0}`}
              muted={!alloyResult}
            >
              {verifyStatus.alloy?.lokiURL && (
                <Text size="xs" c="dimmed" mt={4} style={{ fontFamily: 'monospace' }}>Logs → {verifyStatus.alloy.lokiURL}</Text>
              )}
              {verifyStatus.alloy?.components && (
                <Stack gap={2} mt="xs">
                  <Divider />
                  {Object.entries(verifyStatus.alloy.components).map(([name, comp]) => (
                    <Group key={name} justify="space-between" px="xs">
                      <Group gap={4}>{comp.ready ? <IconCheck size={12} color="#40c057" /> : <Loader size="xs" type="dots" />}<Text size="xs" c="dimmed">{name}</Text></Group>
                      <Text size="xs" c="dimmed">{comp.ready ? 'Ready' : `${comp.readyReplicas ?? 0}/${comp.totalReplicas ?? 1}`}</Text>
                    </Group>
                  ))}
                </Stack>
              )}
            </StatusCard>

            {allReady && (
              <Alert icon={<IconCheck size={20} />} variant="light" color="green" radius="md" mt="sm">
                <Text size="sm" fw={500}>All systems go! Redirecting to dashboard...</Text>
              </Alert>
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
    <Stack align="center" gap="lg" py="xl">
      <ThemeIcon size={80} radius="xl" variant="filled" gradient={{ from: 'green', to: 'teal', deg: 135 }}>
        <IconCircleCheck size={42} stroke={1.5} />
      </ThemeIcon>
      <Title order={2} ta="center">You're Ready to Deploy Gen3</Title>
      <Text c="dimmed" ta="center" maw={500} size="lg">
        Your CSOC infrastructure is fully set up. Agent <Code size="sm">{agentName}</Code> is connected,
        ArgoCD is running, and observability tools are in place.
      </Text>

      <SimpleGrid cols={1} w="100%" maw={480} mt="md">
        <Anchor component={Link} href="/helm/gen3/deploy" style={{ textDecoration: 'none' }}>
          <Paper withBorder p="lg" radius="lg" style={{ cursor: 'pointer', transition: 'border-color 200ms' }}
            className="hover:border-blue-500"
          >
            <Group justify="space-between">
              <div>
                <Text size="sm" fw={600}>Deploy a new Gen3 instance</Text>
                <Text size="xs" c="dimmed">Launch Gen3 data portal into this cluster</Text>
              </div>
              <ThemeIcon size="lg" radius="md" variant="light" color="blue">
                <IconRocket size={20} />
              </ThemeIcon>
            </Group>
          </Paper>
        </Anchor>

        <Anchor component={Link} href="/projects" style={{ textDecoration: 'none' }}>
          <Paper withBorder p="lg" radius="lg" style={{ cursor: 'pointer', transition: 'border-color 200ms' }}>
            <Group justify="space-between">
              <div>
                <Text size="sm" fw={600}>Manage existing deployments</Text>
                <Text size="xs" c="dimmed">View or update running Gen3 instances</Text>
              </div>
              <ThemeIcon size="lg" radius="md" variant="light" color="gray">
                <IconDatabase size={20} />
              </ThemeIcon>
            </Group>
          </Paper>
        </Anchor>
      </SimpleGrid>

      <Button onClick={handleComplete} size="lg" variant="light" mt="lg" leftSection={<IconChevronRight size={18} />}>
        Go to Dashboard
      </Button>
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

  const progressPct = Math.round(((active) / 7) * 100);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', paddingTop: 32, paddingBottom: 48 }}>
      <Container size="lg">

        {/* Header bar */}
        <Paper p="xs" radius="lg" mb="lg" withBorder bg="gray.0">
          <Group justify="space-between">
            <Group gap="md">
              <ThemeIcon size="sm" radius="md" variant="filled" gradient={{ from: 'indigo', to: 'cyan' }}>
                <IconBulb size={14} />
              </ThemeIcon>
              <Text size="sm" fw={600}>CSOC Setup Wizard</Text>
            </Group>
            <Group gap="md">
              <Text size="xs" c="dimmed">Step {active + 1} of 8</Text>
              <Progress value={progressPct} size="xs" w={120} radius="xl" color="indigo" />
            </Group>
          </Group>
        </Paper>

        <Paper shadow="xl" radius="xl" p={0} overflow="hidden">
          <div style={{ display: 'flex', minHeight: 520 }}>

            {/* Sidebar */}
            <div style={{
              width: 260,
              background: 'linear-gradient(180deg, #f8f9fc 0%, #f1f3f9 100%)',
              borderRight: '1px solid #e9ecf2',
              padding: '24px 16px',
              display: 'flex',
              flexDirection: 'column',
            }}>
              <Stepper active={active} orientation="vertical" iconSize={30} size="sm"
                allowNextStepsSelect={false}
                styles={{
                  stepBody: { paddingLeft: 12 },
                  stepLabel: { fontWeight: 600, fontSize: 13, lineHeight: 1.2 },
                  stepDescription: { fontSize: 11, color: '#868e96', marginTop: 2 },
                  stepIcon: { borderWidth: 2 },
                  completedIcon: { background: 'transparent' },
                }}
              >
                {STEP_CONFIG.map((step, i) => (
                  <Stepper.Step
                    key={i}
                    label={step.label}
                    description={step.description}
                    icon={
                      <step.icon size={14} stroke={2} />
                    }
                  />
                ))}
              </Stepper>

              <div style={{ flex: 1 }} />

              {/* Mini progress at bottom of sidebar */}
              <Box mt="md">
                <Progress value={progressPct} size="xs" radius="xl" color="indigo" />
                <Text size="xs" c="dimmed" ta="center" mt={4}>{progressPct}% complete</Text>
              </Box>
            </div>

            {/* Main content area */}
            <div style={{ flex: 1, padding: '32px 40px', overflowY: 'auto', background: '#fff' }}>
              {contentForStep(active)}

              {/* Bottom nav inside content */}
              <Box mt="xl">
                <Divider my="lg" />
                <Group justify="space-between">
                  <Button
                    variant="default"
                    onClick={prevStep}
                    disabled={active <= minStep || active === 2 || active === 4 || active === 5 || active === 6 || active === 7}
                  >
                    Back
                  </Button>
                  {(active === 0 && !envLoading && envInfo) && (
                    <Button onClick={nextStep} rightSection={<IconChevronRight size={16} />}>
                      Next
                    </Button>
                  )}
                </Group>
              </Box>
            </div>

          </div>
        </Paper>

      </Container>
    </div>
  );
}
