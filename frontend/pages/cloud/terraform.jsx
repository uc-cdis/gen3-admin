import React, { useState } from 'react';
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
  Tooltip
} from '@mantine/core';
import { IconPlus, IconTrash, IconDownload, IconInfoCircle } from '@tabler/icons-react';

export default function Gen3ConfigUI() {
  const [config, setConfig] = useState({
    // Required Variables
    vpc_name: "my-gen3-vpc",
    aws_region: "us-east-1",
    availability_zones: ["us-east-1a", "us-east-1c", "us-east-1d"],
    hostname: "gen3.example.com",
    revproxy_arn: "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012",
    user_yaml_bucket_name: "my-gen3-user-yaml-bucket",

    // Optional Variables
    kubernetes_namespace: "gen3",
    es_linked_role: true,
    create_gitops_infra: true,
    deploy_cognito: true,

    // Custom Tags
    default_tags: {
      Environment: "production",
      Project: "gen3-deployment",
      Owner: "data-team",
      CostCenter: "research"
    }
  });

  const [newTagKey, setNewTagKey] = useState('');
  const [newTagValue, setNewTagValue] = useState('');

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

  const generateTerraformConfig = () => {
    let output = `# Required Variables
vpc_name = "${config.vpc_name}"
aws_region = "${config.aws_region}"
availability_zones = [${config.availability_zones.map(az => `"${az}"`).join(', ')}]
hostname = "${config.hostname}"
revproxy_arn = "${config.revproxy_arn}"
user_yaml_bucket_name = "${config.user_yaml_bucket_name}"

# Optional Variables with Custom Values
kubernetes_namespace = "${config.kubernetes_namespace}"
es_linked_role = ${config.es_linked_role}

# Create service accounts so we can do gitops
create_gitops_infra = ${config.create_gitops_infra}

# Custom Tags
default_tags = {
`;

    Object.entries(config.default_tags).forEach(([key, value]) => {
      output += `  ${key} = "${value}"
`;
    });

    output += `}

# Cognito Configuration (optional - will use defaults based on vpc_name if not specified)
deploy_cognito = ${config.deploy_cognito}
`;

    return output;
  };

  const downloadConfig = () => {
    const configText = generateTerraformConfig();
    const blob = new Blob([configText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'terraform.tfvars';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Container size="xl" py="md">
      <Paper shadow="sm" radius="md" p="xl">
        <Group justify="space-between" mb="xl">
          <div>
            <Title order={1} c="blue">Gen3 Configuration</Title>
            <Badge color="blue" variant="light" mt="xs">Terraform Variables</Badge>
          </div>
          <Button
            leftSection={<IconDownload size={16} />}
            onClick={downloadConfig}
            variant="filled"
          >
            Download Config
          </Button>
        </Group>

        <Accordion multiple defaultValue={['required', 'optional', 'tags']}>
          <Accordion.Item value="required">
            <Accordion.Control>
              <Group>
                <Title order={3}>Required Variables</Title>
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
                      required
                    />
                  </Grid.Col>
                  <Grid.Col span={6}>
                    <Select
                      label="AWS Region"
                      placeholder="Select region"
                      data={awsRegions}
                      value={config.aws_region}
                      onChange={(value) => {
                        handleInputChange('aws_region', value);
                        // Reset availability zones when region changes
                        handleInputChange('availability_zones', []);
                      }}
                      required
                    />
                  </Grid.Col>
                </Grid>

                <MultiSelect
                  label="Availability Zones"
                  placeholder="Select availability zones"
                  data={getAvailabilityZones(config.aws_region)}
                  value={config.availability_zones}
                  onChange={(value) => handleInputChange('availability_zones', value)}
                  required
                />

                <TextInput
                  label="Hostname"
                  placeholder="gen3.example.com"
                  value={config.hostname}
                  onChange={(e) => handleInputChange('hostname', e.target.value)}
                  required
                />

                <TextInput
                  label="Reverse Proxy ARN"
                  placeholder="arn:aws:acm:us-east-1:123456789012:certificate/..."
                  value={config.revproxy_arn}
                  onChange={(e) => handleInputChange('revproxy_arn', e.target.value)}
                  required
                />

                <TextInput
                  label="User YAML Bucket Name"
                  placeholder="my-gen3-user-yaml-bucket"
                  value={config.user_yaml_bucket_name}
                  onChange={(e) => handleInputChange('user_yaml_bucket_name', e.target.value)}
                  required
                />
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="optional">
            <Accordion.Control>
              <Group>
                <Title order={3}>Optional Variables</Title>
                <Badge color="green" size="sm">Optional</Badge>
              </Group>
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
                <Title order={3}>Default Tags</Title>
                <Badge color="purple" size="sm">{Object.keys(config.default_tags).length} tags</Badge>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="md">
                <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
                  Tags are used for resource organization and cost tracking in AWS.
                </Alert>

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
                    <Tooltip label="Remove tag">
                      <ActionIcon color="red" onClick={() => removeTag(key)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                ))}

                <Divider label="Add New Tag" labelPosition="center" />

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
                    Add Tag
                  </Button>
                </Group>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="preview">
            <Accordion.Control>
              <Title order={3}>Configuration Preview</Title>
            </Accordion.Control>
            <Accordion.Panel>
              <Code block style={{ whiteSpace: 'pre-wrap', fontSize: '12px' }}>
                {generateTerraformConfig()}
              </Code>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Paper>
    </Container>
  );
}
