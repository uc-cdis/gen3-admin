import { useState } from 'react';
import { Stack, Paper, TextInput, Text, Divider, Group, Card, Title, Switch, Button, NumberInput, Collapse } from '@mantine/core';
import { IconArrowBackUp, IconPlus, IconTrash } from '@tabler/icons-react';
import AuthStep from './AuthStep';

import { notifications } from '@mantine/notifications';


const ConfigStep = ({ form, clusters, fetchClusters }) => {
  const [lastDeletedContainer, setLastDeletedContainer] = useState(null);

  const addContainer = () => {
    const last = form.values.values.hatchery.containers.at(-1);
    const newContainer = { ...last };
    form.insertListItem('values.hatchery.containers', newContainer);
  };

  const removeContainer = (index) => {
    if (form.values.values.hatchery.containers.length > 1) {
      const removed = form.values.values.hatchery.containers[index];
      setLastDeletedContainer({ container: removed, index });
      form.removeListItem('values.hatchery.containers', index);

      notifications.show({
        id: 'undo-delete',
        title: 'Container removed',
        message: (
          <Button
            size="xs"
            variant="light"
            onClick={undoRemove}
            leftSection={<IconArrowBackUp size={14} />}
          >
            Undo
          </Button>
        ),
        color: 'yellow',
        autoClose: 5000,
        withCloseButton: true,
      });
    }
  };

  const undoRemove = () => {
    if (lastDeletedContainer) {
      form.insertListItem('values.hatchery.containers', lastDeletedContainer.container, lastDeletedContainer.index);
      setLastDeletedContainer(null);
      notifications.clean();
    }
  };


  return (
    <Stack spacing="lg">

      {/* Fence Config */}
      {form.values.values?.fence?.enabled && (
        <Paper p="md" radius="md" withBorder>
          <Text fw={500} mb="sm">Fence Configuration</Text>
          <Divider mb="md" />
          <Paper p="md" radius="md" withBorder>
            <Text fw={500} mb="sm">Login Options</Text>
            <AuthStep form={form} />
          </Paper>
        </Paper>
      )}

      {/* Guppy Config */}
      {form.values.values?.guppy?.enabled && (
        <Paper p="md" radius="md" withBorder>
          <Text fw={500} mb="sm">Guppy Configuration</Text>
          <Divider mb="md" />
          <TextInput
            label="ElasticSearch URL"
            placeholder="Enter ElasticSearch URL for Guppy"
            {...form.getInputProps('values.guppy.elasticUrl')}
          />
        </Paper>
      )}

      {/* Hatchery Config */}
      <Paper p="md" radius="md" withBorder>
        <Title order={2} mb="md">Workspace Configuration</Title>

        <Switch
          label="Enable Hatchery"
          checked={form.values.values.hatchery.enabled}
          onChange={(e) => form.setFieldValue('values.hatchery.enabled', e.currentTarget.checked)}
          mb="lg"
        />

        {form.values.values.hatchery.enabled && (
          <>
            {/* Sidecar Configuration */}
            <Paper p="md" radius="md" withBorder mb="xl">
              <Text fw={500} mb="sm">Sidecar Configuration</Text>
              <Divider mb="sm" />
              <Text fw={30} size="sm">A sidecar is a small image that runs alongside your main contianer (Jupyter, RStudio, or other apps with a webui) and is used to pull in data or other operations. </Text>
              <Divider mb="md" />
              <Group grow mt="md">
                <TextInput
                  label="Sidecar Image"
                  {...form.getInputProps('values.hatchery.sidecarContainer.image')}
                />
              </Group>
              <Group grow mt="md">
                <NumberInput
                  label="Sidecar CPU Limit"
                  precision={2}
                  step={0.1}
                  min={0}
                  {...form.getInputProps('values.hatchery.sidecarContainer.cpuLimit')}
                />
                <TextInput
                  label="Sidecar Memory Limit"
                  placeholder="e.g., 256Mi"
                  {...form.getInputProps('values.hatchery.sidecarContainer.memoryLimit')}
                />
              </Group>
            </Paper>

            {/* Containers Configuration */}
            <Text fw={500} mb="lg">Workspace Options</Text>
            {form.values.values.hatchery.containers.map((container, index) => (
              <Card key={index} withBorder shadow="sm" p="md" radius="lg" mb="md">
                <Group grow>
                  <TextInput
                    label="Container Name"
                    {...form.getInputProps(`values.hatchery.containers.${index}.name`)}
                  />
                  <TextInput
                    label="Image"
                    {...form.getInputProps(`values.hatchery.containers.${index}.image`)}
                  />
                </Group>

                <Group grow mt="md">
                  <NumberInput
                    label="CPU Limit"
                    precision={1}
                    step={0.1}
                    min={0}
                    {...form.getInputProps(`values.hatchery.containers.${index}.cpuLimit`)}
                  />
                  <TextInput
                    label="Memory Limit"
                    placeholder="e.g., 2Gi"
                    {...form.getInputProps(`values.hatchery.containers.${index}.memoryLimit`)}
                  />
                </Group>

                <Group grow mt="md">
                  <NumberInput
                    label="PORT"
                    precision={1}
                    step={0.1}
                    min={0}
                    {...form.getInputProps(`values.hatchery.containers.${index}.targetPort`)}
                  />
                  <TextInput
                    label="Memory Limit"
                    placeholder="e.g., 2Gi"
                    {...form.getInputProps(`values.hatchery.containers.${index}.memoryLimit`)}
                  />
                </Group>

                <Group position="right" mt="md">
                  <Button
                    variant="light"
                    color="red"
                    leftSection={<IconTrash size={16} />}
                    onClick={() => removeContainer(index)}
                    disabled={form.values.values.hatchery.containers.length === 1}
                  >
                    Remove
                  </Button>
                </Group>
              </Card>
            ))}

            <Group position="center" mt="lg">
              <Button
                leftIcon={<IconPlus size={18} />}
                onClick={addContainer}
                variant="outline"
              >
                Add New Container
              </Button>
            </Group>
          </>
        )}
      </Paper>

    </Stack>
  );
};

export default ConfigStep;
