import { useState } from 'react';
import { Stack, Paper, Text, Checkbox, SimpleGrid, Tooltip, Accordion, Badge, Group, SegmentedControl, Box } from '@mantine/core';
import { IconHelp, IconLock } from '@tabler/icons-react';

import { SERVICE_CATEGORIES } from '../serviceRegistry';

// Sentinel for "no proxy selected" in the mutually-exclusive ES proxy control.
const NO_PROXY = '__none';

const ModulesStep = ({ form }) => {
  // Default expanded categories (all visible by default)
  const [expandedCategories] = useState(SERVICE_CATEGORIES.map(c => c.id));

  // Services that belong to a mutually-exclusive toggle group are deliberately
  // excluded from bulk selection. They are infrastructure choices (the AWS ES
  // proxies replace the in-cluster elasticsearch Service), so turning them on as a
  // side effect of "Select All" silently breaks Elasticsearch.
  const bulkSelectable = (category) => category.services.filter(s => !s.disabled && !s.toggleGroup);

  // Toggle all services in a category (skip disabled and toggle-group members)
  const toggleCategory = (category, enabled) => {
    bulkSelectable(category).forEach(svc => {
      form.setFieldValue(`values.${svc.key}.enabled`, enabled);
    });
  };

  // Check if all services in a category are enabled
  const isCategoryAllEnabled = (category) => {
    const svcs = bulkSelectable(category);
    return svcs.length > 0 && svcs.every(svc => form.values.values?.[svc.key]?.enabled);
  };

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

  // Handle ES proxy toggle — at most one can be enabled; NO_PROXY disables both.
  const handleToggleGroupChange = (groupServices, selectedKey) => {
    groupServices.forEach(svc => {
      form.setFieldValue(`values.${svc.key}.enabled`, svc.key === selectedKey);
    });
  };

  return (
    <Paper p="md" radius="md" withBorder>
      <Stack gap="lg">
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

                      {/* Toggle group services (mutually exclusive).
                          Always rendered — previously this was hidden unless the cloud
                          provider was AWS, which made an enabled proxy impossible to
                          turn back off from the UI. */}
                      {Object.entries(toggleGroups).map(([groupName, svcs]) => {
                        const activeValue = svcs.find(s => form.values.values?.[s.key]?.enabled)?.key || NO_PROXY;
                        return (
                          <Stack key={groupName} gap="xs">
                            <Text size="sm" fw={500}>AWS Elasticsearch Proxy</Text>
                            <Text size="xs" c="dimmed">
                              Only for AWS-managed Elasticsearch/OpenSearch. Either proxy replaces the
                              in-cluster <strong>elasticsearch</strong> Service with one pointing at AWS,
                              so leave this on <strong>None</strong> when using the bundled Elasticsearch.
                            </Text>
                            <SegmentedControl
                              fullWidth
                              value={activeValue}
                              onChange={(val) => handleToggleGroupChange(svcs, val)}
                              data={[
                                { value: NO_PROXY, label: 'None (in-cluster ES)' },
                                ...svcs.map(svc => ({
                                  value: svc.key,
                                  label: svc.label,
                                })),
                              ]}
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
