import { Stack, Paper, Divider, Radio, Group, Collapse, TextInput, NumberInput, Switch } from '@mantine/core';

const DatabaseStep = ({ form }) => {
  const isLocal = Boolean(form.values.values?.global?.dev);
  return (
    <Paper p="md" radius="md" withBorder>
      <Stack spacing="lg">
        <Divider variant="dashed" label="Database Configuration" labelPosition="center" />
        <Switch
        checked={Boolean(form.values.values.global.postgres.dbCreate)}
        label="Automatically Create Databases"
        description="Run the database job to create all gen3 service DBs."
        onChange={(e) => form.setFieldValue('values.global.postgres.dbCreate', e.currentTarget.checked)}
        />
        <Radio.Group
        name="databaseType"
        label="Would you like to use an external database or use a local Postgresql pod?"
        description="Select an external or local database."
        value={form.values.values.global.dev ? 'local' : 'external'}
        onChange={(val) => form.setFieldValue('values.global.dev', val === 'local')}
        withAsterisk
        >
        <Group mt="xs">
            <Radio value="external" label="External" />
            <Radio value="local" label="Local" />
        </Group>
        </Radio.Group>
        <Collapse in={isLocal}>
            <Divider variant="dashed" label="Local Postgres Configuration" labelPosition="center" />
            <Switch
            checked={Boolean(form.values.values.global.pdb)}
            label="Create Pod Distruption Budget"
            description="Would you like your Postgres pod to have a pod disruption budget?"
            onChange={(e) => form.setFieldValue('values.global.pdb', e.currentTarget.checked)}
            />
            <Switch
            checked={Boolean(form.values.values.postgresql?.primary?.persistence?.enabled)}
            label="Enable Persistence?"
            description="Would you like your Postgres pod to persist your data using a PVC?"
            onChange={(e) => form.setFieldValue('values.postgresql.primary.persistence.enabled', e.currentTarget.checked)}
            />
        </Collapse>
        <Collapse in={!isLocal}>
            <Divider variant="dashed" label="External Postgres Configuration" labelPosition="center" />
            <Group grow>
                <TextInput
                label={`Postgres Host`}
                placeholder="prod.cluster-abc123def456.us-east-1.rds.amazonaws.com"
                 {...form.getInputProps('values.global.postgres.master.host')}
                withAsterisk
                />
                <TextInput
                label={`Postgres Master Username`}
                placeholder="postgres"
                 {...form.getInputProps('values.global.postgres.master.username')}
                withAsterisk
                />
                <TextInput
                label={`Postgres Master Password`}
                type="password"
                placeholder="test123"
                 {...form.getInputProps('values.global.postgres.master.password')}
                withAsterisk
                />
                <TextInput
                label={`Postgres Port`}
                placeholder="5432"
                 {...form.getInputProps('values.global.postgres.master.port')}
                withAsterisk
                />
            </Group>
            <TextInput
              label="External Secret Name"
              description="Name of an existing K8s secret containing postgres master credentials (optional)"
              mt="md"
              {...form.getInputProps('values.global.postgres.externalSecret')}
            />
        </Collapse>

        {/* Elasticsearch Configuration (dev mode only) */}
        {isLocal && (
          <>
            <Divider variant="dashed" label="Elasticsearch Configuration (Dev Mode)" labelPosition="center" />
            <Group grow>
              <TextInput label="Image Tag" placeholder="7.10.2" {...form.getInputProps('values.elasticsearch.imageTag')} />
              <Switch
                label="Single Node"
                checked={Boolean(form.values.values?.elasticsearch?.singleNode)}
                onChange={(e) => form.setFieldValue('values.elasticsearch.singleNode', e.currentTarget.checked)}
              />
            </Group>
            <TextInput
              label="CPU Request"
              mt="md"
              placeholder="500m"
              {...form.getInputProps('values.elasticsearch.resources.requests.cpu')}
            />
          </>
        )}

        {/* PostgreSQL Image Config (local mode) */}
        {isLocal && (
          <>
            <Divider variant="dashed" label="PostgreSQL Image Configuration" labelPosition="center" />
            <Group grow>
              <TextInput label="Image Repository" {...form.getInputProps('values.postgresql.image.repository')} />
              <TextInput label="Image Tag" {...form.getInputProps('values.postgresql.image.tag')} />
            </Group>
          </>
        )}
        </Stack>
    </Paper>
    );
}

export default DatabaseStep;
