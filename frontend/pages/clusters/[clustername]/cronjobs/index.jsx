import JobsPage from '@/components/CronJobsPage/Overview';
import { Container, Text, Title } from '@mantine/core';

import { useGlobalState } from '@/contexts/global';

export default function Jobs() {
    const { activeCluster, setActiveCluster, activeGlobalEnv, setActiveGlobalEnv } = useGlobalState();

    // get namespace
    const namespace = activeGlobalEnv.split('/')[1];


    return (
        <>
            <Container fluid my={20}>
                <Title>CronJobs Dashboard</Title>
                <Text>{namespace}</Text>
            </Container>
            <JobsPage namespace={namespace} hideSelect={true} />
        </>
    );
}
