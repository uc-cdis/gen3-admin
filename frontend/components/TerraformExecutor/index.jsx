import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import {
  Container,
  Paper,
  Title,
  TextInput,
  Select,
  MultiSelect,
  Switch,
  Button,
  Group,
  Stack,
  Grid,
  Divider,
  Code,
  Accordion,
  Badge,
  Alert,
  ActionIcon,
  Tooltip,
  Text,
  SegmentedControl,
  Loader,
  Table,
  ScrollArea,
  Stepper,
  PasswordInput
} from '@mantine/core';
import {
  IconPlus,
  IconTrash,
  IconDownload,
  IconInfoCircle,
  IconPlayerPlay,
  IconCheck,
  IconX,
  IconClock,
  IconRefresh,
  IconEye,
  IconKey,
  IconServer,
  IconSettings
} from '@tabler/icons-react';

// ============================================================================
// Terraform Context
// ============================================================================
const TerraformContext = createContext({
  awsRegion: null,
  awsCredentials: null,
  awsIdentity: null,
  awsProfile: null,
  runtime: 'docker',
  workDir: null,
  stateBucket: null,
  stateRegion: null,
  stateKey: null,
  namespace: null,
  secretName: null,
  currentExecution: null,
  executionHistory: [],
  isExecuting: false,
  executionLogs: [],
  execute: () => { },
  terminate: () => { },
  refresh: () => { }
});

// ============================================================================
// Sub-Components
// ============================================================================

function TerraformLogsViewer({ logs, isExecuting, logsEndRef }) {
  const parseAnsiColors = (text) => {
    const ansiColorMap = {
      '30': '#2e3440', '31': '#bf616a', '32': '#a3be8c', '33': '#ebcb8b',
      '34': '#81a1c1', '35': '#b48ead', '36': '#88c0d0', '37': '#e5e9f0',
      '90': '#4c566a', '91': '#bf616a', '92': '#a3be8c', '93': '#ebcb8b',
      '94': '#81a1c1', '95': '#b48ead', '96': '#8fbcbb', '97': '#eceff4',
      '1': 'bold', '0': 'reset'
    };

    const parts = [];
    let currentIndex = 0;
    let currentColor = '#c1c2c5';
    let isBold = false;

    const ansiRegex = /\[(\d+)m/g;
    let match;

    while ((match = ansiRegex.exec(text)) !== null) {
      if (match.index > currentIndex) {
        parts.push({
          text: text.slice(currentIndex, match.index),
          color: currentColor,
          bold: isBold
        });
      }

      const code = match[1];
      if (code === '0') {
        currentColor = '#c1c2c5';
        isBold = false;
      } else if (code === '1') {
        isBold = true;
      } else if (ansiColorMap[code]) {
        currentColor = ansiColorMap[code];
      }

      currentIndex = match.index + match[0].length;
    }

    if (currentIndex < text.length) {
      parts.push({
        text: text.slice(currentIndex),
        color: currentColor,
        bold: isBold
      });
    }

    return parts;
  };

  return (
    <Paper p="md" withBorder style={{ backgroundColor: '#1a1b1e', minHeight: '300px' }}>
      <Group justify="space-between" mb="xs">
        <Text size="xs" c="dimmed">Execution Logs:</Text>
        {logs.length > 0 && (
          <Badge size="sm" color="blue">{logs.length} lines</Badge>
        )}
      </Group>
      {logs.length === 0 ? (
        <Text size="sm" c="dimmed" ta="center" mt="xl">
          {isExecuting ? 'Waiting for logs...' : 'No logs yet. Click a Terraform operation to start.'}
        </Text>
      ) : (
        <div style={{ maxHeight: '400px', overflow: 'auto' }}>
          <Code block style={{
            whiteSpace: 'pre-wrap',
            fontSize: '11px',
            backgroundColor: 'transparent',
            color: '#c1c2c5',
            lineHeight: '1.5'
          }}>
            {logs.map((log, idx) => {
              const parts = parseAnsiColors(log);
              return (
                <div key={idx}>
                  {parts.map((part, i) => (
                    <span
                      key={i}
                      style={{
                        color: part.color,
                        fontWeight: part.bold ? 'bold' : 'normal'
                      }}
                    >
                      {part.text}
                    </span>
                  ))}
                </div>
              );
            })}
          </Code>
          <div ref={logsEndRef} />
        </div>
      )}
    </Paper>
  );
}

function TerraformConfigViewer({ tfvars, config }) {
  const displayTfvars = tfvars || buildTfvars(config);

  return (
    <Accordion>
      <Accordion.Item value="config">
        <Accordion.Control>
          <Group>
            <Title order={4}>View Configuration</Title>
            <Badge color="blue" size="sm">Terraform Variables</Badge>
          </Group>
        </Accordion.Control>
        <Accordion.Panel>
          <Paper p="md" withBorder style={{ backgroundColor: '#1a1b1e' }}>
            <ScrollArea h={400}>
              <Code block style={{
                whiteSpace: 'pre-wrap',
                fontSize: '12px',
                backgroundColor: 'transparent',
                color: '#c1c2c5',
                fontFamily: 'monospace'
              }}>
                {displayTfvars}
              </Code>
            </ScrollArea>
          </Paper>
          <Group justify="flex-end" mt="xs">
            <Button
              size="xs"
              variant="light"
              leftSection={<IconDownload size={14} />}
              onClick={() => {
                const blob = new Blob([displayTfvars], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'terraform.tfvars';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download Config
            </Button>
          </Group>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

function TerraformOperationButtons({ operations, disabled, onExecute }) {
  const buttonConfig = {
    init: { color: 'gray', variant: 'light', label: 'Init' },
    validate: { color: 'gray', variant: 'light', label: 'Validate' },
    plan: { color: 'blue', variant: 'filled', label: 'Plan' },
    apply: { color: 'green', variant: 'filled', label: 'Apply' },
    destroy: { color: 'red', variant: 'filled', label: 'Destroy' }
  };

  return (
    <Group grow>
      {operations.map(op => {
        const config = buttonConfig[op] || buttonConfig.plan;
        return (
          <Button
            key={op}
            leftSection={<IconPlayerPlay size={16} />}
            onClick={() => onExecute(op)}
            disabled={disabled}
            color={config.color}
            variant={config.variant}
          >
            {config.label}
          </Button>
        );
      })}
    </Group>
  );
}

function TerraformExecutionCard({ execution, runtime, isExecuting }) {
  if (!execution) return null;

  return (
    <Alert color="blue" variant="light">
      <Stack gap="xs">
        <Text size="sm">
          <strong>Execution ID:</strong> {execution.id}
        </Text>
        <Text size="sm">
          <strong>Operation:</strong> {execution.operation}
        </Text>
        <Text size="sm">
          <strong>Runtime:</strong> {runtime}
        </Text>
        {isExecuting && (
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm" c="dimmed">Running...</Text>
          </Group>
        )}
      </Stack>
    </Alert>
  );
}

function ExecutionHistory({ onViewLogs }) {
  const { currentExecution, isExecuting } = useContext(TerraformContext);
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchExecutions = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/terraform/executions');
      if (response.ok) {
        const data = await response.json();
        setExecutions(data || []);
      }
    } catch (error) {
      console.error('Failed to fetch executions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExecutions();
  }, [currentExecution, isExecuting]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'running': return 'blue';
      case 'complete': return 'green';
      case 'error': return 'red';
      default: return 'gray';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'running': return <Loader size="xs" />;
      case 'complete': return <IconCheck size={16} />;
      case 'error': return <IconX size={16} />;
      default: return <IconClock size={16} />;
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {executions.length} execution{executions.length !== 1 ? 's' : ''} found
        </Text>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconRefresh size={14} />}
          onClick={fetchExecutions}
          loading={loading}
        >
          Refresh
        </Button>
      </Group>

      {loading && executions.length === 0 ? (
        <Group justify="center" p="xl">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">Loading executions...</Text>
        </Group>
      ) : executions.length === 0 ? (
        <Alert color="gray" variant="light">
          No previous executions found. Start a Terraform operation to see it here.
        </Alert>
      ) : (
        <ScrollArea style={{ height: 400 }}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Status</Table.Th>
                <Table.Th>Operation</Table.Th>
                <Table.Th>Runtime</Table.Th>
                <Table.Th>Started</Table.Th>
                <Table.Th>ID</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {executions.map((exec) => (
                <Table.Tr key={exec.id}>
                  <Table.Td>
                    <Badge
                      color={getStatusColor(exec.status)}
                      variant="light"
                      leftSection={getStatusIcon(exec.status)}
                    >
                      {exec.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="outline">{exec.operation}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{exec.runtime}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">{formatDate(exec.start_time)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Code style={{ fontSize: '10px' }}>{exec.id.slice(0, 8)}</Code>
                  </Table.Td>
                  <Table.Td>
                    <Tooltip label="View logs">
                      <ActionIcon
                        variant="light"
                        color="blue"
                        onClick={() => onViewLogs(exec)}
                      >
                        <IconEye size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Stack>
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

function buildTfvars(config) {
  if (!config) return '';

  const formatValue = (value) => {
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'boolean') return value.toString();
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      return `[\n  ${value.map(v => `"${v}"`).join(',\n  ')}\n]`;
    }
    if (typeof value === 'object' && value !== null) {
      const entries = Object.entries(value);
      if (entries.length === 0) return '{}';
      return `{\n  ${entries.map(([k, v]) => `${k} = "${v}"`).join('\n  ')}\n}`;
    }
    return String(value);
  };

  let output = '# Required Variables\n';
  output += `vpc_name = ${formatValue(config.vpc_name)}\n`;
  output += `aws_region = ${formatValue(config.aws_region)}\n`;
  output += `availability_zones = ${formatValue(config.availability_zones)}\n`;
  output += `hostname = ${formatValue(config.hostname)}\n`;
  output += `revproxy_arn = ${formatValue(config.revproxy_arn)}\n`;
  output += `user_yaml_bucket_name = ${formatValue(config.user_yaml_bucket_name)}\n`;

  output += '\n# Optional Variables\n';
  output += `kubernetes_namespace = ${formatValue(config.kubernetes_namespace)}\n`;
  output += `es_linked_role = ${formatValue(config.es_linked_role)}\n`;
  output += `create_gitops_infra = ${formatValue(config.create_gitops_infra)}\n`;
  output += `deploy_cognito = ${formatValue(config.deploy_cognito)}\n`;

  output += '\n# Default Tags\n';
  output += `default_tags = ${formatValue(config.default_tags)}`;

  return output;
}

// ============================================================================
// Main TerraformExecutor Component
// ============================================================================

export default function TerraformExecutor({
  // Mode configuration
  mode = 'guided',              // 'guided' | 'embedded'
  autoExecute = false,
  operations = ['init', 'validate', 'plan', 'apply', 'destroy'],

  // UI options
  showHistory = true,
  showConfig = true,
  showOperationButtons = true,
  title = 'Terraform Executor',

  // AWS Context (passed from parent)
  awsContext = {},

  // Terraform configuration
  tfvars = null,                // Pre-built tfvars string
  config = null,                // Config object to build tfvars from
  workDir = '/tmp/gen3-terraform',
  dockerImage = 'gen3-terraform:latest',

  // State configuration
  stateBucket = '',
  stateRegion = 'us-east-1',
  stateKey = 'terraform.tfstate',

  // Callbacks
  onComplete = () => { },
  onError = () => { },
  onProgress = () => { },

  // Initial values for guided mode
  initialConfig = null
}) {
  // ========== State ==========
  const [activeStep, setActiveStep] = useState(0);
  const [runtime, setRuntime] = useState('docker');
  const [localWorkDir, setLocalWorkDir] = useState(workDir);

  // AWS Credentials State (for guided mode)
  const [awsAccessKeyId, setAwsAccessKeyId] = useState('');
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState('');
  const [awsRoleArn, setAwsRoleArn] = useState('');
  const [localStateBucket, setLocalStateBucket] = useState(stateBucket);
  const [localStateRegion, setLocalStateRegion] = useState(stateRegion);
  const [secretName, setSecretName] = useState('terraform-aws-credentials');
  const [namespace, setNamespace] = useState('terraform');
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapSuccess, setBootstrapSuccess] = useState(false);

  // Terraform Config State (for guided mode)
  const [localConfig, setLocalConfig] = useState(initialConfig || {
    vpc_name: "my-gen3-vpc",
    aws_region: "us-east-1",
    availability_zones: ["us-east-1a", "us-east-1c", "us-east-1d"],
    hostname: "gen3.example.com",
    revproxy_arn: "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012",
    user_yaml_bucket_name: "my-gen3-user-yaml-bucket",
    kubernetes_namespace: "gen3",
    es_linked_role: true,
    create_gitops_infra: true,
    deploy_cognito: true,
    default_tags: {
      Environment: "production",
      Project: "gen3-deployment",
      Owner: "data-team",
      CostCenter: "research"
    }
  });

  // Execution State
  const [execution, setExecution] = useState(null);
  const [executionLogs, setExecutionLogs] = useState([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [newTagKey, setNewTagKey] = useState('');
  const [newTagValue, setNewTagValue] = useState('');
  const logsEndRef = useRef(null);

  // ========== Effects ==========
  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [executionLogs]);

  // Auto-execute on mount if enabled
  useEffect(() => {
    if (autoExecute && operations.length > 0 && mode === 'embedded') {
      executeTerraform(operations[0]);
    }
  }, [autoExecute, mode]);

  // ========== Helpers ==========
  const awsRegions = [
    'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
    'eu-west-1', 'eu-west-2', 'eu-central-1', 'ap-southeast-1',
    'ap-southeast-2', 'ap-northeast-1'
  ];

  const getAvailabilityZones = (region) => {
    const zoneMap = {
      'us-east-1': ['us-east-1a', 'us-east-1b', 'us-east-1c', 'us-east-1d', 'us-east-1f'],
      'us-east-2': ['us-east-2a', 'us-east-2b', 'us-east-2c'],
      'us-west-1': ['us-west-1a', 'us-west-1c'],
      'us-west-2': ['us-west-2a', 'us-west-2b', 'us-west-2c', 'us-west-2d'],
      'eu-west-1': ['eu-west-1a', 'eu-west-1b', 'eu-west-1c'],
      'eu-west-2': ['eu-west-2a', 'eu-west-2b', 'eu-west-2c'],
      'eu-central-1': ['eu-central-1a', 'eu-central-1b', 'eu-central-1c'],
      'ap-southeast-1': ['ap-southeast-1a', 'ap-southeast-1b', 'ap-southeast-1c'],
      'ap-southeast-2': ['ap-southeast-2a', 'ap-southeast-2b', 'ap-southeast-2c'],
      'ap-northeast-1': ['ap-northeast-1a', 'ap-northeast-1c', 'ap-northeast-1d']
    };
    return zoneMap[region] || [];
  };

  const handleInputChange = (field, value) => {
    setLocalConfig(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleTagChange = (key, value) => {
    setLocalConfig(prev => ({
      ...prev,
      default_tags: {
        ...prev.default_tags,
        [key]: value
      }
    }));
  };

  const addTag = () => {
    if (newTagKey && newTagValue) {
      handleTagChange(newTagKey, newTagValue);
      setNewTagKey('');
      setNewTagValue('');
    }
  };

  const removeTag = (key) => {
    setLocalConfig(prev => {
      const newTags = { ...prev.default_tags };
      delete newTags[key];
      return {
        ...prev,
        default_tags: newTags
      };
    });
  };

  // ========== API Calls ==========
  const bootstrapSecret = async () => {
    setBootstrapping(true);
    try {
      const response = await fetch('/api/terraform/bootstrap-secret', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          secret_name: secretName,
          namespace: namespace,
          aws_access_key_id: awsAccessKeyId,
          aws_secret_access_key: awsSecretAccessKey,
          aws_role_arn: awsRoleArn,
          state_bucket: localStateBucket,
          state_region: localStateRegion,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setBootstrapSuccess(true);
        setActiveStep(2);
      } else {
        alert(`Failed to bootstrap secret: ${data.error}`);
        onError(new Error(data.error));
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
      onError(error);
    } finally {
      setBootstrapping(false);
    }
  };

  const executeTerraform = async (operation) => {
    setIsExecuting(true);
    setExecutionLogs([]);
    setExecution(null);

    try {
      // Use passed tfvars or build from config
      const finalTfvars = tfvars || buildTfvars(config || localConfig);

      // Determine state bucket - use awsContext if provided, otherwise local
      const finalStateBucket = awsContext.stateBucket || localStateBucket;
      const finalStateRegion = awsContext.stateRegion || localStateRegion;

      const response = await fetch('/api/terraform/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operation: operation,
          work_dir: localWorkDir,
          runtime: runtime,
          auto_approve: operation === 'apply' || operation === 'destroy',
          docker_image: dockerImage,
          docker_network: 'bridge',
          namespace: namespace,
          pod_image: dockerImage,
          secret_name: secretName,
          state_bucket: "", //finalStateBucket,
          state_region: finalStateRegion,
          state_key: stateKey,
          tfvars: finalTfvars,
          tfvars_file_name: 'terraform.tfvars',
          // Pass AWS context for credential handling
          aws_region: awsContext.region,
          aws_profile: awsContext.profile,
          aws_credentials: awsContext.credentials,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setExecution({ id: data.id, operation });
        streamLogs(data.id);
      } else {
        const errorMsg = `Error: ${data.error}.\n\nDetails: \n${data.stderr}`;
        setExecutionLogs([errorMsg]);
        setIsExecuting(false);
        onError(new Error(data.error));
      }
    } catch (error) {
      setExecutionLogs([`Error: ${error.message}`]);
      setIsExecuting(false);
      onError(error);
    }
  };

  const streamLogs = async (executionId) => {
    try {
      const response = await fetch(`/api/terraform/executions/${executionId}/stream`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          if (line.startsWith('event:')) {
            currentEvent = line.substring(6).trim();
          } else if (line.startsWith('data:')) {
            const data = line.substring(5).trim();

            if (currentEvent === 'done') {
              setIsExecuting(false);
              setExecutionLogs(prev => [...prev, '\n✓ Execution completed successfully']);
              onComplete({ executionId, logs: executionLogs });
            } else if (currentEvent === 'error') {
              setIsExecuting(false);
              setExecutionLogs(prev => [...prev, `\n✗ Error: ${data}`]);
              onError(new Error(data));
            } else if (currentEvent === 'message' && data) {
              setExecutionLogs(prev => {
                const newLogs = [...prev, data];
                onProgress(newLogs);
                return newLogs;
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('Stream error:', error);
      setExecutionLogs(prev => [...prev, `\nStream error: ${error.message}`]);
      setIsExecuting(false);
      onError(error);
    }
  };

  const terminateExecution = async () => {
    if (!execution) return;

    try {
      const response = await fetch(`/api/terraform/executions/${execution.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setIsExecuting(false);
        setExecutionLogs(prev => [...prev, '--- Execution terminated ---']);
      }
    } catch (error) {
      console.error('Failed to terminate execution:', error);
    }
  };

  const handleViewLogs = (exec) => {
    setExecution({ id: exec.id, operation: 'viewing' });
    setExecutionLogs([]);
    setIsExecuting(false);
    setRuntime(exec.runtime);
    streamLogs(exec.id);
  };

  // ========== Context Value ==========
  const contextValue = {
    awsRegion: awsContext.region || localConfig.aws_region,
    awsCredentials: awsContext.credentials,
    awsIdentity: awsContext.identity,
    awsProfile: awsContext.profile,
    runtime,
    workDir: localWorkDir,
    stateBucket: awsContext.stateBucket || localStateBucket,
    stateRegion: awsContext.stateRegion || localStateRegion,
    stateKey,
    namespace,
    secretName,
    currentExecution: execution,
    isExecuting,
    executionLogs,
    execute: executeTerraform,
    terminate: terminateExecution,
  };

  // ========== Embedded Mode ==========
  if (mode === 'embedded') {
    return (
      <TerraformContext.Provider value={contextValue}>
        <Stack gap="md">
          {showConfig && (
            <TerraformConfigViewer
              tfvars={tfvars}
              config={config || localConfig}
            />
          )}

          {showOperationButtons && (
            <TerraformOperationButtons
              operations={operations}
              disabled={isExecuting}
              onExecute={executeTerraform}
            />
          )}

          {isExecuting && (
            <Button
              onClick={terminateExecution}
              color="red"
              variant="outline"
              fullWidth
            >
              Terminate Execution
            </Button>
          )}

          <TerraformExecutionCard
            execution={execution}
            runtime={runtime}
            isExecuting={isExecuting}
          />

          <TerraformLogsViewer
            logs={executionLogs}
            isExecuting={isExecuting}
            logsEndRef={logsEndRef}
          />

          {showHistory && (
            <>
              <Divider label="Execution History" labelPosition="center" />
              <ExecutionHistory onViewLogs={handleViewLogs} />
            </>
          )}
        </Stack>
      </TerraformContext.Provider>
    );
  }

  // ========== Guided Mode (Full Stepper UI) ==========
  return (
    <TerraformContext.Provider value={contextValue}>
      <Container size="xl" py="md">
        <Paper shadow="sm" radius="md" p="xl">
          <Group justify="space-between" mb="xl">
            <div>
              <Title order={1} c="blue">{title}</Title>
              <Badge color="blue" variant="light" mt="xs">Infrastructure as Code</Badge>
            </div>
          </Group>

          <Stepper active={activeStep} onStepClick={setActiveStep} breakpoint="sm">
            {/* Step 0: Runtime */}
            <Stepper.Step label="Runtime" description="Choose execution environment" icon={<IconServer size={18} />}>
              <Stack gap="md" mt="xl">
                <SegmentedControl
                  value={runtime}
                  onChange={setRuntime}
                  data={[
                    { label: '🐳 Docker', value: 'docker' },
                    { label: '☸️ Kubernetes Pod', value: 'pod' }
                  ]}
                  fullWidth
                />

                <TextInput
                  label="Working Directory"
                  description="Path where Terraform files will be executed"
                  placeholder="/tmp/gen3-terraform"
                  value={localWorkDir}
                  onChange={(e) => setLocalWorkDir(e.target.value)}
                />

                {runtime === 'docker' && (
                  <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
                    Terraform will run in a Docker container using your local ~/.aws credentials.
                  </Alert>
                )}

                {runtime === 'pod' && (
                  <Alert icon={<IconInfoCircle size={16} />} color="indigo" variant="light">
                    Terraform will run in a Kubernetes pod. You'll need to configure AWS credentials in the next step.
                  </Alert>
                )}

                <Group justify="flex-end" mt="xl">
                  <Button onClick={() => setActiveStep(runtime === 'pod' ? 1 : 2)}>
                    Next Step
                  </Button>
                </Group>
              </Stack>
            </Stepper.Step>

            {/* Step 1: AWS Credentials (only for pod runtime) */}
            <Stepper.Step
              label="AWS Credentials"
              description="Bootstrap Kubernetes secret"
              icon={<IconKey size={18} />}
              disabled={runtime === 'docker'}
            >
              <Stack gap="md" mt="xl">
                <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
                  These credentials will be stored in a Kubernetes secret for Terraform to use.
                </Alert>

                <Grid>
                  <Grid.Col span={6}>
                    <TextInput
                      label="Secret Name"
                      placeholder="terraform-aws-credentials"
                      value={secretName}
                      onChange={(e) => setSecretName(e.target.value)}
                    />
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <TextInput
                      label="Namespace"
                      placeholder="terraform"
                      value={namespace}
                      onChange={(e) => setNamespace(e.target.value)}
                    />
                  </Grid.Col>
                </Grid>

                <PasswordInput
                  label="AWS Access Key ID"
                  placeholder="AKIAIOSFODNN7EXAMPLE"
                  value={awsAccessKeyId}
                  onChange={(e) => setAwsAccessKeyId(e.target.value)}
                  required
                />

                <PasswordInput
                  label="AWS Secret Access Key"
                  placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                  value={awsSecretAccessKey}
                  onChange={(e) => setAwsSecretAccessKey(e.target.value)}
                  required
                />

                <TextInput
                  label="AWS Role ARN (Optional)"
                  placeholder="arn:aws:iam::123456789012:role/TerraformRole"
                  value={awsRoleArn}
                  onChange={(e) => setAwsRoleArn(e.target.value)}
                />

                <Grid>
                  <Grid.Col span={6}>
                    <TextInput
                      label="Terraform State Bucket"
                      placeholder="my-terraform-state-bucket"
                      value={localStateBucket}
                      onChange={(e) => setLocalStateBucket(e.target.value)}
                      required
                    />
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <Select
                      label="State Bucket Region"
                      data={awsRegions}
                      value={localStateRegion}
                      onChange={setLocalStateRegion}
                    />
                  </Grid.Col>
                </Grid>

                {bootstrapSuccess && (
                  <Alert icon={<IconCheck size={16} />} color="green" variant="light">
                    AWS credentials secret created successfully!
                  </Alert>
                )}

                <Group justify="space-between" mt="xl">
                  <Button variant="default" onClick={() => setActiveStep(0)}>
                    Back
                  </Button>
                  <Button
                    onClick={bootstrapSecret}
                    loading={bootstrapping}
                    disabled={!awsAccessKeyId || !awsSecretAccessKey || !localStateBucket}
                  >
                    Bootstrap Secret
                  </Button>
                </Group>
              </Stack>
            </Stepper.Step>

            {/* Step 2: Configure */}
            <Stepper.Step label="Configure" description="Terraform variables" icon={<IconSettings size={18} />}>
              <Stack gap="md" mt="xl">
                <Accordion multiple defaultValue={['required']}>
                  <Accordion.Item value="required">
                    <Accordion.Control>
                      <Group>
                        <Title order={4}>Required Variables</Title>
                        <Badge color="red" size="sm">Required</Badge>
                      </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="md">
                        <Grid>
                          <Grid.Col span={6}>
                            <TextInput
                              label="VPC Name"
                              placeholder="my-gen3-vpc"
                              value={localConfig.vpc_name}
                              onChange={(e) => handleInputChange('vpc_name', e.target.value)}
                            />
                          </Grid.Col>
                          <Grid.Col span={6}>
                            <Select
                              label="AWS Region"
                              data={awsRegions}
                              value={localConfig.aws_region}
                              onChange={(value) => {
                                handleInputChange('aws_region', value);
                                handleInputChange('availability_zones', []);
                              }}
                            />
                          </Grid.Col>
                        </Grid>

                        <MultiSelect
                          label="Availability Zones"
                          data={getAvailabilityZones(localConfig.aws_region)}
                          value={localConfig.availability_zones}
                          onChange={(value) => handleInputChange('availability_zones', value)}
                        />

                        <TextInput
                          label="Hostname"
                          placeholder="gen3.example.com"
                          value={localConfig.hostname}
                          onChange={(e) => handleInputChange('hostname', e.target.value)}
                        />

                        <TextInput
                          label="Reverse Proxy ARN"
                          placeholder="arn:aws:acm:us-east-1:123456789012:certificate/..."
                          value={localConfig.revproxy_arn}
                          onChange={(e) => handleInputChange('revproxy_arn', e.target.value)}
                        />

                        <TextInput
                          label="User YAML Bucket Name"
                          placeholder="my-gen3-user-yaml-bucket"
                          value={localConfig.user_yaml_bucket_name}
                          onChange={(e) => handleInputChange('user_yaml_bucket_name', e.target.value)}
                        />
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>

                  <Accordion.Item value="optional">
                    <Accordion.Control>
                      <Title order={4}>Optional Variables</Title>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="md">
                        <TextInput
                          label="Kubernetes Namespace"
                          placeholder="gen3"
                          value={localConfig.kubernetes_namespace}
                          onChange={(e) => handleInputChange('kubernetes_namespace', e.target.value)}
                        />

                        <Group grow>
                          <Switch
                            label="Enable Elasticsearch Linked Role"
                            checked={localConfig.es_linked_role}
                            onChange={(e) => handleInputChange('es_linked_role', e.currentTarget.checked)}
                          />
                          <Switch
                            label="Create GitOps Infrastructure"
                            checked={localConfig.create_gitops_infra}
                            onChange={(e) => handleInputChange('create_gitops_infra', e.currentTarget.checked)}
                          />
                          <Switch
                            label="Deploy Cognito"
                            checked={localConfig.deploy_cognito}
                            onChange={(e) => handleInputChange('deploy_cognito', e.currentTarget.checked)}
                          />
                        </Group>
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>

                  <Accordion.Item value="tags">
                    <Accordion.Control>
                      <Group>
                        <Title order={4}>Default Tags</Title>
                        <Badge color="purple" size="sm">{Object.keys(localConfig.default_tags).length} tags</Badge>
                      </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="md">
                        {Object.entries(localConfig.default_tags).map(([key, value]) => (
                          <Group key={key} grow>
                            <TextInput
                              placeholder="Tag key"
                              value={key}
                              onChange={(e) => {
                                const oldKey = key;
                                const newKey = e.target.value;
                                setLocalConfig(prev => {
                                  const newTags = { ...prev.default_tags };
                                  if (newKey !== oldKey) {
                                    delete newTags[oldKey];
                                    newTags[newKey] = value;
                                  }
                                  return { ...prev, default_tags: newTags };
                                });
                              }}
                            />
                            <TextInput
                              placeholder="Tag value"
                              value={value}
                              onChange={(e) => handleTagChange(key, e.target.value)}
                            />
                            <ActionIcon color="red" onClick={() => removeTag(key)}>
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Group>
                        ))}

                        <Divider />

                        <Group grow>
                          <TextInput
                            placeholder="Tag key"
                            value={newTagKey}
                            onChange={(e) => setNewTagKey(e.target.value)}
                          />
                          <TextInput
                            placeholder="Tag value"
                            value={newTagValue}
                            onChange={(e) => setNewTagValue(e.target.value)}
                          />
                          <Button
                            leftSection={<IconPlus size={16} />}
                            onClick={addTag}
                            disabled={!newTagKey || !newTagValue}
                          >
                            Add
                          </Button>
                        </Group>
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>

                <Group justify="space-between" mt="xl">
                  <Button variant="default" onClick={() => setActiveStep(runtime === 'pod' ? 1 : 0)}>
                    Back
                  </Button>
                  <Button onClick={() => setActiveStep(3)}>
                    Next Step
                  </Button>
                </Group>
              </Stack>
            </Stepper.Step>

            {/* Step 3: Execute */}
            <Stepper.Step label="Execute" description="Run Terraform" icon={<IconPlayerPlay size={18} />}>
              <Stack gap="md" mt="xl">
                <TerraformConfigViewer config={localConfig} />

                <TerraformOperationButtons
                  operations={operations}
                  disabled={isExecuting}
                  onExecute={executeTerraform}
                />

                {isExecuting && (
                  <Button
                    onClick={terminateExecution}
                    color="red"
                    variant="outline"
                    fullWidth
                  >
                    Terminate Execution
                  </Button>
                )}

                <TerraformExecutionCard
                  execution={execution}
                  runtime={runtime}
                  isExecuting={isExecuting}
                />

                <TerraformLogsViewer
                  logs={executionLogs}
                  isExecuting={isExecuting}
                  logsEndRef={logsEndRef}
                />

                <Divider label="Execution History" labelPosition="center" />

                <ExecutionHistory onViewLogs={handleViewLogs} />

                <Group justify="flex-start" mt="xl">
                  <Button variant="default" onClick={() => setActiveStep(2)}>
                    Back
                  </Button>
                </Group>
              </Stack>
            </Stepper.Step>

            <Stepper.Completed>
              <Alert icon={<IconCheck size={16} />} color="green" variant="light" mt="xl">
                All steps completed! You can execute Terraform operations from the Execute step.
              </Alert>
            </Stepper.Completed>
          </Stepper>
        </Paper>
      </Container>
    </TerraformContext.Provider>
  );
}

// Export sub-components for custom usage
export {
  TerraformLogsViewer,
  TerraformConfigViewer,
  TerraformOperationButtons,
  TerraformExecutionCard,
  ExecutionHistory,
  TerraformContext,
  buildTfvars
};