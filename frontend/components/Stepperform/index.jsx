// components/StepperForm.js
import { useState } from 'react';
import {
  Stepper,
  Button,
  Group,
  Code,
  Flex,
  Box,
  Checkbox,
  Text,
  TextInput,
  Container,
  Switch,
  Radio,
  Textarea,
  PasswordInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';

const StepperForm = () => {
  const [active, setActive] = useState(0);

  // Initialize Mantine's useForm with initial values
  const form = useForm({
    initialValues: {
      modules: [],
      auth: {
        ras: {
          enabled: false,
          clientID: '',
          clientSecret: '',
          issuerURL: '',
        },
        oidc: {
          enabled: false,
          clientID: '',
          clientSecret: '',
          issuerURL: '',
        },
        google: {
          enabled: false,
          clientID: '',
          clientSecret: '',
        }
      },
      authz: {
        yamlSource: 'external',
        yaml: '',
        yamlPath: '',
      },
      workspaces: {
        containerImage: '',
        cpu: '',
        memory: '',
        useDefault: true,
      },
      // Placeholder for future steps
    },
  });

  const modules = [
    { label: 'Framework Services', value: 'framework' },
    { label: 'Workspaces', value: 'workspaces' },
    { label: 'Workflows', value: 'workflows' },
    // { label: 'Dicom', value: 'dicom' },
    // { label: 'OMOP', value: 'omop' },
  ];

  const selectedModules = form.values.modules;

  const nextStep = () =>
    setActive((current) => (current < steps.length - 1 ? current + 1 : current));
  const prevStep = () =>
    setActive((current) => (current > 0 ? current - 1 : current));

  const onSubmit = (values) => {
    console.log('Form Data:', values);
    // Handle final submission, e.g., generate values.yaml
  };

  const steps = [
    {
      label: 'Select Modules',
      content: (
        <Container>
          <Checkbox.Group
            {...form.getInputProps('modules', { type: 'checkbox' })}
            orientation="horizontal"
          >

            {modules.map((module) => (
              <Checkbox
                key={module.value}
                value={module.value}
                label={module.label}
              />
            ))}
          </Checkbox.Group>
        </Container>
      ),
    },
    {
      label: 'Configure Auth',
      // selectedModules.includes('auth') 
      content: (
        <>
          <Switch
            label="Google"
            {...form.getInputProps('auth.google.enabled', { type: 'checkbox' })}
            mb="md"
          />
          <>
          </>
          {form.values.auth.google.enabled && (
            <>
              <TextInput
                label="Client ID"
                placeholder="Your Client ID"
                {...form.getInputProps('auth.google.clientID')}
                mb="md"
              />
              <PasswordInput
                label="Client Secret"
                secret
                placeholder="Your Client Secret"
                {...form.getInputProps('auth.clientSecret')}
                mb="md"
              />
            </>
          )}
          <Switch
            label="Generic OIDC"
            {...form.getInputProps('auth.oidc.enabled', { type: 'checkbox' })}
            mb="md"
          />
          {form.values.auth.oidc.enabled && (
            <>
              <TextInput
                label="Issuer URL"
                placeholder="https://example.com/issuer"
                {...form.getInputProps('auth.oidc.issuerURL')}
                mb="md"
              />
              <TextInput
                label="Client ID"
                placeholder="Your Client ID"
                {...form.getInputProps('auth.oidc.clientID')}
                mb="md"
              />
              <PasswordInput
                label="Client Secret"
                secret
                placeholder="Your Client Secret"
                {...form.getInputProps('auth.oidc.clientSecret')}
                mb="md"
              />
            </>
          )}
          <Switch
            label="RAS"
            {...form.getInputProps('auth.ras.enabled', { type: 'checkbox' })}
            mb="md"
          />
          {form.values.auth.ras.enabled && (
            <>
              <TextInput
                label="Issuer URL"
                placeholder="https://example.com/issuer"
                {...form.getInputProps('auth.ras.issuerURL')}
                mb="md"
              />
              <TextInput
                label="Client ID"
                placeholder="Your Client ID"
                {...form.getInputProps('auth.ras.clientID')}
                mb="md"
              />
              <PasswordInput
                label="Client Secret"
                secret
                placeholder="Your Client Secret"
                {...form.getInputProps('auth.ras.clientSecret')}
                mb="md"
              />
            </>
          )}
        </>
      ),
    },
    {
      label: 'Configure AuthZ',
      // selectedModules.includes('authZ') &&
      content: (
        <>
          <Radio.Group
            name="favoriteFramework"
            label="Select source of user.yaml for authz"
            required
            {...form.getInputProps('authz.yamlSource')}
            withAsterisk
          >
            <Radio value="external" label="External" />
            <Radio value="customUserYaml" label="Custom" />

          </Radio.Group>
          {form.values.authz.yamlSource === 'external' && (
            <>
              <TextInput
                label="Path to user.yaml"
                placeholder="e.g., https://raw.github or s3://bucket/path/to/user.yaml"
                {...form.getInputProps('authz.yamlPath')}
                mb="md"
              />
            </>
          )}
          {form.values.authz.yamlSource === 'customUserYaml' && (
            <>
              <Textarea
                label="Define Roles"
                placeholder="e.g., admin: read, write; user: read"
                {...form.getInputProps('authz.yaml')}
                mb="md"
              />
            </>
          )}
        </>
      ),
    },
    {
      label: 'Configure Workspaces',
      content: selectedModules.includes('workspaces') && (
        <>
          <Switch
            label="Use Default Settings?"
            {...form.getInputProps('workspaces.useDefault', { type: 'checkbox' })}
            mb="md"
          />
          {!form.values.workspaces.useDefault && (
            <>
              <TextInput
                label="Container Image"
                placeholder="e.g., gen3/workspace:latest"
                {...form.getInputProps('workspaces.containerImage')}
                mb="md"
              />
              <TextInput
                label="CPU"
                placeholder="e.g., 500m"
                {...form.getInputProps('workspaces.cpu')}
                mb="md"
              />
              <TextInput
                label="Memory"
                placeholder="e.g., 256Mi"
                {...form.getInputProps('workspaces.memory')}
                mb="md"
              />
            </>
          )}
        </>
      ),
    },
    {
      label: 'Placeholder Step',
      content: (
        <Box>
          <p>This step is under construction. Stay tuned!</p>
        </Box>
      ),
    },
    {
      label: 'Review & Generate',
      content: (
        <Box>
          <pre>{/* You can display a preview of values.yaml here */}</pre>
          <Button onClick={form.onSubmit(onSubmit)}>Generate values.yaml</Button>
        </Box>
      ),
    },
  ];

  return (
    <>

      <form onSubmit={form.onSubmit(onSubmit)}>
        <Stepper size="sm" active={active} onStepClick={setActive} orientation="horizontal">

          {steps
            .filter((step) => {
              // Always render steps without 'module' or check if the module is selected
              return !step.module || selectedModules.includes(step.module);
            })
            .map((step, index) => (
              <Stepper.Step key={index} label={step.label} description="" allowStepSelect={false}>
                {step.content}
              </Stepper.Step>
            ))}

        </Stepper>

        <Group position="center" mt="xl">
          {active > 0 && (
            <Button variant="default" onClick={prevStep}>
              Back
            </Button>
          )}
          {active < steps.length - 1 && (
            <Button onClick={nextStep} disabled={false}>
              Next
            </Button>
          )}
          {active === steps.length - 1 && (
            <Button type="submit">Submit</Button>
          )}
        </Group>
      </form>

      {/* Code block to display current form values and generated user.yaml */}
      <Container>
        <Flex direction={{ base: 'column', sm: 'row' }} // Stacks vertically on small screens, side-by-side on larger screens
          gap="md"  // Adds spacing between the code blocks
          justify="space-between"
          style={{ width: '100%' }}
        >
        </Flex>
        <Text>Debug values</Text>
        <Code block>
          {JSON.stringify(form.values, null, 2)}
        </Code>
        {/* </Flex> */}
      </Container >
    </>
  );
};

export default StepperForm;
