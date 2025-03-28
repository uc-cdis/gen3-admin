import { Tabs } from '@mantine/core';

import  Logwindow from '@/components/Logs/LogWindowAgent';
// import LogWindow from '../Logs/LogWindow';

// Dynamically import the LogViewer component
// const LogViewer = dynamic(() => import('/components/LogViewer'), { ssr: false });


// import LogMantine from '@/components/Logs/LogMantine';

export default function Logs({pod, namespace, cluster, containers}) {
   
    return (
        <>
            <Tabs.Panel value="logs">
                <Logwindow namespace={namespace} pod={pod} cluster={cluster} containers={containers} />
                {/* <LogMantine namespace={namespace} pod={pod} cluster={cluster} containers={containers} /> */}
            </Tabs.Panel>
        </>
    )
}