import React, { useState, useContext } from 'react';
import { Title, Box, Button, Container, Text, ActionIcon, Icon, TextInput, Group, FileInput, Card } from '@mantine/core';
import AuthContext from '@/contexts/auth';

import { notifications } from '@mantine/notifications';
import { IconX } from '@tabler/icons-react'; // Import from @tabler/icons-react

import { useSession, signIn, signOut } from "next-auth/react"


function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('Error parsing JWT:', error);
    return null;
  }
}

export default function Login() {
  // Attempt at next-auth
  const { data: session } = useSession()

  // if (session) {
  //   return (
  //     <>
  //       Signed in as {session.user.email} <br />
  //       <button onClick={() => signOut()}>Sign out</button>
  //     </>
  //   )
  // }
  // return (
  //   <>
  //     Not signed in <br />
  //     <button onClick={() => signIn()}>Sign in</button>
  //   </>
  // )





  const { login } = useContext(AuthContext);
  const [apiKeyFile, setApiKeyFile] = useState(null);
  const [apiKeyText, setApiKeyText] = useState('');
  const [apiKeyData, setApiKeyData] = useState(null);
  const [extractedUrl, setExtractedUrl] = useState('');
  const [error, setError] = useState('');

  const processApiKey = (data) => {
    if (data && data.api_key) {
      const parsedToken = parseJwt(data.api_key);
      if (parsedToken && parsedToken.iss) {
        setExtractedUrl(parsedToken.iss);
        setApiKeyData(data);
        setError('');
      } else {
        setError('Invalid API key format. Unable to extract URL.');
        setApiKeyData(null);
        setExtractedUrl('');
      }
    } else {
      setError('Invalid API key format. Missing api_key field.');
      setApiKeyData(null);
      setExtractedUrl('');
    }
  };

  const handleFileChange = (file) => {
    if (file) {
      const fileReader = new FileReader();
      fileReader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          processApiKey(data);
        } catch (error) {
          setError('Invalid API key file format. Please upload a valid JSON file.');
          setApiKeyData(null);
          setExtractedUrl('');
        }
      };
      fileReader.readAsText(file);
      setApiKeyFile(file);
    }
  };

  const handleClearData = () => {
    setApiKeyData(null);
    setApiKeyFile(null)
    setExtractedUrl('');
    setError('')
  }

  const handleApiKeyInputChange = (event) => {
    setApiKeyText(event.target.value);
  };

  const handleManualSubmit = () => {
    try {
      const data = JSON.parse(apiKeyText);
      processApiKey(data);
    } catch (error) {
      setError('Invalid API key format. Please enter a valid JSON string.');
      setApiKeyData(null);
      setExtractedUrl('');
    }
  };

  const handleLogin = async () => {
    if (apiKeyData) {
      try {
        console.log("Attempting login...");
        await login(apiKeyData);
        console.log("Login successful"); // This line shouldn't execute if there's an error
      } catch (error) {
        console.log("Error: ", error)
        notifications.show({
          title: 'Error',
          message: `Failed to login: ${error.message}`,
          color: 'red',
        });
      }
    } else {
      setError('Please load a valid API key before logging in.');
    }
  };

  return (
    <Container size="sm">
      <Box sx={{ maxWidth: 400 }} mx="auto">
        <Title order={2} align="center" mb="xl">Gen3 CSOC Login</Title>

        <FileInput
          label="Upload Gen3 API Key File"
          placeholder="Select a JSON file"
          accept=".json"
          onChange={handleFileChange}
          value={apiKeyFile}
          error={error}
          mb="md"
        />

        {!extractedUrl && (
          <>
            <Text size="sm" mb="xs">Or manually enter your API key:</Text>
            <TextInput
              label="API Key (JSON format)"
              placeholder="Enter your API key"
              value={apiKeyText}
              onChange={handleApiKeyInputChange}
              error={error}
              mb="md"
            />
            <Button onClick={handleManualSubmit} fullWidth mb="md">
              Load Manual Input
            </Button>
          </>
        )}

        {extractedUrl && (
          <Card shadow="sm" p="lg" radius="md" mb="md">
            <Card.Section withBorder inheritPadding py="xs">
              <Group justify="space-between">
                <Text fw={700}>Extracted URL:</Text>
                <ActionIcon variant="subtle" onClick={handleClearData} aria-label="Clear data">
                  <IconX size={18} /> {/* Use Mantine's Icon component with Tabler's X icon */}
                </ActionIcon>

              </Group>
            </Card.Section>
            <Text size="sm" my="sm">
              {extractedUrl}
            </Text>
            <Button onClick={handleLogin} fullWidth>
              Confirm Login
            </Button>
          </Card>
        )}

        {error && <Text color="red" size="sm" mt="xs">{error}</Text>}
      </Box>
    </Container>
  );
}