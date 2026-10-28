import { v, ex, btn, fld, cp, cmd, adm, diagram, table, pill, F, ext, where } from './lib.mjs';

export const START = [
/* ================================================================ OVERVIEW */
{ file: 'index.html', key: 'index', nav: 'Overview', section: 'Start here', title: 'Bootstrap a Gen3 CSOC in your AWS account',
  lead: 'These docs take you from an empty AWS account to a running CSOC, the control plane that deploys and manages Gen3 data commons, and then to a first Gen3 commons deployed from it.',
  meta: [pill('To a running CSOC', `${F.total} in the wizard`), pill('First commons', `${F.gen3} from Deploy`)],
  body: () => `
<p>You run a bootstrap wizard on your own computer. It uses your AWS credentials to create the network, the Kubernetes cluster, the certificate and the DNS records, and it shows you what it will create before it creates anything. When it finishes, you sign in to the CSOC and deploy a Gen3 commons from it. If you are new to the terms, start with <a href="what-is-a-csoc.html">What is a CSOC?</a></p>

<h2>Who these docs are for</h2>
<p>They are written for research-IT and research-computing groups, at large universities and at smaller research institutes, and for three readers in particular:</p>
<div class="cards">
  <a class="card" href="what-is-a-csoc.html"><b>Deciding whether to adopt</b><span>What a CSOC is, who it suits, and the roles involved.</span></a>
  <a class="card" href="prerequisites.html"><b>Running it</b><span>The prerequisites, then the tutorial step by step, then the how-to guides.</span></a>
  <a class="card" href="concepts/security.html"><b>Reviewing security and compliance</b><span>What is exposed, where secrets live, why administrator rights are needed, and the shared responsibilities.</span></a>
</div>

<h2>What you'll build</h2>
<ul>
  <li>An <b>S3 state bucket</b> that holds the Terraform state and a record of every change.</li>
  <li>A <b>Route 53 hosted zone</b> for a subdomain such as ${ex('zone')}. Your parent domain, ${ex('parentzone')}, <b>delegates</b> the subdomain to it: a record in the parent's DNS tells the internet which name servers answer for the subdomain.</li>
  <li>A <b>VPC</b> (private network) across three availability zones, with a <b>NAT gateway</b> (lets private machines reach the internet without being reachable from it) and <b>Squid</b> (a proxy that allows outbound traffic only to listed destinations).</li>
  <li>An <b>Amazon EKS</b> Kubernetes cluster without fixed worker nodes: <b>Karpenter</b> starts EC2 nodes when workloads need them.</li>
  <li>An <b>ACM certificate</b> for the CSOC's two hostnames, ${ex('portal')} and ${ex('auth')}.</li>
  <li>The <b>CSOC</b>: the CSOC portal and <b>Keycloak</b> for sign-in, behind a load balancer that accepts only the IP addresses you allow.</li>
  <li>A first <b>Gen3 commons</b> at ${ex('commons')}, deployed from the CSOC and signed in to through the CSOC's Keycloak.</li>
</ul>
<p>The <a href="reference/glossary.html">Glossary</a> defines every term.</p>

<h2>How it fits together</h2>
<p>The wizard and its API run in Docker on your computer. Everything else runs in your AWS account.</p>
${diagram('overview', 'How the pieces fit together', [
  'On your computer, Docker runs the bootstrap wizard, its API and a restricted Docker socket proxy. Your AWS credentials stay on your computer. <a href="start-the-wizard.html">Start the wizard</a>',
  'The <b>Setup</b> step creates the S3 state bucket and a Route 53 hosted zone delegated from your parent domain. <a href="setup.html">Setup</a>',
  'Each Terraform, bootstrap or finish run happens in a new runner container. The apply creates the VPC, the NAT gateway, Squid and the EKS cluster with Karpenter. <a href="apply.html">Apply</a>',
  'After the apply, ACM issues a certificate for the two CSOC hostnames, proven through records in your zone. <a href="certificate-and-dns.html">Certificate</a>',
  'The bootstrap stores the CSOC\'s secrets in AWS Secrets Manager and installs the controllers, Keycloak and the CSOC portal. <a href="install.html">Bootstrap the CSOC</a>',
  `The finish points ${ex('portal')} and ${ex('auth')} at the load balancer. Only the addresses you allow can reach them. <a href="finish.html">Finish the install</a>`,
  'In the CSOC portal you deploy an agent into the cluster. The agent connects to the CSOC over an encrypted, mutually authenticated channel. <a href="connect-cluster.html">Connect the cluster</a>',
  `The CSOC asks the agent to install a Gen3 commons with Helm. external-dns publishes ${ex('commons')}. <a href="deploy-gen3.html">Deploy a Gen3 commons</a>`,
])}
<p>For the detail behind each box, read <a href="concepts/architecture.html">Architecture</a>.</p>

<h2>Time</h2>
<p>These times come from recorded runs in new AWS accounts. They assume the prerequisites are done and the delegation of your subdomain is in place; if central IT must add the delegation, add their turnaround. Most of the time is spent waiting while AWS creates resources.</p>
${table(['Wizard step', 'Pages', 'Time'], [
  ['<b>Welcome</b>', '<a href="start-the-wizard.html">Start the wizard</a>', 'about 1 minute'],
  ['<b>Setup</b>', '<a href="setup.html">Setup</a>', 'about 5 minutes'],
  ['<b>Review</b>', '<a href="review-and-provision.html">Review and provision</a>', 'about 1 minute'],
  ['<b>Provision</b>', '<a href="plan.html">Plan</a>, <a href="apply.html">Apply</a>', `${F.plan} for the plan, then ${F.apply} for the apply`],
  ['<b>Certificate</b>', '<a href="certificate-and-dns.html">Certificate</a>', F.cert],
  ['<b>Install</b>', '<a href="install.html">Bootstrap the CSOC</a>, <a href="finish.html">Finish the install</a>', `${F.install} for the bootstrap, then ${F.finish} for the finish`],
  ['<b>Done</b>', '<a href="sign-in.html">Sign in</a>', 'about 1 minute'],
  ['<i>Total, from Welcome to Done</i>', '', `<b>${F.total}</b>`],
  ['CSOC portal', '<a href="connect-cluster.html">Connect the cluster</a>, <a href="deploy-gen3.html">Deploy a Gen3 commons</a>', `about 2 minutes for the agent, then ${F.gen3} from Deploy Gen3 to a working site`],
  ['Clean up', '<a href="how-to/tear-down.html">Tear down</a>', `${F.teardown}: ${F.uninstall} to uninstall, then ${F.destroy} to destroy`],
])}

<h2>How these docs are organized</h2>
${table(['Part', 'Use it to', 'Pages'], [
  ['Start here', 'understand the product and get ready', '<a href="what-is-a-csoc.html">What is a CSOC?</a>, <a href="prerequisites.html">Prerequisites</a>'],
  ['Tutorial', 'build a CSOC and a first commons, once, from start to finish', 'grouped by the wizard\'s steps, starting with <a href="start-the-wizard.html">Start the wizard</a>'],
  ['How-to guides', 'do one specific task', '<a href="how-to/tear-down.html">Tear down</a>, <a href="how-to/resume.html">Resume</a>, <a href="how-to/allow-an-address.html">Allow a new IP address</a>, and more'],
  ['Concepts', 'understand how it works and what it means for security and cost', '<a href="concepts/architecture.html">Architecture</a>, <a href="concepts/security.html">Security, cost and responsibilities</a>'],
  ['Reference', 'look something up', '<a href="reference/wizard-states.html">Wizard states</a>, <a href="reference/troubleshooting.html">Troubleshooting</a>, <a href="reference/glossary.html">Glossary</a>, <a href="reference/where-things-live.html">Where things live</a>'],
])}

<h2>Conventions</h2>
<ul>
  <li>Buttons look like ${btn('Next')} and field labels look like ${fld('CSOC Name')}. Both use the exact text on screen.</li>
  <li>Wizard steps are named by their label in the wizard's stepper: <b>Welcome</b>, <b>Setup</b>, <b>Review</b>, <b>Provision</b>, <b>Certificate</b>, <b>Install</b> and <b>Done</b>.</li>
  <li>One example runs through every page: the CSOC name ${ex('name')}, the subdomain ${ex('zone')} under ${ex('parentzone')}, the portal ${ex('portal')}, Keycloak ${ex('auth')}, the commons ${ex('commons')}, the administrator ${ex('email')}, the address ${ex('ip')}, and the Region ${ex('region')}. Replace them with your own values; <a href="prerequisites.html#worksheet">the worksheet</a> collects them.</li>
  <li>Commands and templates use placeholders such as ${v('zone')}, which you replace before running them.</li>
  <li>A label such as ${'<span class="where">Terminal</span>'} marks a step that happens outside the wizard.</li>
  <li>The banner under the wizard's stepper always says where you are and offers the next button to press. If a screenshot and the banner disagree, follow the banner.</li>
  <li><b>About the screenshots:</b> they come from an example run, so the account numbers, names and addresses in them belong to that run, and the stepper at the top of some of them uses different labels from the current wizard.</li>
  <li>Press <kbd>/</kbd> to search. The moon button switches between light and dark themes, and pages print without the navigation.</li>
</ul>
` },

/* ================================================================ WHAT IS A CSOC */
{ file: 'what-is-a-csoc.html', key: 'what-is-a-csoc', nav: 'What is a CSOC?', section: 'Start here', title: 'What is a CSOC?',
  lead: 'The terms, the purpose, who a CSOC suits, and the people involved in running one.',
  body: () => `
<h2>Gen3 and data commons</h2>
<p>A <b>data commons</b> is a shared platform where a research community stores, describes, finds and analyzes data, with access controlled per user and per project. <b>${ext('gen3', 'Gen3')}</b> is open-source software for building data commons, developed by the ${ext('ctds', 'Center for Translational Data Science')} (CTDS) at the University of Chicago and published on GitHub under the <code>uc-cdis</code> organization. A Gen3 commons runs as a set of Gen3 services on Kubernetes. The ${ext('gen3docs', 'Gen3 documentation')} describes them.</p>

<h2>The CSOC</h2>
<p>CSOC stands for Cloud Services Operations Center. It is a control plane: the CSOC portal, its API and a Keycloak sign-in service, running in their own Amazon EKS cluster in your AWS account. From the CSOC you deploy Gen3 commons, configure them and keep track of them.</p>
<ul>
  <li><b>It deploys commons through agents.</b> An <b>agent</b> is a small program that runs in a Kubernetes cluster, connects out to the CSOC, and carries out the CSOC's instructions there. To install a commons, the CSOC tells the agent to run <b>Helm</b>, the package manager for Kubernetes applications. The first cluster is the CSOC's own.</li>
  <li><b>It provides sign-in.</b> Each commons can sign users in through the CSOC's Keycloak, so one identity setup serves every commons. What each user may do in a commons is set by that commons' <b>user.yaml</b>, a file that lists users by email and the permissions each one has.</li>
  <li><b>It keeps a record.</b> Every environment and every change is recorded in an S3 state bucket in your account, alongside the Terraform state.</li>
</ul>
<p>The <b>bootstrap wizard</b> is a separate tool that runs on your computer, not in AWS. It creates the CSOC, and you use it again for the CSOC's own maintenance: changing the allowed addresses, upgrading the CSOC portal, resetting the administrator password and tearing down. Gen3 commons are managed from the CSOC portal. Keep the wizard's prerequisites, and access to the state bucket and the AWS account, for as long as the CSOC runs (see <a href="prerequisites.html#plan-who-keeps-access">Plan who keeps access</a>).</p>

<h2>Why an institution would use one</h2>
<ul>
  <li><b>Several commons, one way of running them.</b> Groups that host commons for several labs, consortia or projects deploy each one the same way, from one place.</li>
  <li><b>Your account, your data.</b> Everything runs in an AWS account your institution owns, under your institution's agreements and controls.</li>
  <li><b>One sign-in setup.</b> Keycloak can be connected to your campus identity provider once, and every commons uses it. See <a href="how-to/connect-identity-provider.html">Connect your institution's sign-in</a>.</li>
  <li><b>Reviewable changes.</b> The wizard shows the Terraform plan before it changes anything.</li>
</ul>

<h2>Is this right for you?</h2>
<p>A CSOC is a good fit if all of these are true:</p>
<ul>
  <li>You expect to run more than one Gen3 commons, or to offer commons as a service to research groups.</li>
  <li>You can get a new AWS account with no other workloads, and administrator rights in it.</li>
  <li>You can get a DNS subdomain delegated to that account (see <a href="how-to/request-dns-delegation.html">Request DNS delegation</a>).</li>
  <li>Someone on your team can read Terraform plans, Kubernetes logs and AWS bills.</li>
</ul>
<p>Choose differently, or plan extra work, in these cases:</p>
<ul>
  <li><b>You need a single commons only.</b> Installing the Gen3 Helm chart (${ext('gen3helm', 'gen3-helm')}) into an existing cluster is simpler.</li>
  <li><b>You will hold controlled-access, regulated or protected health data.</b> Before you store such data, your security team must review the setup and harden it. Start with <a href="concepts/security.html#what-this-setup-is-not">What this setup is not</a>.</li>
  <li><b>You cannot use AWS.</b> The bootstrap creates AWS resources only.</li>
</ul>

<h2>Roles</h2>
<p>At a university these roles are usually different people; at a small institute one person may hold several.</p>
${table(['Role', 'Responsibilities'], [
  ['<b>Operator</b> (research-computing engineer)', 'Completes the prerequisites, runs the bootstrap wizard, operates the CSOC, deploys commons, and tears environments down.'],
  ['<b>Owner</b> (service or project lead)', 'Decides to adopt, owns the AWS account and its budget, and approves what data the commons may hold.'],
  ['<b>Security and compliance reviewer</b>', 'Reviews the architecture, the access model and the data classification before real data arrives. Start at <a href="concepts/security.html">Security, cost and responsibilities</a>.'],
  ['<b>Cloud account administrators</b>', 'Provide the AWS account and the administrator role, and set any organization-wide policies (Service Control Policies).'],
  ['<b>DNS administrators</b> (often central IT)', 'Delegate a subdomain of the institution\'s domain to the CSOC\'s account.'],
  ['<b>Commons administrators</b>', 'Manage users and permissions within each commons, through its user.yaml.'],
])}
` },

/* ================================================================ PREREQUISITES */
{ file: 'prerequisites.html', key: 'prerequisites', nav: 'Prerequisites', section: 'Start here', title: 'Prerequisites',
  lead: 'Everything to do before you open the wizard, with a worksheet for every value it asks for.',
  meta: [pill('Time', '10–30 minutes, plus any wait for DNS delegation')],
  body: () => `
<p>Before you open the wizard, do four things:</p>
<ol>
  <li>Fill in the <a href="#worksheet">worksheet</a> below.</li>
  <li><a href="#install-the-tools">Install</a> Git, the AWS CLI version 2 and Docker, and pull the wizard's images.</li>
  <li><a href="#create-an-aws-cli-profile">Create an AWS CLI profile</a>, and confirm that <code>aws sts get-caller-identity</code> prints the ID of the account the CSOC goes in.</li>
  <li><a href="#get-your-subdomain-delegated">Get your subdomain</a>, for example ${ex('zone')}, delegated to that account, or send the request to central IT.</li>
</ol>

<h2>Worksheet</h2>
<p>These are the fields the wizard asks for, in the order it shows them. Fill in the last column before you start. The example column uses the example that runs through these docs.</p>
<div class="tw"><table><thead><tr><th>Wizard step</th><th>Field label</th><th>What it is for</th><th>Rules</th><th>Default</th><th>Recommended</th><th>Example</th><th>Your value</th></tr></thead><tbody>
  <tr><td>Setup</td><td>${fld('AWS Credentials')}</td><td>How the wizard gets AWS credentials</td><td>One of <b>Auto-detect (use default AWS credentials)</b>, <b>Select AWS profile (including SSO profiles)</b>, <b>Provide credentials manually</b></td><td>Auto-detect</td><td><b>Select AWS profile</b></td><td>Select AWS profile</td><td></td></tr>
  <tr><td>Setup</td><td>${fld('AWS Profile')}</td><td>The profile for the CSOC account</td><td>A profile in <code>~/.aws/config</code></td><td>none</td><td>A profile used only for this account</td><td>${ex('profile')}</td><td></td></tr>
  <tr><td>Setup</td><td>${fld('Assume role (optional)')}</td><td>A role to assume on top of the profile</td><td>An IAM role ARN</td><td>empty</td><td>Leave empty; put the role in the profile instead</td><td>empty</td><td></td></tr>
  <tr><td>Setup</td><td>${fld('Terraform State Bucket')}</td><td>The S3 bucket for the Terraform state and the wizard's records</td><td>A globally unique S3 bucket name</td><td>empty (the field shows <code>my-org-gen3-terraform-state</code> as a hint)</td><td><code>gen3-csoc-&lt;csoc-name&gt;-&lt;account-id&gt;</code>; the account ID keeps it unique</td><td>${ex('bucket')}</td><td></td></tr>
  <tr><td>Setup</td><td>${fld('CSOC Name')}</td><td>Names the VPC, the cluster and the state key</td><td>Lowercase letters, digits and hyphens, up to 40 characters, not starting or ending with a hyphen; unique in the bucket; cannot be changed later</td><td>empty</td><td>A short name with the environment in it</td><td>${ex('name')}</td><td></td></tr>
  <tr><td>Setup</td><td>${fld('AWS Region')}</td><td>Where everything is created, including the state bucket</td><td>One of the 10 Regions in the list, with at least three availability zones</td><td>us-east-1</td><td>The Region closest to your users that your institution allows</td><td>${ex('region')}</td><td></td></tr>
  <tr><td>Setup</td><td>${fld('CSOC Hostname')}</td><td>The CSOC portal's full hostname</td><td>Your subdomain with one more label in front</td><td>empty</td><td><code>portal.</code> followed by your subdomain</td><td>${ex('portal')}</td><td></td></tr>
  <tr><td>Setup</td><td>${fld('DNS for the hostnames')}</td><td>Who manages the CSOC's DNS records</td><td><b>A Route 53 hosted zone in this account</b> or <b>I manage DNS myself</b></td><td>A Route 53 hosted zone in this account</td><td>The default</td><td>A Route 53 hosted zone in this account</td><td></td></tr>
  <tr><td>Setup</td><td>${fld('Hosted zone to create')}</td><td>The subdomain the hostnames go under</td><td>At least three labels</td><td>the hostname without its first label</td><td>The default</td><td>${ex('zone')}</td><td></td></tr>
  <tr><td>Setup</td><td>${fld('Delegate it from the parent zone using')}</td><td>How the wizard reaches the parent domain's zone</td><td><b>The credentials above</b>, <b>Profile: …</b>, or <b>I'll add the NS records myself</b></td><td>The credentials above</td><td>See <a href="#get-your-subdomain-delegated">Get your subdomain delegated</a></td><td>I'll add the NS records myself</td><td></td></tr>
  <tr><td>Setup (Advanced Options)</td><td>${fld('Keycloak Hostname')}</td><td>Keycloak's hostname</td><td>In the same zone</td><td><code>auth.</code> followed by the zone</td><td>The default</td><td>${ex('auth')}</td><td></td></tr>
  <tr><td>Setup (Advanced Options)</td><td>${fld('VPC CIDR Block')}</td><td>The VPC's address range</td><td>An IPv4 CIDR range</td><td><code>${F.cidr}</code></td><td>The default, unless it overlaps a network you will peer with</td><td><code>${F.cidr}</code></td><td></td></tr>
  <tr><td>Install</td><td>${fld('Allowed addresses')}</td><td>Who can reach the CSOC portal, Keycloak and the agent endpoint</td><td>IPv4 CIDR ranges</td><td>your current address</td><td>Your current address plus your VPN's or campus's outbound range</td><td>${ex('ip')}, ${ex('campus')}</td><td></td></tr>
  <tr><td>Install</td><td>${fld('Admin email (optional)')}</td><td>The CSOC administrator's email, used to sign in and in each commons' user.yaml</td><td>An email address</td><td>empty</td><td>Your own email; do not leave it empty</td><td>${ex('email')}</td><td></td></tr>
  <tr><td>Install</td><td>${fld('Admin password')}</td><td>The password of the CSOC user <code>admin</code></td><td>12–128 characters; no quotes, backslashes, <code>$</code> or backticks</td><td>empty</td><td>Press <b>Generate password</b> and save it in a password manager</td><td>(generated)</td><td>(in your password manager)</td></tr>
</tbody></table></div>
${adm('warning', 'The hostname decides the zone', `The wizard takes the hostname and drops its first label to get the zone: ${ex('portal')} gives ${ex('zone')}. A hostname with only three labels, such as <code>portal.example.org</code>, makes the zone <code>portal.example.org</code> itself, which is not what you want. Always use a hostname with a label in front of your subdomain.`)}
${adm('note', 'Choose the Region before you create the bucket', `<b>Create bucket</b> creates the bucket in the Region currently selected under ${fld('AWS Region')}, which is ${ex('region')} until you change it. On the <b>Setup</b> step, ${fld('AWS Region')} comes after ${fld('CSOC Name')}, below the bucket field, so set it first.`)}

<h2>Steps</h2>
<h3 id="install-the-tools">Install the tools and pull the images</h3>
<ol class="steps">
  <li>${where('Terminal')}Install ${ext('git', 'Git')}.</li>
  <li>${where('Terminal')}Install the ${ext('awscli', 'AWS CLI version 2')}. You use it to sign in; the runs use their own copy inside the runner image.</li>
  <li>${where('Terminal')}Install and start a Docker runtime: ${ext('docker', 'Docker Desktop')}, ${ext('orbstack', 'OrbStack')} or ${ext('colima', 'Colima')}, with ${ext('compose', 'Docker Compose')}. Check that Docker is running: ${cp("docker info --format '{{.ServerVersion}}'")}</li>
  <li>${where('Terminal')}Clone the repository:
    ${cmd('git clone https://github.com/uc-cdis/gen3-admin\ncd gen3-admin')}</li>
  <li>${where('Terminal')}Pull the wizard's images. They are published, so nothing is built on your computer:
    ${cmd('docker compose -f docker-compose.workshop.yml pull\ndocker pull quay.io/cdis/csoc-terraform:feat_csoc-bootstrap-wizard')}
    The second command pulls the runner image, which the wizard starts for every run.</li>
</ol>
<p>The wizard's images run only on your computer. <code>docker-compose.workshop.yml</code> pins them all to the tag <code>feat_csoc-bootstrap-wizard</code>:</p>
${table(['Image', 'Purpose'], [
  ['<code>quay.io/cdis/csoc-api:feat_csoc-bootstrap-wizard</code>', 'The wizard\'s API.'],
  ['<code>quay.io/cdis/csoc-bootstrap-frontend:feat_csoc-bootstrap-wizard</code>', 'The wizard\'s web pages.'],
  ['<code>quay.io/cdis/csoc-terraform:feat_csoc-bootstrap-wizard</code>', 'The runner: Terraform, Helm, kubectl and the AWS CLI.'],
  ['<code>tecnativa/docker-socket-proxy:v0.5.0</code>', 'The restricted Docker socket proxy.'],
])}
<p>The runner fetches the CSOC's Terraform from gen3-terraform's <code>feat/csoc-bootstrap-master</code> branch (set by <code>TERRAFORM_MODULES_REF</code> in the compose file). The repository checkout is still needed: the runner mounts its <code>scripts/runner</code> and <code>helm/csoc</code> directories. To build the images from source instead, see <a href="contributing.html#build-from-source">For developers</a>.</p>
<p>The images that run in your AWS account are listed in <a href="concepts/security.html#images-and-pinning">Images and pinning</a>.</p>

<h3 id="create-an-aws-cli-profile">Create an AWS CLI profile</h3>
<p>The wizard reads the AWS CLI's profiles from <code>~/.aws</code> on your computer. It also offers <b>Provide credentials manually</b>, where you paste access keys into the page; use <b>Select AWS profile</b> instead, so that no keys are typed into a browser.</p>
<ol class="steps" style="counter-reset: st 5">
  <li><b>Get the account.</b> Ask your cloud administrators for a new AWS account with no other workloads, and an administrator role in it, such as one with the <code>AdministratorAccess</code> policy. The bootstrap creates IAM roles and policies, a VPC, an EKS cluster, EC2 instances, an AWS Lambda function, load balancers, Route 53 records, ACM certificates, Secrets Manager secrets and S3 buckets, so a narrower role fails part-way. <a href="concepts/security.html#why-administrator-rights">Why administrator rights</a> explains this for your reviewers.</li>
  <li>${where('Terminal')}<b>Create the profile.</b>
    <ul>
      <li><b>If your institution signs in to AWS through ${ext('idc', 'IAM Identity Center')} (AWS SSO)</b>, which is recommended, run <code>aws configure sso</code> as described in ${ext('sso', 'Configuring IAM Identity Center authentication with the AWS CLI')}, and name the profile, for example ${ex('profile')}.</li>
      <li><b>If you sign in to one account and assume a role in the CSOC account</b>, add a second profile like this to <code>~/.aws/config</code>, where ${v('ssoprofile')} is the profile you sign in with:
        ${cmd(`[profile ${v('profile')}]
role_arn = arn:aws:iam::${v('account')}:role/&lt;admin-role&gt;
source_profile = ${v('ssoprofile')}
region = ${v('region')}`, 'ini')}</li>
      <li><b>If you use access keys</b>, put them in a ${ext('profiles', 'named profile')} in <code>~/.aws/credentials</code>.</li>
    </ul></li>
  <li>${where('Terminal')}<b>Sign in and check the account:</b>
    ${cmd(`aws sso login --profile ${v('ssoprofile')}
aws sts get-caller-identity --profile ${v('profile')}`)}
    The <code>Account</code> value must be the ID of the CSOC account, for example ${ex('account')}. If you use access keys, skip <code>aws sso login</code>. In these docs, ${v('ssoprofile')} is the profile you sign in with; if that sign-in lands directly in the CSOC account, it is the same profile as ${v('profile')}.</li>
</ol>
${adm('warning', 'Check the account number', 'If the number is not the CSOC account, fix the profile before you continue. Default credentials can point at another account, such as the one that holds your institution\'s DNS.')}
${adm('note', 'Sign in shortly before you start', 'The wizard asks you to sign in again before an apply or a teardown if less than 45 minutes are left on your SSO sign-in, and before a bootstrap or a finish if less than 15 minutes are left.')}

<h3 id="get-your-subdomain-delegated">Get your subdomain delegated</h3>
<p>The wizard creates a Route 53 hosted zone for your subdomain in the CSOC account. Delegation is one NS record set in the parent domain's zone, listing the new zone's four name servers, so that the internet finds the new zone. ACM needs it before it can issue a certificate (${ext('acmdns', 'DNS validation')}). Find out where ${ex('parentzone')} is hosted, then follow the matching branch:</p>
${table(['Where the parent domain is', 'Choose on the Setup step', 'Who adds the delegation', 'Lead time'], [
  ['In Route 53, in the CSOC account', '<b>The credentials above</b> (the default)', 'The wizard', 'None'],
  ['In Route 53, in another account you have a profile for', '<b>Profile:</b> followed by that profile\'s name, for example <b>Profile: dns-admin</b>', 'The wizard', 'None'],
  ['Managed by central IT, in Route 53 or elsewhere', '<b>I\'ll add the NS records myself</b>', `Central IT, from your request (<a href="how-to/request-dns-delegation.html">template</a>)`, 'Days, at most universities. Send the request now.'],
])}
<p>If your institution will not delegate a subdomain at all, choose <b>I manage DNS myself</b> on the <b>Setup</b> step instead and add each record by hand; see <a href="how-to/self-managed-dns.html">Use DNS you manage yourself</a>.</p>

<h3 id="plan-who-keeps-access">Plan who keeps access</h3>
<p>You use the wizard for the CSOC's whole life: changing the allowed addresses, upgrading the CSOC portal, resetting the administrator password and tearing down all run from it. Each needs the repository, Docker, and a profile with administrator rights in the account; the wizard reads everything else from the state bucket. Make sure two people on your team can do this, and include it in any handover when the operator changes.</p>

<h2>Expected result</h2>
<div class="expect">
<ul>
  <li><code>git --version</code> and <code>aws --version</code> print versions.</li>
  <li><code>docker info</code> prints a version, not "Cannot connect to the Docker daemon".</li>
  <li><code>docker images</code> lists <code>quay.io/cdis/csoc-api</code>, <code>quay.io/cdis/csoc-bootstrap-frontend</code> and <code>quay.io/cdis/csoc-terraform</code> with the tag <code>feat_csoc-bootstrap-wizard</code>.</li>
  <li><code>aws sts get-caller-identity --profile ${v('profile')}</code> prints the CSOC account's ID.</li>
  <li>Every row of the worksheet has a value, and the delegation is in place or requested.</li>
</ul>
</div>

<h2>What's happening</h2>
<p>The wizard works entirely from your computer with your AWS credentials. Terraform, Helm, kubectl and a copy of the AWS CLI are in the runner image, and the wizard starts one runner container for each run.</p>

<h2>Troubleshooting</h2>
{{TS:prerequisites}}
` },
];
