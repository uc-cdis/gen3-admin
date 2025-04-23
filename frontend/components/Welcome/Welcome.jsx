import { Title, Text, Anchor, Button, Image, Loader, Container, Divider, Group, Card } from '@mantine/core';
import Link from 'next/link';

import { useEffect, useState } from 'react'

import classes from './Welcome.module.css';
import { notifications } from '@mantine/notifications';

import { callGoApi } from '@/lib/k8s';

import { useSession } from "next-auth/react"

import ImageComp from 'next/image'
import { useGlobalState } from '@/contexts/global';

export function Welcome() {
  const { data: sessionData } = useSession();
  const accessToken = sessionData?.accessToken;

  const { activeCluster, setActiveCluster } = useGlobalState("null");
  const [clusters, setClusters] = useState([])
  const [loading, setLoading] = useState(false)

  const fetchClusters = async () => {
    setLoading(true)
    try {
      const data = await callGoApi('/agents', 'GET', null, null, accessToken)
      // Only show clusters that are active
      // setClusters(data.filter(cluster => cluster.connected))
      const connectedClusterNames = data
        .filter(cluster => cluster.connected)
        .map(cluster => cluster.name);

      console.log(connectedClusterNames);
      setClusters(connectedClusterNames)
      setLoading(false)
    } catch (error) {
      console.error('Failed to fetch clusters:', error);
      setLoading(false)
    }
  };

  useEffect(() => {
    fetchClusters(accessToken)
  }, []);

  // Add styles for the Card hover effect
  const cardStyles = {
    transition: 'border 0.3s ease',
    ':hover': {
      border: '2px solid #000',
    },
  };


  return (
    <>
      <Title className={classes.title} ta="center" mt={100}>
        <Text inherit variant="gradient" component="span" gradient={{ from: 'pink', to: 'yellow' }}>
          Gen3
        </Text>
        {' '} CSOC
      </Title>


      {clusters.length == 0 ? (
        <>
          {/* <Text c="dimmed" ta="center" size="lg" maw={580} mx="auto" mt="xl">
            This Gen3 CSOC (commons services operations center) provides a comprehensive overview of your deployment's health. Here you can monitor system performance, investigate issues, and trigger maintenance tasks to ensure optimal operation of your Gen3 environment. For more information, please refer to the{' '}
            <Anchor href="#" size="lg">
              documentation
            </Anchor>
          </Text> */}

          <Container align="center">


            <Text c="dimmed" ta="center" size="lg" maw={580} mx="auto" mt="xl">
              To get started with, select which cloud provider you would like to deploy Gen3 CSOC to?

              This deployment will be your centralized management hub of all your Gen3 deployments.

            </Text>

            <Group my="xl" grow wrap="nowrap" align="center">

              <Card shadow="lg" padding="lg" radius="md" className={classes.element} style={{ cursor: 'pointer' }}>
                <Card.Section pt="md" pb="md">
                  <Image
                    height={100}
                    my="md"
                    mx="auto"
                    fit="contain"
                    src="/images/logos/aws.png" className={`${classes.shadow} mx-auto my-4}`}
                  />
                </Card.Section>

                <Text> Deploy a production ready AWS infrastructure, thanks to <Anchor href="https://www.biocommons.org.au">Australian Biocommons</Anchor> and their <Anchor href="https://github.com/AustralianBioCommons/gen3-cdk-config-manager">CDK code</Anchor> </Text>
              </Card>

              <Card shadow="lg" padding="lg" radius="md" className={classes.element} style={{ cursor: 'pointer' }}>
                <Card.Section pt="md" pb="md">
                  <Image
                    height={100}
                    fit="contain"
                    my="md"
                    mx="auto"
                    src="/images/logos/azure.png" className={classes.shadow} />
                </Card.Section>
                <Text>
                  Deploy a production-ready Microsoft Azure infrastructure, courtesy of <Anchor>Microsoft</Anchor>
                </Text>
              </Card>

              <Card shadow="lg" padding="lg" radius="md" className={classes.element} style={{ cursor: 'pointer' }}>
                <Card.Section pt="md" pb="md">
                  <Image height={100} fit="contain" src="/images/logos/gcp.png"
                    my="md"
                    mx="auto"
                    className={classes.shadow} />
                </Card.Section>
                <Text>
                  Deploy a production-optimized GCP infrastructure, engineered by <Anchor>Krum.io</Anchor>
                </Text>
              </Card>
            </Group>

            <Divider my="xl" label="Already have a kubernetes cluster?" />

            <Button component={Link} href="/clusters?action=import">Import Existing Cluster</Button>
          </Container>
        </>
      ) : (
        <>
          <Text c="dimmed" ta="center" size="lg" maw={580} mx="auto" mt="xl">
            Welcome to the Gen3 CSOC dashboard for cluster <b>{activeCluster}</b>!

            <br />
            <br />
            <Anchor component={Link} href="/projects">
              Manage existing deployments
            </Anchor>{' '}
            or{' '}
            <Anchor component={Link} href="/helm/gen3/deploy">
              deploy a new Gen3 to this cluster
            </Anchor>.
            <br />
            <br />
            If you want to import new clusters{' '}
            <Anchor component={Link} href="/clusters?import=true">
              click here
            </Anchor>.

          </Text>

        </>
      )}

    </>
  );
}
