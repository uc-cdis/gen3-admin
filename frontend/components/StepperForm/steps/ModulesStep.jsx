import { TextInput, Stack, Paper, Divider, Group, Switch, Collapse, Text, Checkbox, SimpleGrid, Tooltip, PasswordInput, Radio, Textarea, Alert, List, Title } from '@mantine/core';
import { IconHelp, IconWorld, IconId, IconKey, IconLink, IconInfoCircle } from '@tabler/icons-react';


const ModulesStep = ({ form }) => {
  const modulesNew = [
    { label: 'Audit', value: 'audit', tooltip: 'Gen3 audit service' },
    { label: 'Arborist', value: 'arborist', tooltip: 'Gen3 auth service' },
    { label: 'Indexd', value: 'indexd', tooltip: '' },
    { label: 'Fence', value: 'fence', tooltip: 'Gen3 auth service' },
    { label: 'Frontend-Framework', value: 'frontend-framework', tooltip: 'New frontend framework' },
    { label: 'Guppy', value: 'guppy', tooltip: 'GraphQL API for flattened Gen3 data' },
    { label: 'Hatchery', value: 'hatchery', tooltip: 'Gen3 workspaces' },
    { label: 'Metadata', value: 'metadata', tooltip: 'Gen3 metadata catalog' },
    { label: 'Peregrine', value: 'peregrine', tooltip: 'GraphQL API for Gen3 structured data' },
    { label: 'Portal', value: 'portal', tooltip: 'Gen3 portal' },
    { label: 'Sheepdog', value: 'sheepdog', tooltip: 'Gen3 sheepdog service' },
  ];

  return (
    <Paper p="md" radius="md" withBorder>
      <Stack spacing="lg">
      <Text fw={700} size="lg" mb="md">
      Please select the Gen3 Microservices you want to deploy</Text>
        <SimpleGrid cols={3} spacing="lg" breakpoints={[{ maxWidth: 'md', cols: 2 }, { maxWidth: 'sm', cols: 1 }]}>
          {modulesNew.map((module) => (
            <Group key={module?.value} position="apart">
              <Checkbox
                key={`values.${module.value}.enabled`}
                label={module?.label}
                {...form.getInputProps(`values.${module.value}.enabled`, { type: 'checkbox' })}
              />

              {module?.tooltip && (
                <Tooltip label={module.tooltip}>
                  <IconHelp size={16} />
                </Tooltip>
              )}
            </Group>
          ))}
        </SimpleGrid>
      </Stack>
    </Paper>
  );
};

export default ModulesStep;