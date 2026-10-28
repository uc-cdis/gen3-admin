import { v, ex, cmd, adm, diagram, table, F, ext, COST_IN } from './lib.mjs';

const C = 'Concepts';

export const CONCEPTS = [
/* ================================================================ ARCHITECTURE */
{ file: 'concepts/architecture.html', key: 'architecture', nav: 'Architecture', section: C, title: 'Architecture',
  lead: 'What runs where, in detail: the wizard on your computer, the AWS credentials it uses, the state bucket, the network and cluster, and everything the bootstrap installs.',
  body: () => `
<p>Read this page to know what you are operating and reviewing: which component does what, where it runs, and what it can reach. The tutorial pages link here for detail; procedures are in the tutorial and the how-to guides.</p>
<h2>The bootstrap wizard on your computer</h2>
<p><code>docker-compose.workshop.yml</code> starts three long-running containers from published images. (<code>docker-compose-bootstrap-csoc.yml</code> builds the same containers from source, for development.)</p>
${table(['Service', 'Built from', 'Listens on', 'Role'], [
  ['<code>frontend</code>', '<code>quay.io/cdis/csoc-bootstrap-frontend</code> (Next.js)', '<code>127.0.0.1:3000</code>', 'Serves the wizard at <code>/bootstrap</code> and forwards <code>/api</code> calls to the API.'],
  ['<code>api</code>', '<code>quay.io/cdis/csoc-api</code> (Go)', '<code>127.0.0.1:8002</code>', 'Acts with your AWS credentials, without a sign-in of its own, and starts runner containers.'],
  ['<code>docker-proxy</code>', '<code>tecnativa/docker-socket-proxy</code>', 'an internal network only', 'Gives the API the container and image operations the runner needs (<code>CONTAINERS</code>, <code>IMAGES</code> and <code>POST</code> enabled) and blocks the rest of the Docker API.'],
])}
<p>For each run (init, plan, apply, bootstrap, finish, uninstall and destroy) the API starts a new <b>runner container</b> from the image in <code>TERRAFORM_RUNNER_IMAGE</code>, <code>quay.io/cdis/csoc-terraform:feat_csoc-bootstrap-wizard</code>, which contains Terraform, Helm, kubectl and the AWS CLI. The runner is started through your computer's Docker, so the paths it mounts are paths on your computer: <code>~/.aws</code>, the run working directories under <code>~/.gen3-csoc/terraform</code>, and the runner scripts from the repository. The runner's log streams back to the page while it runs.</p>
${diagram('stack', 'The wizard on your computer', [
  'You open <code>localhost:3000/bootstrap</code>, and the frontend serves the wizard.',
  'Each action calls the API at <code>/api/…</code>, published on <code>127.0.0.1:8002</code> only.',
  'The API reads your profiles from <code>~/.aws</code> to confirm the account (the blue box).',
  'To run Terraform, the API asks the Docker socket proxy to start a container.',
  'A runner container starts with a copy of <code>~/.aws</code> and <code>AWS_PROFILE</code> set to your profile.',
  'The runner calls AWS with Terraform, the AWS CLI, kubectl and Helm.',
  'Its log streams back through the API to your browser.',
])}
${adm('danger', 'Loopback only', 'The API runs in a mode that skips sign-in, so anything that can reach it acts as an administrator with your AWS credentials. Both services are published on <code>127.0.0.1</code> only. Do not change that, and do not run the wizard on a shared machine.')}

<h2>AWS credentials</h2>
<p>With <b>Select AWS profile</b> the wizard uses your profiles and asks for no keys; only <b>Provide credentials manually</b> takes keys. Your SSO sign-in authenticates the <code>${v('ssoprofile')}</code> profile; the <code>${v('profile')}</code> profile can assume an administrator role in the CSOC's account on top of it. The API mounts <code>~/.aws</code> so that an SSO token can be refreshed. Each runner gets <code>AWS_PROFILE=${v('profile')}</code> and a private, writable copy of <code>~/.aws</code>, so that the AWS CLI can refresh a token without changing your files.</p>
${diagram('creds', 'The AWS credential chain', [
  '<code>aws sso login</code> caches a short-lived SSO token on your computer.',
  `Your SSO profile, <code>${v('ssoprofile')}</code>, turns the token into credentials for its own account.`,
  `<code>${v('profile')}</code> names that profile as <code>source_profile</code>, with a <code>role_arn</code>. The AWS SDK assumes the role in the CSOC's account.`,
  'The API asks AWS which identity the profile has, and the blue box shows the account and the role.',
  `Each runner gets <code>AWS_PROFILE=${v('profile')}</code> and the same chain, so Terraform acts as that role.`,
])}
<p>Inside the cluster, nothing uses your credentials. Each controller and the CSOC API reach AWS through their own IAM role for service accounts (${ext('irsa', 'IRSA')}), and each role allows only what that component needs.</p>

<h2>State bucket and registry</h2>
<p>One S3 bucket, ${ex('bucket')}, holds the Terraform state for each environment (the ${ext('tfs3', 'S3 backend')}, locked with an S3 lock file rather than a DynamoDB table) and the <b>registry</b>: one record per environment and one per run. The wizard's banner, and later the CSOC portal, read the same records. The bucket is created with versioning, encryption, TLS-only access and public access blocked.</p>
${cmd(`s3://${v('bucket')}/
  gen3-csoc/environments/${v('name')}/
    environment.json      the environment record: settled status, last run, settings
    terraform.tfstate     the Terraform state, with a lock file beside it during a run
    runs/&lt;id&gt;.json        one record per run: operation, status, plan summary
    runs/&lt;id&gt;.log         the run's log`, 'text')}
<p>A plan's summary (addresses, types, actions and names) is stored with its run; the full plan, which contains your settings, stays in the run's working directory on your computer.</p>

<h2>Network and outbound traffic</h2>
<p>The Terraform configuration is gen3-terraform's <code>examples/csoc</code>, which uses its <code>vpc</code> and <code>eks</code> modules (${ext('tfrepo', 'uc-cdis/gen3-terraform')}). A plan on a new account creates ${F.resources} resources.</p>
${table(['Component', 'Detail'], [
  ['VPC', `Three availability zones, CIDR <code>${F.cidr}</code> by default, with public and private subnets and route tables. See ${ext('vpc', 'Amazon VPC')}.`],
  ['Internet and NAT gateways', `In the public subnet. See ${ext('nat', 'NAT gateways')}.`],
  ['Squid', `An outbound proxy (${ext('squid', 'Squid')}) in an auto-scaling group, on Amazon Linux 2023. The cluster's private subnets have no route to the internet of their own; everything the cluster fetches passes through Squid, which allows only listed destinations.`],
  ['Route-check function', `An ${ext('lambda', 'AWS Lambda')} function, <code>gw_checks</code>, in a small subnet (<code>int_services</code>) that reaches AWS through the NAT gateway. It finds a healthy Squid instance, points the private subnets' default route at it, and names it <code>cloud-proxy.internal.io</code> in a private Route 53 zone.`],
  ['Logs', `Two CloudWatch log groups: one named after the CSOC (for example <code>csoc-dev</code>), which keeps logs for ${F.logRetention} by default, and one for the route-check function, which keeps them for ${F.lambdaLogRetention}. VPC flow logs are off by default (<code>vpc_flow_logs = false</code>).`],
])}
<p>The cluster's public outbound address is therefore that of the Squid instance in use. The bootstrap records it and adds it to the allowlist. If Squid is replaced, the address changes, and the bootstrap and the finish must run again to allow the new one.</p>

<h2>The EKS cluster</h2>
${table(['Component', 'Detail'], [
  ['Control plane', `${ext('eks', 'Amazon EKS')} running Kubernetes ${F.eksVersion}, in extended support (see <a href="security.html#cost">Cost</a>). It has a private API endpoint and a public one with no CIDR restriction (see <a href="security.html#internet-facing-endpoints">Internet-facing endpoints</a>). Creating it takes ${F.eks}.`],
  ['IAM', 'The cluster\'s OIDC provider, and IRSA roles for the AWS Load Balancer Controller, External Secrets Operator, the EBS CSI driver, the CSOC API and external-dns. Terraform creates only these roles; the controllers themselves, including the EBS CSI driver, are installed by the bootstrap with Helm. An EKS access entry gives the deploying role administrator access to the cluster.'],
  ['Karpenter', `${ext('karpenter', 'Karpenter')} runs on AWS Fargate. When pods cannot be scheduled, it starts on-demand amd64 EC2 nodes running Amazon Linux 2023, choosing the cheapest instance type that fits from any family of generation 5 or newer (<code>karpenter_instance_categories = []</code>, <code>karpenter_min_instance_generation = "4"</code>). The first node joins in under 1 minute. The cluster has no fixed node group.`],
])}
<p>The ACM certificate, the hosted zone and the state bucket are not part of the Terraform configuration: the wizard creates them (the configuration is applied with <code>create_certificate = false</code>).</p>

<h2>Certificates and DNS</h2>
<ul>
  <li>The wizard creates the hosted zone ${ex('zone')} with a 60-second negative-caching time, so that a lookup made before a record exists is not remembered for long. It refuses to delegate a name that already has records in the parent zone.</li>
  <li>On the <b>Certificate</b> step, the wizard requests an ${ext('acm', 'ACM')} certificate for the portal and Keycloak hostnames and writes its ${ext('acmdns', 'DNS validation')} records into the zone. You can import a certificate or choose an existing one instead.</li>
  <li>The finish creates the two hostname records. For each commons, the CSOC requests a certificate and ${ext('edns', 'external-dns')} publishes the hostname, writing only records it owns (marked with TXT records), and never the CSOC's own two hostnames.</li>
</ul>

<h2>What the bootstrap installs</h2>
<p>The bootstrap runs <code>scripts/runner/install-csoc.sh</code>, and <code>direct.sh</code> for the direct mode. It installs each component with Helm under the release name and namespace an Argo CD application would use.</p>
${table(['Component', 'Release / namespace', 'Purpose'], [
  ['Secrets', `AWS Secrets Manager, <code>gen3-csoc/${v('name')}/</code>`, `Keycloak's administration login, the portal's client secret and its session keys. Created only if they do not exist, so a repeated bootstrap keeps them. See ${ext('sm', 'Secrets Manager')}.`],
  ['Outbound address check', 'a short-lived pod in <code>csoc</code>', 'Fetches <code>checkip.amazonaws.com</code> through Squid to learn the cluster\'s public outbound address.'],
  ['First administrator password', 'Secret <code>csoc-admin-bootstrap</code> in <code>csoc</code>', 'Read once by the realm import; the finish deletes it. Skipped if the realm already exists.'],
  ['External Secrets Operator', '<code>external-secrets</code> / <code>external-secrets</code>', `Copies Secrets Manager values into Kubernetes Secrets. See ${ext('eso', 'external-secrets.io')}.`],
  ['AWS Load Balancer Controller', '<code>aws-load-balancer-controller</code> / <code>kube-system</code>', `Creates Application Load Balancers for ingresses, with the certificate and the allowlist. See ${ext('lbc', 'the controller\'s documentation')}.`],
  ['external-dns', '<code>external-dns</code> / <code>external-dns</code>', 'Publishes commons hostnames. Installed only when the CSOC has a Route 53 zone.'],
  ['EBS CSI driver', '<code>ebs-csi-driver</code> / <code>kube-system</code>', 'Creates EBS volumes for Keycloak\'s database and the CSOC API, using the IAM role Terraform created.'],
  ['CloudNativePG', '<code>cloudnative-pg</code> / <code>cnpg-system</code>', `Runs Keycloak's PostgreSQL database. See ${ext('cnpg', 'cloudnative-pg.io')}.`],
  ['Keycloak operator', '<code>csoc</code>', `Runs ${ext('keycloak', 'Keycloak')} and imports the <code>csoc-realm</code>.`],
  ['CSOC manifests', '<code>csoc</code>', 'A storage class, a ClusterSecretStore, the ExternalSecrets, Keycloak and the realm import.'],
  ['CSOC portal', '<code>csoc</code> / <code>csoc</code>', 'The portal frontend and the CSOC API, with its gRPC endpoint for agents. Its ingress becomes an internet-facing load balancer limited to the allowlist.'],
])}
<p>With <b>With a GitOps repo</b>, the bootstrap installs External Secrets Operator and ${ext('argo', 'Argo CD')} with a root application instead, and opens a pull request with the CSOC's configuration. Argo CD installs the rest once the pull request is merged, and every later change to the CSOC is a pull request.</p>

<h2>What the finish does</h2>
<ol>
  <li>Applies Keycloak's and the portal's ingresses again, with your addresses and the cluster's outbound address on the allowlist.</li>
  <li>Waits until Keycloak is ready and the portal's Helm release has rolled out.</li>
  <li>Waits until the <code>csoc-realm</code> import is done, then deletes <code>csoc-admin-bootstrap</code>. From then on only Keycloak holds the administrator password.</li>
  <li>Waits for the load balancer and reads its hostname.</li>
  <li>With a Route 53 zone, creates or updates two CNAME records with a 60-second TTL, for ${ex('portal')} and ${ex('auth')}, pointing at the load balancer. Without one, it prints the records for you to create.</li>
</ol>
<p>Sign-in sessions in the CSOC realm last up to 12 hours and end after 8 hours without activity. The realm is created with these settings, and the wizard checks them each time its <b>Done</b> step loads.</p>

<h2>Sign-in</h2>
<p>The portal signs users in with ${ext('oidc', 'OpenID Connect')}. Keycloak returns the browser to the portal with a one-time code, and the portal exchanges the code for tokens by calling Keycloak's public hostname from inside the cluster. That call leaves through Squid, which is why the cluster's outbound address must be on the allowlist. Keycloak's users, clients and sessions live in its PostgreSQL database in the cluster.</p>

<h2>Agents</h2>
<ul>
  <li>Pressing <b>Deploy Agent</b> calls the CSOC API (<code>POST /api/agents/local</code>). The API issues a client certificate from the CSOC's own certificate authority, renders the agent's manifest (a Deployment running <code>quay.io/cdis/csoc-agent</code>, its ServiceAccount and the certificate Secret) and applies it to its own cluster.</li>
  <li>The agent connects to the CSOC's gRPC endpoint and keeps the connection open. In the CSOC's own cluster that is <code>csoc-grpc.csoc.svc:50051</code>. Both sides present certificates (mutual TLS).</li>
  <li>The same endpoint is also exposed through an internet-facing Network Load Balancer on port 50051, limited to the allowlist, for agents outside the cluster. Connecting an agent from another cluster is listed in <a href="../next-steps.html#known-gaps">Known gaps</a>.</li>
</ul>

<h2>Deploying a commons</h2>
<ul>
  <li><b>Request a certificate</b> makes the CSOC API request an ACM certificate for the commons hostname and write its validation records into the zone, using the API's IAM role.</li>
  <li><b>Use CSOC login</b> creates a Keycloak client named <code>fence-&lt;namespace&gt;</code> in the CSOC realm and fills in Fence's generic OIDC settings with it.</li>
  <li><b>Deploy Gen3</b> sends the values you changed to the CSOC API (<code>POST /api/agent/&lt;cluster&gt;/helm/install</code>), which forwards the install to the agent. The agent runs <code>helm install</code> for the chart <code>gen3</code> from <code>https://helm.gen3.org</code> (${ext('gen3helm', 'gen3-helm')}).</li>
  <li>The commons' ingress becomes a load balancer with the certificate, and external-dns publishes its hostname with a TXT ownership record.</li>
</ul>

<h2>Teardown</h2>
<p>The uninstall (<code>scripts/runner/uninstall-csoc.sh</code>) runs before <code>terraform destroy</code>, in this order:</p>
<ol>
  <li>The Squid route-check function is deleted, so that it stops rewriting <code>cloud-proxy.internal.io</code> and the private subnets' routes.</li>
  <li>Argo CD, if installed, then every ingress and LoadBalancer service, so that the load balancer controller deletes the load balancers and their security groups.</li>
  <li>The CSOC portal, Keycloak and its database, then every namespace except the cluster's own, including commons. external-dns removes the commons' records as their ingresses go. Orphaned webhooks and leftover finalizers are removed.</li>
  <li>Every persistent volume and Karpenter's nodes. With <b>Force</b>, EBS volumes are deleted by ID and instances are terminated instead of drained.</li>
  <li>The CSOC's two hostname records, Squid's private record, and the secrets under <code>gen3-csoc/${v('name')}/</code>, deleted without a recovery window.</li>
</ol>
<p>Then <code>terraform destroy</code> runs (after an init) and removes the cluster, Fargate and Karpenter, the IAM roles, Squid, the NAT gateway and the VPC. The optional zone deletion removes the zone, the CSOC's certificate and the NS records in the parent; the optional bucket deletion runs last.</p>

<h2>Upstream documentation</h2>
${table(['Component', 'Documentation'], [
  ['Amazon EKS', `${ext('eks', 'Amazon EKS User Guide')}; ${ext('irsa', 'IAM roles for service accounts')}`],
  ['Karpenter', ext('karpenter', 'karpenter.sh/docs')],
  ['AWS Load Balancer Controller', ext('lbc', 'kubernetes-sigs.github.io/aws-load-balancer-controller')],
  ['external-dns', ext('edns', 'kubernetes-sigs.github.io/external-dns')],
  ['External Secrets Operator', ext('eso', 'external-secrets.io')],
  ['CloudNativePG', ext('cnpg', 'cloudnative-pg.io')],
  ['Keycloak', ext('keycloak', 'keycloak.org/documentation')],
  ['Argo CD', ext('argo', 'argo-cd.readthedocs.io')],
  ['Helm', ext('helm', 'helm.sh/docs')],
  ['Terraform', `${ext('terraform', 'Terraform documentation')}; ${ext('tfs3', 'S3 backend')}`],
  ['AWS Secrets Manager', ext('sm', 'Secrets Manager User Guide')],
  ['AWS Certificate Manager', `${ext('acm', 'ACM User Guide')}; ${ext('acmdns', 'DNS validation')}`],
  ['Route 53', `${ext('r53zones', 'Hosted zones')}; ${ext('r53sub', 'Routing traffic for subdomains')}`],
  ['Squid', ext('squid', 'squid-cache.org')],
  ['Gen3', `${ext('gen3', 'gen3.org')}; ${ext('gen3docs', 'docs.gen3.org')}; ${ext('gen3helm', 'uc-cdis/gen3-helm')}`],
])}
` },

/* ================================================================ SECURITY */
{ file: 'concepts/security.html', key: 'security', nav: 'Security, cost and responsibilities', section: C, title: 'Security, cost and responsibilities',
  lead: 'For the people who approve a CSOC: what it stores and where, what is reachable from the internet, why it needs administrator rights, what it is not designed for, what it costs, and who is responsible for what.',
  body: () => `
<h2>What the CSOC stores, and where</h2>
${table(['What', 'Where', 'Notes'], [
  ['Terraform state and the record of every environment and run', `S3 bucket ${ex('bucket')}`, 'Versioned, encrypted, TLS-only, public access blocked. The Terraform state contains resource identifiers and settings.'],
  ['The CSOC\'s secrets: Keycloak\'s administration login, the portal\'s client secret, session keys', `AWS Secrets Manager, under <code>gen3-csoc/${v('name')}/</code>`, 'Copied into the cluster by External Secrets Operator. Deleted without a recovery window at teardown.'],
  ['Users, sessions and sign-in settings', 'Keycloak, in its PostgreSQL database in the cluster', 'After the finish, the CSOC administrator\'s password lives only here.'],
  ['The certificate authority for agents', 'The CSOC API\'s volume in the cluster', 'Issues each agent\'s client certificate.'],
  ['Each commons\' metadata and data files', 'The commons\' own database, and the S3 bucket you configure for it', 'Governed by the commons, not by the CSOC. The tutorial\'s commons has no data bucket.'],
])}
<p>Everything is in the one AWS Region you choose on the <b>Setup</b> step (${ex('region')}); the bootstrap creates nothing in other Regions. The wizard on your computer keeps only run working directories (<code>~/.gen3-csoc/terraform</code>) and uses your existing AWS profiles.</p>

<h2>Internet-facing endpoints</h2>
${table(['Endpoint', 'Port', 'Exposed through', 'Who can connect'], [
  [`CSOC portal, ${ex('portal')}`, '443 (80 redirects to 443)', 'An internet-facing Application Load Balancer, shared with Keycloak', 'Only the allowlist: <b>Allowed addresses</b> plus the cluster\'s outbound address'],
  [`Keycloak, ${ex('auth')}`, '443 (80 redirects to 443)', 'The same load balancer', 'The same allowlist'],
  ['Agent endpoint (gRPC)', '50051', 'An internet-facing Network Load Balancer', 'The same allowlist (<code>loadBalancerSourceRanges</code>); agents also need a client certificate from the CSOC (mutual TLS)'],
  ['EKS Kubernetes API', '443', 'The EKS public endpoint, alongside the private one', 'Any address: no CIDR restriction is set. Requests must be authenticated with IAM credentials that have EKS access.'],
  [`Each commons, such as ${ex('commons')}`, '443', 'Its own Application Load Balancer', 'Not limited by the CSOC\'s allowlist; access is controlled by the commons\' sign-in and user.yaml'],
  ['SSH on EC2 nodes', '22', 'The security group <code>ssh_eks_&lt;csoc-name&gt;</code>, which allows TCP 22 from <code>0.0.0.0/0</code> and which Karpenter attaches to every node', 'Not reachable from the internet, because the nodes are in private subnets without public addresses; reachable from anywhere inside the VPC'],
])}
<p>To restrict or close the EKS public endpoint, see ${ext('eksendpoint', 'Cluster API server endpoint')}. The configuration sets <code>eks_public_access</code>, which the wizard does not expose; see <a href="../next-steps.html#known-gaps">Known gaps</a>.</p>

<h2>Why administrator rights</h2>
<p>The bootstrap creates IAM roles and policies, a VPC with its gateways and routes, an EKS cluster with Fargate and EC2 capacity, an AWS Lambda function, CloudWatch log groups, load balancers, Route 53 zones and records, ACM certificates, Secrets Manager secrets and S3 buckets. Creating IAM roles alone requires broad permissions, so the operator needs an administrator role in the account. Use an account dedicated to the CSOC, so that these rights cover nothing else.</p>
<p>The running CSOC does not use the operator's rights: each component uses its own IAM role (see <a href="#iam-roles">IAM roles</a>). The operator needs administrator rights again for anything done from the wizard: changing the allowlist, upgrading, resetting the administrator password and tearing down.</p>

<h2>The IP allowlist</h2>
<p>The CSOC's load balancers accept connections only from the address ranges in <b>Allowed addresses</b>, plus the cluster's own outbound address. This covers the CSOC portal, Keycloak and the agent endpoint. The allowlist is a network control in addition to sign-in, not instead of it. Plan which ranges you need: your operators' VPN, your campus network's outbound ranges, and any partner networks. See <a href="../how-to/allow-an-address.html">Allow a new IP address</a>.</p>

<h2>Identity</h2>
<p>The install creates one local Keycloak user, <code>admin</code>. For real use, connect Keycloak to your institution's identity provider instead of creating local users; Keycloak supports identity brokering with SAML 2.0 and OpenID Connect providers, which includes campus single sign-on and federations such as ${ext('incommon', 'InCommon')}. See <a href="../how-to/connect-identity-provider.html">Connect your institution's sign-in</a>. Each commons that uses <b>Use CSOC login</b> then accepts the same identities.</p>
<p>Inside a commons, permissions come from its user.yaml, which maps each user's email to policies. The tutorial's user.yaml gives one email full control of the commons and gives everyone else nothing. Review each commons' user.yaml as part of its data access approval; see <a href="../how-to/edit-user-yaml.html">Edit a commons' user.yaml</a>.</p>

<h2>What this setup is not</h2>
<ul>
  <li><b>Not hardened for regulated data as delivered.</b> It has not been assessed for controlled-access data, protected health information, or frameworks such as NIST SP 800-171 or HIPAA. Holding such data requires your own security review and additional controls.</li>
  <li><b>No backups are configured.</b> The bootstrap does not back up Keycloak's database, the CSOC API's volume, or any commons database, and a commons' local database is not even persistent unless you turn on persistence. Configure backups before you rely on the CSOC, for example CloudNativePG backups and EBS snapshots.</li>
  <li><b>Not highly available.</b> The cluster spans three availability zones, but Keycloak, its database and the CSOC portal each run as a single instance. A node failure interrupts them until Kubernetes starts them elsewhere.</li>
  <li><b>Not a managed service.</b> Upgrades of the cluster, the charts and the images are the operator's responsibility; see <a href="../next-steps.html#keep-it-up-to-date">Keep it up to date</a>.</li>
</ul>

<h2>Shared responsibility</h2>
<p>AWS is responsible for the security of the cloud, such as its data centers and managed services; you are responsible for security in the cloud, including configuration, access and data (${ext('shared', 'AWS shared responsibility model')}). Within your institution:</p>
${table(['Area', 'Responsible'], [
  ['The AWS account, its budget, and organization policies', 'Owner, with the cloud account administrators'],
  ['Running the CSOC: upgrades, the allowlist, backups, monitoring, teardown', 'Operator'],
  ['Keeping access to the wizard, the state bucket and an administrator role, and handing it over', 'Operator, with the owner'],
  ['Identity provider integration and who may sign in', 'Operator, with your identity team'],
  ['Data classification and approval of what a commons may hold', 'Owner, with security and compliance'],
  ['Permissions inside each commons (user.yaml)', 'Commons administrators'],
  ['The parent domain and its delegation', 'DNS administrators'],
])}

<h2>Cost</h2>
<p>A running CSOC costs <b>${F.costNow}</b> ${COST_IN}, on the default Kubernetes version ${F.eksVersion}. That version left EKS standard support on ${F.eks133StdEnd}, so the control plane is billed at the extended-support rate of ${F.eksExtRate}, ${F.eksExt} instead of ${F.eksStd}, until extended support ends on ${F.eks133ExtEnd}. On a Kubernetes version in standard support (1.35 or later; 1.34 leaves standard support on ${F.eks134StdEnd}) the CSOC costs ${F.costStd} ${COST_IN}. Sources: the ${ext('ekscal', 'Amazon EKS Kubernetes release calendar')} and ${ext('ekspricing', 'Amazon EKS pricing')}. The <b>Rough Monthly Cost Estimate</b> on the wizard's <b>Review</b> step shows the same figure, ${F.costBadge}.</p>
${table(['Item (us-east-1, 730 hours a month)', 'Estimate per month'], [
  ['EKS control plane', `${F.eksStd} in standard support; ${F.eksExt} in extended support`],
  ['Squid: 2 × t3.medium instances', '$60 (approximate)'],
  ['Karpenter\'s controller on AWS Fargate', '$70 (approximate)'],
  ['EC2 nodes started by Karpenter: 1–2 nodes for the CSOC alone, the cheapest type that fits', '$60–140, depending on load (approximate)'],
  ['NAT gateway', 'about $33, plus $0.045 per GB processed'],
  ['Public IPv4 addresses: 6 × $3.65', 'about $22'],
  ['Application Load Balancer', 'about $16, plus capacity units'],
  ['EBS volumes', 'about $10'],
  ['Route 53: 2 hosted zones (public and private)', '$1'],
  ['Secrets Manager: 3–4 secrets × $0.40', '$1–2'],
  ['CloudWatch Logs', `small; the VPC's log group keeps logs for ${F.logRetention} by default`],
  ['Data transfer', 'depends on use; not included above'],
])}
<p>To plan and control spending, model your configuration in the ${ext('calc', 'AWS Pricing Calculator')}, see ${ext('vpcpricing', 'Amazon VPC pricing')} for NAT gateways and public IPv4 addresses, and set up ${ext('budgets', 'AWS Budgets')} alerts on the account before you start.</p>

<h3>What a commons adds</h3>
<p>Each commons adds its own resources to the bill. Their size depends on the services you enable and on use:</p>
<ul>
  <li>EC2 nodes that Karpenter starts for the commons' services, the largest part.</li>
  <li>An Application Load Balancer, about $16 a month in us-east-1 plus capacity units, and its public IPv4 addresses.</li>
  <li>An EBS volume for the local database, if you turn on persistence, or a managed database if you use an external one.</li>
  <li>S3 storage and requests for data files, once you configure a data bucket.</li>
</ul>
<p>Check the actual figures in AWS Cost Explorer a day after you deploy, filtered by the commons' resources.</p>

<h3>What remains after teardown</h3>
<p>A teardown removes everything Terraform and the bootstrap created. These remain unless you remove them; the wizard's <b>What is left</b> list offers to delete the first three:</p>
<ul>
  <li>The hosted zone ${ex('zone')}, $0.50 a month, if you did not select it for deletion.</li>
  <li>The CSOC's ACM certificate, which is free, if the zone was kept.</li>
  <li>The state bucket ${ex('bucket')}, a few cents a month, if you did not select it for deletion.</li>
  <li>Each commons' ACM certificate, which the portal requested. Certificates are free; delete them in the ACM console.</li>
</ul>

<h2>Campus realities</h2>
<ul>
  <li><b>The parent domain belongs to central IT.</b> At most universities, delegating ${ex('zone')} needs a ticket and takes days. Send the request early; <a href="../how-to/request-dns-delegation.html">Request DNS delegation</a> has a template.</li>
  <li><b>Service Control Policies can block services.</b> AWS organizations can limit Regions or services with ${ext('scp', 'Service Control Policies')}. Ask your cloud administrators to confirm that EKS, Fargate, EC2, AWS Lambda, Route 53, ACM, Secrets Manager and IAM role creation are allowed in ${ex('region')}. An SCP denial looks like an access error even with administrator rights.</li>
  <li><b>Campus and VPN outbound addresses.</b> The allowlist needs the public addresses your traffic leaves from, which are not your computer's local address. Ask your network team for the outbound ranges of the campus network and the VPN.</li>
  <li><b>Short sign-in sessions.</b> The wizard asks for at least 45 minutes left on your AWS sign-in before an apply or a teardown. If your institution sets short sessions, sign in again just before each long step.</li>
</ul>

<h2>For security reviewers</h2>
<p>The answers below come from the code: gen3-admin and the gen3-terraform configuration in <code>examples/csoc</code>. Open questions are collected in <a href="../next-steps.html#known-gaps">Known gaps</a>.</p>

<h3 id="iam-roles">IAM roles</h3>
<p>Each role below is an IRSA role, trusted only by one Kubernetes service account in one namespace.</p>
${table(['Role', 'Used by', 'Permissions'], [
  ['<code>&lt;csoc-name&gt;-csoc-api</code>', 'The CSOC API', 'Read and write objects in the state bucket. Read and replace only the GitHub App secret under <code>gen3-csoc/&lt;csoc-name&gt;/github-app-*</code>. Request, describe, list and tag ACM certificates (any). Read and change records only in the CSOC\'s hosted zone. No other policies are attached by default (<code>csoc_api_policy_arns</code> is empty).'],
  ['<code>&lt;csoc-name&gt;-external-secrets</code>', 'External Secrets Operator', 'Read the secrets under <code>gen3-csoc/&lt;csoc-name&gt;/</code>, and no others.'],
  ['<code>&lt;csoc-name&gt;-external-dns</code>', 'external-dns', 'Change and list records in the CSOC\'s hosted zone only; list hosted zones.'],
  ['<code>&lt;csoc-name&gt;-lb-controller</code>', 'AWS Load Balancer Controller', 'The controller\'s upstream IAM policy, shipped with the configuration.'],
  ['<code>&lt;csoc-name&gt;-ebs-csi</code>', 'EBS CSI driver', 'The AWS managed policy <code>AmazonEBSCSIDriverPolicy</code>.'],
  ['Karpenter\'s controller role', 'Karpenter', 'EC2 instance and launch-template management, limited by tags, and <code>kms:*</code> on all resources. The broad KMS grant is worth reviewing.'],
])}
<p>The roles for the EKS cluster, its nodes, Fargate, Squid and the route-check function are defined in the <code>eks</code> and <code>vpc</code> modules of ${ext('tfrepo', 'gen3-terraform')}.</p>

<h3>Kubernetes permissions of the CSOC API</h3>
<p>The CSOC API's service account has a cluster role that can create, change and delete namespaces, Secrets, ServiceAccounts, ConfigMaps, Deployments and other workloads, roles and role bindings (including cluster-wide ones), Services, ingresses and Jobs, and can exec into pods. It uses these to install agents. In effect, the CSOC API is an administrator of its own cluster, so access to the CSOC portal should be treated as administrative access.</p>

<h3>Encryption at rest</h3>
<ul>
  <li><b>Volumes.</b> The default storage class (<code>gp3</code>) creates encrypted EBS volumes, so Keycloak's database and the CSOC API's volume are encrypted, with the AWS managed key. Node root volumes are encrypted too.</li>
  <li><b>State bucket.</b> Encrypted by default.</li>
  <li><b>Secrets Manager.</b> Encrypted with the AWS managed key.</li>
  <li><b>Kubernetes Secrets.</b> The configuration does not set up envelope encryption with a customer managed KMS key. What EKS applies by default is described in the ${ext('eks', 'Amazon EKS documentation')}.</li>
</ul>

<h3>Audit logs</h3>
<ul>
  <li><b>VPC flow logs</b> are off by default (<code>vpc_flow_logs = false</code>). See ${ext('flowlogs', 'VPC flow logs')} to enable them.</li>
  <li><b>EKS control-plane logs</b>, including the Kubernetes audit log, are not enabled. See ${ext('ekslogs', 'control plane logging')}.</li>
  <li><b>AWS API activity</b> is recorded by ${ext('cloudtrail', 'AWS CloudTrail')} if your account or organization has it on; the bootstrap does not configure it.</li>
  <li><b>The wizard's runs</b> are recorded in the state bucket, with their logs.</li>
</ul>

<h3>Outbound traffic</h3>
<p>The cluster reaches the internet only through Squid. Each Squid instance, as it boots, clones the <code>uc-cdis/cloud-automation</code> repository from GitHub (branch <code>master</code>) and uses its ${ext('squidlist', 'default allowlist files')}: <code>web_whitelist</code>, about 190 exact hostnames, and <code>web_wildcard_whitelist</code>, about 120 domain wildcards. The wildcards include all of <code>.amazonaws.com</code>, <code>.github.com</code>, <code>.githubusercontent.com</code>, <code>.quay.io</code>, <code>.docker.io</code> and <code>.gen3.org</code>, package repositories such as <code>.anaconda.org</code>, <code>.bioconductor.org</code> and <code>.cpan.org</code>, and the domains of other research data commons. The list therefore allows far more than the CSOC needs, and it changes when that repository changes. The configuration can point at another repository or files (<code>whitelist_repo</code>, <code>web_whitelist_file</code>, <code>web_wildcard_whitelist_file</code>); the wizard does not expose them.</p>

<h3>SSH access to nodes</h3>
<p>Each EC2 node that Karpenter starts runs a startup script that appends the public keys in ${ext('opskeys', 'cloud-automation\'s <code>files/authorized_keys/ops_team</code>')} to the node's <code>ec2-user</code> account, and every node carries the security group <code>ssh_eks_&lt;csoc-name&gt;</code>, which allows SSH from <code>0.0.0.0/0</code>. The nodes have no public addresses, so this allows SSH from inside the VPC only, by the holders of those keys. Reviewers should decide whether to remove the keys and the rule; both are in the gen3-terraform <code>eks</code> module.</p>

<h3 id="images-and-pinning">Images and pinning</h3>
${table(['Image', 'Runs', 'Default tag'], [
  ['<code>quay.io/cdis/csoc-api</code>', 'The CSOC API, in the cluster', 'Set under <b>Images</b> on the <b>Install</b> step; empty, <code>feat_csoc-bootstrap-wizard</code> from <code>CSOC_API_IMAGE</code> in <code>docker-compose.workshop.yml</code> (the chart\'s own default is <code>master</code>)'],
  ['<code>quay.io/cdis/csoc-frontend</code>', 'The CSOC portal, in the cluster', 'Set under <b>Images</b>; empty, <code>feat_csoc-bootstrap-wizard</code> from <code>CSOC_FRONTEND_IMAGE</code>'],
  ['<code>quay.io/cdis/csoc-agent</code>', 'Each agent', 'The CSOC API\'s tag, unless <code>CSOC_AGENT_IMAGE</code> is set'],
  ['Keycloak, its operator, CloudNativePG, External Secrets, the AWS Load Balancer Controller, external-dns, the EBS CSI driver', 'In the cluster', 'Chart and manifest versions pinned by the bootstrap'],
  ['Gen3 services', 'Each commons', 'Set by the <code>gen3</code> chart version'],
  ['<code>public.ecr.aws/docker/library/busybox:1.37</code>', 'Briefly, to find the outbound address', 'Pinned'],
])}
<p>Branch tags such as <code>feat_csoc-bootstrap-wizard</code> and <code>master</code> change whenever the branch changes, so a restarted pod can run different code. For real use, set fixed release tags for the CSOC images. The wizard's own images, which run only on your computer, are listed on <a href="../prerequisites.html#install-the-tools">Prerequisites</a>.</p>

<h3>Third-party sources</h3>
<p>Building, installing and running the CSOC downloads from these sources:</p>
<ul>
  <li><b>quay.io</b> (<code>quay.io/cdis/…</code>): the wizard's images (<code>csoc-api</code>, <code>csoc-bootstrap-frontend</code>, <code>csoc-terraform</code>), and the CSOC, agent and Gen3 images.</li>
  <li><b>Docker Hub</b>: <code>tecnativa/docker-socket-proxy</code>, on your computer (and <code>hashicorp/terraform</code> if you build the runner from source).</li>
  <li><b>public.ecr.aws</b>: the busybox image.</li>
  <li><b>GitHub</b>: the gen3-terraform configuration and modules (branch <code>feat/csoc-bootstrap-master</code>), <code>cloud-automation</code> (Squid's startup scripts and allowlist), and the Keycloak operator's manifests (<code>keycloak/keycloak-k8s-resources</code>).</li>
  <li><b>Helm repositories</b>: <code>charts.external-secrets.io</code>, <code>aws.github.io/eks-charts</code>, <code>kubernetes-sigs.github.io/external-dns</code>, <code>kubernetes-sigs.github.io/aws-ebs-csi-driver</code>, <code>cloudnative-pg.github.io/charts</code>, <code>argoproj.github.io/argo-helm</code> (GitOps only) and <code>helm.gen3.org</code>.</li>
  <li><b>checkip.amazonaws.com</b>, to find the cluster's outbound address.</li>
</ul>

<h3>The wizard on your computer</h3>
<p>The wizard's API acts with your AWS administrator credentials, and it does not ask anyone to sign in: every request it receives is treated as coming from you. That is acceptable only because it listens on <code>127.0.0.1</code>, so only programs on your own computer can reach it. It starts containers through a proxy that allows container and image operations and blocks the rest of the Docker API. Do not change the port bindings, do not run the wizard on a shared or remote machine, and stop it (<code>docker compose -f docker-compose-bootstrap-csoc.yml down</code>) when you are not using it.</p>

<h3>Administrator accounts</h3>
<p>Two administrator logins exist: the CSOC's <code>admin</code> user in <code>csoc-realm</code>, and Keycloak's own administration login, stored in Secrets Manager. Neither has a second factor by default. Keycloak supports one-time passwords as a required action and in authentication flows; see the ${ext('kcadmin', 'Keycloak Server Administration Guide')}.</p>

<h3>Reporting vulnerabilities and license</h3>
<p>The gen3-admin repository has no security policy file. Do not report a vulnerability in a public GitHub issue; contact the maintainers privately, for example with ${ext('ghprivate', 'GitHub private vulnerability reporting')} if the repository has it enabled. gen3-admin is licensed under the Apache License 2.0.</p>
` },
];
