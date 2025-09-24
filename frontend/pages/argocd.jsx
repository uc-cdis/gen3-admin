import { Container, Title, Text, Button, Alert, LoadingOverlay, Modal, Group } from "@mantine/core";
import { useState, useEffect, useRef } from "react";
import { IconGitBranch, IconAlertCircle, IconExternalLink } from '@tabler/icons-react';
import { useGlobalState } from '@/contexts/global';
import { useSession } from "next-auth/react";
import Link from "next/link";

export default function ArgoCD() {
    // Get current context (environment, cluster, namespace, etc.)
    const { activeGlobalEnv } = useGlobalState();
    const { data: sessionData } = useSession();
    const accessToken = sessionData?.accessToken;

    // Parse the activeGlobalEnv to get agent and namespace
    let [env, namespace] = activeGlobalEnv ? activeGlobalEnv.split("/") : [null, null];
    const clusterName = env;

    const [modalOpened, setModalOpened] = useState(false);
    const [argocdStatus, setArgocdStatus] = useState(null); // null, 'loading', 'running', 'error'
    const [argocdError, setArgocdError] = useState(null);
    const [argocdUrl, setArgocdUrl] = useState(null);

    // Refs for DOM manipulation
    const iframeRef = useRef(null);
    const normalContainerRef = useRef(null);
    const modalContainerRef = useRef(null);

    // Effect to move iframe between containers
    useEffect(() => {
        if (iframeRef.current && normalContainerRef.current && modalContainerRef.current) {
            if (modalOpened) {
                // Move iframe to modal container
                modalContainerRef.current.appendChild(iframeRef.current);
                // Update styles for fullscreen
                iframeRef.current.style.height = 'calc(100vh - 60px)';
                iframeRef.current.style.border = 'none';
                iframeRef.current.style.borderRadius = '0';
            } else {
                // Move iframe back to normal container
                normalContainerRef.current.appendChild(iframeRef.current);
                // Update styles for normal view
                iframeRef.current.style.height = '800px';
                iframeRef.current.style.border = '1px solid #e0e0e0';
                iframeRef.current.style.borderRadius = '8px';
            }
        }
    }, [modalOpened]);

    // Function to check if ArgoCD proxy endpoint is ready
    const checkArgocdHealth = async () => {
        // Assuming ArgoCD server service is named 'argocd-server' in 'argocd' namespace
        const proxyUrl = `/api/k8s/${clusterName}/proxy/api/v1/namespaces/argocd/services/argocd-server:80/proxy/`;

        try {
            const response = await fetch(proxyUrl, {
                method: 'GET',
                cache: 'no-cache'
            });
            return response.ok;
        } catch (error) {
            console.log('ArgoCD proxy health check failed:', error);
            return false;
        }
    };

    // Function to initialize ArgoCD connection
    const initializeArgocd = async () => {
        if (!clusterName || !accessToken) return;

        setArgocdStatus('loading');
        setArgocdError(null);

        try {
            // Check if ArgoCD proxy is accessible
            const isProxyHealthy = await checkArgocdHealth();

            if (isProxyHealthy) {
                // Set up the iframe URL
                const proxyUrl = `/api/k8s/${clusterName}/proxy/api/v1/namespaces/argocd/services/argocd-server:80/proxy/`;
                setArgocdUrl(proxyUrl);
                setArgocdStatus('running');
            } else {
                setArgocdStatus('error');
                setArgocdError('ArgoCD service is not accessible in the argocd namespace');
            }
        } catch (error) {
            console.error('Error connecting to ArgoCD:', error);
            setArgocdStatus('error');
            setArgocdError('Failed to connect to ArgoCD service');
        }
    };

    // Reset state when environment changes
    useEffect(() => {
        setArgocdStatus(null);
        setArgocdError(null);
        setArgocdUrl(null);
        setModalOpened(false);
    }, [activeGlobalEnv]);

    // Auto-initialize when we have the required context
    useEffect(() => {
        if (activeGlobalEnv && accessToken && clusterName) {
            initializeArgocd();
        }
    }, [activeGlobalEnv, accessToken, clusterName]);

    return (
        <>
            <Container fluid my={20}>
                <Title>ArgoCD Dashboard</Title>
                <Text mt="md" size="md">
                    Access ArgoCD for GitOps management in the selected cluster.
                </Text>
            </Container>

            {!activeGlobalEnv ? (
                <Container fluid my={20}>
                    <Text c="dimmed">No environment selected. Please select an environment to access ArgoCD.</Text>
                </Container>
            ) : (
                <Container fluid my={20}>
                    {/* Connection Status */}
                    {argocdStatus === 'loading' && (
                        <Alert icon={<LoadingOverlay visible />} title="Connecting to ArgoCD" color="blue" mt="md">
                            Establishing connection to ArgoCD in the argocd namespace...
                        </Alert>
                    )}

                    {argocdStatus === 'error' && (
                        <Alert icon={<IconAlertCircle size={16} />} title="Connection Error" color="red" mt="md">
                            {argocdError}
                            <Button
                                size="xs"
                                variant="light"
                                color="red"
                                mt="xs"
                                onClick={initializeArgocd}
                            >
                                Retry Connection
                            </Button>
                        </Alert>
                    )}

                    {argocdStatus === 'running' && (
                        <Group justify="space-between" mb="md">
                            <Group>
                                <Button
                                    leftSection={<IconGitBranch size={16} />}
                                    onClick={() => setModalOpened(true)}
                                >
                                    Open Fullscreen
                                </Button>
                                <Link href={argocdUrl} target="_blank">
                                    <Button variant="light" leftSection={<IconExternalLink size={16} />}>
                                        Direct Link
                                    </Button>
                                </Link>
                            </Group>
                            <Text size="sm" c="dimmed">
                                Cluster: <strong>{clusterName}</strong> | Namespace: <strong>argocd</strong>
                            </Text>
                        </Group>
                    )}

                    {/* ArgoCD iframe */}
                    {argocdStatus === 'running' && argocdUrl && (
                        <div style={{ position: 'relative' }}>
                            <div ref={normalContainerRef}>
                                <iframe
                                    ref={iframeRef}
                                    src={argocdUrl}
                                    style={{
                                        width: '100%',
                                        height: '800px',
                                        border: '1px solid #e0e0e0',
                                        borderRadius: '8px'
                                    }}
                                    title="ArgoCD Dashboard"
                                />
                            </div>
                        </div>
                    )}
                </Container>
            )}

            {/* Fullscreen Modal */}
            <Modal
                opened={modalOpened}
                onClose={() => setModalOpened(false)}
                title="ArgoCD Dashboard"
                size="100%"
                padding={0}
                styles={{
                    modal: {
                        height: '100vh',
                    },
                    body: {
                        height: 'calc(100vh - 60px)',
                        padding: 0,
                    }
                }}
            >
                <div ref={modalContainerRef} style={{ height: '100%' }}>
                    {/* Iframe will be moved here when modal is opened */}
                </div>
            </Modal>
        </>
    );
}
