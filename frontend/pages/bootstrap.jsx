import { useState } from "react";
import { Stepper, Button, Text, Group, Paper, Container, Select, NumberInput, Stack, List, Loader, Box, Alert } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import CSOCDiagram from "@/components/CSOCDiagram";
import { useAwsIdentity } from "@/hooks/aws";

export default function Gen3BootstrapStepper() {
  const [active, setActive] = useState(0);

  const { identity, loading, error } = useAwsIdentity();


  const nextStep = () => setActive((current) => (current < 4 ? current + 1 : current));
  const prevStep = () => setActive((current) => (current > 0 ? current - 1 : current));

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
              This guided setup will deploy a complete Gen3 Cloud Services Operations Center
              inside your AWS account. You will receive:
            </Text>

            <List spacing="xs" size="sm">
              <List.Item>Private VPC configured for security</List.Item>
              <List.Item>EKS cluster for all Gen3 microservices</List.Item>
              <List.Item>RDS PostgreSQL database</List.Item>
              <List.Item>S3 storage buckets</List.Item>
              <List.Item>Automated Gen3 application deployment</List.Item>
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


            <Select
              label="AWS Region"
              placeholder="Select region"
              data={regions}
              />

              {/* Loading */}
              {loading && (
                <div className="flex items-center gap-2">
                  <Loader size="sm" />
                  <Text>Checking AWS identity…</Text>
                </div>
              )}

              {/* Error */}
              {error && (
                <Alert color="red" title="Unable to detect AWS account">
                  {error}
                </Alert>
              )}

              {/* Success */}
              {identity && (
                <Alert color="blue" title="AWS Identity Detected" mt="sm">
                  <Text>Deploying into AWS Account: <b>{identity.Account}</b></Text>
                  <Text>User / Role: <b>{identity.Arn}</b></Text>
                </Alert>
              )}
          </Stack>
        );

      case 2:
        // Review & Confirm
        return (
          <Stack spacing="md">
            <Text size="xl" fw={600}>
              Review & Confirm
            </Text>

            <Text>Please confirm your selected configuration:</Text>

            <Paper withBorder p="md" radius="md">
              <Stack spacing={6}>
                <Text><strong>Region:</strong> us-east-1</Text>
                <Text><strong>EKS Nodes:</strong> 3</Text>
                <Text><strong>RDS Instance:</strong> db.m5.large</Text>
                <Text><strong>VPC:</strong> Auto-generated (10.0.0.0/16)</Text>
              </Stack>
            </Paper>

            <Text size="sm" c="dimmed">
              If everything looks correct, proceed to provisioning.
            </Text>
          </Stack>
        );

      case 3:
        // Provisioning
        return (
          <Stack spacing="md">
            <Text size="xl" fw={600}>
              Provisioning Infrastructure
            </Text>

            <Text>
              Terraform is setting up your AWS environment. This may take several minutes.
            </Text>

            <Paper withBorder radius="md" p="md" style={{ background: "#000" }}>
              <Text size="sm" style={{ color: "#5eff5e", fontFamily: "monospace" }}>
                [terraform logs streaming...]
              </Text>
            </Paper>

            <Loader color="blue" />
          </Stack>
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



  return (
    <div className="max-w-3xl mx-auto py-10">
      <Container size="lg">

        <Box mt="xl" style={{ display: "flex", justifyContent: "flex-end" }}>
          <Group spacing="md">
            <Button variant="default" onClick={prevStep} disabled={active === 0}>
              Back
            </Button>
            <Button onClick={nextStep} disabled={active === 4}>
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
