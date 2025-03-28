import { useState, useEffect, useRef } from "react";

import { formatDistanceToNow } from 'date-fns';
import Editor from "@monaco-editor/react";
import { Button, Container, TextInput, Select, Group, ActionIcon, Card, Checkbox } from "@mantine/core";

import { useViewportSize } from "@mantine/hooks";
import { IconRefresh } from "@tabler/icons-react";

import stripAnsi from 'strip-ansi';

export default function DockerRunner() {
    const [executionId, setExecutionId] = useState(null);
    const [logs, setLogs] = useState("");
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(false);
    const [cowsay, setCowsay] = useState("hello world from CSOC!")

    const [destroy, setDestroy] = useState(false);
    const [deploy, setDeploy] = useState(false);
    const [plan, setPlan] = useState(true)
    const [cloud, setCloud] = useState("aws")

    const [executions, setExecutions] = useState([]);

    const options = [
        { value: 'ctds_aws_terraform', label: 'CTDS - AWS Terraform', container: 'gen3tf' },
        { value: 'au_biocommons_aws_cdk', label: 'AU BioCommons - AWS CDK', container: 'gen3cdk' },
        { value: 'krumwarer_gcp_terraform', label: 'Krumware - Google Cloud Terraform', container: 'krumwarer_gcp_terraform-container' },
        { value: 'community_azure_terraform', label: 'Community - Azure Terraform', container: 'community_azure_terraform-container' },
    ];

    const [selectedValue, setSelectedValue] = useState(null);
    const selectedOption = options.find(item => item.value === selectedValue) || null;



    const editorRef = useRef(null);

    const { height, width } = useViewportSize();


    const executeCommand = async () => {
        setLogs("Starting execution...\n");
        setExecutionId(null);
        setStatus(null);
        setLoading(true);

        const container = selectedOption.container;

        const envs = {
            "DESTROY": destroy,
            "DEPLOY": deploy,
            "CLOUD": cloud,
            "PLAN": plan,
        };

        // Create environment variable arguments for Docker
        const envArgs = Object.entries(envs)
            .map(([key, value]) => `-e ${key}=${value}`)
            .join(' ');

        const args = [
            "-c",
            `docker volume create ${container} && docker run ${envArgs} -v ${container}:/workspace/.terraform -v /Users/qureshi/.aws:/root/.aws ${container}`
        ];

        try {
            const response = await fetch("/api/runner/execute", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    cmd: "sh",
                    args: args,
                })
            });

            const data = await response.json();
            setExecutionId(data.id);
            setLogs((prev) => prev + "Execution started with ID: " + data.id + "\n");
            pollExecutionStatus(data.id);
        } catch (error) {
            setLogs((prev) => prev + "Error starting execution: " + error.message + "\n");
            setLoading(false);
        }
    };


    const pollExecutionStatus = async (execId) => {
        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/runner/executions/${execId}`);
                const result = await res.json();
                if (result?.output && Array.isArray(result.output)) {
                    const strippedOutput = result.output.map(stripAnsi).join("\n");
                    setLogs((prev) => strippedOutput + "\n");
                    jumpToBottom();
                } else {
                    console.error("Invalid output format:", result);
                }
                setStatus(result.status);

                if (result.status === "complete" || result.status === "error") {
                    clearInterval(interval);
                    setLogs((prev) => prev + `Execution ${result.status}\n`);
                    setLoading(false);
                }
            } catch (err) {
                setLogs((prev) => prev + "Error fetching execution status: " + err.message + "\n");
                clearInterval(interval);
                setLoading(false);
            }
        }, 1000);
    };

    useEffect(() => {
        fetchExecutions();
    }, []);

    const fetchExecutions = async () => {
        try {
            const response = await fetch("/api/runner/executions");
            const data = await response.json();
            setExecutions(data);
        } catch (error) {
            console.error("Error fetching executions:", error);
        }
    };

    const handleExecutionSelect = async (id) => {

        // find execution by id
        const execution = executions.find((exec) => exec.id === id);
        console.log(execution)
        if (!execution) {
            setLogs("Execution not found");
            return;
        }
        try {
            if (execution?.output && Array.isArray(execution.output)) {
                const strippedOutput = execution.output.map(stripAnsi).join("\n");
                setLogs((prev) => prev + strippedOutput + "\n");
            } else {
                console.error("Invalid output format:", result);
            }
        } catch (error) {
            setLogs("Error fetching logs for execution: " + error.message);
        }
    };

    // Function to scroll the editor to the bottom
    const jumpToBottom = () => {
        if (editorRef.current) {
            const editor = editorRef.current;
            const model = editor.getModel();
            if (model) {
                const lineCount = model.getLineCount();
                editor.revealLine(lineCount);
            }
        }
    };

    // Auto-scroll to bottom whenever logs update
    useEffect(() => {
        if (logs.length > 0) {
            jumpToBottom();
        }
    }, [logs]);

    // Capture the editor instance on mount
    const handleEditorDidMount = (editor) => {
        editorRef.current = editor;
    };



    return (
        <div className="p-6 max-w-xl mx-auto bg-white rounded-lg shadow-md">
            <h1 className="text-xl font-bold">IAC plugin demo</h1>
            <div className="mt-4">
                <Card shadow="sm" padding="lg" radius="md" withBorder>
                    <Group spacing="xs" align="center">
                        <Select
                            style={{ flex: 1 }}
                            placeholder="Select previous execution"
                            data={executions.map((exec) => ({
                                value: exec.id,
                                // label: `${exec.command} \t- ${exec.id} \t- ${time.now() - exec.start_time} \t- ${exec.status}`,
                                label: `${exec.command} \t- ${exec.id} \t- ${exec.status} \t\t- ${formatDistanceToNow(new Date(exec.start_time), { addSuffix: true })}`,
                            }))}
                            searchable
                            onChange={handleExecutionSelect}
                        />
                        <ActionIcon variant="light" onClick={fetchExecutions}>
                            <IconRefresh size={18} />
                        </ActionIcon>
                    </Group>
                </Card>
            </div>

            <Card shadow="sm" padding="lg" mt={20} radius="md" withBorder>
                <Group align="center" spacing="md">
                    <Checkbox
                        label="Destroy"
                        checked={destroy}
                        onChange={(event) => setDestroy(event.currentTarget.checked)}
                        size="md"
                    />

                    <Checkbox
                        label="Deploy"
                        checked={deploy}
                        onChange={(event) => setDeploy(event.currentTarget.checked)}
                        size="md"
                    />

                    <Checkbox
                        label="Plan"
                        checked={plan}
                        onChange={(event) => setPlan(event.currentTarget.checked)}
                        size="md"
                    />
                    <Select
                        label="Select an Option"
                        placeholder="Choose a project"
                        style={{ flex: 1 }}
                        data={options}
                        value={selectedValue}
                        onChange={setSelectedValue}
                    />

                    <Button onClick={executeCommand} size="md" variant="filled" color="blue">
                        Deploy
                    </Button>
                </Group>
            </Card>
            <Container fluid mt={20}>
                <div className="mt-20 p-4 bg-gray-100 rounded h-48 overflow-auto text-sm border border-gray-300">
                    <Editor
                        height={height - 200}
                        defaultLanguage="plaintext"
                        value={logs}

                        options={{
                            readOnly: true,
                            minimap: { enabled: false },
                            lineNumbers: "off",
                            wordWrap: "on",
                            scrollBeyondLastLine: false,
                        }
                        }
                        theme="vs-dark"
                        onMount={handleEditorDidMount}
                    />
                </div>
            </Container>
        </div >
    );
}