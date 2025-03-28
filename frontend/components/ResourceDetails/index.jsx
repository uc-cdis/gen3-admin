import { useState, useEffect } from 'react';
import { Button, Container, Tabs, useMantineColorScheme } from '@mantine/core';

import callK8sApi from '@/lib/k8s';
import { useViewportSize } from '@mantine/hooks';

import Overview from './Overview';
import Logs from './Logs';

import Editor from "@monaco-editor/react";

import YAML from 'yaml';
import Events from './Events';

export default function ResourceDetails({ cluster, namespace, resource, type, tabs, url, columnDefinitions, columnConfig }) {
    const { height, width } = useViewportSize();
    const [activeTab, setActiveTab] = useState('overview');
    const [resourceData, setResourceData] = useState(null);

    const { colorScheme, setColorScheme } = useMantineColorScheme();

    const isDarkMode = colorScheme === 'dark';

    const fetchResource = async () => {
        try {
            console.log("calling k8s api")
            const data = await callK8sApi(url, 'GET', null, null, cluster, null);
            return data
        } catch (error) {
            console.error('Failed to fetch resource:', error);
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
            <h1>{namespace}/{resource}</h1>
            <Container fluid mt={-10} mb={10}>
                <Button > Delete {type} </Button>
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
                        {type === "pod" ? <Logs
                            namespace={namespace}
                            cluster={cluster}
                            pod={resource}
                            containers={resourceData?.spec.containers.map(container => container.name)}
                        /> : null
                        }
                    </Tabs.Panel>
                    <Tabs.Panel value="events">
                        <Events resource={resource} namespace={namespace} cluster={cluster} />
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
            </Container>
        </>
    )
}