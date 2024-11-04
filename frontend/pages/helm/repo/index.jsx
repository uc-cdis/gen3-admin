import { callGoApi } from '@/lib/k8s';


import { useState, useEffect } from 'react';

import { Container, Title, List, Paper, Anchor } from '@mantine/core';

import Link from 'next/link';

export default function Repo() {

    const fetchRepos = async () => {
        try {
            const data = await callGoApi('/helm/repos', 'GET', null, null, null);
            return data;
        } catch (error) {
            console.error('Failed to fetch repos:', error);
            return [];
        }
    };

    const [repos, setRepos] = useState([]);

    useEffect(() => {
        fetchRepos().then((data) => {
            setRepos(data);
        });
    }, []);

    return (
        <>
            <div>
                <Container>
                    <Title order={1} align="center" mb="lg">Helm Repositories</Title>
                    <List spacing="sm" size="lg" center>
                        {repos.map((repo) => (
                            <List.Item key={repo.name}>
                                <Anchor component={Link} href={`/helm/repo/${repo.name}`}>
                                    {repo.name}
                                </Anchor>
                            </List.Item>
                        ))}
                    </List>
                </Container>
            </div>
        </>
    )
}