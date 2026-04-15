import { useState } from 'react';
import { Stack, Paper, Text, Divider, Checkbox, SimpleGrid, Tooltip, Accordion, Badge, Group } from '@mantine/core';
import { IconHelp } from '@tabler/icons-react';

import { SERVICE_CATEGORIES } from '../serviceRegistry';

const ModulesStep = ({ form }) => {
  // Default expanded categories (core services visible by default)
  const [expandedCategories] = useState(['core']);

  // Toggle all services in a category
  const toggleCategory = (category, enabled) => {
    category.services.forEach(svc => {
      form.setFieldValue(`values.${svc.key}.enabled`, enabled);
    });
  };

  // Check if all services in a category are enabled
  const isCategoryAllEnabled = (category) =>
    category.services.every(svc => form.values.values?.[svc.key]?.enabled);

  // Count enabled services in a category
  const enabledCount = (category) =>
    category.services.filter(svc => form.values.values?.[svc.key]?.enabled).length;

  return (
    <Paper p="md" radius="md" withBorder>
      <Stack spacing="lg">
        <Text fw={700} size="lg">
          Select Gen3 Microservices to Deploy
        </Text>
        <Text size="sm" c="dimmed">
          Services are grouped by category. Core services are enabled by default for a functional deployment.
        </Text>

        <Accordion variant="separated" multiple defaultValue={expandedCategories}>
          {SERVICE_CATEGORIES.map(category => (
            <Accordion.Item key={category.id} value={category.id}>
              <Accordion.Control>
                <Group justify="space-between">
                  <Group gap="xs">
                    <Text fw={600}>{category.label}</Text>
                    <Badge size="sm" variant="light">
                      {enabledCount(category)} / {category.services.length}
                    </Badge>
                  </Group>
                  <Text size="xs" c="dimmed">{category.description}</Text>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>

                {/* Select All checkbox for this category */}
                <Group justify="space-between" mb="xs">
                  <Checkbox
                    label="Select All"
                    checked={isCategoryAllEnabled(category)}
                    onChange={(e) => toggleCategory(category, e.currentTarget.checked)}
                  />
                </Group>

                <SimpleGrid cols={{ base: 1, xs: 2, sm: 3 }} spacing="lg">
                  {category.services.map(svc => (
                    <Group key={svc.key} justify="space-between">
                      <Checkbox
                        key={`values.${svc.key}.enabled`}
                        label={svc.label}
                        {...form.getInputProps(`values.${svc.key}.enabled`, { type: 'checkbox' })}
                      />
                      {svc.tooltip && (
                        <Tooltip label={svc.tooltip}>
                          <IconHelp size={16} />
                        </Tooltip>
                      )}
                    </Group>
                  ))}
                </SimpleGrid>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </Stack>
    </Paper>
  );
};

export default ModulesStep;
