import { TextInput, Select, Group, Stack, Paper, Divider, Switch, Tooltip, ActionIcon, Accordion, Text } from '@mantine/core';
import { IconPencil, IconRefresh } from '@tabler/icons-react';

const DestinationStep = ({ form, clusters, fetchClusters }) => {
  return (
    <Paper p="md" radius="md" withBorder>
      <Stack spacing="md">
        <Group justify="space-between" align="flex-end">
          <Select
            label="Cluster"
            description="Select your Kubernetes cluster"
            placeholder="e.g., my-cluster"
            data={clusters}
            {...form.getInputProps('destination.cluster')}
            style={{ flexGrow: 1 }}
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
            {...form.getInputProps('destination.releaseName')}
            placeholder="e.g., my-release"
            rightSection={<IconPencil size={16} />}
          />
        </Group>

        <Divider label="Namespace Configuration" labelPosition="center" />

        <Group grow align="flex-start">
          {form.values.destination.useCustomNs ? (
            <TextInput
              label="Custom Namespace"
              {...form.getInputProps('destination.namespace')}
              placeholder="e.g., default"
              rightSection={<IconPencil size={16} />}
            />
          ) : (
            <Select
              label="Namespace"
              placeholder={form.values.destination.releaseName}
              disabled
            />
          )}

          <Switch
            label="Use custom namespace"
            description="Toggle to input a custom namespace"
            {...form.getInputProps('destination.useCustomNs', { type: 'checkbox' })}
            size="md"
            pt={20}
          />
        </Group>

        {/* Helm Repository Configuration — collapsible */}
        <Accordion defaultValue="" variant="separated">
          <Accordion.Item value="helm-source">
            <Accordion.Control>
              Helm Chart Source
              <Text size="xs" c="dimmed" ml="xs">Repository URL, chart name & version</Text>
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                <Group grow>
                  <TextInput
                    label="Repository URL"
                    description="Helm repository URL for the gen3 chart"
                    {...form.getInputProps('destination.repoUrl')}
                    placeholder="https://helm.gen3.org"
                  />
                  <TextInput
                    label="Chart Name"
                    description="Name of the chart to deploy"
                    {...form.getInputProps('destination.chartName')}
                    placeholder="gen3"
                  />
                </Group>

                <TextInput
                  label="Chart Version (optional)"
                  description="Leave empty for latest version"
                  {...form.getInputProps('destination.chartVersion')}
                  placeholder="e.g., 0.3.26"
                />
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>
    </Paper>
  );
};

export default DestinationStep;
