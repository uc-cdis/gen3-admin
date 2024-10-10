import { useState, useEffect } from 'react';
import { Container, Tabs } from '@mantine/core';

import callK8sApi from '@/lib/k8s';


import  Overview from './Overview';
import Logs from './Logs';

export default function ResourceDetails({ cluster, namespace, resource, type, tabs, url }) {

    const [activeTab, setActiveTab] = useState('overview');
    const [resourceData, setResourceData] = useState(null);

    console.log("type", type)
    console.log("resource", resource)  
    console.log("namespace", namespace)
    console.log("cluster", cluster)

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
                <Tabs value={activeTab} onChange={setActiveTab}>
                    <Tabs.List>

                        {tabs.map(tab => (
                            <Tabs.Tab value={tab} key={tab}>
                                {tab[0].toUpperCase() + tab.slice(1)}
                                {/* {tab === "overview" ? <Overview resource={resource} /> : null} */}
                            </Tabs.Tab>
                        ))}
                        {/* <Tabs.tab value="overviews">
                        overview
                        </Tabs.tab> */}
                    </Tabs.List>
                    <Tabs.Panel value="overview">
                        <Overview resource={resourceData} />
                    </Tabs.Panel>
                    <Tabs.Panel value="logs">
                        <Logs />
                    </Tabs.Panel>
                    <Tabs.Panel value="events">
                        events
                    </Tabs.Panel>
                    <Tabs.Panel value="metrics">
                        metrics
                    </Tabs.Panel>
                    <Tabs.Panel value="yaml">
                        yaml
                    </Tabs.Panel>
                    <Tabs.Panel value="data">
                        data
                    </Tabs.Panel>
                </Tabs>
            </Container>
        </>
    )
}