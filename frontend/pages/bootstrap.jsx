import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Stepper, Divider, Radio, Switch, TextInput, PasswordInput, Button, Text, Group, Paper, Container, Select, Stack, List, Loader, Box, Alert, Collapse, Badge, Table, Code, TagsInput, Anchor, Modal } from "@mantine/core";
import { IconCheck, IconX, IconAlertTriangle, IconChevronDown, IconChevronUp, IconRefresh, IconExternalLink, IconPlayerPlay } from "@tabler/icons-react";
import CSOCDiagram from "@/components/CSOCDiagram";
import { buildTfvars } from '@/components/TerraformExecutor';
import GitOpsConnect from '@/components/GitOpsConnect';
import HostedZoneSetup from '@/components/HostedZoneSetup';
import PlanReview from '@/components/PlanReview';
import StateBanner from '@/components/bootstrap/StateBanner';
import RunPanel from '@/components/bootstrap/RunPanel';
import TeardownPanel from '@/components/bootstrap/TeardownPanel';
import CertificateStep from '@/components/bootstrap/CertificateStep';
import Leftovers from '@/components/bootstrap/Leftovers';
import AdminAccount from '@/components/bootstrap/AdminAccount';
import { parseApplyProgress } from '@/lib/applyProgress';
import { deriveState, STEP_INDEX } from '@/lib/wizardState';
import { useTerraformRun } from '@/lib/useTerraformRun';
import { useEnvironment, useThrottled } from '@/lib/useEnvironment';

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

const STEPS = { welcome: 0, setup: 1, review: 2, provision: 3, certificate: 4, install: 5, done: 6 };

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
    installed: 'green', bootstrapped: 'cyan', applied: 'teal', planned: 'yellow',
    partial: 'red', destroyed: 'gray',
  }[status] || 'gray';
  return <Badge color={color} variant="light">{status || 'new'}</Badge>;
}

const hasCSOC = (s) => s === 'bootstrapped' || s === 'installed';
const hasInfra = (s) => s === 'applied' || hasCSOC(s);

// The zone the CSOC's hostnames are in: the hostname's parent, as
// HostedZoneSetup proposes it.
const zoneOf = (hostname) => {
  const labels = (hostname || '').split('.');
  return labels.length > 3 ? labels.slice(1).join('.') : hostname;
};

// The state once the state bucket, and the record in it, are gone too.
const BLANK = {
  id: 'blank', step: 'done', tone: 'gray', title: 'Back to a blank account',
  detail: 'Nothing the bootstrap created is left in AWS.',
  primary: { kind: 'start-over', label: 'Start over' }, secondary: [],
  ops: [], running: null, problem: null, lastRun: null, teardown: false, blocker: null,
};

// Stepper props for a step that is behind the active one but not done.
const notDone = (n) => ({
  completedIcon: <Text size="sm" fw={600} c="white">{n}</Text>,
  color: 'gray',
});

const NO_TEARDOWN = { open: false, armed: false, force: true, zone: false, bucket: false, zoneRecords: false, skipUninstall: false, uninstalled: false, started: [], phase: null, results: {}, plan: null };

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
  // The certificate the load balancer serves, chosen on the Certificate &
  // DNS step after the apply. Terraform does not make it.
  const [certificateArn, setCertificateArn] = useState('');
  // 'route53': the hostnames live in a public zone in this account, which
  // the wizard can create and delegate; 'self': DNS is run elsewhere, and
  // the records to create are shown instead.
  const [dnsMode, setDnsMode] = useState('route53');
  const [validatingDomain, setValidatingDomain] = useState(false);
  // null until checked; the old initial value of true showed "Domain
  // Verified" before anything had been checked.
  const [domainValidation, setDomainValidation] = useState(null);
  // The hosted zone a resumed environment was planned with. Only shown, to
  // say when the zone was recreated since: what Terraform gets is always the
  // zone found just now. Trusting this saved ID once sent a re-provision to
  // a zone the teardown had deleted, and the apply failed at its last step.
  const [resumedZoneId, setResumedZoneId] = useState('');
  // Why the last Plan or Apply was held back before it started.
  const [preflightError, setPreflightError] = useState(null);
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
  // The latest plan run, for the plan review. Null shows the latest one
  // the registry has.
  const [planRunId, setPlanRunId] = useState(null);

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
    // Only the form: where the environment stands comes from the registry.
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify({
      credentialSource, selectedProfile, roleArn, selectedRegion, stateBucket, csocName, active,
    }));
  }, [restored, credentialSource, selectedProfile, roleArn, selectedRegion, stateBucket, csocName, active]);

  const startOver = () => {
    window.localStorage.removeItem(PROGRESS_KEY);
    window.location.reload();
  };

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
    // The step comes from where the environment stands, not from where the
    // browser was: the two used to disagree after a run elsewhere.
    resume(env);
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
  const hostedZoneId = domainValidation?.hosted_zone_id || '';
  // A zone public DNS cannot find would leave the certificate unvalidated.
  const domainVerified = dnsMode === 'self'
    ? /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domainName)
    : Boolean(domainValidation?.found && domainValidation.resolves !== false);

  // A saved hostname is checked again as soon as there is an identity to
  // check it with, on every load: the zone may have gone since.
  useEffect(() => {
    if (dnsMode === 'route53' && identity && domainName && !domainValidation && !validatingDomain) handleValidateDomain();
  }, [identity, domainName, domainValidation, dnsMode]); // eslint-disable-line react-hooks/exhaustive-deps

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
    csocName, stateBucket, domainName, keycloakHostname, certificateArn, dnsMode,
    selectedRegion, vpcCidr, hostedZoneId, deployDataBucket, dataBucketName,
  };

  const resume = (env) => {
    const c = env.config || {};
    setCsocName(env.name);
    setSelectedRegion(c.selectedRegion || env.region || selectedRegion);
    setDomainName(c.domainName || '');
    setKeycloakHostname(c.keycloakHostname || '');
    setCertificateArn(c.certificateArn || '');
    setDnsMode(c.dnsMode === 'self' ? 'self' : 'route53');
    setVpcCidr(c.vpcCidr || vpcCidr);
    setDeployDataBucket(Boolean(c.deployDataBucket));
    setDataBucketName(c.dataBucketName || '');
    setResumedZoneId(c.hostedZoneId || '');
    setGitops(env.gitops || null);
    setInstallMode(env.install?.mode || (env.gitops ? 'gitops' : 'direct'));
    setActive(STEP_INDEX[deriveState({ env }).step]);
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
    // Only scopes the CSOC's permission to write DNS for commons now.
    hosted_zone_id: dnsMode === 'route53' ? hostedZoneId : '',
    // Empty means Terraform requests one for both hostnames and validates
    // it through the hosted zone.
    // The certificate comes after the apply (Certificate & DNS step), so a
    // zone that is gone or not delegated yet cannot fail the apply.
    create_certificate: false,
    certificate_arn: '',
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
  const saveEnvironment = async (configPatch = {}) => {
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
          config: { ...formState, ...configPatch },
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

  // ========== Where the environment stands ==========
  // Everything past setup reads the registry record, through deriveState.
  // wiped: the state bucket itself was deleted, taking the record with it.
  const [wiped, setWiped] = useState(false);
  const registryReady = Boolean(csocName && identity && bucketStatus?.exists && !bucketStatus.forbidden && !wiped);
  const { env, error: envError, refresh: refreshEnv } = useEnvironment({
    target: registryTarget, name: csocName, enabled: registryReady,
  });
  const authExpired = identityError?.code === 'sso_expired' ? identityError : envError?.code === 'sso_expired' ? envError : null;
  // The hosted zone, as checked just now. Missing or undelegated, it holds
  // back everything that needs it, and is fixed right there in the banner.
  const zoneProblem = Boolean(dnsMode === 'route53' && identity && domainName && domainValidation && !validatingDomain
    && !(domainValidation.found && domainValidation.resolves !== false));
  const blocker = authExpired
    ? { kind: 'auth', message: authExpired.message, loginCommand: authExpired.loginCommand }
    : envError ? { kind: 'registry', message: envError.message }
      : zoneProblem ? (domainValidation.found
        ? {
          kind: 'zone', title: `${domainValidation.zone_name} is not delegated yet`,
          message: `The zone exists in this account, but public DNS does not find it, so the certificate for ${domainName} cannot be validated. Delegate it from its parent zone. Right after a new delegation, resolvers can take up to five minutes to see it; Check again then.`,
        }
        : {
          kind: 'zone', title: `No hosted zone for ${domainName}`,
          message: `Terraform validates the certificate in a public hosted zone in this account, and there is none for ${domainName} (it may have been deleted with a teardown). Create it and delegate it here, then continue.`,
        })
        : null;
  const portalUrl = domainName ? `https://${domainName}` : undefined;

  // The certificate: the one chosen on the Certificate & DNS step, else one
  // Terraform made for an environment planned before that step existed.
  // Its status is ACM's, read live and polled while it is pending.
  const effectiveCert = certificateArn || (typeof env?.outputs?.certificate_arn === 'string' ? env.outputs.certificate_arn : '');
  const [certDetail, setCertDetail] = useState(null);
  const [certError, setCertError] = useState(null);
  // Each look at the certificate also does DNS validation's work: with a
  // Route 53 zone the API writes any validation record that is missing,
  // and either way it checks each record in the zone and in public DNS.
  const describeCert = useCallback(async () => {
    if (!effectiveCert || !identity) return;
    try {
      const res = await awsLookup('acm/ensure-validation', { ...awsTarget, arn: effectiveCert, write: dnsMode === 'route53' });
      setCertDetail(res.certificate);
      setCertError(null);
    } catch (err) {
      if (/no such certificate/i.test(err.message)) {
        setCertDetail({ arn: effectiveCert, status: 'NOT_FOUND', failure_reason: 'it is not in this account and region any more', domains: [] });
      } else {
        setCertError(err.message);
      }
    }
  }, [effectiveCert, identity, awsTarget, dnsMode]);
  useEffect(() => { setCertDetail(null); setCertError(null); describeCert(); }, [effectiveCert, identity, dnsMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const certPending = certDetail?.status === 'PENDING_VALIDATION';
  // Issued while this step is shown: on to Install, nothing to press.
  const lastCertStatus = useRef(null);
  useEffect(() => {
    const was = lastCertStatus.current;
    lastCertStatus.current = certDetail?.status || null;
    if (was === 'PENDING_VALIDATION' && certDetail?.status === 'ISSUED' && active === STEPS.certificate) setActive(STEPS.install);
  }, [certDetail?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!certPending) return undefined;
    const id = setInterval(describeCert, 10000);
    return () => clearInterval(id);
  }, [certPending, describeCert]);
  // A certificate covers a name exactly or by a one-level wildcard.
  const certCovers = (names, host) => names.some((n) => n === host || (n.startsWith('*.') && host.split('.').slice(1).join('.') === n.slice(2)));
  const certMissing = certDetail?.names?.length
    ? [domainName, effectiveKeycloakHostname].filter((h) => h && !certCovers(certDetail.names.map((n) => n.toLowerCase()), h))
    : [];
  const certDomains = certDetail?.domains || [];
  const certInput = effectiveCert
    ? {
      arn: effectiveCert, status: certDetail?.status, reason: certDetail?.failure_reason, missing: certMissing,
      recordsReady: certDetail?.status === 'PENDING_VALIDATION' ? certDomains.length > 0 && certDomains.every((d) => d.record) : undefined,
      inZone: certDomains.length > 0 && certDomains.every((d) => d.dns?.in_zone),
      public: certDomains.length > 0 && certDomains.every((d) => d.dns?.public),
      error: certError || undefined,
    }
    : null;
  const wizard = useMemo(
    () => (env ? deriveState({ env, blocker, portalUrl, cert: certInput, dns: dnsMode }) : null),
    [env, blocker?.kind, blocker?.title, blocker?.message, portalUrl, JSON.stringify(certInput), dnsMode], // eslint-disable-line react-hooks/exhaustive-deps
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const status = env?.status;
  const bootstrapped = hasCSOC(status);

  // The operation to start when a given run succeeds: plan after init. It
  // names the run it follows, so a run that never started, or any other
  // run ending, cannot set it off.
  const chain = useRef(null);
  const [teardown, setTeardown] = useState(NO_TEARDOWN);
  const teardownBusy = useRef(false);
  const disarm = (patch = {}) => setTeardown((t) => ({ ...t, armed: false, phase: null, ...patch }));

  const runner = useTerraformRun({
    workDir: `csoc-${csocName}`,
    environment: csocName,
    moduleName: 'csoc',
    tfvars: buildTfvars(csocConfig),
    awsContext,
    onStart: (run) => {
      refreshEnv();
      // Every run a teardown sets off is its own, including one chained
      // after another (destroy after init).
      setTeardown((t) => (t.armed ? { ...t, started: [...t.started, run.id] } : t));
    },
    onEnd: (run, ok) => {
      refreshEnv();
      const next = chain.current?.after === run.id ? chain.current.op : null;
      chain.current = null;
      if (!ok) return;
      if (run.operation === 'plan') setPlanRunId(run.id);
      if (run.operation === 'apply') setActive(STEPS.certificate);
      if (run.operation === 'install-csoc' && gitops) proposeConfig();
      if (run.operation === 'finish-csoc') setActive(STEPS.done);
      if (next) runOp(next);
    },
  });
  const shownLines = useThrottled(runner.lines, 1000);
  const applyProgress = useMemo(
    () => (runner.run?.operation === 'apply' ? parseApplyProgress(shownLines) : null),
    [runner.run, shownLines],
  );

  const fetchStoredLog = useCallback(async (id) => {
    const res = await fetch('/api/environments/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...registryTarget, name: csocName, run_id: id }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }, [registryTarget, csocName]);

  // Show the environment's last run: followed live while it goes, its log
  // otherwise. A run started elsewhere (another tab, the CSOC) is picked up
  // the same way. Showing it never acts on it.
  const lastRunId = env?.last_run?.id;
  const lastRunLive = env?.last_run?.status === 'running';
  useEffect(() => {
    if (!lastRunId || runner.starting || runner.run?.id === lastRunId) return;
    runner.attach(lastRunId, env.last_run.operation, { live: lastRunLive, fallbackLog: fetchStoredLog });
  }, [lastRunId]); // eslint-disable-line react-hooks/exhaustive-deps

  const runOp = async (op, { force = false } = {}) => {
    const started = await runner.start(op, {
      force, install: op === 'install-csoc' ? { ...installOptions, certificate_arn: effectiveCert || undefined } : null,
    });
    if (!started) chain.current = null;
    return started;
  };

  // Plan always initialises first: init is quick, and a changed module or
  // a fresh work dir needs it.
  const planFromScratch = async () => {
    const init = await runOp('init');
    if (init) chain.current = { after: init.id, op: 'plan' };
  };

  const stopRun = async () => {
    if (!window.confirm('Stop this run? It stops where it is. The environment keeps what it had settled, and you can run the step again.')) return;
    chain.current = null;
    disarm();
    if (await runner.stop()) setTimeout(refreshEnv, 3000);
  };

  // ========== Teardown ==========
  // Runs the steps in order, one at a time, each only once the registry has
  // recorded the one before it as succeeded.
  const [teardownZone, setTeardownZone] = useState('');
  // No zone of ours to delete when DNS is the operator's.
  useEffect(() => { setTeardownZone(dnsMode === 'route53' ? zoneOf(domainName) : ''); }, [domainName, dnsMode]);
  const [parentAccess, setParentAccessState] = useState('same');
  useEffect(() => {
    setParentAccessState(window.localStorage.getItem('gen3-csoc-parent-access') || 'same');
  }, []);
  const setParentAccess = (v) => {
    setParentAccessState(v);
    window.localStorage.setItem('gen3-csoc-parent-access', v);
  };
  const [profileNames, setProfileNames] = useState([]);
  useEffect(() => {
    if (!teardown.open && !wizard?.teardown) return;
    fetch('/api/aws/profiles').then((r) => (r.ok ? r.json() : {})).then((d) => setProfileNames(d.profiles || [])).catch(() => {});
  }, [teardown.open, wizard?.teardown]);

  const guardedTeardown = async (opts) => {
    const short = await sessionShort('teardown');
    if (!short) { startTeardown(opts); return; }
    const profile = selectedProfile || 'default';
    setConfirming({
      action: { kind: 'start-teardown', opts }, button: 'Tear down anyway', noName: true,
      title: short.left <= 0 ? 'Your AWS sign-in has ended' : `Your AWS sign-in ends in ${short.left} minutes`,
      body: `A teardown takes up to 45 minutes and stops part-way if the sign-in ends first. Sign in again from a terminal first: aws sso login --profile ${profile}`,
    });
  };
  const startTeardown = ({ force, zone, bucket, skipUninstall, zoneRecords = false }) => {
    setTeardown((t) => ({
      ...t, open: true, armed: true, force, zone, bucket, skipUninstall, zoneRecords,
      started: [], phase: null, results: {}, uninstalled: false,
      plan: { uninstall: hasCSOC(status), destroy: hasInfra(status) || status === 'partial' },
    }));
  };

  // A destroy initialises first, like a plan: the work dir may be stale,
  // or from before a module change.
  const teardownStep = async (op, opts) => {
    teardownBusy.current = true;
    const started = await runOp(op === 'destroy' ? 'init' : op, opts);
    teardownBusy.current = false;
    if (!started) { disarm(); return; }
    if (op === 'destroy') chain.current = { after: started.id, op: 'destroy' };
  };

  const deleteZone = async () => {
    teardownBusy.current = true;
    setTeardown((t) => ({ ...t, phase: 'zone' }));
    const parent = parentAccess === 'manual' ? undefined
      : parentAccess === 'same' ? awsTarget : { profile: parentAccess, region: awsTarget.region };
    try {
      const res = await fetch('/api/aws/route53/teardown', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...awsTarget, domain: teardownZone, confirm: teardownZone, delete_records: teardown.zoneRecords, parent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        disarm({ results: { ...teardown.results, zone: { error: data.error || `HTTP ${res.status}`, remaining: data.remaining } } });
        return;
      }
      const note = !data.deleted ? `There was no zone named ${teardownZone}.`
        : data.delegation === 'removed' ? `Deleted, and its NS records removed from ${data.parent_zone}.`
          : data.delegation === 'manual' ? `Deleted. Remove the NS records for ${teardownZone} from its parent zone yourself.`
            : 'Deleted. The parent zone had no NS records for it.';
      setTeardown((t) => ({ ...t, phase: null, results: { ...t.results, zone: { done: true, note } } }));
      setZoneLive('gone');
      // What was verified about the zone is void now.
      setDomainValidation(null);
    } catch (err) {
      disarm({ results: { ...teardown.results, zone: { error: err.message } } });
    } finally {
      teardownBusy.current = false;
    }
  };

  const deleteBucket = async () => {
    teardownBusy.current = true;
    setTeardown((t) => ({ ...t, phase: 'bucket' }));
    try {
      const data = await postJSON('/api/environments/delete-bucket', { ...registryTarget, confirm: stateBucket });
      setTeardown((t) => ({ ...t, armed: false, phase: null, results: { ...t.results, bucket: { done: true, note: `${data.objects} objects deleted.` } } }));
      setWiped(true);
      window.localStorage.removeItem(PROGRESS_KEY);
    } catch (err) {
      disarm({ results: { ...teardown.results, bucket: { error: err.message } } });
    } finally {
      teardownBusy.current = false;
    }
  };

  useEffect(() => {
    if (!teardown.armed || !env || runner.running || runner.starting || teardownBusy.current || chain.current) return;
    const r = env.last_run;
    const latest = teardown.started[teardown.started.length - 1];
    // Wait for the registry to record the run this teardown started.
    if (latest && (r?.id !== latest || r.status === 'running')) return;
    if (r?.status === 'running') return;
    if (latest && r.status !== 'succeeded') { disarm(); return; }
    if (latest && r.operation === 'uninstall-csoc' && !teardown.uninstalled) {
      setTeardown((t) => ({ ...t, uninstalled: true }));
      return;
    }
    // The uninstall goes before every destroy attempt, a retry included: it
    // is quick, and it clears what would stop the destroy again (the squid
    // lambda's record, load balancers, nodes).
    const infra = hasInfra(env.status) || env.status === 'partial';
    if (infra && !teardown.uninstalled && !teardown.skipUninstall) {
      teardownStep('uninstall-csoc', { force: teardown.force });
      return;
    }
    if (infra) { teardownStep('destroy'); return; }
    if (teardown.zone && !teardown.results.zone?.done) { deleteZone(); return; }
    if (teardown.bucket && !teardown.results.bucket?.done) { deleteBucket(); return; }
    disarm();
  }, [teardown, env, runner.running, runner.starting]); // eslint-disable-line react-hooks/exhaustive-deps

  // A run that could not start ends the teardown: its error is shown.
  useEffect(() => { if (runner.error) disarm(); }, [runner.error]);

  const [showInstallForm, setShowInstallForm] = useState(false);
  useEffect(() => { if (!bootstrapped) setShowInstallForm(false); }, [bootstrapped]);
  // The run shown is the one that failed (or was stopped, or lost).
  const runFailed = Boolean(wizard?.problem && wizard.problem.id === runner.run?.id && !runner.running);
  const planning = runner.running && ['init', 'plan'].includes(runner.run?.operation);

  // Whether the CSOC's hosted zone is still there, asked of AWS rather than
  // remembered, once the environment is destroyed.
  const [zoneLive, setZoneLive] = useState(null);
  const checkZone = useCallback(async () => {
    if (!teardownZone || !identity) return;
    setZoneLive('checking');
    try {
      const r = await awsLookup('route53/zone', { ...awsTarget, domain: teardownZone });
      setZoneLive(r.found && r.zone_name === teardownZone ? 'exists' : 'gone');
    } catch {
      setZoneLive('error');
    }
  }, [teardownZone, identity, awsTarget]);
  useEffect(() => {
    if (status === 'destroyed' && !teardown.armed) checkZone();
  }, [status, teardown.armed, teardown.results.zone?.done, checkZone]);

  // A certificate chosen (or cleared) is saved with the environment at once,
  // so a reload, or the CSOC itself, knows it.
  const chooseCert = async (arn) => {
    setCertificateArn(arn);
    setCertDetail(null);
    setCertError(null);
    await saveEnvironment({ certificateArn: arn });
  };

  // Typed confirmation for what cannot be undone and the plan review alone
  // might not make plain: an apply that destroys running infrastructure, or
  // a destroy without the uninstall.
  const [confirming, setConfirming] = useState(null);
  const [confirmTyped, setConfirmTyped] = useState('');
  // A long run must end before the SSO sign-in does, or it fails part-way.
  const LONG_RUN_MIN = { apply: 45, destroy: 45, teardown: 45, 'install-csoc': 15, 'finish-csoc': 15, 'uninstall-csoc': 15 };
  const sessionShort = async (what) => {
    const need = LONG_RUN_MIN[what];
    if (!need) return null;
    try {
      const id = await awsLookup('identity', awsTarget);
      if (!id.session_expires_at) return null;
      const left = Math.floor((new Date(id.session_expires_at).getTime() - Date.now()) / 60000);
      return left < need ? { left, need } : null;
    } catch (err) {
      setIdentityError(err);
      return { left: 0, need };
    }
  };
  const askFirst = (action) => {
    if (action.confirmed) return false;
    if (action.kind === 'run' && action.confirm) {
      setConfirming({
        action, button: 'Apply',
        title: `Apply: ${action.confirm.destroy} resource${action.confirm.destroy === 1 ? '' : 's'} destroyed or replaced`,
        body: 'This plan destroys or replaces resources that exist now (they are in the red box in the plan review). Anything only they held is lost.',
      });
      return true;
    }
    if (action.kind === 'teardown' && action.skipUninstall) {
      setConfirming({
        action, button: 'Destroy anyway',
        title: 'Destroy without finishing the uninstall?',
        body: 'The uninstall did not finish, so load balancers, EBS volumes, Karpenter nodes or DNS records it would have removed may still be there. The destroy can then hang on them, or leave them behind, still costing. Use this when the cluster cannot be reached at all; otherwise Retry teardown with Force.',
      });
      return true;
    }
    return false;
  };

  // On a step behind where the environment stands, the one thing to do is
  // to go there: its action may need a form on that step.
  const STEP_NAME = { provision: 'Provision', certificate: 'Certificate', install: 'Install', done: 'Done' };
  const bannerState = wizard && !wizard.running && !wizard.blocker && STEP_INDEX[wizard.step] > active && active >= STEPS.provision
    ? { ...wizard, primary: { kind: 'goto', step: wizard.step, label: `Continue to ${STEP_NAME[wizard.step]}` }, secondary: [] }
    : wizard;

  // Tear down from Advanced: only when something exists to remove.
  const teardownAdvanced = env && (hasInfra(status) || status === 'partial')
    ? () => onAction({ kind: 'teardown', label: 'Tear down' }) : null;

  // ========== Actions ==========
  const onAction = async (action) => {
    if (askFirst(action)) {
      setConfirmTyped('');
      return;
    }
    const what = action.kind === 'run' ? action.op : action.kind === 'teardown' && ['uninstall-failed', 'destroy-failed'].includes(wizard?.id) ? 'teardown' : null;
    if (what && !action.sessionChecked) {
      const short = await sessionShort(what);
      if (short) {
        const profile = selectedProfile || 'default';
        setConfirming({
          action: { ...action, sessionChecked: true }, button: 'Run anyway', noName: true,
          title: short.left <= 0 ? 'Your AWS sign-in has ended' : `Your AWS sign-in ends in ${short.left} minutes`,
          body: `This takes up to ${short.need} minutes and fails part-way if the sign-in ends first. Sign in again from a terminal, then run it: aws sso login --profile ${profile}`,
        });
        return;
      }
    }
    switch (action.kind) {
      case 'start-teardown':
        startTeardown(action.opts);
        break;
      case 'cert-records':
      case 'cert-check':
        describeCert();
        break;
      case 'cert-change':
        chooseCert('');
        break;
      case 'run':
        if (action.needsForm && bootstrapped && !showInstallForm) {
          // Bootstrapping again needs the admin password again: show the form.
          setActive(STEPS.install);
          setShowInstallForm(true);
          break;
        }
        setActive(['init', 'plan', 'apply'].includes(action.op) ? STEPS.provision : STEPS.install);
        preflight(action.op).then((ok) => {
          if (!ok) return;
          if (action.op === 'plan') planFromScratch();
          else runOp(action.op, { force: action.force });
        });
        break;
      case 'start-over':
        startOver();
        break;
      case 'stop':
        stopRun();
        break;
      case 'goto':
        setActive(STEP_INDEX[action.step]);
        break;
      case 'teardown':
        setActive(STEPS.done);
        if (['uninstall-failed', 'destroy-failed'].includes(wizard?.id)) {
          // Confirmed when it started: a retry picks up where it stopped.
          startTeardown({ force: teardown.force, zone: teardown.zone, bucket: false, skipUninstall: Boolean(action.skipUninstall) });
        } else {
          setTeardown((t) => ({ ...t, open: true, skipUninstall: Boolean(action.skipUninstall) }));
        }
        break;
      case 'propose':
        proposeConfig();
        break;
      case 'retry-check':
        if (blocker?.kind === 'zone') {
          handleValidateDomain();
        } else {
          checkIdentity();
          refreshEnv();
        }
        break;
      default:
    }
  };

  // What Terraform will rely on is checked once more right before it runs:
  // the hosted zone its certificate is validated in. A plan does not look
  // the zone up; only the apply does, near its end.
  const preflight = async (op) => {
    setPreflightError(null);
    if (!['plan', 'apply', 'install-csoc', 'finish-csoc'].includes(op) || dnsMode !== 'route53') return true;
    try {
      const r = await awsLookup('route53/zone', { ...awsTarget, domain: domainName });
      const zone = r.found ? r.hosted_zone_id : null;
      if (!zone || r.resolves === false) {
        // Shown as the zone blocker in the banner, with the fix in it.
        setDomainValidation(r.found ? r : { missing: true, error: `No public Route53 hosted zone serves ${domainName} any more.` });
        return false;
      }
      if (zone !== hostedZoneId) {
        // A recreated zone: the configuration picks up its ID now, and an
        // apply of a plan made with the old one must be planned again.
        setDomainValidation(r);
        if (op === 'apply') {
          setPreflightError(`The hosted zone for ${domainName} was recreated since the plan. Plan again so Terraform uses ${zone}.`);
          return false;
        }
      }
      return true;
    } catch (err) {
      setPreflightError(`Could not check the hosted zone for ${domainName}: ${err.message}`);
      return false;
    }
  };

  const actionState = (action) => {
    if (action.kind === 'stop') return {};
    if (action.kind === 'propose') return { loading: proposing };
    if (action.kind === 'retry-check') return { loading: identityLoading || validatingDomain };
    if (action.kind !== 'run') return {};
    if (runner.starting) return { disabled: true, loading: true };
    if (!setupComplete) {
      return {
        disabled: true,
        reason: !identity ? 'Checking the AWS identity…'
          : validatingDomain ? `Checking the hosted zone for ${domainName}…`
            : !domainVerified ? `The hosted zone for ${domainName} is missing or not delegated: fix it on Environment Setup.`
              : 'Finish Environment Setup first.',
      };
    }
    if (action.needsForm && bootstrapped && !showInstallForm) return {};
    if (action.needsForm && !installReady) {
      return { disabled: true, reason: active === STEPS.install ? 'Fill in the allowed addresses and the admin password below.' : 'Fill in the allowed addresses and the admin password on the Install step.' };
    }
    return {};
  };

  const nextStep = async () => {
    if (active === STEPS.review) {
      if (!(await saveEnvironment())) return;
      setActive(STEPS.provision);
      const saved = await refreshEnv();
      // Provision means plan, unless something already exists to keep.
      const s = saved?.status;
      if (!saved?.last_run || (!hasInfra(s) && saved.last_run.status !== 'running')) planFromScratch();
      return;
    }
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
              description={dnsMode === 'route53'
                ? 'Where the portal will be served. Validate checks the Route 53 zone for it, and offers to create and delegate one.'
                : 'Where the portal will be served. You create its DNS record once the install has a load balancer.'}
              value={domainName}
              onChange={(e) => {
                setDomainName(e.target.value.trim().toLowerCase());
                setDomainValidation(null);
                setResumedZoneId('');
              }}
              required
              rightSection={
                dnsMode === 'route53' && domainName && identity && (
                  <Button size="xs" onClick={handleValidateDomain} loading={validatingDomain}>
                    Validate
                  </Button>
                )
              }
              rightSectionWidth={90}
            />

            <Radio.Group label="DNS for the hostnames" value={dnsMode} onChange={(v) => { setDnsMode(v); setDomainValidation(null); }}>
              <Stack gap={6} mt={4}>
                <Radio value="route53" label="A Route 53 hosted zone in this account"
                  description="The wizard can create the zone and delegate it from its parent, write the certificate's validation records, and point the hostnames at the load balancer." />
                <Radio value="self" label="I manage DNS myself"
                  description="Anywhere else (another provider, another account). The wizard shows the validation records and, after the install, the two CNAMEs to create." />
              </Stack>
            </Radio.Group>

            {dnsMode === 'route53' && resumedZoneId && domainValidation?.found && domainValidation.hosted_zone_id !== resumedZoneId && (
              <Alert color="yellow" title="The hosted zone was recreated" icon={<IconAlertTriangle />}>
                <Text size="sm">
                  {csocName} was planned with zone {resumedZoneId}; {domainValidation.zone_name} is now{' '}
                  {domainValidation.hosted_zone_id}. The next plan puts the certificate&apos;s validation records in the new one.
                </Text>
              </Alert>
            )}

            {dnsMode === 'route53' && domainVerified && domainValidation?.found && (
              <Alert color="green" title="Domain Verified" icon={<IconCheck />}>
                <Stack gap={4}>
                  <Text size="sm">Served by Route53 hosted zone <b>{domainValidation.zone_name}</b></Text>
                  <Text size="xs" c="dimmed">Zone ID: {domainValidation.hosted_zone_id}</Text>
                </Stack>
              </Alert>
            )}

            {dnsMode === 'route53' && domainValidation?.found && domainValidation.resolves === false && (
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

            {dnsMode === 'route53' && domainValidation?.error && (
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
                <Text><strong>Certificate:</strong> chosen after the infrastructure is up (request, import or existing, on the Certificate &amp; DNS step)</Text>
                <Text><strong>DNS:</strong> {dnsMode === 'route53' ? `Route 53 zone ${domainValidation?.zone_name || ''}` : 'managed by you'}</Text>
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
            {planning ? (
              <Paper withBorder p="md" radius="md">
                <Group gap="xs"><Loader size="xs" /><Text size="sm">Working out the plan. It appears here when it is ready.</Text></Group>
              </Paper>
            ) : env && ['planned', 'partial'].includes(status) || applyProgress ? (
              <PlanReview target={registryTarget} environment={csocName} runId={planRunId}
                progress={applyProgress} running={runner.running} />
            ) : null}
            <RunPanel runner={runner} failed={runFailed} ops={wizard?.ops || []} disabled={!setupComplete}
              onRun={(op) => onAction({ kind: 'run', op, needsForm: op === 'install-csoc' })} onTeardown={teardownAdvanced}
              config={csocConfig} showConfig />
          </Stack>
        );

      case STEPS.certificate:
        return (
          <Stack gap="md">
            <Text size="xl" fw={600}>Certificate &amp; DNS</Text>
            <Text size="sm">
              The CSOC&apos;s load balancer serves https://{domainName} and https://{effectiveKeycloakHostname} with an
              ACM certificate in {selectedRegion}. {dnsMode === 'route53'
                ? 'Its validation records, and later the hostnames, go in the Route 53 zone.'
                : 'You create its validation records, and later the hostnames, wherever your DNS is hosted.'}
            </Text>
            <CertificateStep target={awsTarget} hostnames={[domainName, effectiveKeycloakHostname].filter(Boolean)}
              detail={effectiveCert ? (certDetail || { arn: effectiveCert, status: '', domains: [] }) : null}
              dnsMode={dnsMode} onChosen={chooseCert} onChange={() => chooseCert('')} disabled={Boolean(blocker)} />
            <RunPanel runner={runner} failed={runFailed} ops={wizard?.ops || []} disabled={!setupComplete}
              onRun={(op) => onAction({ kind: 'run', op, needsForm: op === 'install-csoc' })} onTeardown={teardownAdvanced} />
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

            {bootstrapped && !showInstallForm && (
              <Paper withBorder p="md" radius="md">
                <Text fw={600} mb="xs">2. Bootstrapped</Text>
                <Stack gap={4}>
                  <Text size="sm"><b>Mode:</b> {env?.install?.mode === 'gitops' ? 'GitOps' : 'direct, from this wizard'}</Text>
                  <Text size="sm"><b>Allowed addresses:</b> {(env?.install?.allowed_cidrs || []).join(', ') || '(none recorded)'}</Text>
                  {env?.install?.egress_ip && <Text size="sm"><b>Cluster egress IP:</b> {env.install.egress_ip} (always allowed)</Text>}
                  {env?.install?.admin_email && <Text size="sm"><b>Admin email:</b> {env.install.admin_email}</Text>}
                  <Text size="xs" c="dimmed" mt={4}>To change these, use Bootstrap under Advanced below; it asks for the admin password again.</Text>
                </Stack>
              </Paper>
            )}

            {(!bootstrapped || showInstallForm) && (
            <Paper withBorder p="md" radius="md">
              <Text fw={600} mb="xs">2. Access and bootstrap</Text>
              {/* Read-only while the bootstrap runs with what it was given. */}
              <fieldset disabled={runner.running} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
                {!runner.running && (
                  <Text size="xs" c="dimmed">
                    {installReady ? 'Ready: press Bootstrap CSOC in the banner above.' : 'Needs at least one allowed address and a confirmed admin password.'}
                  </Text>
                )}
              </Stack>
              </fieldset>
            </Paper>
            )}

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
                </Stack>
              </Paper>
            )}

            {(prMerged || (bootstrapped && !gitops)) && (
              <Paper withBorder p="md" radius="md">
                <Text fw={600} mb="xs">{gitops ? '4' : '3'}. Finish</Text>
                <Text size="sm">
                  {gitops
                    ? 'Waits for ArgoCD to deploy the merged configuration, then creates the DNS records.'
                    : "Adds the cluster's egress IP to the allowlist, waits for Keycloak and the portal, then creates the DNS records."}
                  {status === 'installed' ? ' Done.' : ''}
                </Text>
              </Paper>
            )}

            <RunPanel runner={runner} failed={runFailed} ops={wizard?.ops || []} disabled={!setupComplete}
              onRun={(op) => onAction({ kind: 'run', op, needsForm: op === 'install-csoc' })} onTeardown={teardownAdvanced} />
          </Stack>
        );

      case STEPS.done: {
        // One body per state: the portal, the teardown form, the teardown
        // as it runs or where it stopped, or what is left after it.
        const tearingDown = teardown.armed || ['uninstall-failed', 'destroy-failed'].includes(wizard?.id)
          || (wizard?.id === 'running' && wizard.teardown);
        let body;
        if (wiped) {
          body = (
            <Alert color="gray" icon={<IconCheck />} title="Back to a blank account">
              <Text size="sm">
                {csocName}, its hosted zone and the state bucket {stateBucket} are gone. Nothing the
                bootstrap created is left in AWS.
              </Text>
            </Alert>
          );
        } else if (!env) {
          body = <Text size="sm" c="dimmed">Nothing has been set up yet.</Text>;
        } else if (tearingDown) {
          body = (
            <>
              <TeardownPanel mode="progress" env={env} teardown={teardown} runner={runner} stateBucket={stateBucket}
                zoneName={teardownZone} />
              <RunPanel runner={runner} failed={runFailed} advanced={false} />
            </>
          );
        } else if (status === 'destroyed') {
          body = (
            <>
              <Leftovers
                zoneName={teardownZone} zone={zoneLive} zoneResult={teardown.results.zone} onDeleteZone={deleteZone}
                parentAccess={parentAccess} setParentAccess={setParentAccess} profiles={profileNames}
                stateBucket={stateBucket} onDeleteBucket={deleteBucket} bucketResult={teardown.results.bucket}
                busy={teardown.phase} blocked={Boolean(blocker)}
              />
              <RunPanel runner={runner} failed={runFailed} advanced={false} />
            </>
          );
        } else if (teardown.open) {
          body = (
            <TeardownPanel mode="form" env={env} teardown={teardown} runner={runner}
              blocked={Boolean(blocker) || !setupComplete} onStart={guardedTeardown}
              onCancel={() => setTeardown(NO_TEARDOWN)} zoneName={teardownZone} setZoneName={setTeardownZone}
              parentAccess={parentAccess} setParentAccess={setParentAccess} profiles={profileNames} stateBucket={stateBucket} />
          );
        } else if (status === 'installed') {
          body = (
            <>
            <Alert color="green" icon={<IconCheck />} title={csocName}>
              <Stack gap={6}>
                <Anchor href={`https://${domainName}`} target="_blank" rel="noreferrer">
                  <Group gap={4}>https://{domainName}<IconExternalLink size={14} /></Group>
                </Anchor>
                <Text size="sm">Keycloak: https://{effectiveKeycloakHostname}. Sign in as <b>admin</b> with the password you set.</Text>
                {env.install?.egress_ip && <Text size="sm">Cluster egress IP: {env.install.egress_ip}</Text>}
                {dnsMode === 'self' && (
                  <Stack gap={4} mt={4}>
                    <Text size="sm" fw={500}>Create these records where your DNS is hosted:</Text>
                    <Code block>
                      {[domainName, effectiveKeycloakHostname].map((h) => `${h}.  60  IN  CNAME  ${env.install?.load_balancer || '<the load balancer, shown by the finish>'}.`).join('\n')}
                    </Code>
                  </Stack>
                )}
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
            </Alert>
            <AdminAccount target={registryTarget} environment={csocName} />
            </>
          );
        } else {
          body = <Text size="sm" c="dimmed">The CSOC is not installed yet; the banner says what comes next.</Text>;
        }
        return <Stack gap="md">{body}</Stack>;
      }

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
    !dataBucketError,
  );

  // Disable next button if required fields are not filled
  const canProceed = () => {
    switch (active) {
      case STEPS.setup:
      case STEPS.review:
        return setupComplete && !saving;
      case STEPS.provision:
      case STEPS.certificate:
      case STEPS.install:
        // On to where the environment stands, never past it.
        return Boolean(wizard) && active < STEP_INDEX[wizard.step];
      default:
        return active < STEPS.done;
    }
  };

  // Forms read best at a fixed width; the Terraform and install steps (logs,
  // the plan review and its diagram) get the whole window.
  const wide = active >= STEPS.provision;

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
            <Stepper.Step label="Welcome" description="What it builds" />
            <Stepper.Step label="Setup" description="AWS, state, names" />
            <Stepper.Step label="Review" description="Check config" />
            {/* A step is ticked for what exists, not for having been visited:
                after a teardown, Provisioning and Install are open again. */}
            <Stepper.Step label="Provision" description="Terraform"
              {...(active > STEPS.provision && !hasInfra(status) ? notDone(4) : {})} />
            <Stepper.Step label="Certificate" description="ACM and DNS"
              {...(active > STEPS.certificate && !(certDetail?.status === 'ISSUED' || bootstrapped) ? notDone(5) : {})} />
            <Stepper.Step label="Install" description="CSOC, access"
              {...(active > STEPS.install && status !== 'installed' ? notDone(6) : {})} />
            <Stepper.Step label="Done" description={status === 'destroyed' || wiped ? 'Torn down' : 'Open it'} />
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
          <Stack gap="md">
            {active >= STEPS.provision && (wiped || wizard) && (
              <StateBanner state={wiped ? BLANK : bannerState} environment={csocName} onAction={onAction} actionState={actionState}
                blockerBody={blocker?.kind === 'zone' && (
                  <HostedZoneSetup target={awsTarget} hostname={domainName} onReady={handleValidateDomain} />
                )} />
            )}
            {active >= STEPS.provision && preflightError && (
              <Alert color="red" icon={<IconX />} title="Held back before anything ran" withCloseButton onClose={() => setPreflightError(null)}>
                <Text size="sm">{preflightError}</Text>
              </Alert>
            )}
            {contentForStep(active)}
          </Stack>
        </Box>
        <Modal opened={Boolean(confirming)} onClose={() => setConfirming(null)} title={confirming?.title}>
          <Stack gap="sm">
            <Text size="sm">{confirming?.body}</Text>
            {!confirming?.noName && (
              <TextInput label={<>Type <Code>{csocName}</Code> to confirm</>} value={confirmTyped}
                onChange={(e) => setConfirmTyped(e.target.value)} data-autofocus />
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirming(null)}>Cancel</Button>
              <Button color="red" disabled={!confirming?.noName && confirmTyped !== csocName}
                onClick={() => { const a = confirming.action; setConfirming(null); onAction({ ...a, confirmed: true }); }}>
                {confirming?.button}
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Box>
    </Container>
  );
}
