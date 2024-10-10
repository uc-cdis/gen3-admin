import { useEffect, useState } from 'react';
import { Card, Table, Badge, Text, Grid, Title, Container, Pill, Code } from '@mantine/core';
import { fetchCronJobs, getJobInstances } from '../CronJobsPage/functions';
import { set } from 'date-fns';

export default function CronJobDetails({ name }) {
    const [cronJob, setCronJob] = useState(null);
    const [jobInstances, setJobInstances] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchCronJobs()
            .then(data => {
                const job = data.find(job => job.metadata.name === name);
                setCronJob(job);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setError(err);
                setLoading(false);
            });
    }, [name]);


    useEffect(() => {
        getJobInstances(name)
            .then(data => {
                setJobInstances(data);
            })
            .catch(err => {
                console.error(err);
            });
    }, [name]);

    if (loading) return <p>Loading...</p>;
    if (error) return <p>Error loading data!</p>;
    if (!cronJob) return <p>No cronjob found with the name: {name}</p>;

    return (
        <Container size="xl">
            <Title order={4} my="lg">CronJob Details</Title>
            <Title order={5} my="md">Name</Title>
            <Text>{cronJob.metadata.name}</Text>

            <Title order={5} my="md">Namespace</Title>
            <Text>{cronJob.metadata.namespace}</Text>

            <Title order={5} my="md">Creation</Title>
            <Text>Creation: {new Date(cronJob.metadata.creationTimestamp).toLocaleString()}</Text>

            <Title order={5} my="md">Schedule </Title>
            <Text>{cronJob.spec.schedule}</Text>

            <Title order={5} my="md">Annotations</Title>
            <Grid>
                {Object.entries(cronJob.metadata.annotations).map(([key, value], index) => (
                    <Grid.Col span={6} key={index}>
                        <Code autoContrast={true}>{key}: {value}</Code>
                    </Grid.Col>
                ))}
            </Grid>
            <Title order={5} my="md">Labels</Title>
            <Grid>
                {Object.entries(cronJob.metadata.labels).map(([key, value], index) => (
                    <Grid.Col span={6} key={index}>
                        <Code>{key}: {value}</Code>
                    </Grid.Col>
                ))}
            </Grid>

            <Title order={5} my="md">Jobs</Title>
            <Table>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Completions</th>
                        <th>Conditions</th>
                    </tr>
                </thead>
                <tbody>
                    {jobInstances.map(job => {
                        // Find the condition that indicates the job has failed or succeeded.
                        const failureCondition = job.status.conditions?.find(condition => condition.type === 'Failed');
                        const successCondition = job.status.conditions?.find(condition => condition.type === 'Complete');

                        // Determine the badge color based on the job status.
                        let badgeColor = 'green'; // Default to green for active or succeeded jobs.
                        let conditionText = 'Active'; // Default text if no conditions are met.

                        if (failureCondition && failureCondition.status === 'True') {
                            badgeColor = 'red';
                            conditionText = 'Failed';
                        } else if (successCondition && successCondition.status === 'True') {
                            conditionText = 'Complete';
                        }

                        return (
                            <tr key={job.metadata.name}>
                                <td>{job.metadata.name}</td>
                                <td>{job.status.completions || 'N/A'}</td>
                                <td>
                                    <Badge color={badgeColor}>
                                        {conditionText}
                                    </Badge>
                                </td>
                            </tr>
                        );
                    })}

                </tbody>
            </Table>

            <Title order={5} my="md">Events</Title>
            {cronJob?.events?.length > 0 ? (
                <Table>
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>Message</th>
                        </tr>
                    </thead>
                    <tbody>
                        {cronJob.events.map((event, index) => (
                            <tr key={index}>
                                <td>{new Date(event.time).toLocaleString()}</td>
                                <td>{event.message}</td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            ) : <Text>No events to show.</Text>}
        </Container>
    );
}
