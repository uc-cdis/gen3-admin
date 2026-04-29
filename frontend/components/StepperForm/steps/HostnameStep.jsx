import { useState, useEffect } from 'react';
import { TextInput, Textarea, Stack, Paper, Divider, Group, Text, Tooltip, Select, ActionIcon, SegmentedControl, Accordion, Box } from '@mantine/core';
import { IconRefresh, IconCloud, IconKey, IconCertificate, IconInfoCircle, IconEdit } from '@tabler/icons-react';
import { callGoApi } from '@/lib/k8s';

const CERT_SOURCES = [
  { label: 'AWS ACM', value: 'acm', description: 'Amazon Certificate Manager' },
  { label: 'TLS Secret', value: 'secret', description: 'Existing Kubernetes TLS secret' },
  { label: 'Cert Manager', value: 'certmanager', description: 'Automatic certificate provisioning' },
  { label: 'Manual', value: 'manual', description: 'Paste your own certificate & key' },
];

const HostnameStep = ({ form, certs, fetchCerts }) => {
  const [certSource, setCertSource] = useState('acm');
  const [wildcardDomain, setWildcardDomain] = useState('');
  const [subdomain, setSubdomain] = useState('');

  // TLS secrets state
  const [tlsSecrets, setTlsSecrets] = useState([]);
  const [tlsLoading, setTlsLoading] = useState(false);

  // Cert manager state
  const [certManagerIssuer, setCertManagerIssuer] = useState('');
  const [certManagerEmail, setCertManagerEmail] = useState('');

  // Fetch TLS secrets when source is switched to "secret"
  useEffect(() => {
    if (certSource !== 'secret') return;
    setTlsLoading(true);
    callGoApi('/secrets/tls', 'GET', null, null)
      .then(data => {
        if (Array.isArray(data)) {
          setTlsSecrets(data.map(s => ({ value: s.name, label: `${s.name} (${s.namespace})` })));
        }
      })
      .catch(err => console.error('Failed to fetch TLS secrets:', err))
      .finally(() => setTlsLoading(false));
  }, [certSource]);

  const handleCertSelect = (value) => {
    form.setFieldValue('values.global.revproxyArn', value);
    const selectedCert = certs.find(cert => cert.value === value);
    if (selectedCert && selectedCert.label.startsWith('*.')) {
      const domain = selectedCert.label.replace('*.', '');
      setWildcardDomain(domain);
      setSubdomain('');
      form.setFieldValue('values.global.hostname', "." + domain);
    }
  };

  const handleTlsSecretSelect = (value) => {
    form.setFieldValue('values.global.tlsSecretName', value);
  };

  useEffect(() => {
    if (wildcardDomain && subdomain) {
      const fullHostname = `${subdomain}.${wildcardDomain}`;
      if (form.values.values?.global?.hostname !== fullHostname) {
        form.setFieldValue('values.global.hostname', fullHostname);
      }
    }
  }, [subdomain, wildcardDomain]);

  return (
    <Paper p="md" radius="md" withBorder>
      <Stack spacing="lg">
        {/* SSL Certificate section */}
        <Divider variant="dashed" label="SSL Certificate" labelPosition="center" />

        {/* Certificate source selector */}
        <Stack gap="xs">
          <Text size="sm" fw={600}>Certificate Source</Text>
          <SegmentedControl
            fullWidth
            value={certSource}
            onChange={(val) => {
              setCertSource(val);
              // Clear cert-specific fields on switch
              form.setFieldValue('values.global.revproxyArn', '');
              form.setFieldValue('values.global.tlsSecretName', '');
            }}
            data={CERT_SOURCES.map(s => ({
              label: s.label,
              value: s.value,
            }))}
          />
          <Text size="xs" c="dimmed">{CERT_SOURCES.find(s => s.value === certSource)?.description}</Text>
        </Stack>

        {/* ── AWS ACM ── */}
        {certSource === 'acm' && (
          <Stack gap="sm">
            <Group justify="space-between" align="flex-end">
              <Select
                label="ACM Certificate"
                description="Select your Amazon managed certificate"
                data={certs}
                value={form.values.values?.global?.revproxyArn}
                onChange={handleCertSelect}
                style={{ flexGrow: 1 }}
                placeholder="Choose a certificate..."
                leftSection={<IconCertificate size={16} />}
              />
              <Tooltip label="Refresh certificates list">
                <ActionIcon onClick={fetchCerts} variant="light" size="lg" color="blue">
                  <IconRefresh size={20} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Stack>
        )}

        {/* ── TLS Secret ── */}
        {certSource === 'secret' && (
          <Stack gap="sm">
            <Select
              label="TLS Secret"
              description="Select an existing Kubernetes secret of type kubernetes.io/tls"
              data={tlsSecrets}
              value={form.values.values?.global?.tlsSecretName || ''}
              onChange={handleTlsSecretSelect}
              placeholder="Choose a secret..."
              leftSection={<IconKey size={16} />}
              nothingFound="No TLS secrets found in this namespace"
              loading={tlsLoading}
            />
            <Text size="xs" c="dimmed">
              The secret must contain tls.crt and tls.key. It will be mounted by the revproxy.
            </Text>
          </Stack>
        )}

        {/* ── Cert Manager ── */}
        {certSource === 'certmanager' && (
          <Stack gap="sm">
            <TextInput
              label="Issuer Name"
              description="The ClusterIssuer or Issuer resource name (e.g., letsencrypt-prod)"
              placeholder="letsencrypt-prod"
              value={certManagerIssuer}
              onChange={(e) => {
                setCertManagerIssuer(e.currentTarget.value);
                form.setFieldValue('values.global.certManagerIssuer', e.currentTarget.value);
              }}
              leftSection={<IconCertificate size={16} />}
            />
            <TextInput
              label="Email for ACME Registration"
              description="Contact email used by Let's Encrypt / cert-manager"
              placeholder="admin@example.com"
              type="email"
              value={certManagerEmail}
              onChange={(e) => {
                setCertManagerEmail(e.currentTarget.value);
                form.setFieldValue('values.global.certManagerEmail', e.currentTarget.value);
              }}
            />
            <Box
              p="xs"
              radius="sm"
              bg="blue.0"
              style={{ borderLeft: '3px solid #228be6' }}
            >
              <Group gap="xs">
                <IconInfoCircle size={14} color="#228be6" />
                <Text size="xs" c="dimmed">
                  Requires cert-manager to be installed in your cluster. A Certificate resource will be created automatically.
                </Text>
              </Group>
            </Box>
          </Stack>
        )}

        {/* ── Manual (paste cert + key) ── */}
        {certSource === 'manual' && (
          <Stack gap="sm">
            <Textarea
              label="TLS Certificate (PEM)"
              description="Paste your full certificate chain in PEM format"
              placeholder="-----BEGIN CERTIFICATE-----&#10;MIIF...&#10;-----END CERTIFICATE-----"
              minRows={4}
              maxRows={8}
              monospace
              value={form.values.values?.global?.manualTlsCert || ''}
              onChange={(e) => form.setFieldValue('values.global.manualTlsCert', e.currentTarget.value)}
              leftSection={<IconCertificate size={16} />}
            />
            <Textarea
              label="Private Key (PEM)"
              description="Paste your private key in PEM format"
              placeholder="-----BEGIN PRIVATE KEY-----&#10;MIIE...&#10;-----END PRIVATE KEY-----"
              minRows={4}
              maxRows={8}
              monospace
              value={form.values.values?.global?.manualTlsKey || ''}
              onChange={(e) => form.setFieldValue('values.global.manualTlsKey', e.currentTarget.value)}
              leftSection={<IconKey size={16} />}
            />
            <Text size="xs" c="dimmed">
              A TLS Kubernetes secret will be created from these values during deployment.
            </Text>
          </Stack>
        )}

        {/* Hostname Configuration */}
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
              value={form.values.values?.global?.hostname || ''}
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
