import { useState } from 'react';
import { Stack, Paper, Text, Checkbox, SimpleGrid, Tooltip, Accordion, Badge, Group, SegmentedControl, Box } from '@mantine/core';
import { IconHelp, IconLock } from '@tabler/icons-react';

import { SERVICE_CATEGORIES } from '../serviceRegistry';

const ModulesStep = ({ form }) => {
  // Default expanded categories (all visible by default)
  const [expandedCategories] = useState(SERVICE_CATEGORIES.map(c => c.id));

  // Toggle all services in a category (skip disabled)
  const toggleCategory = (category, enabled) => {
    category.services.filter(s => !s.disabled).forEach(svc => {
      form.setFieldValue(`values.${svc.key}.enabled`, enabled);
    });
  };

  // Check if all services in a category are enabled
  const isCategoryAllEnabled = (category) =>
    category.services.filter(s => !s.disabled).every(svc => form.values.values?.[svc.key]?.enabled);

  // Count enabled services in a category (excluding disabled)
  const enabledCount = (category) => {
    const activeServices = category.services.filter(s => !s.disabled);
    return activeServices.filter(svc => form.values.values?.[svc.key]?.enabled).length;
  };

  // Group services by toggleGroup — returns { regular: [], toggles: { groupName: [svc1, svc2] } }
  const groupServices = (services) => {
    const regular = [];
    const toggleGroups = {};
    services.forEach(svc => {
      if (svc.toggleGroup) {
        if (!toggleGroups[svc.toggleGroup]) toggleGroups[svc.toggleGroup] = [];
        toggleGroups[svc.toggleGroup].push(svc);
      } else {
        regular.push(svc);
      }
    });
    return { regular, toggleGroups };
  };

  // Handle ES proxy toggle — only one can be enabled at a time
  const handleToggleGroupChange = (groupServices, selectedKey) => {
    groupServices.forEach(svc => {
      form.setFieldValue(`values.${svc.key}.enabled`, svc.key === selectedKey);
    });
  };

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
                      {enabledCount(category)} / {category.services.filter(s => !s.disabled).length}
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

                {(() => {
                  const { regular, toggleGroups } = groupServices(category.services);

                  return (
                    <Stack gap="md">
                      {/* Regular checkbox services */}
                      {regular.length > 0 && (
                        <SimpleGrid cols={{ base: 1, xs: 2, sm: 3 }} spacing="lg">
                          {regular.map(svc => {
                            if (svc.disabled) {
                              return (
                                <Group key={svc.key} justify="space-between" opacity={0.5}>
                                  <Group gap="xs">
                                    <IconLock size={14} c="dimmed" />
                                    <Text size="sm" td="line-through" c="dimmed">{svc.label}</Text>
                                  </Group>
                                  <Badge size="xs" variant="light" color="gray">Coming Soon</Badge>
                                </Group>
                              );
                            }
                            return (
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
                            );
                          })}
                        </SimpleGrid>
                      )}

                      {/* Toggle group services (mutually exclusive) — only show for AWS */}
                      {(form.values.values?.global?._cloudProvider === 'aws' || form.values.values?.global?._cloudProvider === undefined) && Object.entries(toggleGroups).map(([groupName, svcs]) => {
                        const activeValue = svcs.find(s => form.values.values?.[s.key]?.enabled)?.key || '';
                        return (
                          <Stack key={groupName} gap="xs">
                            <Text size="sm" fw={500}>AWS Elasticsearch Proxy</Text>
                            <Text size="xs" c="dimmed">Choose one proxy type (only needed for AWS environments)</Text>
                            <SegmentedControl
                              fullWidth
                              value={activeValue}
                              onChange={(val) => handleToggleGroupChange(svcs, val)}
                              data={svcs.map(svc => ({
                                value: svc.key,
                                label: svc.label,
                              }))}
                            />
                            {svcs.map(svc => (
                              svc.tooltip && form.values.values?.[svc.key]?.enabled ? (
                                <Text key={svc.key} size="xs" c="dimmed">{svc.tooltip}</Text>
                              ) : null
                            ))}
                          </Stack>
                        );
                      })}
                    </Stack>
                  );
                })()}
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </Stack>
    </Paper>
  );
};

export default ModulesStep;
