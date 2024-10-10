import { useParams } from 'next/navigation';

import { callGoApi } from '@/lib/k8s';

import { useState, useEffect } from 'react';

import { Container, Loader, Title, SimpleGrid, Text, Group, Card, Accordion, Button, Divider } from '@mantine/core';

import { IconMedicalCrossFilled } from '@tabler/icons-react';
export default function Repo() {

    const [latestCharts, setLatestCharts] = useState([]);
    const [olderCharts, setOlderCharts] = useState([]);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const repo = useParams()?.repo;


    const fetchCharts = async () => {
        setLoading(true);
        console.log("fetching charts for repo", repo)
        try {
            const data = await callGoApi(`/helm/charts/${repo}`, 'GET', null, null, null);

            // Get all unique chart names
            const uniqueChartNames = [...new Set(data.map(chart => chart.name))];

            const latestChartsArray = [];
            const olderChartsArray = [];

            // Group charts by name and version
            uniqueChartNames.forEach(name => {
                const chartsByName = data.filter(chart => chart.name === name);

                // Sort by version, assuming semver format, descending (latest first)
                chartsByName.sort((a, b) => semverCompare(b.version, a.version));

                // Push the latest version to latestCharts and the rest to olderCharts
                latestChartsArray.push(chartsByName[0]); // Latest version
                olderChartsArray.push({ name: name, versions: chartsByName.slice(1) }); // Older versions
            });

            setLatestCharts(latestChartsArray);
            setOlderCharts(olderChartsArray);
            setLoading(false);
        } catch (error) {
            setLoading(false);
            setError(error);
            console.error('Failed to fetch charts:', error);
            return [];
        }
    };

    // Semver comparison helper function
    const semverCompare = (a, b) => {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            if ((pa[i] || 0) > (pb[i] || 0)) return 1;
            if ((pa[i] || 0) < (pb[i] || 0)) return -1;
        }
        return 0;
    };


    useEffect(() => {
        if (!repo) {
            return;
        }
        console.log("fetching charts for repo", repo)
        fetchCharts()
    }, [repo]);


    return (
        <>
            <div>
                <h1>Repo {repo}</h1>

                <Title order={2}>Helm Charts for {repo} repository</Title>
                {error && <Text c="red">{error.message}</Text>}


                {loading ? <Container > <Loader type="bars" /> </Container>:
                (<SimpleGrid cols={3} spacing="lg">
                    {latestCharts.map((chart) => (
                        <Card key={chart.name} shadow="sm" p="lg" radius="md" withBorder>
                            <Group position="apart" style={{ marginBottom: 5 }}>
                                <Text weight={500}>{chart.name}</Text>
                                <Text size="xs" color="dimmed">Latest Version: {chart.version}</Text>
                            </Group>

                            <Group position="apart">
                                {chart.icon ?
                                    <img src={chart.icon} height={50} radius="md" />
                                    : <IconMedicalCrossFilled style={{ height: 50 }} />}
                                <Text size="sm" color="dimmed" style={{ marginBottom: 10 }}>
                                    {chart.description}
                                </Text>
                            </Group>

                            <Divider my="sm" />

                            <Group position="apart">
                                <Text size="xs" color="dimmed">App Version: {chart.appVersion}</Text>
                            </Group>

                            <Group position="apart">
                                <Text size="xs" color="dimmed">Release Date: {chart.releaseDate}</Text>
                                <Button variant="light" size="xs" color="blue">
                                    More Details
                                </Button>
                                <Button variant="light" size="xs" color="green">
                                    Install
                                </Button>
                            </Group>
                            {/* Render accordion for older versions */}
                            <OlderVersionsAccordion name={chart.name} versions={olderCharts.find(oc => oc.name === chart.name)?.versions || []} />
                        </Card>

                    ))}
                </SimpleGrid>)
                }

            </div>
        </>
    )
}

// Accordion component for older versions
const OlderVersionsAccordion = ({ name, versions }) => {
    if (versions.length === 0) {
        return null; // No older versions, don't render accordion
    }

    return (
        <Accordion
            variant="separated"
            // disableIconRotation
            // defaultValue="older-versions"
            style={{ marginTop: 15 }}
        >
            <Accordion.Item value="older-versions">
                <Accordion.Control>Show Older Versions</Accordion.Control>
                <Accordion.Panel>
                    {versions.map((version, index) => (
                        <Card key={index} shadow="sm" p="md" radius="sm" withBorder style={{ marginBottom: 10 }}>
                            <Text weight={500}>Version: {version.version}</Text>
                            <Text size="xs" color="dimmed">App Version: {version.appVersion}</Text>
                            <Text size="xs" color="dimmed" style={{ marginBottom: 10 }}>{version.description}</Text>
                        </Card>
                    ))}
                </Accordion.Panel>
            </Accordion.Item>
        </Accordion>
    );
};
