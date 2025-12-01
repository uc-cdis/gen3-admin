import { useState, useEffect } from "react";
import { Stepper, Divider, Radio, TextInput, PasswordInput, Button, Text, Group, Paper, Container, Select, NumberInput, Stack, List, Loader, Box, Alert, Collapse, Checkbox, Badge, Table } from "@mantine/core";
import { IconCheck, IconX, IconAlertTriangle, IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import CSOCDiagram from "@/components/CSOCDiagram";
import { useAwsIdentity } from "@/hooks/aws";
import TerraformExecutor, { buildTfvars } from '@/components/TerraformExecutor';


export default function Gen3BootstrapStepper() {
  const [active, setActive] = useState(0);

  const [selectedRegion, setSelectedRegion] = useState('us-east-1');
  const [credentialSource, setCredentialSource] = useState('auto');
  const [selectedProfile, setSelectedProfile] = useState('');
  const [availableProfiles, setAvailableProfiles] = useState([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [profilesError, setProfilesError] = useState(null);
  const [validatingProfile, setValidatingProfile] = useState(false);
  const [manualCredentials, setManualCredentials] = useState({
    accessKeyId: '',
    secretAccessKey: '',
    sessionToken: ''
  });
  const [validatingManual, setValidatingManual] = useState(false);

  // New configuration options
  const [csocName, setCsocName] = useState('');
  const [domainName, setDomainName] = useState('');
  const [validatingDomain, setValidatingDomain] = useState(false);
  const [domainValidation, setDomainValidation] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [vpcCidr, setVpcCidr] = useState('10.0.0.0/16');

  // Load profiles when switching to profile mode
  useEffect(() => {
    if (credentialSource === 'profile') {
      loadAWSProfiles();
    }
  }, [credentialSource]);

  const loadAWSProfiles = async () => {
    setLoadingProfiles(true);
    setProfilesError(null);

    try {
      // Mock for now - will call real API
      const profiles = ['default', 'production', 'staging'];
      const formattedProfiles = profiles.map(profile => ({
        value: profile,
        label: profile
      }));

      setAvailableProfiles(formattedProfiles);

      if (profiles.includes('default')) {
        setSelectedProfile('default');
      }
    } catch (err) {
      setProfilesError(err.message || 'Failed to load AWS profiles');
    } finally {
      setLoadingProfiles(false);
    }
  };

  const handleValidateDomain = async () => {
    setValidatingDomain(true);
    setDomainValidation(null);

    try {
      // Mock validation - will call real API
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Simulate validation result
      const mockResult = {
        exists: true,
        isRoute53: true,
        hostedZoneId: 'Z1234567890ABC',
        nameServers: ['ns-123.awsdns-12.com', 'ns-456.awsdns-45.net']
      };

      setDomainValidation(mockResult);
    } catch (err) {
      setDomainValidation({ error: err.message || 'Domain validation failed' });
    } finally {
      setValidatingDomain(false);
    }
  };

  const handleValidateProfile = async () => {
    setValidatingProfile(true);
    setLoading(true);
    setError(null);

    try {
      // Mock - will call real API
      const response = {
        identity: {
          Account: '123456789012',
          Arn: 'arn:aws:iam::123456789012:user/admin'
        }
      };

      setIdentity(response.identity);
    } catch (err) {
      setError(err.message || 'Invalid profile or insufficient permissions');
      setIdentity(null);
    } finally {
      setValidatingProfile(false);
      setLoading(false);
    }
  };

  const handleValidateManualCredentials = async () => {
    setValidatingManual(true);
    setLoading(true);
    setError(null);

    try {
      // Mock - will call real API
      const response = {
        identity: {
          Account: '123456789012',
          Arn: 'arn:aws:iam::123456789012:user/admin'
        }
      };

      setIdentity(response.identity);
    } catch (err) {
      setError(err.message || 'Invalid credentials');
      setIdentity(null);
    } finally {
      setValidatingManual(false);
      setLoading(false);
    }
  };

  const { identity, loading, error } = useAwsIdentity();

  const nextStep = () => setActive((current) => (current < 3 ? current + 1 : current));
  const prevStep = () => setActive((current) => (current > 0 ? current - 1 : current));

  // Calculate estimated monthly cost based on configuration
  const calculateCost = () => {
    const costs = {
      eks: 73, // EKS cluster
      fargate: 120, // Fargate for Karpenter
      vpc: 0, // VPC is free
      nat: 32.85, // NAT Gateway
      ebs: 40, // EBS volumes for cluster
      alb: 22.50, // Application Load Balancer
      route53: 0.50, // Hosted Zone
      dataTransfer: 50 // Estimated data transfer
    };

    return Object.values(costs).reduce((a, b) => a + b, 0);
  };

  const contentForStep = (step) => {
    switch (step) {
      case 0:
        // Welcome
        return (
          <Stack spacing="md">
            <Text size="xl" fw={600}>
              Welcome to the Gen3 CSOC Bootstrap
            </Text>

            <Text>
              This guided setup will provision the Gen3 Cloud Services Operations Center (CSOC)
              within your AWS account. The CSOC provides a centralized, secure environment for
              managing and deploying one or more Gen3 platforms.
            </Text>

            <List spacing="xs" size="sm">
              <List.Item>Secure cloud networking and foundational infrastructure</List.Item>
              <List.Item>Managed EKS cluster with Karpenter for auto-scaling</List.Item>
              <List.Item>Observability stack (Grafana, Loki, Mimir, Tempo)</List.Item>
              <List.Item>Cluster-level components (ALB Controller, EBS Controller)</List.Item>
              <List.Item>Automated deployment of the CSOC dashboard and tooling</List.Item>
            </List>

            <Text size="sm" c="dimmed">
              Estimated time: 30-45 minutes
            </Text>

            <CSOCDiagram />
          </Stack>
        );

      case 1:
        // Environment Setup
        return (
          <Stack spacing="md">
            <Text size="xl" fw={600}>
              Environment Setup
            </Text>

            <Text>Please review or change the environment settings below.</Text>

            <TextInput
              label="CSOC Name"
              placeholder="my-csoc"
              description="A unique identifier for this CSOC deployment"
              value={csocName}
              onChange={(e) => setCsocName(e.target.value)}
              required
            />

            <TextInput
              label="Domain Name"
              placeholder="csoc.example.com"
              description="The domain where CSOC services will be accessible"
              value={domainName}
              onChange={(e) => setDomainName(e.target.value)}
              required
              rightSection={
                domainName && (
                  <Button
                    size="xs"
                    compact
                    onClick={handleValidateDomain}
                    loading={validatingDomain}
                  >
                    Validate
                  </Button>
                )
              }
            />

            {validatingDomain && (
              <Alert color="blue" icon={<Loader size="sm" />}>
                Checking domain ownership...
              </Alert>
            )}

            {domainValidation && !domainValidation.error && (
              <Alert color="green" title="Domain Verified" icon={<IconCheck />}>
                <Stack spacing={4}>
                  <Text size="sm">Route53 Hosted Zone found</Text>
                  <Text size="xs" c="dimmed">Zone ID: {domainValidation.hostedZoneId}</Text>
                </Stack>
              </Alert>
            )}

            {domainValidation?.error && (
              <Alert color="red" title="Domain Validation Failed" icon={<IconX />}>
                <Text size="sm">{domainValidation.error}</Text>
                <Text size="xs" mt="xs">
                  Please ensure the domain has a Route53 Hosted Zone in your AWS account.
                </Text>
              </Alert>
            )}

            <Select
              label="AWS Region"
              placeholder="Select region"
              data={regions}
              value={selectedRegion}
              onChange={setSelectedRegion}
            />

            <Divider my="sm" />

            {/* Credential Source Selection */}
            <Radio.Group
              label="AWS Credentials"
              description="Choose how to authenticate with AWS"
              value={credentialSource}
              onChange={setCredentialSource}
            >
              <Stack mt="xs" spacing="xs">
                <Radio
                  value="auto"
                  label="Auto-detect (use default AWS credentials)"
                />
                <Radio
                  value="profile"
                  label="Select AWS profile"
                />
                <Radio
                  value="manual"
                  label="Provide credentials manually"
                />
              </Stack>
            </Radio.Group>

            {/* AWS Profile Selection */}
            {credentialSource === 'profile' && (
              <Stack spacing="sm" mt="md">
                {loadingProfiles ? (
                  <div className="flex items-center gap-2">
                    <Loader size="sm" />
                    <Text>Loading AWS profiles…</Text>
                  </div>
                ) : profilesError ? (
                  <Alert color="yellow" title="Unable to load profiles">
                    {profilesError}
                  </Alert>
                ) : (
                  <>
                    <Select
                      label="AWS Profile"
                      placeholder="Select a profile"
                      data={availableProfiles}
                      value={selectedProfile}
                      onChange={setSelectedProfile}
                      searchable
                      required
                    />
                    {selectedProfile && (
                      <Button
                        variant="light"
                        size="sm"
                        onClick={handleValidateProfile}
                        loading={validatingProfile}
                      >
                        Validate Profile
                      </Button>
                    )}
                  </>
                )}
              </Stack>
            )}

            {/* Manual Credentials Input */}
            {credentialSource === 'manual' && (
              <Stack spacing="sm" mt="md">
                <TextInput
                  label="AWS Access Key ID"
                  placeholder="AKIAIOSFODNN7EXAMPLE"
                  value={manualCredentials.accessKeyId}
                  onChange={(e) => setManualCredentials({
                    ...manualCredentials,
                    accessKeyId: e.target.value
                  })}
                  required
                />
                <PasswordInput
                  label="AWS Secret Access Key"
                  placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                  value={manualCredentials.secretAccessKey}
                  onChange={(e) => setManualCredentials({
                    ...manualCredentials,
                    secretAccessKey: e.target.value
                  })}
                  required
                />
                <PasswordInput
                  label="Session Token (Optional)"
                  placeholder="For temporary credentials"
                  value={manualCredentials.sessionToken}
                  onChange={(e) => setManualCredentials({
                    ...manualCredentials,
                    sessionToken: e.target.value
                  })}
                />
                <Button
                  variant="light"
                  size="sm"
                  onClick={handleValidateManualCredentials}
                  loading={validatingManual}
                  disabled={!manualCredentials.accessKeyId || !manualCredentials.secretAccessKey}
                >
                  Validate Credentials
                </Button>
              </Stack>
            )}

            {/* Loading */}
            {loading && (
              <div className="flex items-center gap-2">
                <Loader size="sm" />
                <Text>
                  {credentialSource === 'manual'
                    ? 'Validating provided credentials…'
                    : credentialSource === 'profile'
                      ? 'Validating profile…'
                      : 'Checking AWS identity…'}
                </Text>
              </div>
            )}

            {/* Error */}
            {error && (
              <Alert color="red" title="Unable to detect AWS account" icon={<IconX />}>
                {error}
                {credentialSource === 'auto' && (
                  <Text size="sm" mt="xs">
                    Try selecting an AWS profile or providing credentials manually.
                  </Text>
                )}
              </Alert>
            )}

            {/* Success */}
            {identity && (
              <Alert color="blue" title="AWS Identity Detected" icon={<IconCheck />} mt="sm">
                <Text>Deploying into AWS Account: <b>{identity.Account}</b></Text>
                <Text>User / Role: <b>{identity.Arn}</b></Text>
                {credentialSource === 'profile' && (
                  <Text size="sm" c="dimmed" mt="xs">
                    Using profile: <b>{selectedProfile}</b>
                  </Text>
                )}
                {credentialSource === 'manual' && (
                  <Text size="sm" c="dimmed" mt="xs">
                    Using manually provided credentials
                  </Text>
                )}
              </Alert>
            )}

            <Divider my="md" />

            {/* Advanced Options */}
            <div>
              <Button
                variant="subtle"
                onClick={() => setShowAdvanced(!showAdvanced)}
                rightIcon={showAdvanced ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
              >
                Advanced Options
              </Button>

              <Collapse in={showAdvanced}>
                <Stack spacing="sm" mt="md">
                  <TextInput
                    label="VPC CIDR Block"
                    placeholder="10.0.0.0/16"
                    description="The IP range for the VPC"
                    value={vpcCidr}
                    onChange={(e) => setVpcCidr(e.target.value)}
                  />
                </Stack>
              </Collapse>
            </div>
          </Stack>
        );

      case 2:
        // Review & Confirm
        const estimatedCost = calculateCost();

        return (
          <Stack spacing="md">
            <Text size="xl" fw={600}>
              Review & Confirm
            </Text>

            <Text>Please review your configuration before provisioning:</Text>

            {/* Configuration Summary */}
            <Paper withBorder p="md" radius="md">
              <Text fw={600} mb="sm">Configuration</Text>
              <Stack spacing={6}>
                <Text><strong>CSOC Name:</strong> {csocName || '(not set)'}</Text>
                <Text><strong>Domain:</strong> {domainName || '(not set)'}</Text>
                <Text><strong>Region:</strong> {selectedRegion}</Text>
                <Text><strong>AWS Account:</strong> {identity?.Account || '(not detected)'}</Text>
                <Text><strong>VPC CIDR:</strong> {vpcCidr}</Text>
              </Stack>
            </Paper>

            {/* Resources to be Created */}
            <Paper withBorder p="md" radius="md">
              <Text fw={600} mb="sm">Resources to be Created</Text>

              <Stack spacing="xs">
                <Group position="apart">
                  <Text size="sm">
                    <strong>Networking</strong>
                  </Text>
                </Group>
                <List size="sm" spacing={4} ml="md">
                  <List.Item>VPC ({vpcCidr})</List.Item>
                  <List.Item>3 Public Subnets (across availability zones)</List.Item>
                  <List.Item>3 Private Subnets (across availability zones)</List.Item>
                  <List.Item>Internet Gateway</List.Item>
                  <List.Item>NAT Gateway</List.Item>
                  <List.Item>Route Tables & Security Groups</List.Item>
                </List>

                <Divider my="xs" />

                <Group position="apart">
                  <Text size="sm">
                    <strong>EKS Cluster</strong>
                  </Text>
                </Group>
                <List size="sm" spacing={4} ml="md">
                  <List.Item>EKS Control Plane (v1.28)</List.Item>
                  <List.Item>Karpenter for node auto-scaling</List.Item>
                  <List.Item>Fargate Profile for Karpenter pods</List.Item>
                  <List.Item>OIDC Provider for IRSA</List.Item>
                </List>

                <Divider my="xs" />

                <Group position="apart">
                  <Text size="sm">
                    <strong>Cluster Components</strong>
                  </Text>
                </Group>
                <List size="sm" spacing={4} ml="md">
                  <List.Item>AWS Load Balancer Controller</List.Item>
                  <List.Item>EBS CSI Driver</List.Item>
                  <List.Item>CoreDNS</List.Item>
                  <List.Item>kube-proxy</List.Item>
                </List>

                <Divider my="xs" />

                <Group position="apart">
                  <Text size="sm">
                    <strong>Observability Stack</strong>
                  </Text>
                </Group>
                <List size="sm" spacing={4} ml="md">
                  <List.Item>Grafana (dashboarding & visualization)</List.Item>
                  <List.Item>Loki (log aggregation)</List.Item>
                  <List.Item>Mimir (metrics storage)</List.Item>
                  <List.Item>Tempo (distributed tracing)</List.Item>
                  <List.Item>Prometheus (metrics collection)</List.Item>
                </List>

                <Divider my="xs" />

                <Group position="apart">
                  <Text size="sm">
                    <strong>CSOC Services</strong>
                  </Text>
                </Group>
                <List size="sm" spacing={4} ml="md">
                  <List.Item>CSOC Dashboard</List.Item>
                  <List.Item>Gen3 Cluster Operator</List.Item>
                </List>

                <Divider my="xs" />

                <Group position="apart">
                  <Text size="sm">
                    <strong>DNS & Certificates</strong>
                  </Text>
                </Group>
                <List size="sm" spacing={4} ml="md">
                  <List.Item>Route53 records for {domainName}</List.Item>
                  <List.Item>ACM Certificate for *.{domainName}</List.Item>
                  <List.Item>cert-manager for cluster certificates</List.Item>
                </List>
              </Stack>
            </Paper>

            {/* Cost Estimate */}
            <Paper withBorder p="md" radius="md">
              <Group position="apart" mb="sm">
                <Text fw={600}>Estimated Monthly Cost</Text>
                <Badge size="lg" color="blue">${estimatedCost.toFixed(2)}/month</Badge>
              </Group>

              <Table fontSize="sm">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th style={{ textAlign: 'right' }}>Monthly Cost</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>EKS Cluster</td>
                    <td style={{ textAlign: 'right' }}>$73.00</td>
                  </tr>
                  <tr>
                    <td>Fargate (Karpenter)</td>
                    <td style={{ textAlign: 'right' }}>$120.00</td>
                  </tr>
                  <tr>
                    <td>NAT Gateway</td>
                    <td style={{ textAlign: 'right' }}>$32.85</td>
                  </tr>
                  <tr>
                    <td>EBS Volumes</td>
                    <td style={{ textAlign: 'right' }}>$40.00</td>
                  </tr>
                  <tr>
                    <td>Application Load Balancer</td>
                    <td style={{ textAlign: 'right' }}>$22.50</td>
                  </tr>
                  <tr>
                    <td>Route53 Hosted Zone</td>
                    <td style={{ textAlign: 'right' }}>$0.50</td>
                  </tr>
                  <tr>
                    <td>Data Transfer (estimated)</td>
                    <td style={{ textAlign: 'right' }}>$50.00</td>
                  </tr>
                </tbody>
              </Table>

              <Text size="xs" c="dimmed" mt="sm">
                * Additional costs may apply for workload compute (Karpenter-managed nodes), storage, and data transfer.
              </Text>
            </Paper>

            {/* Warnings */}
            {(!csocName || !domainName || !domainValidation || domainValidation.error) && (
              <Alert color="yellow" title="Configuration Incomplete" icon={<IconAlertTriangle />}>
                <Stack spacing={4}>
                  {!csocName && <Text size="sm">• CSOC Name is required</Text>}
                  {!domainName && <Text size="sm">• Domain Name is required</Text>}
                  {domainName && !domainValidation && <Text size="sm">• Domain has not been validated</Text>}
                  {domainValidation?.error && <Text size="sm">• Domain validation failed</Text>}
                </Stack>
              </Alert>
            )}

            <Text size="sm" c="dimmed">
              If everything looks correct, proceed to provisioning.
            </Text>
          </Stack>
        );

      case 3:
        const csocConfig = {
          vpc_name: csocName || 'csoc-vpc',
          aws_region: selectedRegion,
          availability_zones: [], // You might want to auto-select AZs based on region
          hostname: domainName,
          revproxy_arn: '', // You'd need to collect this or create cert
          user_yaml_bucket_name: `${csocName}-user-yaml`,
          kubernetes_namespace: 'csoc',
          es_linked_role: false,
          create_gitops_infra: true,
          deploy_cognito: false,
          default_tags: {
            Environment: 'csoc',
            ManagedBy: 'gen3-bootstrap',
            Name: csocName
          }
        };
        return (
          <TerraformExecutor
            mode="embedded"
            autoExecute={true}
            operations={['init', 'validate', 'plan', 'apply']}
            showOperationButtons={true}
            showConfig={true}
            showHistory={true}
            awsContext={{
              region: selectedRegion,
              credentials: credentialSource === 'manual' ? manualCredentials : null,
              profile: credentialSource === 'profile' ? selectedProfile : null,
              identity: identity,
              stateBucket: 'my-csoc-terraform-state',
              stateRegion: selectedRegion
            }}
            config={csocConfig}  // Pass config instead of tfvars
            stateKey="csoc/terraform.tfstate"
            onComplete={(result) => {
              console.log('CSOC provisioning complete!', result);
              // setActive(4);
            }}
            onError={(error) => {
              console.error('CSOC provisioning failed:', error);
            }}
          />
        );

      default:
        return <Text>Unknown step</Text>;
    }
  };

  const regions = [
    'us-east-1',
    'us-east-2',
    'us-west-1',
    'us-west-2',
    'eu-west-1',
    'eu-west-2',
    'eu-central-1',
    'ap-southeast-1',
    'ap-southeast-2',
    'ap-northeast-1'
  ];

  // Disable next button if required fields are not filled
  const canProceed = () => {
    if (active === 1) {
      return csocName && domainName && domainValidation && !domainValidation.error && identity;
    }
    return true;
  };

  return (
    <div className="max-w-3xl mx-auto py-10">
      <Container size="lg">

        <Box mt="xl" style={{ display: "flex", justifyContent: "flex-end" }}>
          <Group spacing="md">
            <Button variant="default" onClick={prevStep} disabled={active === 0}>
              Back
            </Button>
            <Button onClick={nextStep} disabled={active === 4 || !canProceed()}>
              {active === 3 ? "Finish" : "Next"}
            </Button>
          </Group>
        </Box>

        <Paper p="lg" radius="md" shadow="sm">
          <div style={{ display: "flex", gap: 24 }}>

            {/* Sidebar */}
            <div style={{ width: 240, borderRight: "1px solid #e5e7eb", paddingRight: 16 }}>
              <Stepper
                active={active}
                orientation="vertical"
                onStepClick={setActive}
                iconSize={28}
                size="sm"
                allowNextStepsSelect={false}
              >
                <Stepper.Step label="Welcome" description="What will be deployed" />
                <Stepper.Step label="Environment Setup" description="AWS details" />
                <Stepper.Step label="Review & Confirm" description="Check config" />
                <Stepper.Step label="Provisioning" description="Running Terraform" />
              </Stepper>
            </div>

            {/* Main content */}
            <div style={{ flex: 1 }}>
              {contentForStep(active)}
            </div>

          </div>
        </Paper>
      </Container>

    </div>
  );
}