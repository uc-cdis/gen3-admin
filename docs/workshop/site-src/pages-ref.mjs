import { v, ex, cp, adm, table, F, ext } from './lib.mjs';

const RF = 'Reference';
const B = (tone, t) => `<span class="tone ${tone}" aria-hidden="true"></span><b>${t}</b>`;

export const REF = [
/* ================================================================ WIZARD STATES */
{ file: 'reference/wizard-states.html', key: 'wizard-states', nav: 'Wizard states', section: RF, title: 'Wizard states and banners',
  lead: 'Every banner the wizard can show, what it means, and the buttons it offers.',
  body: () => `
<h2>How the banner is derived</h2>
<p>The banner shows the next step, based on what exists, the last run's result, and the certificate's status. The wizard keeps one record per environment in the state bucket, with a <b>settled status</b> (what exists) and the <b>last run</b>; it also takes into account any blocking problem, such as an expired sign-in, and a GitOps pull request. A failed or stopped run never erases the settled status before it, so every failure can be retried from where it stopped.</p>
${table(['Settled status', 'Meaning'], [
  ['<code>new</code>', 'Registered by <b>Provision</b>, never planned.'],
  ['<code>planned</code>', 'A plan exists; nothing is applied.'],
  ['<code>applied</code>', 'The infrastructure exists; the CSOC is not installed.'],
  ['<code>bootstrapped</code>', 'The bootstrap succeeded; the finish has not.'],
  ['<code>installed</code>', 'The CSOC is ready.'],
  ['<code>partial</code>', 'An apply or a destroy stopped part-way; some resources exist.'],
  ['<code>destroyed</code>', 'Terraform destroyed everything it created.'],
])}
${table(['Last run status', 'Meaning'], [
  ['<code>running</code>', 'A run is in progress. The banner offers only <b>Stop this run</b>.'],
  ['<code>succeeded</code>', 'The run finished, and the settled status moved on.'],
  ['<code>failed</code>', 'The run ended with an error. Its log is shown, with the <code>Error:</code> lines first.'],
  ['<code>stopped</code>', 'Someone pressed <b>Stop this run</b>.'],
  ['<code>lost</code>', 'The API restarted while the run was in progress, so its end was not recorded.'],
])}
<p>Buttons that the banner does not offer, such as running the bootstrap or the finish again, or tearing down a working CSOC, are under <b>Advanced</b> below the run log.</p>
<p>Banner colors: ${B('', 'blue')} in progress or informational, ${B('green', 'green')} complete, ${B('yellow', 'yellow')} needs your attention, ${B('red', 'red')} failed, ${B('gray', 'gray')} nothing created or torn down.</p>

<h2>Every banner</h2>
${table(['Banner', 'Meaning', 'Main button', 'Other buttons'], [
  [B('gray', 'Not set up yet'), 'No environment record yet. Fill in the <b>Setup</b> step.', 'None', ''],
  [B('gray', 'Nothing created yet'), 'Registered, never planned (<code>new</code>).', 'Plan', 'Edit configuration'],
  [B('', 'Plan ready'), 'Planned; nothing applied.', 'Apply', 'Plan again, Edit configuration'],
  [B('', 'Plan ready to finish the infrastructure'), 'A plan made on top of <code>partial</code>.', 'Apply', 'Plan again, Tear down'],
  [B('', 'Plan ready: changes to the running infrastructure'), 'A plan made on top of existing infrastructure. Destroying or replacing resources asks for the environment name.', 'Apply', 'Plan again'],
  [B('', '<i>Operation</i> in progress'), 'A run is in progress; see the next table.', 'Stop this run', ''],
  [B('red', 'The plan failed / The init failed'), 'Nothing in AWS changed.', 'Retry plan / Retry init', 'Edit configuration'],
  [B('red', 'The apply failed'), 'The apply stopped part-way; the plan review marks each failed resource with its error.', 'Plan again', 'Tear down, if the infrastructure is not complete'],
  [B('red', 'Part of the infrastructure exists'), '<code>partial</code>.', 'Plan again', 'Tear down'],
  [B('', 'Infrastructure up; the CSOC needs a certificate'), '<code>applied</code>, and no certificate is chosen.', 'Choose on the <b>Certificate</b> step: request, import or existing.', ''],
  [B('', 'Checking the certificate…'), 'The wizard is reading the certificate from ACM.', 'None (waits)', ''],
  [B('', 'ACM is preparing the validation records'), 'Requested; ACM has not named the records yet.', 'None (waits)', ''],
  [B('', 'Validating the certificate'), 'Route 53 zone: the records are being written and checked every 10 seconds.', 'None (waits)', 'Use a different certificate'],
  [B('', 'Create the validation records in your DNS'), 'Self-managed DNS; the certificate is pending validation.', 'Check now', 'Use a different certificate'],
  [B('', 'Records found; waiting for ACM to issue'), 'Self-managed DNS; the records are visible in public DNS.', 'Check now', 'Use a different certificate'],
  [B('red', 'Could not write the validation records'), 'Writing to Route 53 failed, for example because the sign-in expired.', 'Try again', ''],
  [B('red', 'The certificate is failed (or expired, or revoked)'), 'ACM will not issue or use it.', 'Use a different certificate', ''],
  [B('yellow', 'The certificate does not cover <i>hostname</i>'), 'The hostnames changed after the certificate was chosen.', 'Use a different certificate', ''],
  [B('', 'Cluster up, CSOC not installed'), '<code>applied</code>, with an issued certificate.', 'Bootstrap CSOC (needs the form)', ''],
  [B('red', 'The bootstrap failed'), 'Still <code>applied</code>.', 'Bootstrap again', ''],
  [B('', 'Waiting for pull request #N to be merged'), 'GitOps; the configuration pull request is open. Checked every 15 seconds.', 'Open the pull request', ''],
  [B('', 'Bootstrapped; the configuration PR is not open'), 'GitOps; no pull request yet.', 'Open pull request', ''],
  [B('', 'Bootstrapped; ready to finish'), '<code>bootstrapped</code>.', 'Finish install', ''],
  [B('red', 'The finish failed'), 'Still <code>bootstrapped</code>.', 'Finish again', 'Bootstrap, under <b>Advanced</b>'],
  [B('', 'CSOC installed; waiting for DNS'), 'Installed; public DNS does not answer for both hostnames yet. Checked every 10 seconds.', 'None (waits)', ''],
  [B('green', 'CSOC is ready'), '<code>installed</code>. The <b>Admin account</b> panel shows the username and email.', 'Open the CSOC', 'Tear down'],
  [B('red', 'The uninstall failed'), 'The CSOC is still recorded.', 'Retry teardown with Force', 'Destroy anyway…'],
  [B('red', 'The destroy failed'), '<code>partial</code>; some resources still exist.', 'Retry teardown', ''],
  [B('gray', 'Torn down'), '<code>destroyed</code>. <b>What is left</b> lists the certificate, the zone and the bucket.', 'Provision again', 'Start over'],
  [B('gray', 'Back to a blank account'), 'Destroyed, and the zone and the bucket are gone.', 'None', ''],
  [B('red', 'The <i>operation</i> was stopped'), 'Someone pressed <b>Stop this run</b>.', 'Retry that operation', ''],
  [B('red', 'The <i>operation</i>\'s result is unknown'), 'The API restarted during the run.', 'Retry that operation', ''],
  [B('yellow', 'AWS session expired'), 'Your SSO sign-in ran out; the banner shows the <code>aws sso login</code> command, and every button is disabled. (On the <b>Setup</b> step the same problem shows as the box <b>AWS SSO session expired</b>, with <b>Retry</b>.)', 'Check again', ''],
  [B('yellow', 'Cannot read the state bucket'), 'The registry cannot be read, because of credentials or permissions.', 'Check again', ''],
])}

<h3>While a run is in progress</h3>
${table(['Banner', 'Detail shown'], [
  ['<b>Init in progress</b>', F.ui.init],
  ['<b>Plan in progress</b>', F.ui.plan],
  ['<b>Apply in progress</b>', F.ui.apply],
  ['<b>Bootstrap in progress</b>', F.ui.install],
  ['<b>Finish install in progress</b>', F.ui.finish],
  ['<b>Uninstall in progress</b>', F.ui.uninstall],
  ['<b>Destroy in progress</b>', F.ui.destroy],
])}
<p>A stopped bootstrap or finish says "The log below shows where it stopped" in its banner; a failed one says "The log below says what went wrong".</p>

<h2>Checks before a run starts</h2>
<ul>
  <li><b>Destructive changes.</b> An apply whose plan destroys or replaces existing infrastructure asks for the environment name. So does <b>Destroy anyway…</b> after a failed uninstall, which first lists what may be left behind.</li>
  <li><b>Remaining sign-in time.</b> An apply or a teardown with less than 45 minutes left on your SSO sign-in, or a bootstrap or a finish with less than 15, first asks you to sign in again and shows the <code>aws sso login</code> command.</li>
  <li><b>One run per environment.</b> The API refuses a second run while one is recorded as in progress, from any browser tab or computer.</li>
  <li><b>Certificate before bootstrap.</b> The bootstrap needs an issued certificate. Until there is one, the banner leads to the certificate.</li>
  <li><b>A failed plan on a running CSOC.</b> If the infrastructure already exists, a failed plan or init is shown as a note beside the real next step.</li>
</ul>
${adm('warning', 'An expired sign-in blocks everything', 'Whatever the state, a yellow <b>AWS session expired</b> box with the <code>aws sso login --profile …</code> command disables every button until <b>Check again</b> succeeds. A run that cannot start, for the same reason or because a role cannot be assumed, says so in a red box and changes nothing.')}
${adm('note', 'A missing or undelegated zone', 'A Route 53 zone that is missing or not delegated is fixed from the banner, on whichever step you are on. It blocks only what needs the zone; a teardown can still run.')}

<h2>Screen rules</h2>
<ul>
  <li><b>Next action.</b> The banner holds the next action, and the page below it shows the details. Tearing down is offered on the <b>Done</b> step, under <b>Advanced</b>, and in the banner only where it is a reasonable way out, such as a half-built environment.</li>
  <li><b>Stepper.</b> It marks what exists, so after a teardown the <b>Provision</b> and <b>Install</b> steps are open again.</li>
  <li><b>Run log.</b> It is open while a run is in progress or right after one failed, with the <code>Error:</code> lines shown above it, and folded otherwise. <b>Advanced</b> under the log (not <b>Advanced Options</b> on <b>Setup</b>) offers single operations: Init, Plan, Apply, Bootstrap, Finish install and <b>Tear down…</b>; only the ones the state allows are enabled.</li>
  <li><b>Teardown panel.</b> It shows the form before a teardown, the live list of steps while one runs or where it stopped, and, when it is done, only <b>What is left</b>, checked against AWS when the page loads.</li>
</ul>
` },

/* ================================================================ TROUBLESHOOTING */
{ file: 'reference/troubleshooting.html', key: 'troubleshooting', nav: 'Troubleshooting', section: RF, title: 'Troubleshooting',
  lead: 'Every known problem in one place, grouped by tutorial page. Each tutorial page shows the same rows in its own Troubleshooting section.',
  body: () => `
<h2>Common to every step</h2>
${adm('warning', 'AWS session expired', `A yellow <b>AWS session expired</b> box disables every button. Run ${cp(`aws sso login --profile ${ex('ssoprofile')}`)}, then press <b>Check again</b>.`)}
${adm('tip', 'Closed the tab, or the page reloaded', 'Nothing is lost. See <a href="../how-to/resume.html">Resume after closing the tab</a>.')}
${adm('note', '"No such name" (NXDOMAIN) on some networks', 'If your computer looked up a hostname before its record existed, your network\'s DNS resolver can keep answering "no such name" for a while. The wizard\'s zones use a 60-second negative-caching time to keep this short. Wait 5 minutes, or switch your computer to a public resolver such as <code>1.1.1.1</code>.')}
${adm('note', 'Using kubectl', `Some checks below use <code>kubectl</code>. In a terminal, connect it to the cluster with <code>aws eks update-kubeconfig --name ${v('name')} --region ${ex('region')} --profile ${ex('profile')}</code>.`)}
${adm('danger', 'Read the log before you stop a run', 'Stopping a run leaves it <code>stopped</code>, and an interrupted apply leaves the environment <code>partial</code>. Most long waits are expected; the time on each page says how long is normal.')}
{{TSALL}}
` },

/* ================================================================ GLOSSARY */
{ file: 'reference/glossary.html', key: 'glossary', nav: 'Glossary', section: RF, title: 'Glossary',
  lead: 'The terms these docs and the wizard use, with links to their official documentation.',
  body: () => `
<h2>Terms</h2>
<dl class="gloss">
<dt id="acm">ACM</dt><dd>AWS Certificate Manager, which issues and renews the TLS certificates the load balancers serve. ${ext('acm', 'Docs')}.</dd>
  <dt id="acm-dns-validation">ACM DNS validation</dt><dd>How ACM confirms that you control a hostname: it issues the certificate once it finds a DNS record it chose under that name, and renews it while the record stays. ${ext('acmdns', 'Docs')}.</dd>
  <dt id="advanced">Advanced and Advanced Options</dt><dd><b>Advanced</b> is the fold under the run log that offers single operations (Init, Plan, Apply, Bootstrap, Finish install, Tear down…). <b>Advanced Options</b> is the fold on the <b>Setup</b> step with the Keycloak hostname, the VPC CIDR block and the commons data bucket.</dd>
  <dt id="agent">Agent</dt><dd>A small service in each cluster that hosts commons. It connects out to the CSOC over mutual TLS and runs Helm and kubectl on the CSOC's behalf.</dd>
  <dt id="alb">ALB</dt><dd>Application Load Balancer, the AWS load balancer that receives HTTPS traffic for the CSOC and for each commons. ${ext('alb', 'Docs')}.</dd>
  <dt id="allowlist">Allowed addresses</dt><dd>The address ranges the CSOC's load balancers accept: the ranges in the <b>Allowed addresses</b> field on the <b>Install</b> step, plus the cluster's own outbound address. Also called the allowlist.</dd>
  <dt id="alloy">Alloy</dt><dd>Grafana Alloy, a collector of logs and metrics. The CSOC portal's optional <b>Alloy</b> setup step enables it in a cluster.</dd>
  <dt id="argo-cd">Argo CD</dt><dd>A GitOps tool that installs Kubernetes applications from a Git repository. The CSOC uses it when you choose <b>With a GitOps repo</b>; the wizard's labels spell it "ArgoCD". ${ext('argo', 'Docs')}.</dd>
  <dt id="banner">Banner</dt><dd>The box under the wizard's stepper. It says where you stand and offers the next button to press. See <a href="wizard-states.html">Wizard states</a>.</dd>
  <dt id="bootstrap">Bootstrap</dt><dd>The run that the <b>Bootstrap CSOC</b> button starts on the <b>Install</b> step. It stores the CSOC's secrets and installs the controllers, Keycloak and the CSOC portal.</dd>
  <dt id="bootstrap-wizard">Bootstrap wizard</dt><dd>The application at <code>localhost:3000/bootstrap</code>, running in Docker on your computer, that creates a CSOC in an empty AWS account and tears it down.</dd>
  <dt id="ca">CA</dt><dd>Certificate authority, which issues certificates that others trust. The CSOC runs its own CA for agents' client certificates.</dd>
  <dt id="cidr">CIDR</dt><dd>A notation for an IP address range, such as <code>172.24.16.0/20</code> for the CSOC's VPC or <code>x.x.x.x/32</code> for a single address on the allowlist.</dd>
  <dt id="cnpg">CloudNativePG</dt><dd>A Kubernetes operator for PostgreSQL. It runs Keycloak's database. ${ext('cnpg', 'Docs')}.</dd>
  <dt id="commons">Commons</dt><dd>Short for data commons: one Gen3 installation, deployed from the CSOC with the Helm chart <code>gen3</code>.</dd>
  <dt id="csoc">CSOC</dt><dd>The Gen3 Cloud Services Operations Center: a portal, its API and Keycloak in their own EKS cluster, from which you deploy and manage Gen3 commons. See <a href="../what-is-a-csoc.html">What is a CSOC?</a></dd>
  <dt id="ctds">CTDS and uc-cdis</dt><dd>The Center for Translational Data Science at the University of Chicago develops Gen3 and the CSOC; <code>uc-cdis</code> is the GitHub organization where they are published. ${ext('ctds', 'ctds.uchicago.edu')}.</dd>
  <dt id="data-commons">Data commons</dt><dd>A shared platform where a research community stores, describes, finds and analyzes data, with access controlled per user and project.</dd>
  <dt id="delegation">Delegation</dt><dd>Four NS records in the parent zone that tell public DNS which name servers answer for your subdomain. ${ext('r53sub', 'Docs')}.</dd>
  <dt id="direct-vs-gitops">Direct or GitOps</dt><dd>The two ways to install the CSOC. <b>Directly, from this wizard</b>: the wizard installs with Helm. <b>With a GitOps repo</b>: Argo CD installs from a repository, and every change is a pull request.</dd>
  <dt id="domain-zone-hostname">Domain, zone, hostname</dt><dd>${ex('parentzone')} is the parent domain. ${ex('zone')} is your subdomain, and its Route 53 hosted zone is "the zone". A hostname is one full name in it, such as ${ex('portal')}.</dd>
  <dt id="egress-ip">Egress IP</dt><dd>The wizard's label for what these docs call the cluster's <b>outbound address</b>: the public IP address of the Squid instance that the cluster's traffic leaves through. It is added to the allowed addresses automatically.</dd>
  <dt id="eks">EKS</dt><dd>Amazon Elastic Kubernetes Service, which runs the Kubernetes control plane. ${ext('eks', 'Docs')}.</dd>
  <dt id="environment">Environment</dt><dd>One CSOC as the wizard records it in the state bucket, named by ${ex('name')}.</dd>
  <dt id="eso">External Secrets Operator</dt><dd>A controller that copies values from AWS Secrets Manager into Kubernetes Secrets. ${ext('eso', 'Docs')}.</dd>
  <dt id="external-dns">external-dns</dt><dd>A controller that publishes the hostnames of Kubernetes ingresses in Route 53. Here it writes only records it owns, only in the CSOC's zone. ${ext('edns', 'Docs')}.</dd>
  <dt id="fargate">Fargate</dt><dd>AWS Fargate runs containers without EC2 nodes that you manage. Here it runs Karpenter's controller, so that the cluster needs no fixed nodes.</dd>
  <dt id="fence">Fence</dt><dd>Gen3's sign-in and authorization service. It signs users in through the CSOC's Keycloak, and with Arborist it applies the permissions in user.yaml. ${ext('fence', 'Repository')}.</dd>
  <dt id="finish">Finish</dt><dd>The run that the <b>Finish install</b> button starts on the <b>Install</b> step. It completes the allowlist, waits for Keycloak and the portal, and creates the DNS records.</dd>
  <dt id="gen3">Gen3</dt><dd>Open-source software for building data commons. ${ext('gen3', 'gen3.org')}; ${ext('gen3docs', 'documentation')}.</dd>
  <dt id="helm">Helm</dt><dd>The package manager for Kubernetes. The bootstrap installs the CSOC's components with Helm, and the agent installs each commons with it. ${ext('helm', 'Docs')}.</dd>
  <dt id="irsa">IRSA</dt><dd>IAM roles for service accounts: a Kubernetes service account is trusted by one IAM role, so its pods get only that role's AWS permissions, without keys. ${ext('irsa', 'Docs')}.</dd>
  <dt id="karpenter">Karpenter</dt><dd>A node autoscaler that starts and stops EC2 instances to fit pending pods. Here it runs on AWS Fargate, starts on-demand nodes of any instance family of generation 5 or newer, choosing the cheapest type that fits, and the cluster has no fixed nodes. ${ext('karpenter', 'Docs')}.</dd>
  <dt id="keycloak">Keycloak</dt><dd>The open-source identity service that signs users in to the CSOC and, through it, to each commons. ${ext('keycloak', 'Docs')}.</dd>
  <dt id="keycloak-realm">Keycloak realm</dt><dd>A separate set of users, clients and settings in Keycloak. The CSOC uses <code>csoc-realm</code>, and each commons gets a client in it named <code>fence-&lt;namespace&gt;</code>.</dd>
  <dt id="kms">KMS</dt><dd>AWS Key Management Service, which holds encryption keys. The CSOC's encrypted volumes, bucket and secrets use AWS managed keys; no customer managed key is created.</dd>
  <dt id="lbc">Load Balancer Controller</dt><dd>The AWS Load Balancer Controller, which creates load balancers for Kubernetes ingresses and services. ${ext('lbc', 'Docs')}.</dd>
  <dt id="lost-run">Lost run</dt><dd>A run whose end was not recorded, because the wizard's API restarted while it was in progress. The banner says its result is unknown and offers to retry it.</dd>
  <dt id="mtls">Mutual TLS</dt><dd>A TLS connection in which both sides present certificates, so each proves its identity to the other. Agents and the CSOC connect this way.</dd>
  <dt id="nat">NAT gateway</dt><dd>An AWS service that lets resources in private subnets reach the internet without accepting connections from it. ${ext('nat', 'Docs')}.</dd>
  <dt id="nlb">NLB</dt><dd>Network Load Balancer, the AWS load balancer for TCP traffic. The CSOC's agent endpoint uses one, limited to the allowlist.</dd>
  <dt id="oidc">OIDC</dt><dd>OpenID Connect, the sign-in protocol between the portal, each commons' Fence and Keycloak. ${ext('oidc', 'How it works')}.</dd>
  <dt id="outbound-address">Outbound address</dt><dd>The public IP address the cluster's traffic leaves from, which is that of the Squid instance in use. The wizard labels it "Egress IP".</dd>
  <dt id="provision">Provision</dt><dd>The button on the <b>Review</b> step, and the wizard step that follows it. The button registers the environment and starts the init and the plan; the <b>Apply</b> button on the <b>Provision</b> step creates the infrastructure.</dd>
  <dt id="registry">Registry</dt><dd>The records of each environment and its runs, kept in the state bucket. The banner is derived from them.</dd>
  <dt id="runner">Runner</dt><dd>A container started for each run, with Terraform, Helm, kubectl and the AWS CLI.</dd>
  <dt id="settled-status">Settled status</dt><dd>What the wizard believes exists in AWS, as recorded in the environment's record: <code>new</code>, <code>planned</code>, <code>applied</code>, <code>bootstrapped</code>, <code>installed</code>, <code>partial</code> or <code>destroyed</code>. It changes only when a run succeeds or leaves resources part-built. See <a href="wizard-states.html">Wizard states</a>.</dd>
  <dt id="squid">Squid</dt><dd>The outbound proxy. The cluster reaches the internet only through it, and only to listed destinations. ${ext('squid', 'squid-cache.org')}.</dd>
  <dt id="terraform">Terraform</dt><dd>The infrastructure-as-code tool that creates the network and the cluster from the gen3-terraform configuration. ${ext('terraform', 'Docs')}.</dd>
  <dt id="user-yaml">user.yaml</dt><dd>A commons' permission file, which maps users' emails to what they may do. ${ext('useryaml', 'Guide')}.</dd>
  <dt id="vpc">VPC</dt><dd>Amazon Virtual Private Cloud, the private network the CSOC runs in. ${ext('vpc', 'Docs')}.</dd>
</dl>
` },

/* ================================================================ WHERE THINGS LIVE */
{ file: 'reference/where-things-live.html', key: 'where-things-live', nav: 'Where things live', section: RF, title: 'Where things live',
  lead: 'Where the CSOC\'s state, secrets and records live in your AWS account and on your computer. Paths in the source code are on <a href="../contributing.html#source-code">For developers</a>.',
  body: () => `
<h2>In your AWS account</h2>
${table(['What', 'Where'], [
  ['State and registry', `<code>s3://${v('bucket')}/gen3-csoc/environments/${ex('name')}/</code>`],
  ['Secrets', `AWS Secrets Manager, <code>gen3-csoc/${v('name')}/…</code>`],
  ['DNS', `Route 53 hosted zone ${ex('zone')}`],
  ['Certificates', `ACM in ${ex('region')}`],
  ['Cluster', `EKS in ${ex('region')}, named ${ex('name')}`],
])}

<h2>On your computer</h2>
${table(['What', 'Where'], [
  ['Run working directories', '<code>~/.gen3-csoc/terraform</code>'],
  ['AWS profiles and the SSO cache', '<code>~/.aws/config</code>, <code>~/.aws/sso/cache</code>'],
  ['Developer settings', '<code>.env</code> in the repository (not committed). See <a href="../contributing.html">For developers</a>.'],
  ['Timers and the theme choice for these docs', 'Your browser\'s local storage'],
])}
` },
];
