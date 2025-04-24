import { TextInput, Stack, Paper, Divider, Card, Group, Title, Switch, Collapse, Text, SimpleGrid, Tooltip, PasswordInput, Radio, Textarea, Alert, List, Anchor, Checkbox, SegmentedControl } from '@mantine/core';
import { IconHelp, IconWorld, IconId, IconKey, IconLink, IconInfoCircle, IconAlertTriangle, IconBrandGoogle, IconBroadcast } from '@tabler/icons-react';


const AuthStep = ({ form }) => {
  const isUsersyncEnabled = form.values.values.fence.usersync.usersync;

  return (
    <Stack spacing="lg">
      <Paper p="md" radius="md" withBorder>
        <Group position="apart">
          <IconBrandGoogle />
          <Text>Google Login</Text>
          <Switch
            {...form.getInputProps('values.fence.FENCE_CONFIG.OPENID_CONNECT.google.enabled', { type: 'checkbox' })}
            size="lg"
          />
        </Group>

        <Collapse in={form.values.values.fence.FENCE_CONFIG.OPENID_CONNECT.google.enabled}>
          <Stack mt="md">
            {/* <TextInput
              label="Discovery URL"
              placeholder="https://accounts.google.com/.well-known/openid-configuration"
              {...form.getInputProps('values.fence.FENCE_CONFIG.OPENID_CONNECT.google.discovery_url')}
              withAsterisk
            /> */}
            <Anchor href="https://github.com/uc-cdis/gen3-helm?tab=readme-ov-file#google-login-generation" target="_blank">Docs</Anchor>
            <TextInput
              label="Client ID"
              placeholder="Enter Google Client ID"
              {...form.getInputProps('values.fence.FENCE_CONFIG.OPENID_CONNECT.google.client_id')}
              withAsterisk
            />
            <PasswordInput
              label="Client Secret"
              placeholder="Enter Google Client Secret"
              {...form.getInputProps('values.fence.FENCE_CONFIG.OPENID_CONNECT.google.client_secret')}
              withAsterisk
            />
            <TextInput
              label="Redirect URL"
              // placeholder="{{BASE_URL}}/login/google/login/"
              {...form.getInputProps('values.fence.FENCE_CONFIG.OPENID_CONNECT.google.redirect_url')}
              withAsterisk
            />
            <TextInput
              label="Scope"
              placeholder="openid email"
              {...form.getInputProps('values.fence.FENCE_CONFIG.OPENID_CONNECT.google.scope')}
            />

            <Text fw={500} mt="md">Mock Settings (For Dev Testing Only)</Text>
            <Alert
              title="Warning"
              color="red"
              icon={<IconAlertTriangle />}
            >
              Enabling this will <strong>bypass authentication</strong>.
              Only use this in <strong>development</strong> or <strong>test environments</strong>.
              <Anchor href="https://docs.gen3.org/gen3-resources/operator-guide/helm/helm-config/helm-config-auth/#mock-authorization-for-development-only" target="_blank"></Anchor>
            </Alert>


            <Checkbox
              label="Mock Google Auth"
              {...form.getInputProps('values.fence.FENCE_CONFIG.MOCK_GOOGLE_AUTH')}
            />
            {
              form.values.values.fence.FENCE_CONFIG.MOCK_GOOGLE_AUTH ?
                <TextInput
                  label="Mock Default User"
                  placeholder="test@example.com"
                  {...form.getInputProps('values.fence.FENCE_CONFIG.OPENID_CONNECT.google.mock_default_user')}
                /> : null
            }
          </Stack>
        </Collapse>
      </Paper>


      <Paper p="md" radius="md" withBorder>
        <Group position="apart">
          <IconBroadcast />
          <Text>Generic OIDC</Text>
          <Switch
            {...form.getInputProps('values.fence.FENCE_CONFIG.OPENID_CONNECT.generic_oidc_idp.enabled', { type: 'checkbox' })}
            size="lg"
          />
        </Group>

        <Collapse in={form.values.values.fence.FENCE_CONFIG.OPENID_CONNECT.generic_oidc_idp.enabled}>
          <Stack mt="md">
            <TextInput
              label="Display Name (name)"
              placeholder="some_idp"
              {...form.getInputProps('values.fence.FENCE_CONFIG.OPENID_CONNECT.generic_oidc_idp.name')}
              withAsterisk
            />
            <TextInput
              label="Client ID"
              placeholder="Enter Client ID"
              {...form.getInputProps('values.fence.FENCE_CONFIG.OPENID_CONNECT.generic_oidc_idp.client_id')}
              withAsterisk
            />
            <PasswordInput
              label="Client Secret"
              placeholder="Enter Client Secret"
              {...form.getInputProps('values.fence.FENCE_CONFIG.OPENID_CONNECT.generic_oidc_idp.client_secret')}
              withAsterisk
            />
            <TextInput
              label="Redirect URL"
              placeholder="{{BASE_URL}}/login/some_idp/login"
              {...form.getInputProps('values.fence.FENCE_CONFIG.OPENID_CONNECT.generic_oidc_idp.redirect_url')}
              withAsterisk
            />
            <TextInput
              label="Discovery URL"
              placeholder="https://server.com/.well-known/openid-configuration"
              {...form.getInputProps('values.fence.FENCE_CONFIG.OPENID_CONNECT.generic_oidc_idp.discovery_url')}
              withAsterisk
            />

            <Text fw={500} mt="md">Discovery (Manual)</Text>

            <TextInput
              label="Authorization Endpoint"
              placeholder="https://your-auth.com/authorize"
              {...form.getInputProps('values.fence.FENCE_CONFIG.OPENID_CONNECT.generic_oidc_idp.discovery.authorization_endpoint')}
            />
            <TextInput
              label="Token Endpoint"
              placeholder="https://your-auth.com/token"
              {...form.getInputProps('values.fence.FENCE_CONFIG.OPENID_CONNECT.generic_oidc_idp.discovery.token_endpoint')}
            />
            <TextInput
              label="JWKS URI"
              placeholder="https://your-auth.com/.well-known/jwks.json"
              {...form.getInputProps('values.fence.FENCE_CONFIG.OPENID_CONNECT.generic_oidc_idp.discovery.jwks_uri')}
            />

            <Text fw={500} mt="md">Optional Claim Mappings</Text>

            <TextInput
              label="User ID Field"
              placeholder="sub"
              {...form.getInputProps('values.fence.FENCE_CONFIG.OPENID_CONNECT.generic_oidc_idp.user_id_field')}
            />
            <TextInput
              label="Email Field"
              placeholder="email"
              {...form.getInputProps('values.fence.FENCE_CONFIG.OPENID_CONNECT.generic_oidc_idp.email_field')}
            />
            <TextInput
              label="Scope"
              placeholder="openid email"
              {...form.getInputProps('values.fence.FENCE_CONFIG.OPENID_CONNECT.generic_oidc_idp.scope')}
            />
          </Stack>
        </Collapse>
      </Paper>



      {/* <Paper p="md" radius="md" withBorder>
        <Group position="apart">
          <Text>RAS Authentication</Text>
          <Switch {...form.getInputProps('auth.ras.enabled', { type: 'checkbox' })} size="lg" />
        </Group>
        <Collapse in={form.values.auth.ras.enabled}>
          <Stack>
            <TextInput label="Issuer URL" {...form.getInputProps('auth.ras.issuerURL')} withAsterisk />
            <TextInput label="Client ID" {...form.getInputProps('auth.ras.clientID')} withAsterisk />
            <PasswordInput label="Client Secret" {...form.getInputProps('auth.ras.clientSecret')} withAsterisk />
          </Stack>
        </Collapse>
      </Paper> */}

      {/* <Divider my="md" ></Divider> */}
      <Paper p="md" radius="md" withBorder>
        <Title order={3} c="gray.0">User Sync Configuration</Title>


        <Stack spacing="lg">

          <Anchor href="https://github.com/uc-cdis/fence/blob/master/docs/additional_documentation/user.yaml_guide.md" target="_blank">
            User yaml guide</Anchor>
          <Divider label="Choose User Sync Mode" labelPosition="center" />

          {/* <Switch.Group
            label="User Sync Mode"
            description="Toggle between loading users from an S3 YAML file or defining them manually below."
            withAsterisk
          >
          </Switch.Group>

          <Switch
            size="lg"
            onLabel="Usersync"
            offLabel="User yaml"
            {...form.getInputProps('values.fence.usersync.usersync')}
          />
          
          */}


          <Stack spacing="xs">
            <Text fw={500} size="sm">
              Authorization Source <Text span c="red">*</Text>
            </Text>
            <Text size="xs" c="dimmed">
              Choose whether to sync users from an external S3 YAML file or define them manually.
            </Text>

            <SegmentedControl
              fullWidth
              data={[
                { label: 'External user.yaml (S3)', value: 'true' },
                { label: 'Custom user.yaml (inline)', value: 'false' },
              ]}
              value={String(form.values.values.fence.usersync.usersync)}
              onChange={(val) =>
                form.setFieldValue('values.fence.usersync.usersync', val === 'true')
              }
            />
          </Stack>

          <Collapse in={isUsersyncEnabled}>
            <TextInput
              label="S3 URL to user.yaml"
              placeholder="s3://cdis-gen3-users/helm-test/user.yaml"
              {...form.getInputProps('values.fence.usersync.userYamlS3Path')}
              withAsterisk
            />
          </Collapse>

          <Collapse in={!isUsersyncEnabled}>
            <Textarea
              label="Custom Role Definitions (YAML format)"
              placeholder={`users:\n  admin:\n    policies:\n      - all_programs\n      - services`}
              autosize
              minRows={10}
              {...form.getInputProps('values.fence.USER_YAML')}
              withAsterisk
            />
            <Alert icon={<IconInfoCircle size={16} />} color="blue" mt="md">
              Define your roles and permissions carefully using YAML syntax.
              For more information, see the{' '}
              <Anchor
                href="https://github.com/uc-cdis/fence/blob/master/docs/additional_documentation/user.yaml_guide.md"
                target="_blank"
              >
                user.yaml guide
              </Anchor>.
            </Alert>
          </Collapse>
        </Stack>


      </Paper>
    </Stack>
  );
};

export default AuthStep;