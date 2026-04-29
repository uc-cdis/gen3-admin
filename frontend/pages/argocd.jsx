import { Center, Loader, Stack, Text } from '@mantine/core';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

export default function ArgoCD() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/argocd/applications');
  }, [router]);

  return (
    <Center py="xl">
      <Stack align="center" gap="xs">
        <Loader />
        <Text c="dimmed">Opening ArgoCD applications...</Text>
      </Stack>
    </Center>
  );
}
