import { useState } from 'react';
import { Alert, Anchor, Button, FileInput, Group, List, NumberInput, Stack, Text, TextInput } from '@mantine/core';
import { IconCheck, IconKey, IconX } from '@tabler/icons-react';

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// Connects an environment to its GitOps repo through a GitHub App. The App's
// private key is read from the .pem file in the browser, sent once to the
// API, which stores it in Secrets Manager, and then dropped from memory.
export default function GitOpsConnect({ target, environment, onConnected }) {
  const [repo, setRepo] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [appId, setAppId] = useState('');
  const [installationId, setInstallationId] = useState('');
  const [keyFile, setKeyFile] = useState(null);
  const [privateKey, setPrivateKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  const readKey = async (file) => {
    setKeyFile(file);
    setPrivateKey(file ? await file.text() : '');
  };

  const repoError = repo && !REPO_PATTERN.test(repo) ? 'owner/name' : null;
  const keyError = privateKey && !privateKey.includes('PRIVATE KEY-----') ? 'Not a PEM private key' : null;
  const ready = REPO_PATTERN.test(repo) && appId && installationId && privateKey && !keyError;

  const connect = async () => {
    setConnecting(true);
    setError(null);
    const [owner, name] = repo.split('/');
    try {
      const res = await fetch('/api/gitops/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...target,
          environment,
          owner,
          repo: name,
          base_branch: baseBranch || undefined,
          app_id: Number(appId),
          installation_id: Number(installationId),
          private_key: privateKey,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
      setPrivateKey('');
      setKeyFile(null);
      onConnected?.(data.gitops, data.repo);
    } catch (err) {
      setError(err.message);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Stack gap="sm">
      <Text size="sm">
        Everything {environment} runs is kept in a Git repo and deployed by ArgoCD; secrets stay in
        AWS Secrets Manager. CSOC proposes every change as a pull request through a GitHub App.
      </Text>
      <Text size="xs" c="dimmed" component="div">
        <Anchor href="https://github.com/settings/apps/new" target="_blank" rel="noreferrer" size="xs">Create a GitHub App</Anchor>
        {' '}(or use your organization&apos;s), then:
        <List size="xs" mt={4}>
          <List.Item>Repository permissions: <b>Contents</b> and <b>Pull requests</b>, read &amp; write.</List.Item>
          <List.Item>Install it on the repo, an empty one is fine. The installation ID is the number at the end of the installation&apos;s settings URL.</List.Item>
          <List.Item>Generate a private key and choose the downloaded .pem below.</List.Item>
        </List>
      </Text>

      <Group grow align="flex-start">
        <TextInput label="Repository" placeholder="your-org/csoc-gitops" value={repo}
          onChange={(e) => setRepo(e.target.value.trim())} error={repoError} required />
        <TextInput label="Base branch" placeholder="the repo's default" value={baseBranch}
          onChange={(e) => setBaseBranch(e.target.value.trim())} />
      </Group>
      <Group grow align="flex-start">
        <NumberInput label="App ID" value={appId} onChange={setAppId} min={1} hideControls required />
        <NumberInput label="Installation ID" value={installationId} onChange={setInstallationId} min={1} hideControls required />
      </Group>
      <FileInput
        label="App private key"
        description="Stored in Secrets Manager under gen3-csoc/<name>/github-app; not kept by this page."
        placeholder="app-name.2026-01-01.private-key.pem"
        accept=".pem"
        leftSection={<IconKey size={14} />}
        value={keyFile}
        onChange={readKey}
        error={keyError}
        clearable
        required
      />

      {error && <Alert color="red" icon={<IconX />} title="Could not connect">{error}</Alert>}

      <Group>
        <Button onClick={connect} loading={connecting} disabled={!ready} leftSection={<IconCheck size={16} />}>
          Connect repo
        </Button>
      </Group>
    </Stack>
  );
}
