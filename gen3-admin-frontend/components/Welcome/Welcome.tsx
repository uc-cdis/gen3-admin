import { Title, Text, Anchor, Button } from '@mantine/core';
import classes from './Welcome.module.css';
import { notifications } from '@mantine/notifications';
export function Welcome() {
  return (
    <>
      <Title className={classes.title} ta="center" mt={100}>
        <Text inherit variant="gradient" component="span" gradient={{ from: 'pink', to: 'yellow' }}>
          Gen3
        </Text>
        {' '} Admin
      </Title>

      <Text c="dimmed" ta="center" size="lg" maw={580} mx="auto" mt="xl">
        This Gen3 Admin dashboard provides a comprehensive overview of your deployment's health. Here you can monitor system performance, investigate issues, and trigger maintenance tasks to ensure optimal operation of your Gen3 environment. For more information, please refer to the{' '}
        <Anchor href="#" size="lg">
          documentation
        </Anchor>
      </Text>

    </>
  );
}
