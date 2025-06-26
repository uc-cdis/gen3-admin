import { Container } from "@mantine/core";
import { useRouter } from 'next/router';

import EnvironmentDashboardComp from '@/components/EnvironmentDashboard';
import { useGlobalState } from '@/contexts/global';

export default function EnvironmentDashboard () {
  const router = useRouter();
  const { env, namespace } = router.query;
  const { activeGlobalEnv } = useGlobalState();
  return(
    <Container fluid>
      <EnvironmentDashboardComp env={activeGlobalEnv.split("/")[0]} namespace={activeGlobalEnv.split("/")[1]}/>
    </Container>
  )
}