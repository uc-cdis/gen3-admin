import { Paper, Stack, Text, Divider, TextInput, NumberInput, Switch, Select, Radio, SegmentedControl, TagsInput, Group } from '@mantine/core';

const AWS_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-central-1',
  'ap-northeast-1', 'ap-northeast-2', 'ap-southeast-1', 'ap-south-1',
  'ca-central-1', 'sa-east-1',
];

const GlobalSettingsStep = ({ form }) => {
  const g = form.getInputProps; // shorthand

  return (
    <Paper p="md" radius="md" withBorder>
      <Stack spacing="lg">

        {/* A. Environment Basics */}
        <div>
          <Text fw={600} size="lg" mb="xs">Environment Basics</Text>
          <Divider mb="md" />
          <Group grow>
            <TextInput label="Environment" placeholder="default"
              {...g('values.global.environment')}
              description="Environment name (should match VPC name for AWS)" />
            <TextInput label="Cluster Name" placeholder="default"
              {...g('values.global.clusterName')}
              description="Kubernetes cluster identifier" />
          </Group>
          <Group grow mt="md">
            <SegmentedControl
              label="Frontend Root — Which app serves on /"
              data={[
                { label: 'Portal', value: 'portal' },
                { label: 'Gen3FF (Frontend Framework)', value: 'gen3ff' },
              ]}
              {...g('values.global.frontendRoot')}
            />
          </Group>
        </div>

        {/* B. Cloud Provider */}
        <div>
          <Text fw={600} size="lg" mb="xs">Cloud Provider</Text>
          <Divider mb="md" />

          <Radio.Group label="Target cloud platform" {...g('values.global._cloudProvider')}>
            <Stack mt="xs">
              <Radio value="none" label="None (generic Kubernetes)" />
              <Radio value="aws" label="Amazon Web Services (AWS)" />
              <Radio value="gcp" label="Google Cloud Platform (GCP)" />
            </Stack>
          </Radio.Group>

          {/* AWS Section */}
          {form.values.values?.global?._cloudProvider === 'aws' && (
            <Paper p="md" radius="sm" withBorder mt="md">
              <Text fw={500} mb="sm">AWS Configuration</Text>

              <Select
                label="Region"
                searchable
                creatable
                data={AWS_REGIONS.map(r => ({ value: r, label: r }))}
                {...g('values.global.aws.region')}
              />

              <Switch
                label="AWS Enabled (controls ingress annotations)"
                mt="md"
                {...g('values.global.aws.enabled', { type: 'checkbox' })}
              />

              <Text fw={500} size="sm" mt="lg">Credentials Strategy</Text>
              <Radio.Group {...g('values.global.aws._credStrategy')} mt="xs">
                <Stack>
                  <Radio value="keys" label="Access Keys (direct)" />
                  <Radio value="irsa" label="IRSA (Service Account + IAM Role)" />
                  <Radio value="localSecret" label="Pre-existing Local Secret" />
                  <Radio value="externalSecrets" label="External Secrets Operator" />
                </Stack>
              </Radio.Group>

              {form.values.values?.global?.aws?._credStrategy === 'keys' && (
                <Group grow mt="md">
                  <TextInput label="AWS Access Key ID" {...g('values.global.aws.awsAccessKeyId')} />
                  <TextInput label="AWS Secret Access Key" type="password" {...g('values.global.aws.awsSecretAccessKey')} />
                </Group>
              )}

              {form.values.values?.global?.aws?._credStrategy === 'irsa' && (
                <Stack mt="md">
                  <Switch label="Use IRSA" {...g('values.global.aws.secretStoreServiceAccount.enabled', { type: 'checkbox' })} />
                  <TextInput label="Service Account Name" placeholder="secret-store-sa" {...g('values.global.aws.secretStoreServiceAccount.name')} />
                  <TextInput label="IAM Role ARN" placeholder="arn:aws:iam::..." {...g('values.global.aws.secretStoreServiceAccount.roleArn')} />
                </Stack>
              )}

              {form.values.values?.global?.aws?._credStrategy === 'localSecret' && (
                <Stack mt="md">
                  <Switch label="Use Local Secret" {...g('values.global.aws.useLocalSecret.enabled', { type: 'checkbox' })} />
                  <TextInput label="Local Secret Name" {...g('values.global.aws.useLocalSecret.localSecretName')} />
                </Stack>
              )}

              {form.values.values?.global?.aws?._credStrategy === 'externalSecrets' && (
                <Stack mt="md">
                  <Switch label="External Secrets Enabled" {...g('values.global.aws.externalSecrets.enabled', { type: 'checkbox' })} />
                  <TextInput label="External Secret (Secrets Manager name)" {...g('values.global.aws.externalSecrets.externalSecretAwsCreds')} />
                  <Switch label="Push DB Secrets to Secrets Manager" {...g('values.global.aws.externalSecrets.pushSecret', { type: 'checkbox' })} />
                </Stack>
              )}
            </Paper>
          )}

          {/* GCP Section */}
          {form.values.values?.global?._cloudProvider === 'gcp' && (
            <Paper p="md" radius="sm" withBorder mt="md">
              <Text fw={500} mb="sm">GCP Configuration</Text>
              <Switch label="GCP Enabled" {...g('values.global.gcp.enabled', { type: 'checkbox' })} />
              <TextInput label="GCP Project ID" placeholder="project-name" mt="md" {...g('values.global.gcp.projectID')} />
              <TextInput label="GCP Service Account" placeholder="GCP_SA@PROJECT.iam.gserviceaccount.com" mt="xs" {...g('values.global.gcp.secretStoreServiceAccount')} />
            </Paper>
          )}
        </div>

        {/* C. Crossplane */}
        <div>
          <Text fw={600} size="lg" mb="xs">Crossplane (AWS Resource Provisioning)</Text>
          <Divider mb="md" />
          <Switch label="Enable Crossplane" description="Provision AWS resources (S3 buckets, etc.) via Crossplane"
            {...g('values.global.crossplane.enabled', { type: 'checkbox' })} />
          {form.values.values?.global?.crossplane?.enabled && (
            <Stack mt="md">
              <TextInput label="Provider Config Name" placeholder="provider-aws" {...g('values.global.crossplane.providerConfigName')} />
              <NumberInput label="AWS Account ID" {...g('values.global.crossplane.accountId')} />
              <TextInput label="S3 KMS Key ID" {...g('values.global.crossplane.s3.kmsKeyId')} />
              <Switch label="S3 Bucket Versioning" {...g('values.global.crossplane.s3.versioningEnabled', { type: 'checkbox' })} />
            </Stack>
          )}
        </div>

        {/* D. Network & Infrastructure */}
        <div>
          <Text fw={600} size="lg" mb="xs">Network & Infrastructure</Text>
          <Divider mb="md" />

          <Switch label="Network Policies" description="Enable K8s NetworkPolicies (beta feature)"
            {...g('values.global.netPolicy.enabled', { type: 'checkbox' })} />
          {form.values.values?.global?.netPolicy?.enabled && (
            <TagsInput
              label="Database Subnet CIDRs"
              description="CIDR ranges that services with databases need access to"
              placeholder="10.0.0.0/16"
              mt="md"
              {...g('values.global.netPolicy.dbSubnets')}
            />
          )}

          <Group grow mt="md">
            <Switch label="Pod Disruption Budget" description="Require PDB for services (needs >2 replicas)"
              {...g('values.global.pdb', { type: 'checkbox' })} />
            <Switch label="Topology Spread Constraints" description="Spread pods across availability zones"
              {...g('values.global.topologySpread.enabled', { type: 'checkbox' })} />
          </Group>

          {form.values.values?.global?.topologySpread?.enabled && (
            <Group grow mt="md">
              <TextInput label="Topology Key" placeholder="topology.kubernetes.io/zone" {...g('values.global.topologySpread.topologyKey')} />
              <NumberInput label="Max Skew" min={1} {...g('values.global.topologySpread.maxSkew')} />
            </Group>
          )}
        </div>

        {/* E. Deployment Options */}
        <div>
          <Text fw={600} size="lg" mb="xs">Deployment Options</Text>
          <Divider mb="md" />

          <Group grow>
            <NumberInput label="Dispatcher Jobs" description="Number of dispatcher jobs" {...g('values.global.dispatcherJobNum')} />
            <NumberInput label="Workspace Timeout (min)" description="Idle workspace timeout in minutes" {...g('values.global.workspaceTimeoutInMinutes')} />
          </Group>

          <Group grow mt="md">
            <TextInput label="Data Dictionary URL" {...g('values.global.dictionaryUrl')} />
            <TextInput label="Data Upload Bucket" placeholder="s3://..." {...g('values.global.dataUploadBucket')} />
          </Group>

          <Group grow mt="md">
            <Switch label="Public Datasets" {...g('values.global.publicDataSets', { type: 'checkbox' })} />
            <Select
              label="Tier Access Level"
              data={[
                { value: 'libre', label: 'Libre (fully open)' },
                { value: 'regular', label: 'Regular (threshold-based)' },
                { value: 'private', label: 'Private (restricted)' },
              ]}
              {...g('values.global.tierAccessLevel')}
            />
          </Group>

          {form.values.values?.global?.tierAccessLevel === 'regular' && (
            <NumberInput label="Tier Access Limit" description="Min file count threshold for regular tier" mt="md" {...g('values.global.tierAccessLimit')} />
          )}

          <Select
            label="Maintenance Mode"
            data={[
              { value: 'off', label: 'Off (normal operation)' },
              { value: 'on', label: 'On (read-only mode)' },
              { value: 'read-only', label: 'Read-Only' },
            ]}
            mt="md"
            {...g('values.global.maintenanceMode')}
          />

          <Group grow mt="md">
            <Switch label="Metrics Enabled" {...g('values.global.metricsEnabled', { type: 'checkbox' })} />
            <Switch label="External Secrets (global)" description="Pull secrets from AWS Secrets Manager"
              {...g('values.global.externalSecrets.deploy', { type: 'checkbox' })} />
          </Group>

          <TextInput label="Slack Webhook URL" mt="md" {...g('values.global.slackWebhook')} />
        </div>

      </Stack>
    </Paper>
  );
};

export default GlobalSettingsStep;
