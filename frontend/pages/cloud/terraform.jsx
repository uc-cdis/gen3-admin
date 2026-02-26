import React, { useState, useEffect } from 'react';
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

function ExecutionHistory({ onViewLogs, execution, isExecuting }) {
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
  }, [execution, isExecuting]);

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

export default function Gen3TerraformUI() {
  const [activeStep, setActiveStep] = useState(0);
  const [runtime, setRuntime] = useState('docker');
  const [workDir, setWorkDir] = useState('/tmp/gen3-terraform');

  // AWS Credentials State
  const [awsAccessKeyId, setAwsAccessKeyId] = useState('');
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState('');
  const [awsRoleArn, setAwsRoleArn] = useState('');
  const [stateBucket, setStateBucket] = useState('');
  const [stateRegion, setStateRegion] = useState('us-east-1');
  const [secretName, setSecretName] = useState('terraform-aws-credentials');
  const [namespace, setNamespace] = useState('terraform');
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapSuccess, setBootstrapSuccess] = useState(false);

  // Terraform Config State
  const [config, setConfig] = useState({
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
  const logsEndRef = React.useRef(null);

  const scrollToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [executionLogs]);

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
    setConfig(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleTagChange = (key, value) => {
    setConfig(prev => ({
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
    setConfig(prev => {
      const newTags = { ...prev.default_tags };
      delete newTags[key];
      return {
        ...prev,
        default_tags: newTags
      };
    });
  };

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
          state_bucket: stateBucket,
          state_region: stateRegion,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setBootstrapSuccess(true);
        setActiveStep(2);
      } else {
        alert(`Failed to bootstrap secret: ${data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setBootstrapping(false);
    }
  };

  const executeTerraform = async (operation) => {
    setIsExecuting(true);
    setExecutionLogs([]);
    setExecution(null);

    try {
      const tfvars = buildTfvars(config);
      const response = await fetch('/api/terraform/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operation: operation,
          work_dir: workDir,
          runtime: runtime,
          auto_approve: operation === 'apply' || operation === 'destroy',
          // docker_image: 'docker.io/library/gen3-terraform:elise',
          // docker_image: 'hashicorp/terraform:latest',
          docker_image: 'gen3-terraform:latest',
          docker_network: 'bridge',
          namespace: namespace,
          pod_image: 'hashicorp/terraform:latest',
          secret_name: secretName,
          state_bucket: stateBucket,
          state_region: stateRegion,
          tfvars,
          tfvars_file_name: 'terraform.tfvars'
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setExecution({ id: data.id, operation });
        streamLogs(data.id);
      } else {
        setExecutionLogs([`Error: ${data.error}.\n\nDetails: \n${data.stderr}`]);
        setIsExecuting(false);
      }
    } catch (error) {
      setExecutionLogs([`Error: ${error.message}`]);
      setIsExecuting(false);
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
            } else if (currentEvent === 'error') {
              setIsExecuting(false);
              setExecutionLogs(prev => [...prev, `\n✗ Error: ${data}`]);
            } else if (currentEvent === 'message' && data) {
              setExecutionLogs(prev => [...prev, data]);
            }
          }
        }
      }
    } catch (error) {
      console.error('Stream error:', error);
      setExecutionLogs(prev => [...prev, `\nStream error: ${error.message}`]);
      setIsExecuting(false);
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

  const getStatusIcon = () => {
    if (isExecuting) return <Loader size="sm" />;
    if (executionLogs.some(log => log.includes('error') || log.includes('Error'))) {
      return <IconX color="red" />;
    }
    if (executionLogs.length > 0) return <IconCheck color="green" />;
    return <IconClock color="gray" />;
  };

  function buildTfvars(cfg) {
    const q = (v) => `"${v}"`;
    const fmt = (v) => {
      if (typeof v === 'string') return q(v);
      if (typeof v === 'boolean') return String(v);
      if (Array.isArray(v)) return v.length ? `[\n  ${v.map(q).join(',\n  ')}\n]` : '[]';
      if (v && typeof v === 'object') {
        const entries = Object.entries(v);
        return entries.length
          ? `{\n  ${entries.map(([k, val]) => `${k} = ${q(val)}`).join('\n  ')}\n}`
          : '{}';
      }
      return String(v ?? '');
    };

    let out = '# Required Variables\n';
    out += `vpc_name = ${fmt(cfg.vpc_name)}\n`;
    out += `aws_region = ${fmt(cfg.aws_region)}\n`;
    out += `availability_zones = ${fmt(cfg.availability_zones)}\n`;
    out += `hostname = ${fmt(cfg.hostname)}\n`;
    out += `revproxy_arn = ${fmt(cfg.revproxy_arn)}\n`;
    out += `user_yaml_bucket_name = ${fmt(cfg.user_yaml_bucket_name)}\n`;

    out += '\n# Optional Variables\n';
    out += `kubernetes_namespace = ${fmt(cfg.kubernetes_namespace)}\n`;
    out += `es_linked_role = ${fmt(cfg.es_linked_role)}\n`;
    out += `create_gitops_infra = ${fmt(cfg.create_gitops_infra)}\n`;
    out += `deploy_cognito = ${fmt(cfg.deploy_cognito)}\n`;

    out += '\n# Default Tags\n';
    out += `default_tags = ${fmt(cfg.default_tags)}\n`;

    return out;
  }

  return (
    <Container size="xl" py="md">
      <Paper shadow="sm" radius="md" p="xl">
        <Group justify="space-between" mb="xl">
          <div>
            <Title order={1} c="blue">Gen3 Terraform Configuration</Title>
            <Badge color="blue" variant="light" mt="xs">Infrastructure as Code</Badge>
          </div>
        </Group>

        <Stepper active={activeStep} onStepClick={setActiveStep} breakpoint="sm">
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
                value={workDir}
                onChange={(e) => setWorkDir(e.target.value)}
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
                    value={stateBucket}
                    onChange={(e) => setStateBucket(e.target.value)}
                    required
                  />
                </Grid.Col>
                <Grid.Col span={6}>
                  <Select
                    label="State Bucket Region"
                    data={awsRegions}
                    value={stateRegion}
                    onChange={setStateRegion}
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
                  disabled={!awsAccessKeyId || !awsSecretAccessKey || !stateBucket}
                >
                  Bootstrap Secret
                </Button>
              </Group>
            </Stack>
          </Stepper.Step>

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
                            value={config.vpc_name}
                            onChange={(e) => handleInputChange('vpc_name', e.target.value)}
                          />
                        </Grid.Col>
                        <Grid.Col span={6}>
                          <Select
                            label="AWS Region"
                            data={awsRegions}
                            value={config.aws_region}
                            onChange={(value) => {
                              handleInputChange('aws_region', value);
                              handleInputChange('availability_zones', []);
                            }}
                          />
                        </Grid.Col>
                      </Grid>

                      <MultiSelect
                        label="Availability Zones"
                        data={getAvailabilityZones(config.aws_region)}
                        value={config.availability_zones}
                        onChange={(value) => handleInputChange('availability_zones', value)}
                      />

                      <TextInput
                        label="Hostname"
                        placeholder="gen3.example.com"
                        value={config.hostname}
                        onChange={(e) => handleInputChange('hostname', e.target.value)}
                      />

                      <TextInput
                        label="Reverse Proxy ARN"
                        placeholder="arn:aws:acm:us-east-1:123456789012:certificate/..."
                        value={config.revproxy_arn}
                        onChange={(e) => handleInputChange('revproxy_arn', e.target.value)}
                      />

                      <TextInput
                        label="User YAML Bucket Name"
                        placeholder="my-gen3-user-yaml-bucket"
                        value={config.user_yaml_bucket_name}
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
                        value={config.kubernetes_namespace}
                        onChange={(e) => handleInputChange('kubernetes_namespace', e.target.value)}
                      />

                      <Group grow>
                        <Switch
                          label="Enable Elasticsearch Linked Role"
                          checked={config.es_linked_role}
                          onChange={(e) => handleInputChange('es_linked_role', e.currentTarget.checked)}
                        />
                        <Switch
                          label="Create GitOps Infrastructure"
                          checked={config.create_gitops_infra}
                          onChange={(e) => handleInputChange('create_gitops_infra', e.currentTarget.checked)}
                        />
                        <Switch
                          label="Deploy Cognito"
                          checked={config.deploy_cognito}
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
                      <Badge color="purple" size="sm">{Object.keys(config.default_tags).length} tags</Badge>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="md">
                      {Object.entries(config.default_tags).map(([key, value]) => (
                        <Group key={key} grow>
                          <TextInput
                            placeholder="Tag key"
                            value={key}
                            onChange={(e) => {
                              const oldKey = key;
                              const newKey = e.target.value;
                              setConfig(prev => {
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

          <Stepper.Step label="Execute" description="Run Terraform" icon={<IconPlayerPlay size={18} />}>
            <Stack gap="md" mt="xl">
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
                          {(() => {
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
                          })()}
                        </Code>
                      </ScrollArea>
                    </Paper>
                    <Group justify="flex-end" mt="xs">
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconDownload size={14} />}
                        onClick={() => {
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

                          const blob = new Blob([output], { type: 'text/plain' });
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

              <Group grow>
                <Button
                  leftSection={<IconPlayerPlay size={16} />}
                  onClick={() => executeTerraform('init')}
                  disabled={isExecuting}
                  variant="light"
                >
                  Init
                </Button>
                <Button
                  leftSection={<IconPlayerPlay size={16} />}
                  onClick={() => executeTerraform('validate')}
                  disabled={isExecuting}
                  variant="light"
                >
                  Validate
                </Button>
                <Button
                  leftSection={<IconPlayerPlay size={16} />}
                  onClick={() => executeTerraform('plan')}
                  disabled={isExecuting}
                  color="blue"
                >
                  Plan
                </Button>
                <Button
                  leftSection={<IconPlayerPlay size={16} />}
                  onClick={() => executeTerraform('apply')}
                  disabled={isExecuting}
                  color="green"
                >
                  Apply
                </Button>
                <Button
                  leftSection={<IconPlayerPlay size={16} />}
                  onClick={() => executeTerraform('destroy')}
                  disabled={isExecuting}
                  color="red"
                >
                  Destroy
                </Button>
              </Group>

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

              {execution && (
                <Alert color="blue" variant="light">
                  <Text size="sm">
                    <strong>Execution ID:</strong> {execution.id}
                  </Text>
                  <Text size="sm">
                    <strong>Operation:</strong> {execution.operation}
                  </Text>
                  <Text size="sm">
                    <strong>Runtime:</strong> {runtime}
                  </Text>
                </Alert>
              )}

              <Paper p="md" withBorder style={{ backgroundColor: '#1a1b1e', minHeight: '300px' }}>
                <Group justify="space-between" mb="xs">
                  <Text size="xs" c="dimmed">Execution Logs:</Text>
                  {executionLogs.length > 0 && (
                    <Badge size="sm" color="blue">{executionLogs.length} lines</Badge>
                  )}
                </Group>
                {executionLogs.length === 0 ? (
                  <Text size="sm" c="dimmed" ta="center" mt="xl">
                    No logs yet. Click a Terraform operation to start.
                  </Text>
                ) : (
                  <div style={{ maxHeight: '400px', overflow: 'auto' }}>
                    <Code block style={{
                      whiteSpace: 'pre-wrap',
                      fontSize: '11px',
                      backgroundColor: 'transparent',
                      color: '#c1c2c5'
                    }}>
                      {executionLogs.join('\n')}
                    </Code>
                    <div ref={logsEndRef} />
                  </div>
                )}
              </Paper>

              <Divider label="Execution History" labelPosition="center" />

              <ExecutionHistory
                execution={execution}
                isExecuting={isExecuting}
                onViewLogs={(exec) => {
                  setExecution({ id: exec.id, operation: 'viewing' });
                  setExecutionLogs([]);
                  setIsExecuting(false);
                  setRuntime(exec.runtime);
                  streamLogs(exec.id);
                }}
              />

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
  );
}
