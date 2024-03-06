import { Title, Text, Grid, Button, Progress, Paper, Badge, Divider, Table, HoverCard, Container, Skeleton } from '@mantine/core';
import { useEffect, useState } from 'react';
import Link from 'next/link';

async function fetchK8sVersion() {
    try {
        const response = await fetch('/admin-api-go/cluster/version'); // This endpoint will be redirected by your proxy
        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }
        const data = await response.json();
        let versionString: string = data.major + "." + data.minor
        return versionString;
    } catch (error) {
        console.error('Failed to fetch cluster version:', error);
        return null;
    }
}

export default function Cluster() {
    // const k8s_version = "1.26"
    const [k8sversion, setK8sVersion] = useState("1.27");
    useEffect(() => {
        fetchK8sVersion().then(data => {
            if (data) {
                console.log(data)
                setK8sVersion(data);
            }
            else {
                setK8sVersion("error");
            }
        });
    }, []);
    return (
        <>
            <Skeleton visible={false}>
                <Container fluid my={20}>
                    <Title>Cluster Dashboard</Title>
                </Container>
                <Divider />
                {/* <Container fluid my={20}>
                    <Text>
                        This is the cluster dashboard. It will show the status of the cluster, the number of nodes, and other useful information.
                    </Text>
                    <Button></Button>
                </Container> }
                <Divider /> */}

                <Container fluid my={20}>
                    <Grid>
                        <Grid.Col span={4}>
                            <Paper>
                                Provider: AWS
                            </Paper>
                        </Grid.Col>
                        <Grid.Col span={4}>
                            Kubernetes Version: {k8sversion}
                        </Grid.Col>
                        <Grid.Col span={4}>
                            Created: 2021-08-01
                        </Grid.Col>
                    </Grid>
                </Container>
                <Divider />
                <Container fluid my={20}>
                    <Grid>
                        <Grid.Col span={4}>
                            {/* Total Resources */}
                            <Paper shadow="lg" withBorder p="xl" >
                                <Grid>
                                    <Grid.Col span={4}>
                                        <Text>524</Text>
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                        <Text>Total Resources</Text>
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                        {/* <Anchor href="/deployments">Deployments</Anchor> */}
                                        <Badge>1</Badge>
                                    </Grid.Col>
                                </Grid>
                            </Paper>
                        </Grid.Col>
                        <Grid.Col span={4}>
                            {/* Nodes */}
                            {/* <Anchor component={Link} href="/nodes"> */}
                            <Paper shadow="lg" withBorder p="xl" component={Link} href="/nodes">
                                <Grid>
                                    <Grid.Col span={4}>
                                        <Text>1</Text>
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                        <Text>Node</Text>
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                        <Badge color="red">1 alerts</Badge>
                                    </Grid.Col>
                                </Grid>
                            </Paper>
                            {/* </Anchor> */}
                        </Grid.Col>
                        <Grid.Col span={4}>
                            {/* Nodes */}
                            <Paper shadow="lg" withBorder p="xl" component={Link} href="/deployments">
                                <Grid>
                                    <Grid.Col span={4}>
                                        <Text>13</Text>
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                        <Text>Deployments</Text>
                                    </Grid.Col>
                                    <Grid.Col span={4}>
                                        <Badge>1</Badge>
                                    </Grid.Col>
                                </Grid>
                            </Paper>
                        </Grid.Col>
                    </Grid>
                </Container>
                <Divider />
                <Container fluid my={20}>
                    <Title order={2}>
                        Capacity
                    </Title>
                    <Text>
                    </Text>
                    <Grid>
                        <Grid.Col span={4}>
                            <Paper shadow="lg" withBorder p="xl" >
                            <Title order={4}>Pods</Title>
                            <Text>Used  | 20/110 | 20%</Text>
                            <Progress value={20} label="20 / 100" />
                            </Paper>
                        </Grid.Col>
                        <Grid.Col span={4}>
                            <Paper shadow="lg" withBorder p="xl" >
                            <Text>CPU</Text>
                            <Text> Reserved 1.15 / 8 cores</Text>
                            <Progress value={14.37} label="1.15 / 8 cores" />
                            <Text>Used 0.69 / 8 cores</Text>
                            <Progress value={7.11} color="yellow" label="0.57 / 8 cores" />
                            </Paper>
                        </Grid.Col>
                        <Grid.Col span={4}>
                            <Paper shadow="lg" withBorder p="xl" >
                            <Text>Memory</Text>
                            <Text> Reserved 1.15 / 8 cores</Text>
                            <Progress value={14.37} label="1.15 / 8 cores" />
                            <Text>Used 0.69 / 8 cores</Text>
                            <Progress value={7.11} color="yellow" label="0.57 / 8 cores" />
                            </Paper>
                        </Grid.Col>
                    </Grid>
                </Container>
                <Divider />
                <Container fluid my={20}>
                    <Title order={2}>
                        Events
                    </Title>
                   
                </Container>
            </Skeleton>
        </>
    );
}