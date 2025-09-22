import { useState } from 'react';
import { Switch, Stack, Paper, Divider, Radio, Group, Collapse, TextInput } from '@mantine/core';
const DatabaseStep = ({ form }) => {
  console.log(form.values.values)
  const [value, setValue] = useState('react');
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
            checked={Boolean(form.values.values.postgresql.persistence.enabled)}
            label="Enable Persistence?"
            description="Would you like your Postgres pod to persist your data using a PVC?"
            onChange={(e) => form.setFieldValue('values.postgresql.persistence.enabled', e.currentTarget.checked)}
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
        </Collapse>
        </Stack>
    </Paper>
    );
}

export default DatabaseStep;
