import { use, useState, useEffect } from 'react';

import callK8sApi from '@/lib/k8s';

export default function Workspaces() {
    const [workspaces, setWorkspaces] = useState([]);

    // Fetch workspaces from API useEffect(() => {

    useEffect(() => {
        // TODO: Get this from the config
        var jupyterNs = 'jupyter-pods-gen3';
        // Get pods in jupyter-pods namespace for current cluster
        callK8sApi('/api/v1/namespaces/' + jupyterNs + '/pods')
            .then(data => {
                console.log(data);
                setWorkspaces(data.items);
            })
            .catch(error => {
                console.error('Error fetching workspaces:', error);
            });
    }, []);

    return (
        <div>
            <h1>Workspaces</h1>


            {/* List of running workspaces */}
            <div>
                {workspaces.length > 0 ? (
                    <>
                        <h2>List of running workspaces</h2>
                        <ul>
                            {workspaces.map(workspace => (
                                <li key={workspace.metadata.name}>{workspace.metadata.name}</li>
                            ))}
                        </ul>
                    </>
                )
                    :
                    <p>No workspaces found.</p>
                }

            </div>

        </div>
    );
}