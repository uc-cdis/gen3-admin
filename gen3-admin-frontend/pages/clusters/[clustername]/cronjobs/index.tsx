import  JobsPage from '@/components/CronJobsPage/Overview';
import { Container, Title } from '@mantine/core';

export default function Jobs() {
    return (
        <>
        <Container fluid my={20}>
                <Title>CronJobs Dashboard</Title>
            </Container>
            <JobsPage />
        </>
    );
}
