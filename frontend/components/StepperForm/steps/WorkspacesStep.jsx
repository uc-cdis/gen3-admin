import { TextInput, Stack, Paper, Divider, Group, Switch, Collapse, Text, Checkbox, SimpleGrid, Tooltip, PasswordInput, Radio, Textarea, Alert, List } from '@mantine/core';
import { IconHelp, IconWorld, IconId, IconKey, IconLink, IconInfoCircle } from '@tabler/icons-react';


const WorkspacesStep = ({ form }) => {
    return (
        <Paper p="md" radius="md" withBorder>
            <Stack spacing="lg">
                <Group position="apart">
                    <Text>Configure Workspaces</Text>
                    <Switch
                        label="Use Default Settings"
                        {...form.getInputProps('workspaces.useDefaults', { type: 'checkbox' })}
                        size="md"
                    />
                </Group>

                <Collapse in={!form.values.workspaces.useDefaults}>
                    <Stack>
                        {(form.values.workspaces.flavors || []).map((flavor, idx) => (
                            <Group key={idx} grow>
                                <TextInput label="Name" {...form.getInputProps(`workspaces.flavors.${idx}.name`)} withAsterisk />
                                <TextInput label="Image" {...form.getInputProps(`workspaces.flavors.${idx}.image`)} withAsterisk />
                                <TextInput label="CPU" {...form.getInputProps(`workspaces.flavors.${idx}.cpu`)} withAsterisk />
                                <TextInput label="Memory" {...form.getInputProps(`workspaces.flavors.${idx}.memory`)} withAsterisk />
                            </Group>
                        ))}
                    </Stack>
                </Collapse>
            </Stack>
        </Paper>
    );
};

export default WorkspacesStep;