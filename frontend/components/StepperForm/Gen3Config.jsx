import React, { useState } from 'react';
import { 
  Stepper, 
  Button, 
  Group, 
  Box, 
  TextInput, 
  NumberInput, 
  Checkbox, 
  Switch,
  Code, 
  Title,
  Paper,
  Grid,
  Card,
  Divider,
  Select,
  Text
} from '@mantine/core';
import { useForm } from '@mantine/form';
import yaml from 'js-yaml';
import YamlEditor from '../YamlEditor/YamlEditor';

const Gen3ConfigForm = () => {
  const [active, setActive] = useState(0);
  const [yamlOutput, setYamlOutput] = useState('');

  // Initialize the form with the values from the values.yaml
  const form = useForm({
    initialValues: {
      // Global settings
      hostname: 'gen3.example.com',
      awsEnabled: false,
      awsRegion: '',
      awsAccessKeyId: '',
      awsSecretAccessKey: '',
      secretStoreServiceAccountEnabled: false,
      secretStoreServiceAccountName: '',
      secretStoreServiceAccountRoleArn: '',
      useLocalSecretEnabled: false,
      useLocalSecretName: '',
      dev: false,
      revproxyArn: '',
      dbCreate: true,
      dbHost: '',
      dbPort: '5432',
      dbUsername: 'postgres',
      dbPassword: '',
      environment: '',
      frontendRoot: 'portal',
      netPolicyEnabled: false,
      netPolicyDbSubnet: '',
      
      // Services toggle
      ambassadorEnabled: false,
      arboristEnabled: true,
      auditEnabled: true,
      awsEsProxyEnabled: false,
      etlEnabled: false,
      fenceEnabled: false,
      guppyEnabled: false,
      hatcheryEnabled: false,
      indexdEnabled: false,
      manifestServiceEnabled: false,
      metadataEnabled: false,
      peregrineEnabled: false,
      portalEnabled: false,
      requestorEnabled: false,
      revproxyEnabled: false,
      sheepdogEnabled: false,
      ssjdispatcherEnabled: false,
      wtsEnabled: false,
      posgresqlEnabled: false,
      elasticsearchEnabled: false,
      neuvectorEnabled: false,
      
      // Image tags
      ambassadorImageTag: 'master',
      arboristImageTag: 'master',
      auditImageTag: 'master',
      awsEsProxyImageTag: 'master',
      
      // Resources (using the same anchor for all)
      resourceMemory: '105Mi',
      resourceCpu: '15m',
    },

    // Add validation
    validate: {
      hostname: (value) => (!value ? 'Hostname is required' : null),
      dbPort: (value) => (isNaN(parseInt(value)) ? 'Port must be a number' : null),
    },
  });

  const nextStep = () => {
    if (active < 3) {
      setActive((current) => current + 1);
    }
  };

  const prevStep = () => {
    if (active > 0) {
      setActive((current) => current - 1);
    }
  };

  const generateYaml = () => {
    const values = form.values;
    
    // Create the YAML structure
    const config = {
      global: {
        hostname: values.hostname,
        aws: {
          enabled: values.awsEnabled,
          region: values.awsRegion,
          awsAcccessKeyId: values.awsAccessKeyId,
          awsSecretAccessKey: values.awsSecretAccessKey,
          secretStoreServiceAccount: {
            enabled: values.secretStoreServiceAccountEnabled,
            name: values.secretStoreServiceAccountName,
            roleArn: values.secretStoreServiceAccountRoleArn,
          },
          useLocalSecret: {
            enabled: values.useLocalSecretEnabled,
            localSecretName: values.useLocalSecretName,
          },
        },
        dev: values.dev,
        revproxyArn: values.revproxyArn,
        postgres: {
          dbCreate: values.dbCreate,
          master: {
            host: values.dbHost,
            port: values.dbPort,
            username: values.dbUsername,
            password: values.dbPassword,
          },
        },
        environment: values.environment,
        frontendRoot: values.frontendRoot,
        netPolicy: {
          enabled: values.netPolicyEnabled,
          dbSubnet: values.netPolicyDbSubnet,
        },
      },
      ambassador: {
        enabled: values.ambassadorEnabled,
        resources: {
          requests: {
            memory: values.resourceMemory,
            cpu: values.resourceCpu,
          },
        },
        image: {
          tag: values.ambassadorImageTag,
        },
      },
      arborist: {
        enabled: values.arboristEnabled,
        resources: {
          requests: {
            memory: values.resourceMemory,
            cpu: values.resourceCpu,
          },
        },
        image: {
          tag: values.arboristImageTag,
        },
      },
      audit: {
        enabled: values.auditEnabled,
        resources: {
          requests: {
            memory: values.resourceMemory,
            cpu: values.resourceCpu,
          },
        },
        image: {
          tag: values.auditImageTag,
        },
      },
      'aws-es-proxy': {
        enabled: values.awsEsProxyEnabled,
        resources: {
          requests: {
            memory: values.resourceMemory,
            cpu: values.resourceCpu,
          },
        },
        image: {
          tag: values.awsEsProxyImageTag,
        },
      },
      etl: {
        enabled: values.etlEnabled,
      },
      fence: {
        enabled: values.fenceEnabled,
      },
      guppy: {
        enabled: values.guppyEnabled,
      },
      hatchery: {
        enabled: values.hatcheryEnabled,
      },
      indexd: {
        enabled: values.indexdEnabled,
      },
      manifestService: {
        enabled: values.manifestServiceEnabled,
      },
      metadata: {
        enabled: values.metadataEnabled,
      },
      peregrine: {
        enabled: values.peregrineEnabled,
      },
      portal: {
        enabled: values.portalEnabled,
      },
      requestor: {
        enabled: values.requestorEnabled,
      },
      revproxy: {
        enabled: values.revproxyEnabled,
      },
      sheepdog: {
        enabled: values.sheepdogEnabled,
      },
      ssjdispatcher: {
        enabled: values.ssjdispatcherEnabled,
      },
      wts: {
        enabled: values.wtsEnabled,
      },
      posgresql: {
        enabled: values.posgresqlEnabled,
      },
      elasticsearch: {
        enabled: values.elasticsearchEnabled,
      },
      neuvector: {
        enabled: values.neuvectorEnabled,
      },
    };
    
    // Convert to YAML
    const yamlString = yaml.dump(config, { lineWidth: -1 });
    setYamlOutput(yamlString);
    
    // Move to last step to show the output
    setActive(3);
  };

  return (
    <Box p="md">
      <Title order={2} mb="lg">Gen3 Configuration</Title>
      
      <Stepper active={active} onStepClick={setActive} breakpoint="sm" mb="xl">
        <Stepper.Step label="Global Settings" description="Basic configuration">
          <Paper shadow="xs" p="md" withBorder>
            <Title order={4} mb="md">Global Configuration</Title>
            
            <Grid>
              <Grid.Col span={6}>
                <TextInput
                  label="Hostname"
                  placeholder="gen3.example.com"
                  required
                  {...form.getInputProps('hostname')}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <TextInput
                  label="Frontend Root"
                  placeholder="portal"
                  {...form.getInputProps('frontendRoot')}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <TextInput
                  label="Environment"
                  placeholder="Production, development, etc."
                  {...form.getInputProps('environment')}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="Development Mode"
                  {...form.getInputProps('dev', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
            </Grid>
            
            <Divider my="md" label="AWS Configuration" />
            
            <Grid>
              <Grid.Col span={12}>
                <Switch
                  label="Enable AWS"
                  {...form.getInputProps('awsEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              {form.values.awsEnabled && (
                <>
                  <Grid.Col span={6}>
                    <TextInput
                      label="AWS Region"
                      placeholder="us-east-1"
                      {...form.getInputProps('awsRegion')}
                      mb="md"
                    />
                  </Grid.Col>
                  
                  <Grid.Col span={6}>
                    <TextInput
                      label="AWS Access Key ID"
                      {...form.getInputProps('awsAccessKeyId')}
                      mb="md"
                    />
                  </Grid.Col>
                  
                  <Grid.Col span={6}>
                    <TextInput
                      label="AWS Secret Access Key"
                      type="password"
                      {...form.getInputProps('awsSecretAccessKey')}
                      mb="md"
                    />
                  </Grid.Col>
                  
                  <Grid.Col span={6}>
                    <TextInput
                      label="Revproxy ARN"
                      {...form.getInputProps('revproxyArn')}
                      mb="md"
                    />
                  </Grid.Col>
                  
                  <Grid.Col span={12}>
                    <Card shadow="xs" p="md" withBorder>
                      <Card.Section>
                        <Switch
                          label="Enable Secret Store Service Account"
                          {...form.getInputProps('secretStoreServiceAccountEnabled', { type: 'checkbox' })}
                          m="md"
                        />
                      </Card.Section>
                      
                      {form.values.secretStoreServiceAccountEnabled && (
                        <Card.Section p="md">
                          <TextInput
                            label="Secret Store Service Account Name"
                            {...form.getInputProps('secretStoreServiceAccountName')}
                            mb="md"
                          />
                          
                          <TextInput
                            label="Secret Store Service Account Role ARN"
                            {...form.getInputProps('secretStoreServiceAccountRoleArn')}
                            mb="md"
                          />
                        </Card.Section>
                      )}
                    </Card>
                  </Grid.Col>
                  
                  <Grid.Col span={12} mt="md">
                    <Card shadow="xs" p="md" withBorder>
                      <Card.Section>
                        <Switch
                          label="Use Local Secret"
                          {...form.getInputProps('useLocalSecretEnabled', { type: 'checkbox' })}
                          m="md"
                        />
                      </Card.Section>
                      
                      {form.values.useLocalSecretEnabled && (
                        <Card.Section p="md">
                          <TextInput
                            label="Local Secret Name"
                            {...form.getInputProps('useLocalSecretName')}
                            mb="md"
                          />
                        </Card.Section>
                      )}
                    </Card>
                  </Grid.Col>
                </>
              )}
            </Grid>
            
            <Divider my="md" label="Database Configuration" />
            
            <Grid>
              <Grid.Col span={12}>
                <Switch
                  label="Create Database"
                  {...form.getInputProps('dbCreate', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <TextInput
                  label="Database Host"
                  {...form.getInputProps('dbHost')}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <TextInput
                  label="Database Port"
                  placeholder="5432"
                  {...form.getInputProps('dbPort')}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <TextInput
                  label="Database Username"
                  placeholder="postgres"
                  {...form.getInputProps('dbUsername')}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <TextInput
                  label="Database Password"
                  type="password"
                  {...form.getInputProps('dbPassword')}
                  mb="md"
                />
              </Grid.Col>
            </Grid>
            
            <Divider my="md" label="Network Policy" />
            
            <Grid>
              <Grid.Col span={12}>
                <Switch
                  label="Enable Network Policy"
                  {...form.getInputProps('netPolicyEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              {form.values.netPolicyEnabled && (
                <Grid.Col span={12}>
                  <TextInput
                    label="Database Subnet"
                    {...form.getInputProps('netPolicyDbSubnet')}
                    mb="md"
                  />
                </Grid.Col>
              )}
            </Grid>
          </Paper>
        </Stepper.Step>
        
        <Stepper.Step label="Services" description="Enable/disable services">
          <Paper shadow="xs" p="md" withBorder>
            <Title order={4} mb="md">Services Configuration</Title>
            
            <Grid>
              <Grid.Col span={6}>
                <Switch
                  label="Ambassador"
                  {...form.getInputProps('ambassadorEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="Arborist"
                  {...form.getInputProps('arboristEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="Audit"
                  {...form.getInputProps('auditEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="AWS ES Proxy"
                  {...form.getInputProps('awsEsProxyEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="ETL"
                  {...form.getInputProps('etlEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="Fence"
                  {...form.getInputProps('fenceEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="Guppy"
                  {...form.getInputProps('guppyEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="Hatchery"
                  {...form.getInputProps('hatcheryEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="Indexd"
                  {...form.getInputProps('indexdEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="Manifest Service"
                  {...form.getInputProps('manifestServiceEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="Metadata"
                  {...form.getInputProps('metadataEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="Peregrine"
                  {...form.getInputProps('peregrineEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="Portal"
                  {...form.getInputProps('portalEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="Requestor"
                  {...form.getInputProps('requestorEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="Revproxy"
                  {...form.getInputProps('revproxyEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="Sheepdog"
                  {...form.getInputProps('sheepdogEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="SSJ Dispatcher"
                  {...form.getInputProps('ssjdispatcherEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="WTS"
                  {...form.getInputProps('wtsEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="PostgreSQL"
                  {...form.getInputProps('posgresqlEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="Elasticsearch"
                  {...form.getInputProps('elasticsearchEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <Switch
                  label="NeuVector"
                  {...form.getInputProps('neuvectorEnabled', { type: 'checkbox' })}
                  mb="md"
                />
              </Grid.Col>
            </Grid>
          </Paper>
        </Stepper.Step>
        
        <Stepper.Step label="Resources" description="Configure resources and image tags">
          <Paper shadow="xs" p="md" withBorder>
            <Title order={4} mb="md">Resources Configuration</Title>
            
            <Text color="dimmed" mb="md">
              These resource settings will be applied to all services
            </Text>
            
            <Grid>
              <Grid.Col span={6}>
                <TextInput
                  label="Memory Request"
                  placeholder="105Mi"
                  {...form.getInputProps('resourceMemory')}
                  mb="md"
                />
              </Grid.Col>
              
              <Grid.Col span={6}>
                <TextInput
                  label="CPU Request"
                  placeholder="15m"
                  {...form.getInputProps('resourceCpu')}
                  mb="md"
                />
              </Grid.Col>
            </Grid>
            
            <Divider my="md" label="Image Tags" />
            
            <Grid>
              {form.values.ambassadorEnabled && (
                <Grid.Col span={6}>
                  <TextInput
                    label="Ambassador Image Tag"
                    placeholder="master"
                    {...form.getInputProps('ambassadorImageTag')}
                    mb="md"
                  />
                </Grid.Col>
              )}
              
              {form.values.arboristEnabled && (
                <Grid.Col span={6}>
                  <TextInput
                    label="Arborist Image Tag"
                    placeholder="master"
                    {...form.getInputProps('arboristImageTag')}
                    mb="md"
                  />
                </Grid.Col>
              )}
              
              {form.values.auditEnabled && (
                <Grid.Col span={6}>
                  <TextInput
                    label="Audit Image Tag"
                    placeholder="master"
                    {...form.getInputProps('auditImageTag')}
                    mb="md"
                  />
                </Grid.Col>
              )}
              
              {form.values.awsEsProxyEnabled && (
                <Grid.Col span={6}>
                  <TextInput
                    label="AWS ES Proxy Image Tag"
                    placeholder="master"
                    {...form.getInputProps('awsEsProxyImageTag')}
                    mb="md"
                  />
                </Grid.Col>
              )}
            </Grid>
          </Paper>
        </Stepper.Step>
        
        <Stepper.Step label="Output" description="Review YAML">
          <Paper shadow="xs" p="md" withBorder>
            <Title order={4} mb="md">Generated YAML Configuration</Title>
            
            <Code block>{yamlOutput}</Code>
          </Paper>
        </Stepper.Step>
      </Stepper>

      <Group position="right" mt="xl">
        {active !== 0 && (
          <Button variant="default" onClick={prevStep}>
            Back
          </Button>
        )}
        
        {active !== 3 ? (
          <Button onClick={active === 2 ? generateYaml : nextStep}>
            {active === 2 ? 'Generate YAML' : 'Next'}
          </Button>
        ) : (
          <Button onClick={() => {
            // Copy YAML to clipboard
            navigator.clipboard.writeText(yamlOutput);
          }}>
            Copy to Clipboard
          </Button>
        )}
      </Group>

      <YamlEditor data={yamlOutput} button={false} readOnly={true} />
    </Box>
  );
};

export default Gen3ConfigForm;