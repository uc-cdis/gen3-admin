import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Stepper, Divider, Radio, Switch, TextInput, PasswordInput, Button, Text, Group, Paper, Container, Select, Stack, List, Loader, Box, Alert, Collapse, Badge, Table, Code, TagsInput, Anchor } from "@mantine/core";
import { IconCheck, IconX, IconAlertTriangle, IconChevronDown, IconChevronUp, IconRefresh, IconExternalLink } from "@tabler/icons-react";
import CSOCDiagram from "@/components/CSOCDiagram";
import TerraformExecutor, { buildTfvars } from '@/components/TerraformExecutor';
import GitOpsConnect from '@/components/GitOpsConnect';
import HostedZoneSetup from '@/components/HostedZoneSetup';
import PlanReview from '@/components/PlanReview';
import { parseApplyProgress } from '@/lib/applyProgress';

// The CSOC name becomes part of the work dir, the state key and S3 bucket
// names, so it is held to the strictest of those rules.
const CSOC_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const ROLE_ARN_PATTERN = /^arn:aws[a-z-]*:iam::[0-9]{12}:role\/[A-Za-z0-9+=,.@_/-]{1,512}$/;
const CERT_ARN_PATTERN = /^arn:aws[a-z-]*:acm:[a-z0-9-]+:[0-9]{12}:certificate\/[0-9a-f-]{36}$/;
const CIDR_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d|[12]\d|3[0-2])$/;
// Must match the API's rule: the password goes into YAML and a shell env
// file, so quotes, backslashes and $ / ` are not allowed.
const ADMIN_PASSWORD_PATTERN = /^[A-Za-z0-9 !#%&()*+,./:;<=>?@[\]^_{|}~-]{12,128}$/;
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!#%*+-=?@^_';

const STEPS = { welcome: 0, setup: 1, review: 2, provision: 3, install: 4, done: 5 };

// POSTs to the API and returns the body, or throws with the API's error
// message. An expired SSO session comes back with a code and the command
// that fixes it, which the error carries along.
async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (HTTP ${res.status})`);
    err.code = data.code;
    err.loginCommand = data.login_command;
    throw err;
  }
  return data;
}

const awsLookup = (path, body) => postJSON(`/api/aws/${path}`, body);

function validCidr(value) {
  const m = CIDR_PATTERN.exec(value);
  return !!m && m.slice(1, 5).every((o) => Number(o) <= 255) && Number(m[5]) > 0;
}

function generatePassword(length = 20) {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]).join('');
}

function StatusBadge({ status }) {
  const color = {
    installed: 'green', bootstrapped: 'cyan', applied: 'teal', planned: 'yellow', applying: 'blue',
    destroying: 'orange', destroyed: 'gray', failed: 'red',
  }[status] || 'gray';
  return <Badge color={color} variant="light">{status || 'new'}</Badge>;
}

// Where the wizard was, kept in this browser so a reload or a visit to
// another page comes back to it. Never credentials: typed-in keys are not
// saved, so a manual-credentials setup asks for them again.
const PROGRESS_KEY = 'gen3-csoc-bootstrap';

export default function Gen3BootstrapStepper() {
  const [active, setActive] = useState(STEPS.welcome);

  const [selectedRegion, setSelectedRegion] = useState('us-east-1');
  const [credentialSource, setCredentialSource] = useState('auto');
  const [availableProfiles, setAvailableProfiles] = useState([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [profilesError, setProfilesError] = useState(null);
  const [manualCredentials, setManualCredentials] = useState({
    accessKeyId: '',
    secretAccessKey: '',
    sessionToken: ''
  });
  const [roleArn, setRoleArn] = useState('');

  const [csocName, setCsocName] = useState('');
  // Terraform state bucket. It also holds the environment registry, which is
  // how the CSOC, once running in its own cluster, sees what was done here.
  const [stateBucket, setStateBucket] = useState('');
  const [bucketStatus, setBucketStatus] = useState(null);
  const [bucketChecking, setBucketChecking] = useState(false);
  const [bucketError, setBucketError] = useState(null);
  const [environments, setEnvironments] = useState(null);
  const [domainName, setDomainName] = useState('');
  const [keycloakHostname, setKeycloakHostname] = useState('');
  const [certificateArn, setCertificateArn] = useState('');
  const [validatingDomain, setValidatingDomain] = useState(false);
  // null until checked; the old initial value of true showed "Domain
  // Verified" before anything had been checked.
  const [domainValidation, setDomainValidation] = useState(null);
  // The hosted zone a resumed environment was planned with. Kept apart from
  // domainValidation, which an identity change clears: re-planning without
  // the zone would plan to delete the certificate it validated.
  const [resumedZoneId, setResumedZoneId] = useState('');
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityError, setIdentityError] = useState(null);
  const [availabilityZones, setAvailabilityZones] = useState([]);
  const [azError, setAzError] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [vpcCidr, setVpcCidr] = useState('172.24.16.0/20');
  // The vpc module's commons data bucket (with its logs bucket, CloudTrail
  // and fence-bot user). A CSOC has no use for it, and its default name,
  // <name>-data-bucket, is easily taken: bucket names are global.
  const [deployDataBucket, setDeployDataBucket] = useState(false);
  const [dataBucketName, setDataBucketName] = useState('');

  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [applied, setApplied] = useState(false);
  // The latest plan run, for the plan review. Null shows the latest one
  // the registry has.
  const [planRunId, setPlanRunId] = useState(null);
  // The run the executor shows, and its log so far, for the apply progress.
  const [shownRun, setShownRun] = useState(null);
  const shownLogs = useRef({ run: null, lines: [] });
  const logTimer = useRef(null);
  const [installed, setInstalled] = useState(false);

  // Install options
  const [allowedCidrs, setAllowedCidrs] = useState([]);
  const [myIpError, setMyIpError] = useState(null);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState('');
  const [showImageOptions, setShowImageOptions] = useState(false);
  const [apiImage, setApiImage] = useState('');
  const [frontendImage, setFrontendImage] = useState('');

  // GitOps: the repo CSOC's configuration goes into, and its latest PR
  const [gitops, setGitops] = useState(null);
  // 'direct' installs everything from this wizard; 'gitops' deploys it with
  // ArgoCD from a repo, every change a pull request.
  const [installMode, setInstallMode] = useState('direct');
  const [changingRepo, setChangingRepo] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [proposeError, setProposeError] = useState(null);
  const [gitopsError, setGitopsError] = useState(null);

  // Restore once, on load. The environment itself is resumed from the
  // registry when the bucket check lists it (below).
  const pendingRestore = useRef(null);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(PROGRESS_KEY) || 'null');
      if (saved?.csocName) {
        setCredentialSource(saved.credentialSource === 'manual' ? 'manual' : saved.credentialSource || 'auto');
        if (saved.selectedProfile) setSelectedProfile(saved.selectedProfile);
        setRoleArn(saved.roleArn || '');
        setSelectedRegion(saved.selectedRegion || 'us-east-1');
        setStateBucket(saved.stateBucket || '');
        setCsocName(saved.csocName);
        pendingRestore.current = saved;
        setActive(Math.min(saved.active ?? STEPS.welcome, STEPS.setup));
      }
    } catch {
      // A bad entry is ignored, and overwritten as soon as anything changes.
    }
    setRestored(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!restored) return;
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify({
      credentialSource, selectedProfile, roleArn, selectedRegion, stateBucket, csocName, active, planRunId,
    }));
  }, [restored, credentialSource, selectedProfile, roleArn, selectedRegion, stateBucket, csocName, active, planRunId]);

  const startOver = () => {
    window.localStorage.removeItem(PROGRESS_KEY);
    window.location.reload();
  };

  // The executor's log, shared at most once a second: the plan review and
  // diagram redraw from it.
  const onRunLogs = useCallback((lines, run) => {
    shownLogs.current = { run, lines };
    if (logTimer.current) return;
    logTimer.current = setTimeout(() => {
      logTimer.current = null;
      setShownRun({ ...shownLogs.current.run, lines: shownLogs.current.lines });
    }, 1000);
  }, []);
  useEffect(() => () => clearTimeout(logTimer.current), []);

  const applyProgress = useMemo(
    () => (shownRun && (shownRun.operation === 'apply' || shownRun.operation === 'destroy') ? parseApplyProgress(shownRun.lines) : null),
    [shownRun],
  );

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
      const response = await fetch('/api/aws/profiles');
      if (!response.ok) {
        throw new Error(`Failed to fetch profiles: ${response.statusText}`);
      }
      const data = await response.json();
      setAvailableProfiles((data.profiles || []).map(profile => ({ value: profile, label: profile })));
    } catch (err) {
      console.error('Error loading AWS profiles:', err);
      setProfilesError(err.message || 'Failed to load AWS profiles');
    } finally {
      setLoadingProfiles(false);
    }
  };

  const validRoleArn = !roleArn || ROLE_ARN_PATTERN.test(roleArn);

  // The identity every AWS check runs as -- the same one Terraform will use.
  // Each lookup sends it, so nothing depends on the server's own profile.
  const awsTarget = useMemo(() => {
    const target = { region: selectedRegion };
    if (credentialSource === 'profile' && selectedProfile) target.profile = selectedProfile;
    if (credentialSource === 'manual' && manualCredentials.accessKeyId) {
      target.credentials = {
        access_key_id: manualCredentials.accessKeyId,
        secret_access_key: manualCredentials.secretAccessKey,
        session_token: manualCredentials.sessionToken || undefined,
      };
    }
    if (roleArn && ROLE_ARN_PATTERN.test(roleArn)) target.role_arn = roleArn;
    return target;
  }, [selectedRegion, credentialSource, selectedProfile, manualCredentials, roleArn]);

  // State lives in the bucket's own region, which need not be the deploy region.
  const stateRegion = bucketStatus?.region || selectedRegion;
  const registryTarget = useMemo(
    () => ({ ...awsTarget, region: stateRegion, bucket: stateBucket }),
    [awsTarget, stateRegion, stateBucket],
  );

  const checkIdentity = useCallback(async () => {
    setIdentityLoading(true);
    setIdentityError(null);
    setIdentity(null);
    try {
      setIdentity(await awsLookup('identity', awsTarget));
    } catch (err) {
      setIdentityError(err);
    } finally {
      setIdentityLoading(false);
    }
  }, [awsTarget]);

  // Anything verified against one identity is void once the identity changes.
  useEffect(() => {
    setIdentity(null);
    setIdentityError(null);
    setDomainValidation(null);
    setBucketStatus(null);
    setEnvironments(null);
    // Auto and profile modes are checked straight away; manual keys wait for
    // the Validate button so a half-typed key is not sent on every keystroke.
    if (credentialSource === 'auto' || (credentialSource === 'profile' && selectedProfile)) {
      checkIdentity();
    }
    // checkIdentity changes with awsTarget, which is what should re-run this.
  }, [checkIdentity]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once the identity is (re)confirmed, re-check a bucket that was already
  // filled in, e.g. after resuming, so the setup is complete again without
  // another click.
  useEffect(() => {
    if (identity && BUCKET_PATTERN.test(stateBucket) && !bucketStatus && !bucketChecking) {
      checkBucket(false);
    }
  }, [identity]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zone letters are per account and some regions have fewer than three, so
  // they are listed rather than guessed as <region>a/b/c.
  useEffect(() => {
    setAvailabilityZones([]);
    setAzError(null);
    if (!identity) return;
    let cancelled = false;
    awsLookup('azs', awsTarget)
      .then((data) => { if (!cancelled) setAvailabilityZones(data.zones || []); })
      .catch((err) => { if (!cancelled) setAzError(err.message); });
    return () => { cancelled = true; };
  }, [identity, awsTarget]);

  const checkBucket = async (create = false) => {
    setBucketChecking(true);
    setBucketError(null);
    setEnvironments(null);
    try {
      const status = await awsLookup('state-bucket', { ...awsTarget, bucket: stateBucket, create });
      setBucketStatus(status);
      if (status.exists && !status.forbidden) {
        const region = status.region || selectedRegion;
        const list = await postJSON('/api/environments/list', { ...awsTarget, region, bucket: stateBucket });
        setEnvironments(list.environments || []);
      }
    } catch (err) {
      setBucketStatus(null);
      setBucketError(err.message);
    } finally {
      setBucketChecking(false);
    }
  };

  // The saved environment, resumed at the step it was left on once the
  // registry lists it.
  useEffect(() => {
    const saved = pendingRestore.current;
    if (!saved || !environments) return;
    pendingRestore.current = null;
    const env = environments.find((e) => e.name === saved.csocName);
    if (!env) return;
    resume(env);
    if (saved.active != null) setActive(saved.active);
    if (saved.planRunId) setPlanRunId(saved.planRunId);
  }, [environments]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleValidateDomain = async () => {
    setValidatingDomain(true);
    setDomainValidation(null);
    try {
      const result = await awsLookup('route53/zone', { ...awsTarget, domain: domainName });
      setDomainValidation(
        result.found
          ? result
          : { missing: true, error: `No public Route53 hosted zone serves ${result.domain} in account ${identity?.Account ?? 'this account'}.` },
      );
      // Keycloak goes beside the portal in its zone: portal.csoc.example.org
      // gets auth.csoc.example.org, not auth.portal.csoc.example.org.
      if (result.found && !keycloakHostname && result.zone_name !== domainName) {
        setKeycloakHostname(`auth.${result.zone_name}`);
      }
    } catch (err) {
      setDomainValidation({ error: err.message || 'Domain validation failed' });
    } finally {
      setValidatingDomain(false);
    }
  };

  // Keycloak sits beside the portal by default: auth.<portal hostname> is in
  // the same hosted zone and on the same certificate.
  const hostedZoneId = domainValidation?.hosted_zone_id || resumedZoneId;
  // A zone public DNS cannot find would leave the certificate unvalidated.
  const domainVerified = Boolean((domainValidation?.found && domainValidation.resolves !== false) || resumedZoneId);

  const effectiveKeycloakHostname = keycloakHostname || (domainName ? `auth.${domainName}` : '');

  const csocNameError =
    csocName && !CSOC_NAME_PATTERN.test(csocName)
      ? 'Lowercase letters, digits and hyphens, up to 40 characters, not starting or ending with a hyphen'
      : null;

  // Room for the -logs suffix the module adds.
  const dataBucketError =
    deployDataBucket && dataBucketName && !/^[a-z0-9][a-z0-9.-]{1,56}[a-z0-9]$/.test(dataBucketName)
      ? 'Lowercase letters, digits, dots and hyphens, 3 to 58 characters'
      : null;

  // The wizard's form, as saved to the registry for resuming. Never
  // credentials: only what describes the environment.
  const formState = {
    csocName, stateBucket, domainName, keycloakHostname, certificateArn,
    selectedRegion, vpcCidr, hostedZoneId, deployDataBucket, dataBucketName,
  };

  const resume = (env) => {
    const c = env.config || {};
    setCsocName(env.name);
    setSelectedRegion(c.selectedRegion || env.region || selectedRegion);
    setDomainName(c.domainName || '');
    setKeycloakHostname(c.keycloakHostname || '');
    setCertificateArn(c.certificateArn || '');
    setVpcCidr(c.vpcCidr || vpcCidr);
    setDeployDataBucket(Boolean(c.deployDataBucket));
    setDataBucketName(c.dataBucketName || '');
    setResumedZoneId(c.hostedZoneId || '');
    const isApplied = ['applied', 'bootstrapped', 'installed'].includes(env.status);
    setApplied(isApplied);
    setBootstrapped(['bootstrapped', 'installed'].includes(env.status));
    setInstalled(env.status === 'installed');
    setGitops(env.gitops || null);
    setInstallMode(env.install?.mode || (env.gitops ? 'gitops' : 'direct'));
    setActive(env.status === 'installed' ? STEPS.done : isApplied ? STEPS.install : STEPS.review);
  };

  const csocConfig = {
    vpc_name: csocName,
    aws_region: selectedRegion,
    // The module requires exactly three, taken from the account's real
    // zones for this region.
    availability_zones: availabilityZones.slice(0, 3),
    vpc_cidr_block: vpcCidr,
    hostname: domainName,
    csoc_hostname: domainName,
    keycloak_hostname: effectiveKeycloakHostname,
    hosted_zone_id: hostedZoneId,
    // Empty means Terraform requests one for both hostnames and validates
    // it through the hosted zone.
    certificate_arn: certificateArn,
    state_bucket: stateBucket,
    deploy_data_bucket: deployDataBucket,
    // Empty: the module names it <name>-data-bucket-<account>.
    data_bucket_name: deployDataBucket ? dataBucketName : '',
    user_yaml_bucket_name: `${csocName}-user-yaml`,
    kubernetes_namespace: 'csoc',
    es_linked_role: false,
    create_gitops_infra: true,
    deploy_cognito: false,
    // No Name here: every resource would inherit the same one, and the
    // modules name what they create themselves.
    default_tags: {
      Environment: 'csoc',
      ManagedBy: 'gen3-bootstrap',
      CSOC: csocName
    }
  };

  // Registers (or updates) the environment before anything runs, so every
  // run has a record to attach to and the setup can be resumed from here or
  // from the CSOC.
  const saveEnvironment = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await postJSON('/api/environments/save', {
        ...registryTarget,
        environment: {
          name: csocName,
          kind: 'csoc',
          module: 'csoc',
          region: selectedRegion,
          tfvars: buildTfvars(csocConfig),
          config: formState,
        },
      });
      return true;
    } catch (err) {
      setSaveError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Prefill the allowlist with the operator's own IP the first time the
  // install step is shown.
  useEffect(() => {
    if (active !== STEPS.install || allowedCidrs.length > 0) return;
    let cancelled = false;
    fetch('/api/aws/my-ip')
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error)))))
      .then((d) => { if (!cancelled) setAllowedCidrs([d.cidr]); })
      .catch((err) => { if (!cancelled) setMyIpError(err.message); });
    return () => { cancelled = true; };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // The repo and PR state, refreshed from GitHub while a PR is open.
  const refreshGitops = useCallback(async () => {
    if (!csocName || !stateBucket) return null;
    try {
      const data = await postJSON('/api/gitops/status', { ...registryTarget, environment: csocName });
      setGitops(data.connected ? data.gitops : null);
      setGitopsError(null);
      return data.gitops || null;
    } catch (err) {
      setGitopsError(err.message);
      return null;
    }
  }, [csocName, stateBucket, registryTarget]);

  useEffect(() => {
    if (active === STEPS.install) refreshGitops();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const pullRequest = gitops?.pull_request || null;
  const prOpen = pullRequest?.state === 'open';
  const prMerged = Boolean(pullRequest?.merged);

  useEffect(() => {
    if (active !== STEPS.install || !prOpen) return;
    const id = setInterval(refreshGitops, 15000);
    return () => clearInterval(id);
  }, [active, prOpen, refreshGitops]);

  // Called as soon as the bootstrap's log stream ends. The API records the
  // run a moment after that, and refuses to propose until it has, so the
  // first few refusals are waited out rather than shown.
  const proposeConfig = async () => {
    setProposing(true);
    setProposeError(null);
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const data = await postJSON('/api/gitops/propose-csoc', { ...registryTarget, environment: csocName });
          setGitops(data.gitops);
          return;
        } catch (err) {
          if (attempt >= 10 || !/run install-csoc first/.test(err.message)) throw err;
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    } catch (err) {
      setProposeError(err.message);
    } finally {
      setProposing(false);
    }
  };

  const badCidrs = allowedCidrs.filter((c) => !validCidr(c));
  const passwordError =
    adminPassword && !ADMIN_PASSWORD_PATTERN.test(adminPassword)
      ? 'At least 12 characters; no quotes, backslashes, $ or `'
      : null;
  const direct = installMode === 'direct';
  const installReady =
    (direct ? !gitops : Boolean(gitops) && !changingRepo) &&
    allowedCidrs.length > 0 && badCidrs.length === 0 &&
    ADMIN_PASSWORD_PATTERN.test(adminPassword) && adminPassword === adminPasswordConfirm;

  const installOptions = {
    allowed_cidrs: allowedCidrs,
    admin_email: adminEmail || undefined,
    admin_password: adminPassword,
    api_image: apiImage || undefined,
    frontend_image: frontendImage || undefined,
  };

  const awsContext = {
    region: selectedRegion,
    credentials: credentialSource === 'manual' ? manualCredentials : null,
    profile: credentialSource === 'profile' ? selectedProfile : null,
    roleArn: roleArn || null,
    identity,
    stateBucket,
    stateRegion,
  };

  const nextStep = async () => {
    if (active === STEPS.review && !(await saveEnvironment())) return;
    setActive((current) => Math.min(current + 1, STEPS.done));
  };
  const prevStep = () => setActive((current) => (current > 0 ? current - 1 : current));

  // Calculate estimated monthly cost based on configuration
  const calculateCost = () => {
    const costs = {
      eks: 73, // EKS cluster
      ec2: 120, // Worker nodes and Squid proxy
      vpc: 0, // VPC is free
      nat: 32.85, // NAT Gateway
      ebs: 40, // EBS volumes for cluster
      alb: 22.50, // Application Load Balancer
      route53: 0.50, // Hosted Zone
      dataTransfer: 50 // Estimated data transfer
    };

    return Object.values(costs).reduce((a, b) => a + b, 0);
  };

  const identityAlert = identityError && (
    identityError.code === 'sso_expired' ? (
      <Alert color="yellow" title="AWS SSO session expired" icon={<IconAlertTriangle />}>
        <Stack gap="xs">
          <Text size="sm">Sign in again from a terminal, then retry:</Text>
          <Code block>{identityError.loginCommand}</Code>
          <Group>
            <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} onClick={checkIdentity} loading={identityLoading}>
              Retry
            </Button>
          </Group>
        </Stack>
      </Alert>
    ) : (
      <Alert color="red" title="Unable to detect AWS account" icon={<IconX />}>
        {identityError.message}
        {credentialSource === 'auto' && (
          <Text size="sm" mt="xs">
            Try selecting an AWS profile or providing credentials manually.
          </Text>
        )}
      </Alert>
    )
  );

  const contentForStep = (step) => {
    switch (step) {
      case STEPS.welcome:
        return (
          <Stack gap="md">
            <Text size="xl" fw={600}>
              Welcome to the Gen3 CSOC Bootstrap
            </Text>

            <Text>
              This guided setup will provision the Gen3 Cloud Services Operations Center (CSOC)
              within your AWS account. The CSOC provides a centralized, secure environment for
              managing and deploying one or more Gen3 platforms.
            </Text>

            <List spacing="xs" size="sm">
              <List.Item>A VPC with public and private subnets, NAT, and a Squid egress proxy</List.Item>
              <List.Item>A managed EKS cluster and its worker nodes</List.Item>
              <List.Item>A certificate and DNS records for the CSOC and Keycloak hostnames</List.Item>
              <List.Item>
                The CSOC portal and Keycloak, behind a load balancer that only accepts the
                addresses you allow
              </List.Item>
            </List>

            <Text size="sm" c="dimmed">
              Estimated time: 45-60 minutes. Everything is recorded in your Terraform state
              bucket, so you can close this window and resume, here or from the CSOC once it is up.
            </Text>

            <CSOCDiagram />
          </Stack>
        );

      case STEPS.setup:
        return (
          <Stack gap="md">
            <Text size="xl" fw={600}>
              Environment Setup
            </Text>

            {/* Credential Source Selection */}
            <Radio.Group
              label="AWS Credentials"
              description="Choose how to authenticate with AWS"
              value={credentialSource}
              onChange={setCredentialSource}
            >
              <Stack mt="xs" gap="xs">
                <Radio value="auto" label="Auto-detect (use default AWS credentials)" />
                <Radio value="profile" label="Select AWS profile (including SSO profiles)" />
                <Radio value="manual" label="Provide credentials manually" />
              </Stack>
            </Radio.Group>

            {credentialSource === 'profile' && (
              <Stack gap="sm">
                {loadingProfiles ? (
                  <Group gap="xs">
                    <Loader size="sm" />
                    <Text>Loading AWS profiles…</Text>
                  </Group>
                ) : profilesError ? (
                  <Alert color="yellow" title="Unable to load profiles">
                    {profilesError}
                  </Alert>
                ) : (
                  <Select
                    label="AWS Profile"
                    placeholder="Select a profile"
                    data={availableProfiles}
                    value={selectedProfile}
                    onChange={setSelectedProfile}
                    searchable
                    required
                  />
                )}
              </Stack>
            )}

            {credentialSource === 'manual' && (
              <Stack gap="sm">
                <TextInput
                  label="AWS Access Key ID"
                  placeholder="AKIAIOSFODNN7EXAMPLE"
                  value={manualCredentials.accessKeyId}
                  onChange={(e) => setManualCredentials({ ...manualCredentials, accessKeyId: e.target.value })}
                  required
                />
                <PasswordInput
                  label="AWS Secret Access Key"
                  value={manualCredentials.secretAccessKey}
                  onChange={(e) => setManualCredentials({ ...manualCredentials, secretAccessKey: e.target.value })}
                  required
                />
                <PasswordInput
                  label="Session Token (Optional)"
                  placeholder="For temporary credentials"
                  value={manualCredentials.sessionToken}
                  onChange={(e) => setManualCredentials({ ...manualCredentials, sessionToken: e.target.value })}
                />
              </Stack>
            )}

            <TextInput
              label="Assume role (optional)"
              placeholder="arn:aws:iam::123456789012:role/gen3-deployer"
              description="Deploy into another account by assuming a role there, on top of the credentials above"
              value={roleArn}
              onChange={(e) => setRoleArn(e.target.value.trim())}
              error={!validRoleArn && 'Not an IAM role ARN'}
            />

            {credentialSource === 'manual' || roleArn ? (
              <Group>
                <Button
                  variant="light"
                  size="sm"
                  onClick={checkIdentity}
                  loading={identityLoading}
                  disabled={!validRoleArn || (credentialSource === 'manual' && (!manualCredentials.accessKeyId || !manualCredentials.secretAccessKey))}
                >
                  Validate Credentials
                </Button>
              </Group>
            ) : null}

            {identityLoading && (
              <Group gap="xs">
                <Loader size="sm" />
                <Text>Checking AWS identity…</Text>
              </Group>
            )}

            {identityAlert}

            {identity && (
              <Alert color="blue" title={`Deploying into AWS account ${identity.Account}`} icon={<IconCheck />}>
                <Text size="sm">As <Code>{identity.Arn}</Code></Text>
                {credentialSource === 'auto' && !roleArn && (
                  <Text size="sm" mt={6}>
                    These are your default credentials. If this is not the account the CSOC belongs
                    in, choose <b>Select AWS profile</b> above.
                  </Text>
                )}
              </Alert>
            )}

            <Divider my="xs" />

            <TextInput
              label="Terraform State Bucket"
              placeholder="my-org-gen3-terraform-state"
              description="Holds Terraform state and the record of every environment and run. Created for you if it does not exist."
              value={stateBucket}
              onChange={(e) => {
                setStateBucket(e.target.value.trim());
                setBucketStatus(null);
                setEnvironments(null);
              }}
              error={stateBucket && !BUCKET_PATTERN.test(stateBucket) && 'Not a valid S3 bucket name'}
              required
              rightSection={
                identity && BUCKET_PATTERN.test(stateBucket) && (
                  <Button size="xs" onClick={() => checkBucket(false)} loading={bucketChecking}>Check</Button>
                )
              }
              rightSectionWidth={80}
            />

            {bucketError && <Alert color="red" icon={<IconX />}>{bucketError}</Alert>}

            {bucketStatus?.forbidden && (
              <Alert color="red" title="Bucket not available" icon={<IconX />}>
                <Text size="sm">
                  {stateBucket} exists but is not owned by account {identity?.Account}, or this identity
                  cannot reach it. Bucket names are global; choose another.
                </Text>
              </Alert>
            )}

            {bucketStatus && !bucketStatus.exists && (
              <Alert color="yellow" title="Bucket does not exist" icon={<IconAlertTriangle />}>
                <Stack gap="xs">
                  <Text size="sm">
                    Create {stateBucket} in {selectedRegion}? It will be versioned, encrypted,
                    TLS-only and blocked from public access.
                  </Text>
                  <Group>
                    <Button size="xs" onClick={() => checkBucket(true)} loading={bucketChecking}>Create bucket</Button>
                  </Group>
                </Stack>
              </Alert>
            )}

            {bucketStatus?.exists && !bucketStatus.forbidden && (
              <Alert color={bucketStatus.versioning ? 'green' : 'yellow'} icon={bucketStatus.versioning ? <IconCheck /> : <IconAlertTriangle />}
                title={bucketStatus.created ? 'Bucket created' : 'Bucket ready'}>
                <Text size="sm">
                  {stateBucket} in {bucketStatus.region || selectedRegion}
                  {bucketStatus.versioning ? ', versioned.' : '. Versioning is off; turn it on so a bad apply can be rolled back.'}
                </Text>
              </Alert>
            )}

            {environments && environments.length > 0 && (
              <Paper withBorder p="sm" radius="md">
                <Text fw={600} size="sm" mb="xs">Environments in this bucket</Text>
                <Table>
                  <Table.Tbody>
                    {environments.map((env) => (
                      <Table.Tr key={env.name}>
                        <Table.Td><Text size="sm" fw={500}>{env.name}</Text></Table.Td>
                        <Table.Td><Badge variant="outline" size="sm">{env.kind}</Badge></Table.Td>
                        <Table.Td><StatusBadge status={env.status} /></Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>
                          {env.kind === 'csoc' && (
                            <Button size="xs" variant="light" onClick={() => resume(env)}>Resume</Button>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Paper>
            )}

            <Divider my="xs" />

            <TextInput
              label="CSOC Name"
              placeholder="my-csoc"
              description="Names the VPC, cluster, work dir and state key for this deployment"
              value={csocName}
              onChange={(e) => setCsocName(e.target.value.trim())}
              error={csocNameError || (environments?.some((e) => e.name === csocName) && 'An environment with this name exists; use Resume above to continue it')}
              required
            />

            <Select
              label="AWS Region"
              placeholder="Select region"
              data={regions}
              value={selectedRegion}
              onChange={setSelectedRegion}
            />
            {azError && <Text size="xs" c="red">{azError}</Text>}

            <TextInput
              label="CSOC Hostname"
              placeholder="portal.csoc.example.org"
              description="Where the portal will be served. Needs a public Route53 hosted zone in this account; Validate offers to create one."
              value={domainName}
              onChange={(e) => {
                setDomainName(e.target.value.trim().toLowerCase());
                setDomainValidation(null);
                setResumedZoneId('');
              }}
              required
              rightSection={
                domainName && identity && (
                  <Button size="xs" onClick={handleValidateDomain} loading={validatingDomain}>
                    Validate
                  </Button>
                )
              }
              rightSectionWidth={90}
            />

            {resumedZoneId && !domainValidation && (
              <Alert color="green" title="Hostname from the saved environment" icon={<IconCheck />}>
                <Text size="xs" c="dimmed">Zone ID: {resumedZoneId}. Edit the hostname to validate a different one.</Text>
              </Alert>
            )}

            {domainVerified && domainValidation?.found && (
              <Alert color="green" title="Domain Verified" icon={<IconCheck />}>
                <Stack gap={4}>
                  <Text size="sm">Served by Route53 hosted zone <b>{domainValidation.zone_name}</b></Text>
                  <Text size="xs" c="dimmed">Zone ID: {domainValidation.hosted_zone_id}</Text>
                </Stack>
              </Alert>
            )}

            {domainValidation?.found && domainValidation.resolves === false && (
              <Alert color="yellow" title="The zone is not delegated yet" icon={<IconAlertTriangle />}>
                <Text size="sm">
                  {domainValidation.zone_name} exists in this account, but public DNS does not find it, so
                  the certificate could not be validated. Delegate it from its parent zone:
                </Text>
                <Box mt="sm">
                  <HostedZoneSetup target={awsTarget} hostname={domainName} onReady={handleValidateDomain} />
                </Box>
              </Alert>
            )}

            {domainValidation?.error && (
              <Alert color={domainValidation.missing ? 'yellow' : 'red'} title={domainValidation.missing ? 'No hosted zone yet' : 'Domain Validation Failed'}
                icon={domainValidation.missing ? <IconAlertTriangle /> : <IconX />}>
                <Text size="sm">{domainValidation.error}</Text>
                {domainValidation.missing ? (
                  <Box mt="sm">
                    <HostedZoneSetup target={awsTarget} hostname={domainName} onReady={handleValidateDomain} />
                  </Box>
                ) : (
                  <Text size="xs" mt="xs">
                    The domain, or a parent of it, needs a public Route53 hosted zone in the
                    account you are deploying into.
                  </Text>
                )}
              </Alert>
            )}

            <div>
              <Button
                variant="subtle"
                onClick={() => setShowAdvanced(!showAdvanced)}
                rightSection={showAdvanced ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
              >
                Advanced Options
              </Button>

              <Collapse expanded={showAdvanced}>
                <Stack gap="sm" mt="md">
                  <TextInput
                    label="Keycloak Hostname"
                    placeholder={effectiveKeycloakHostname || 'auth.csoc.example.org'}
                    description="Login is served here; must be in the same hosted zone"
                    value={keycloakHostname}
                    onChange={(e) => setKeycloakHostname(e.target.value.trim().toLowerCase())}
                  />
                  <TextInput
                    label="Existing ACM certificate (optional)"
                    placeholder="arn:aws:acm:us-east-1:123456789012:certificate/…"
                    description="Must cover both hostnames. Leave empty to have one created and validated through Route53."
                    value={certificateArn}
                    onChange={(e) => setCertificateArn(e.target.value.trim())}
                    error={certificateArn && !CERT_ARN_PATTERN.test(certificateArn) && 'Not an ACM certificate ARN'}
                  />
                  <TextInput
                    label="VPC CIDR Block"
                    placeholder="172.24.16.0/20"
                    description="The IP range for the VPC"
                    value={vpcCidr}
                    onChange={(e) => setVpcCidr(e.target.value)}
                  />
                  <Switch
                    label="Commons data bucket"
                    description="An upload bucket with a logs bucket, a CloudTrail trail over them, and a fence-bot IAM user. Gen3 commons use it; a CSOC does not. Leave off unless you want the trail."
                    checked={deployDataBucket}
                    onChange={(e) => setDeployDataBucket(e.currentTarget.checked)}
                  />
                  {deployDataBucket && (
                    <TextInput
                      label="Data bucket name (optional)"
                      description="Bucket names are global across AWS. The logs bucket gets -logs added."
                      placeholder={`${csocName || 'my-csoc'}-data-bucket-${identity?.Account || '<account>'}`}
                      value={dataBucketName}
                      onChange={(e) => setDataBucketName(e.target.value.trim().toLowerCase())}
                      error={dataBucketError}
                    />
                  )}
                </Stack>
              </Collapse>
            </div>
          </Stack>
        );

      case STEPS.review: {
        const estimatedCost = calculateCost();

        return (
          <Stack gap="md">
            <Text size="xl" fw={600}>
              Review & Confirm
            </Text>

            <Paper withBorder p="md" radius="md">
              <Text fw={600} mb="sm">Configuration</Text>
              <Stack gap={6}>
                <Text><strong>CSOC Name:</strong> {csocName || '(not set)'}</Text>
                <Text><strong>Portal:</strong> https://{domainName || '(not set)'}</Text>
                <Text><strong>Keycloak:</strong> https://{effectiveKeycloakHostname || '(not set)'}</Text>
                <Text><strong>Certificate:</strong> {certificateArn || 'created by Terraform, validated in Route53'}</Text>
                <Text><strong>Region:</strong> {selectedRegion}</Text>
                <Text><strong>AWS Account:</strong> {identity?.Account || '(not detected)'}</Text>
                {roleArn && <Text><strong>Assumed role:</strong> {roleArn}</Text>}
                <Text><strong>State:</strong> s3://{stateBucket}/gen3-csoc/environments/{csocName}/</Text>
                <Text><strong>VPC CIDR:</strong> {vpcCidr}</Text>
                <Text><strong>Data bucket:</strong> {deployDataBucket
                  ? (dataBucketName || `${csocName}-data-bucket-${identity?.Account || '<account>'}`)
                  : 'none'}</Text>
              </Stack>
            </Paper>

            <Paper withBorder p="md" radius="md">
              <Text fw={600} mb="sm">Resources to be Created</Text>

              <Stack gap="xs">
                {/* Kept to what examples/csoc provisions; anything listed here that
                    the module does not create is a promise the run will not keep. */}
                <Text size="sm"><strong>Networking</strong></Text>
                <List size="sm" spacing={4} ml="md">
                  <List.Item>VPC ({vpcCidr}) across {availabilityZones.slice(0, 3).join(', ') || 'three availability zones'}</List.Item>
                  <List.Item>Public subnet, internet gateway and NAT gateway</List.Item>
                  <List.Item>Squid egress proxy</List.Item>
                  <List.Item>VPC flow logs</List.Item>
                </List>

                <Divider my="xs" />

                <Text size="sm"><strong>EKS Cluster</strong></Text>
                <List size="sm" spacing={4} ml="md">
                  <List.Item>EKS control plane (v1.33); worker nodes come from Karpenter, which runs on Fargate and starts nodes as pods need them</List.Item>
                  <List.Item>EBS CSI driver add-on and IAM roles for the load balancer controller and CSOC</List.Item>
                  <List.Item>An S3 endpoint; other traffic from the private subnets goes out through Squid</List.Item>
                </List>

                <Divider my="xs" />

                <Text size="sm"><strong>Then, in the Install step</strong></Text>
                <List size="sm" spacing={4} ml="md">
                  <List.Item>External Secrets, the load balancer controller, Keycloak and the CSOC portal. Secrets go to Secrets Manager</List.Item>
                  <List.Item>Optionally through a GitOps repo: ArgoCD deploys the configuration from a pull request you merge</List.Item>
                  <List.Item>One internet-facing load balancer, limited to the addresses you allow</List.Item>
                  <List.Item>DNS records for both hostnames</List.Item>
                </List>
              </Stack>
            </Paper>

            <Paper withBorder p="md" radius="md">
              <Group justify="space-between" mb="sm">
                <Text fw={600}>Rough Monthly Cost Estimate</Text>
                <Badge size="lg" color="blue">${estimatedCost.toFixed(2)}/month</Badge>
              </Group>
              <Text size="xs" c="dimmed">
                A fixed us-east-1 ballpark for the EKS control plane, nodes, Squid, NAT, EBS, the
                load balancer and data transfer; not a quote. Check AWS Cost Explorer once the
                environment is running.
              </Text>
            </Paper>

            {!setupComplete && (
              <Alert color="yellow" title="Configuration Incomplete" icon={<IconAlertTriangle />}>
                <Stack gap={4}>
                  {!identity && <Text size="sm">• AWS identity has not been verified</Text>}
                  {!(bucketStatus?.exists && !bucketStatus.forbidden) && <Text size="sm">• State bucket has not been checked</Text>}
                  {!csocName && <Text size="sm">• CSOC Name is required</Text>}
                  {!domainVerified && <Text size="sm">• Hostname has not been validated</Text>}
                  {availabilityZones.length < 3 && <Text size="sm">• Region needs at least 3 availability zones</Text>}
                </Stack>
              </Alert>
            )}

            {saveError && (
              <Alert color="red" title="Could not register the environment" icon={<IconX />}>{saveError}</Alert>
            )}

            <Text size="sm" c="dimmed">
              Next registers {csocName || 'the environment'} in the state bucket and starts Terraform.
            </Text>
          </Stack>
        );
      }

      case STEPS.provision:
        return (
          <Stack gap="md">
          {/* Above the run log, which runs to thousands of lines: this is
              what to read before pressing Apply. */}
          {(!applied || applyProgress) && (
            <PlanReview target={registryTarget} environment={csocName} runId={planRunId}
              progress={applyProgress} running={Boolean(shownRun?.running)} />
          )}
          <TerraformExecutor
            mode="embedded"
            autoExecute={!applied}
            operations={['init', 'plan', 'apply', 'destroy']}
            // What the install added outside Terraform (load balancers,
            // volumes, Karpenter's nodes, DNS, secrets) goes first, or the
            // destroy hangs on it or leaves it behind.
            beforeDestroy={applied ? 'uninstall-csoc' : null}
            moduleName="csoc"
            showOperationButtons={true}
            showConfig={true}
            showHistory={true}
            awsContext={awsContext}
            config={csocConfig}
            environment={csocName}
            workDir={`csoc-${csocName}`}
            onLogs={(lines, run) => onRunLogs(lines, { ...run, running: !lines.some((l) => /^\n?[✓✗]/.test(l)) })}
            onComplete={({ operation, executionId, replayed }) => {
              if (operation === 'plan') setPlanRunId(executionId);
              if (operation === 'apply') {
                setApplied(true);
                // Only a run that finished just now moves on; one replayed on
                // coming back leaves the page where it was.
                if (!replayed) setActive(STEPS.install);
              }
              if (operation === 'destroy') setApplied(false);
            }}
            onError={(error) => {
              console.error('CSOC provisioning failed:', error);
            }}
          />
          </Stack>
        );

      case STEPS.install:
        return (
          <Stack gap="md">
            <Text size="xl" fw={600}>Install CSOC</Text>
            <Text size="sm">
              Deploys the load balancer controller, External Secrets, Keycloak and the portal onto{' '}
              {csocName}, then points https://{domainName} and https://{effectiveKeycloakHostname} at
              them. Secrets are generated into Secrets Manager either way.
            </Text>

            <Paper withBorder p="md" radius="md">
              <Text fw={600} mb="xs">1. How to deploy</Text>
              <Radio.Group
                value={gitops ? 'gitops' : installMode}
                onChange={setInstallMode}
                mb={direct && !gitops ? 0 : 'sm'}
              >
                <Stack gap="xs">
                  <Radio value="direct" disabled={Boolean(gitops) || bootstrapped}
                    label="Directly, from this wizard"
                    description="No repo needed. Helm installs the same configuration ArgoCD would." />
                  <Radio value="gitops" disabled={bootstrapped && direct}
                    label="With a GitOps repo"
                    description="ArgoCD deploys the configuration from a pull request to your repo, via a GitHub App." />
                </Stack>
              </Radio.Group>
              {direct && !gitops ? null : gitops && !changingRepo ? (
                <Group justify="space-between">
                  <Group gap="xs">
                    <IconCheck size={16} color="green" />
                    <Anchor href={`https://github.com/${gitops.owner}/${gitops.repo}`} target="_blank" rel="noreferrer" size="sm">
                      {gitops.owner}/{gitops.repo}
                    </Anchor>
                    <Badge variant="light">{gitops.base_branch}</Badge>
                  </Group>
                  {!bootstrapped && (
                    <Button size="xs" variant="subtle" onClick={() => setChangingRepo(true)}>Change</Button>
                  )}
                </Group>
              ) : (
                <GitOpsConnect
                  target={registryTarget}
                  environment={csocName}
                  onConnected={(g) => { setGitops(g); setChangingRepo(false); }}
                />
              )}
              {gitopsError && <Text size="xs" c="red" mt="xs">{gitopsError}</Text>}
            </Paper>

            <Paper withBorder p="md" radius="md">
              <Text fw={600} mb="xs">2. Access and bootstrap</Text>
              <Stack gap="sm">
                <TagsInput
                  label="Allowed addresses"
                  description="Only these IPv4 CIDRs can reach the portal, Keycloak and the agent endpoint. Your current IP is filled in; add your team's or VPN's ranges. The cluster's own egress IP is added automatically."
                  value={allowedCidrs}
                  onChange={(v) => setAllowedCidrs(v.map((c) => (c.includes('/') ? c : `${c}/32`)))}
                  placeholder="203.0.113.7/32"
                  error={badCidrs.length > 0 ? `Not an IPv4 CIDR: ${badCidrs.join(', ')}` : null}
                  clearable
                />
                {myIpError && <Text size="xs" c="red">Could not detect your IP ({myIpError}); enter it yourself.</Text>}

                <TextInput
                  label="Admin email (optional)"
                  placeholder="you@example.org"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value.trim())}
                />
                <PasswordInput
                  label="Admin password"
                  description="For the CSOC user 'admin'. Sent once to the installer, kept in the cluster only until Keycloak has it, and not stored by this wizard or in the repo."
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  error={passwordError}
                  required
                />
                <PasswordInput
                  label="Confirm admin password"
                  value={adminPasswordConfirm}
                  onChange={(e) => setAdminPasswordConfirm(e.target.value)}
                  error={adminPasswordConfirm && adminPasswordConfirm !== adminPassword && 'Passwords do not match'}
                  required
                />
                <Group>
                  <Button size="xs" variant="light" onClick={() => {
                    const p = generatePassword();
                    setAdminPassword(p);
                    setAdminPasswordConfirm(p);
                  }}>
                    Generate password
                  </Button>
                  {adminPassword && adminPassword === adminPasswordConfirm && (
                    <Text size="xs" c="dimmed">Save it in your password manager before installing.</Text>
                  )}
                </Group>

                <div>
                  <Button
                    variant="subtle"
                    size="xs"
                    onClick={() => setShowImageOptions(!showImageOptions)}
                    rightSection={showImageOptions ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                  >
                    Images
                  </Button>
                  <Collapse expanded={showImageOptions}>
                    <Stack gap="sm" mt="sm">
                      <TextInput label="API image" placeholder="quay.io/cdis/csoc-api:master" value={apiImage} onChange={(e) => setApiImage(e.target.value.trim())} />
                      <TextInput label="Frontend image" placeholder="quay.io/cdis/csoc-frontend:master" value={frontendImage} onChange={(e) => setFrontendImage(e.target.value.trim())} />
                    </Stack>
                  </Collapse>
                </div>

                {!direct && !gitops && <Text size="xs" c="dimmed">Connect the GitOps repo first.</Text>}
                <TerraformExecutor
                  mode="embedded"
                  operations={['install-csoc']}
                  showOperationButtons={true}
                  showConfig={false}
                  showHistory={false}
                  canExecute={installReady}
                  awsContext={awsContext}
                  config={csocConfig}
                  environment={csocName}
                  workDir={`csoc-${csocName}`}
                  installOptions={installOptions}
                  onComplete={({ replayed }) => {
                    setBootstrapped(true);
                    // Only a bootstrap that just finished opens the PR, not one
                    // replayed on coming back to this step.
                    if (gitops && !replayed) proposeConfig();
                  }}
                />
              </Stack>
            </Paper>

            {bootstrapped && gitops && (
              <Paper withBorder p="md" radius="md">
                <Text fw={600} mb="xs">3. Review and merge</Text>
                <Stack gap="sm">
                  {pullRequest && (
                    <Group gap="xs">
                      <Anchor href={pullRequest.url} target="_blank" rel="noreferrer">
                        <Group gap={4}>Pull request #{pullRequest.number}<IconExternalLink size={14} /></Group>
                      </Anchor>
                      <Badge color={prMerged ? 'violet' : prOpen ? 'green' : 'gray'} variant="light">
                        {prMerged ? 'merged' : pullRequest.state}
                      </Badge>
                      {prOpen && <Loader size="xs" />}
                    </Group>
                  )}
                  {prOpen && (
                    <Text size="sm" c="dimmed">
                      Review the CSOC&apos;s configuration and merge it on GitHub. This page checks every 15 seconds.
                    </Text>
                  )}
                  {proposeError && <Alert color="red" icon={<IconX />} title="Could not open the pull request">{proposeError}</Alert>}
                  {!prOpen && !prMerged && (
                    <Group>
                      <Button size="xs" onClick={proposeConfig} loading={proposing}>Open pull request</Button>
                    </Group>
                  )}
                  {prOpen && (
                    <Group>
                      <Button size="xs" variant="subtle" leftSection={<IconRefresh size={14} />} onClick={refreshGitops}>Check now</Button>
                    </Group>
                  )}
                </Stack>
              </Paper>
            )}

            {(prMerged || (bootstrapped && !gitops)) && (
              <Paper withBorder p="md" radius="md">
                <Text fw={600} mb="xs">{gitops ? '4' : '3'}. Finish</Text>
                <Text size="sm" mb="sm">
                  {gitops
                    ? 'Waits for ArgoCD to deploy the merged configuration, then creates the DNS records.'
                    : "Adds the cluster's egress IP to the allowlist, waits for Keycloak and the portal, then creates the DNS records."}
                </Text>
                <TerraformExecutor
                  mode="embedded"
                  operations={['finish-csoc']}
                  showOperationButtons={true}
                  showConfig={false}
                  showHistory={false}
                  awsContext={awsContext}
                  config={csocConfig}
                  environment={csocName}
                  workDir={`csoc-${csocName}`}
                  onComplete={({ replayed }) => {
                    setInstalled(true);
                    // A finish replayed on coming back to this step stays here.
                    if (!replayed) setActive(STEPS.done);
                  }}
                />
              </Paper>
            )}
          </Stack>
        );

      case STEPS.done:
        return (
          <Stack gap="md">
            <Text size="xl" fw={600}>CSOC is ready</Text>
            <Alert color="green" icon={<IconCheck />} title={csocName}>
              <Stack gap={6}>
                <Anchor href={`https://${domainName}`} target="_blank" rel="noreferrer">
                  <Group gap={4}>https://{domainName}<IconExternalLink size={14} /></Group>
                </Anchor>
                <Text size="sm">Sign in as <b>admin</b> with the password you set.</Text>
              </Stack>
            </Alert>
            <Text size="sm" c="dimmed">
              DNS can take a few minutes to resolve. From here on, manage {csocName} and add Gen3
              commons from the CSOC itself; it reads the same state bucket, so it already has this
              environment&apos;s history.
              {gitops && (
                <>
                  {' '}Its configuration lives in{' '}
                  <Anchor href={`https://github.com/${gitops.owner}/${gitops.repo}`} target="_blank" rel="noreferrer" size="sm">{gitops.owner}/{gitops.repo}</Anchor>,
                  and every change to it is a pull request.
                </>
              )}
            </Text>
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

  const setupComplete = Boolean(
    csocName && !csocNameError && identity && validRoleArn &&
    bucketStatus?.exists && !bucketStatus.forbidden &&
    domainVerified && availabilityZones.length >= 3 &&
    (!certificateArn || CERT_ARN_PATTERN.test(certificateArn)) &&
    !dataBucketError,
  );

  // Disable next button if required fields are not filled
  const canProceed = () => {
    switch (active) {
      case STEPS.setup:
      case STEPS.review:
        return setupComplete && !saving;
      case STEPS.provision:
        return applied;
      case STEPS.install:
        return installed;
      default:
        return active < STEPS.done;
    }
  };

  // Forms read best at a fixed width; the Terraform and install steps (logs,
  // the plan review and its diagram) get the whole window.
  const wide = active === STEPS.provision || active === STEPS.install;

  return (
    <Container fluid px="xl" pb="lg">
      <Box>
        {/* The steps and Back/Next stay in view while a long step (the plan,
            the run log) scrolls under them. */}
        <Group justify="space-between" align="center" wrap="nowrap" gap="xl" mb="lg" py="md"
          style={{
            position: 'sticky', top: 0, zIndex: 100,
            background: 'var(--mantine-color-body)',
            borderBottom: '1px solid var(--mantine-color-default-border)',
          }}>
          <Stepper
            active={active}
            onStepClick={setActive}
            iconSize={28}
            size="sm"
            allowNextStepsSelect={false}
            style={{ flex: 1 }}
          >
            <Stepper.Step label="Welcome" description="What will be deployed" />
            <Stepper.Step label="Environment Setup" description="AWS, state, hostnames" />
            <Stepper.Step label="Review & Confirm" description="Check config" />
            <Stepper.Step label="Provisioning" description="Running Terraform" />
            <Stepper.Step label="Install CSOC" description="Deploy, access, DNS" />
            <Stepper.Step label="Done" description="Open the CSOC" />
          </Stepper>
          <Group gap="md" wrap="nowrap">
            {csocName && (
              <Button variant="subtle" color="gray" size="xs" onClick={startOver}
                title="Forget this setup in this browser. Nothing in AWS or the state bucket changes.">
                Start over
              </Button>
            )}
            <Button variant="default" onClick={prevStep} disabled={active === STEPS.welcome}>
              Back
            </Button>
            <Button onClick={nextStep} disabled={!canProceed()} loading={saving}>
              {active === STEPS.review ? "Provision" : "Next"}
            </Button>
          </Group>
        </Group>

        <Box maw={wide ? undefined : 960} mx={wide ? 0 : 'auto'}>
          {contentForStep(active)}
        </Box>
      </Box>
    </Container>
  );
}
