import { useState, useEffect } from 'react';
import { TextInput, Stack, Paper, Divider, Group, Switch, Collapse, Text, Tooltip, Select, ActionIcon } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';

const HostnameStep = ({ form, certs, fetchCerts }) => {
  const [wildcardDomain, setWildcardDomain] = useState('');
  const [subdomain, setSubdomain] = useState('');

  const handleCertSelect = (value) => {
    form.setFieldValue('values.global.revproxyArn', value);
    const selectedCert = certs.find(cert => cert.value === value);
    if (selectedCert && selectedCert.label.startsWith('*.')) {
      const domain = selectedCert.label.replace('*.', '');
      setWildcardDomain(domain);
      setSubdomain('');
      form.setFieldValue('values.global.hostname', "."+domain);
    }
  };

  useEffect(() => {
    if (wildcardDomain && subdomain) {
      const fullHostname = `${subdomain}.${wildcardDomain}`;
      if (form.values.hostname !== fullHostname) {
        form.setFieldValue('values.global.hostname', fullHostname);
      }
    }
  }, [subdomain, wildcardDomain]);

  return (
    <Paper p="md" radius="md" withBorder>
      <Stack spacing="lg">
        <Divider variant="dashed" label="SSL Certificate" labelPosition="center" />

        <Stack spacing="sm">
          <Tooltip label="Only support deploying to AWS for now">
            <Switch label="Use AWS Certificate Manager (ACM)?" checked />
          </Tooltip>

          <Group position="apart" align="flex-end">
            <Select
              label="Certificates"
              description="Select your Amazon managed certificate"
              data={certs}
              value={form.values.values.global.revproxyArn}
              onChange={handleCertSelect}
              sx={{ flexGrow: 1 }}
            />
            <Tooltip label="Refresh certs list">
              <ActionIcon
                onClick={fetchCerts}
                variant="light"
                size="lg"
                color="blue"
              >
                <IconRefresh size={20} />
              </ActionIcon>
            </Tooltip>
          </Group>

          {/* <Group position="apart" align="flex-end">
            <TextInput
              label="AWS ACM ARN"
              placeholder="e.g., arn:aws:acm:us-east-1:123456789012:certificate/1234"
              {...form.getInputProps('global.revproxyArn')}
              withAsterisk
            />
          </Group> */}
        </Stack>

        <Divider label="Hostname Configuration" labelPosition="center" />

        {wildcardDomain ? (
          <Group grow>
            <TextInput
              label={`Subdomain for *.${wildcardDomain}`}
              placeholder="e.g., gen3"
              value={subdomain}
              onChange={(e) => setSubdomain(e.currentTarget.value)}
              withAsterisk
            />
            <TextInput
              label="Resulting Hostname"
              value={form.values.values.global.hostname}
              readOnly
            />
          </Group>
        ) : (
          <TextInput
            label="Hostname"
            placeholder="e.g., gen3.example.com"
            {...form.getInputProps('values.global.hostname')}
            withAsterisk
          />
        )}
      </Stack>
    </Paper>
  );
};

export default HostnameStep;