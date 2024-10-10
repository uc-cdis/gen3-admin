import { useMantineColorScheme, SegmentedControl, Group, Center, Box } from '@mantine/core';
import { IconSun, IconMoon } from '@tabler/icons-react';

export function ColorSchemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  return (
    <Group>
      <SegmentedControl
        value={colorScheme}
        onChange={setColorScheme}
        data={[
          {
            value: 'light',
            label: (
              <Center>
                <IconSun size={16} stroke={1.5} />
                <Box ml={10}>Light</Box>
              </Center>
            ),
          },
          {
            value: 'dark',
            label: (
              <Center>
                <IconMoon size={16} stroke={1.5} />
                <Box ml={10}>Dark</Box>
              </Center>
            ),
          },
          {
            value: 'auto',
            label: (
              <Center>
                <IconSun size={16} stroke={1.5} />
                <IconMoon size={16} stroke={1.5} />
                <Box ml={10}>Auto</Box>
              </Center>
            ),
          },
        ]}
      />
    </Group>
  );
}