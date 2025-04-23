import { TextInput, Select, Group, Stack, Paper, Divider, Switch, Tooltip, ActionIcon } from '@mantine/core';
import { IconPencil, IconRefresh } from '@tabler/icons-react';

const DestinationStep = ({ form, clusters, fetchClusters }) => {
  return (
    <Paper p="md" radius="md" withBorder>
      <Stack spacing="md">
        <Group position="apart" align="flex-end">
          <Select
            label="Cluster"
            description="Select your Kubernetes cluster"
            placeholder="e.g., my-cluster"
            data={clusters}
            {...form.getInputProps('cluster')}
            sx={{ flexGrow: 1 }}
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
        </Group>

        <Divider label="Release Configuration" labelPosition="center" />

        <Group grow align="flex-start">
          <TextInput
            label="Release Name"
            {...form.getInputProps('releaseName')}
            placeholder="e.g., my-release"
            rightSection={<IconPencil size={16} />}
          />
        </Group>

        <Divider label="Namespace Configuration" labelPosition="center" />

        <Group grow align="flex-start">
          {form.values.useCustomNs ? (
            <TextInput
              label="Custom Namespace"
              {...form.getInputProps('namespace')}
              placeholder="e.g., default"
              rightSection={<IconPencil size={16} />}
            />
          ) : (
            <Select
              label="Namespace"
              placeholder={form.values.releaseName}
              disabled
            />
          )}

          <Switch
            label="Use custom namespace"
            description="Toggle to input a custom namespace"
            {...form.getInputProps('useCustomNs', { type: 'checkbox' })}
            size="md"
            pt={20}
          />
        </Group>
      </Stack>
    </Paper>
  );
};

export default DestinationStep;
