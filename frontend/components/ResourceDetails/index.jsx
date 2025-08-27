import { useState, useEffect } from 'react';
import { Button, Center, Container, Group, Loader, Tabs, useMantineColorScheme } from '@mantine/core';

import callK8sApi from '@/lib/k8s';
import { useViewportSize } from '@mantine/hooks';

import Overview from './Overview';
import Logs from './Logs';

import Editor from "@monaco-editor/react";

import YAML from 'yaml';
import Events from './Events';
import { IconCheck, IconRefresh } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';

import { useSession } from 'next-auth/react';

export default function ResourceDetails({ cluster, namespace, resource, type, tabs, url, columnDefinitions, columnConfig }) {
    const { height, width } = useViewportSize();
    const [activeTab, setActiveTab] = useState('overview');
    const [resourceData, setResourceData] = useState(null);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const { data: sessionData } = useSession();
    const accessToken = sessionData?.accessToken;


    const { colorScheme, setColorScheme } = useMantineColorScheme();

    const isDarkMode = colorScheme === 'dark';

    const fetchResource = async () => {
        setIsLoading(true);
        setError(null);

        try {
            const response = await callK8sApi(url, 'GET', null, null, cluster, accessToken);
            setResourceData(response);
            return response;
        } catch (error) {
            console.error('Failed to fetch resource:', error);
            setError(error.message || 'Failed to fetch resource');
            return null;
        } finally {
            setIsLoading(false);
        }
    };


    const deleteResource = async () => {
        try {
            const data = await callK8sApi(url, 'DELETE', null, null, cluster, accessToken);
            fetchResource()

            notifications.show({
                title: 'Resource Deleted',
                message: `${type} was successfully deleted.`,
                color: 'green'
            });

            return data
        } catch (error) {
            notifications.show({
                title: 'Deletion Failed',
                message: error.message || `Failed to delete ${type}.`,
                color: 'red'
            });

            console.error('Failed to delete resource:', error);
        }



    };

    useEffect(() => {
        if (!resource || !namespace || !cluster || !type || !url) {
            console.log("no resource")
            return;
        }
        fetchResource().then((data) => {
            if (data) {
                setResourceData(data);
            }
        });
    }, [type, resource, namespace, cluster]);

    return (
        <>
            <h1>{resource}</h1>
            <h3>namespace: {namespace} </h3>
            <Container fluid mt={-10} mb={10}>
                <Group position="left" spacing="md">
                    <Button onClick={deleteResource}> Delete {type} </Button>
                    <Button
                        onClick={fetchResource}
                        disabled={isLoading}
                    >
                        {isLoading ? 'Loading...' : <IconRefresh />}
                    </Button>
                </Group>

                {isLoading ? (
                    <Center style={{ width: '100%', height: '200px' }}>
                        <Loader size="xl" />
                    </Center>

                ) : error ? (
                    <div className="error">Error: {error}</div>
                ) : resourceData ? (
                    <div>
                        <Tabs value={activeTab} onChange={setActiveTab}>
                            <Tabs.List>
                                {tabs.map(tab => {
                                    const normalizedTab = tab.toLowerCase(); // Normalize all tab values to lowercase

                                    return (
                                        <Tabs.Tab value={normalizedTab} key={tab}>
                                            {tab[0].toUpperCase() + tab.slice(1)}
                                            {/* {tab === "overview" ? <Overview resource={resource} /> : null} */}
                                        </Tabs.Tab>
                                    )
                                })}
                                {/* <Tabs.tab value="overviews">
                        overview
                        </Tabs.tab> */}
                            </Tabs.List>
                            <Tabs.Panel value="overview">
                                <Container fluid mt={10} mb={10}>
                                    <Overview
                                        resource={resourceData}
                                        columns={columnDefinitions}
                                        columnConfig={columnConfig}
                                        type={type}
                                    />
                                </Container>
                            </Tabs.Panel>
                            <Tabs.Panel value="logs">
                                {/* && resourceData?.status.phase == "Running" */}
                                {type === "Pod" ? <Logs
                                    namespace={namespace}
                                    cluster={cluster}
                                    accessToken={accessToken}
                                    pod={resource}
                                    // containers={resourceData?.spec.containers.map(container => container.name) }
                                    containers={[
                                        ...(resourceData?.spec?.containers || []).map(container => container.name),
                                        ...(resourceData?.spec?.initContainers || []).map(container => container.name),
                                    ]}
                                /> : null
                                }
                            </Tabs.Panel>
                            <Tabs.Panel value="events">
                                <Events
                                    resource={resource}
                                    type={type}
                                    accessToken={accessToken}
                                    namespace={namespace}
                                    cluster={cluster}
                                />
                            </Tabs.Panel>
                            <Tabs.Panel value="metrics">
                                metrics
                            </Tabs.Panel>
                            <Tabs.Panel value="yaml">
                                <Container fluid mt={10} mb={10}>
                                    <Editor
                                        dark={true}
                                        className='border rounded-lg h-screen'
                                        value={YAML.stringify(resourceData, null, 2)}
                                        defaultLanguage='yaml'
                                        height={height}
                                        theme={isDarkMode ? 'vs-dark' : 'light'} // Dynamically set theme based on color scheme
                                        options={{
                                            minimap: {
                                                enabled: true,
                                            },
                                        }}
                                    />
                                </Container>
                            </Tabs.Panel>
                            <Tabs.Panel value="data">
                                data
                            </Tabs.Panel>
                        </Tabs>
                    </div>
                ) : (
                    <div>No data available. Click "Fetch" to load data.</div>
                )}




            </Container>
        </>
    )
}
