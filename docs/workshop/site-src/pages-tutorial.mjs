import { v, ex, EX, btn, fld, cp, cmd, banner, adm, shot, diagram, timer, table, pill, F, ext, COST_IN, where, doneWhen } from './lib.mjs';

const R = '';
const T = 'Tutorial';
const arch = (id, text) => `<a href="concepts/architecture.html#${id}">${text}</a>`;

const USERYAML = `authz:
  anonymous_policies: []
  all_users_policies: []
  groups:
    - name: administrators
      policies:
        - all_programs_admin
        - services.sheepdog-admin
        - indexd_admin
        - data_upload
      users:
        - ${v('email')}
  resources:
    - name: data_file
    - name: programs
    - name: services
      subresources:
        - name: sheepdog
          subresources:
            - name: submission
              subresources:
                - name: program
                - name: project
        - name: indexd
          subresources:
            - name: admin
  policies:
    - id: all_programs_admin
      resource_paths: [/programs]
      role_ids: [admin]
    - id: services.sheepdog-admin
      resource_paths:
        - /services/sheepdog/submission/program
        - /services/sheepdog/submission/project
      role_ids: [sheepdog_admin]
    - id: indexd_admin
      resource_paths: [/services/indexd/admin]
      role_ids: [indexd_admin]
    - id: data_upload
      resource_paths: [/data_file]
      role_ids: [file_uploader]
  roles:
    - id: admin
      permissions:
        - id: admin
          action: {service: "*", method: "*"}
    - id: sheepdog_admin
      permissions:
        - id: sheepdog_admin_action
          action: {service: sheepdog, method: "*"}
    - id: indexd_admin
      permissions:
        - id: indexd_admin
          action: {service: indexd, method: "*"}
    - id: file_uploader
      permissions:
        - id: file_upload
          action: {service: fence, method: file_upload}

users:
  ${v('email')}:
    admin: true`;

export const TUTORIAL = [
/* ================================================================ WELCOME */
{ file: 'start-the-wizard.html', key: 'start-the-wizard', nav: 'Start the wizard', section: T, group: 'Welcome', title: 'Start the wizard',
  lead: 'Start the bootstrap wizard on your computer and open its first step.',
  meta: [pill('Wizard step', 'Welcome'), pill('Time', 'about 1 minute')],
  body: () => `
<h2>Goal</h2>
<p>Run the wizard's three containers and open the <b>Welcome</b> step in your browser.</p>

<h2>Steps</h2>
<ol class="steps">
  <li>${where('Terminal')}In the <code>gen3-admin</code> directory, start the containers. The first time, after you built the images in <a href="prerequisites.html#install-the-tools">Prerequisites</a>, run:
    ${cmd('docker compose -f docker-compose-bootstrap-csoc.yml up -d')}
    On later runs, after you update the repository with <code>git pull</code>, rebuild as you start:
    ${cmd('./scripts/build-terraform-image.sh\ndocker compose -f docker-compose-bootstrap-csoc.yml up -d --build')}</li>
  <li>${where('Terminal')}Check that all three containers are running: ${cp('docker compose -f docker-compose-bootstrap-csoc.yml ps')}. It lists <b>api</b>, <b>frontend</b> and <b>docker-proxy</b>.</li>
  <li>${where('Browser')}Open ${cp('http://localhost:3000/bootstrap')}. On macOS you can run ${cp('open http://localhost:3000/bootstrap')}.</li>
  <li>You see <b>Welcome to the Gen3 CSOC Bootstrap</b>, the list of what the wizard creates, and "${F.ui.welcome}" Press ${btn('Next')} at the top right.</li>
</ol>
${doneWhen('the stepper shows <i>Welcome · Setup · Review · Provision · Certificate · Install · Done</i> and, after <b>Next</b>, the <b>Environment Setup</b> page is open.')}
${shot(R, '01-welcome.png', "The wizard's Welcome step", 'The <b>Welcome</b> step.')}
<p>When you are not using the wizard, stop it with ${cp('docker compose -f docker-compose-bootstrap-csoc.yml down')}. Nothing in AWS changes when you stop it.</p>

<h2>Expected result</h2>
<div class="expect">
<p>The <b>Welcome</b> step is open in your browser.</p>
<h4>Time</h4><p>Under 1 minute from <code>docker compose up</code> to the <b>Welcome</b> step, when the images are already built.</p>
</div>

<h2>What's happening</h2>
<p>Three containers start on your computer: the wizard's web frontend, its API, and a proxy that lets the API start and watch other containers and blocks the rest of the Docker API. The frontend and the API listen only on your own computer, because the API acts with your AWS credentials and does not ask anyone to sign in. For each Terraform or install run, the API starts a new runner container and streams its log to the page.</p>
${diagram('stack', 'The wizard on your computer', [
  'You open <code>localhost:3000/bootstrap</code>, and the frontend serves the wizard.',
  'Each action in the wizard calls the API, which listens only on your computer.',
  'The API reads your AWS profiles to confirm which account you are using.',
  'To run Terraform, the API asks the Docker socket proxy to start a container.',
  'A new runner container starts, with a copy of your AWS configuration and the profile you chose.',
  'The runner calls AWS with Terraform, the AWS CLI, kubectl and Helm.',
  'The runner\'s log streams back through the API to your browser.',
])}
<p>Everything the wizard does is recorded in the state bucket you create on the next step, so you can close the tab and come back at any time. For the containers, ports and mounts, see ${arch('the-bootstrap-wizard-on-your-computer', 'The bootstrap wizard on your computer')}.</p>
${adm('danger', 'Keep the wizard on your own computer', 'Anyone who can reach the wizard\'s API can act with your AWS credentials. Keep the <code>127.0.0.1</code> port bindings in <code>docker-compose-bootstrap-csoc.yml</code>, and do not run the wizard on a shared server.')}

<h2>Troubleshooting</h2>
{{TS:start-the-wizard}}
` },

/* ================================================================ SETUP */
{ file: 'setup.html', key: 'setup', nav: 'Setup', section: T, group: 'Setup', title: 'Setup: account, state bucket, names and DNS zone',
  lead: 'Choose the AWS account, create the state bucket, name the CSOC, and create and delegate its DNS zone.',
  meta: [pill('Wizard step', 'Setup'), pill('Time', 'about 5 minutes')],
  body: () => `
<div class="choice">
<p>Which applies to you?</p>
<ul>
  <li><b>You sign in with SSO</b> (recommended), <b>or with access keys</b>: both use <a href="#a-choose-the-account">A. Choose the account</a> with a profile.</li>
  <li><b>The state bucket already exists</b>, because you are coming back: see <a href="#b-create-the-state-bucket">B</a> and <a href="how-to/resume.html">Resume after closing the tab</a>.</li>
  <li><b>The parent domain is in Route 53 in this account</b>, <b>in another account</b>, or <b>managed by central IT</b>: see <a href="#d-create-and-delegate-the-zone">D. Create and delegate the zone</a>.</li>
  <li><b>Your DNS is not in Route 53 and cannot be delegated</b>: see <a href="how-to/self-managed-dns.html">Use DNS you manage yourself</a>.</li>
</ul>
</div>

<h2>Goal</h2>
<p>Tell the wizard where the CSOC goes and what it is called. On this step the wizard creates two things, the state bucket and the hosted zone, and nothing else. Have your <a href="prerequisites.html#worksheet">worksheet</a> at hand.</p>

<h2>Steps</h2>
<h3>A. Choose the account</h3>
<ol class="steps">
  <li>Under ${fld('AWS Credentials')}, choose <b>Select AWS profile (including SSO profiles)</b>. Do not use <b>Auto-detect (use default AWS credentials)</b>: it uses your default credentials, which can belong to another account.</li>
  <li>Under ${fld('AWS Profile')}, choose your profile, for example ${ex('profile')}. Leave ${fld('Assume role (optional)')} empty.</li>
  <li>Read the blue box. It says "Deploying into AWS account" followed by the account ID. If the number is not the CSOC account's, choose another profile before you continue.</li>
</ol>
<p>If a yellow box titled <b>AWS SSO session expired</b> appears, your sign-in ran out: ${where('Terminal')}run the command it shows, then press <b>Retry</b> in the box.</p>
${shot(R, '02b-account.png', 'The Setup step with a profile chosen and the blue account box', 'The blue box names the account and the role you reach it through.')}

<h3>B. Create the state bucket</h3>
<ol class="steps">
  <li>Scroll to ${fld('AWS Region')}, below ${fld('CSOC Name')}, and choose your Region, for example ${ex('region')}. <b>Create bucket</b> creates the bucket in this Region.</li>
  <li>Under ${fld('Terraform State Bucket')}, enter your bucket name, for example ${ex('bucket')}. The field starts empty; the grey <code>my-org-gen3-terraform-state</code> is only a hint.</li>
  <li>Press ${btn('Check', 'light')}.
    <ul>
      <li><b>If the bucket is new</b>, the yellow box <b>Bucket does not exist</b> appears. Press ${btn('Create bucket', 'light')}; the box changes to the green <b>Bucket created</b>.</li>
      <li><b>If the bucket already exists</b>, the green box <b>Bucket ready</b> appears, with <b>Environments in this bucket</b> listing earlier environments. To continue one, press <b>Resume</b> next to it; to start a new CSOC, ignore the list and continue.</li>
      <li><b>If the red box Bucket not available appears</b>, another AWS account owns that name. Choose another name.</li>
    </ul></li>
</ol>
${shot(R, '03-bucket-missing.png', 'Bucket does not exist, with a Create bucket button', 'The bucket is created with versioning, encryption, TLS-only access and public access blocked.')}

<h3>C. Name the CSOC and choose its hostname</h3>
<ol class="steps">
  <li>Under ${fld('CSOC Name')}, enter your name, for example ${ex('name')}. It cannot be changed later.</li>
  <li>Check ${fld('AWS Region')} again: it must still be the Region you chose for the bucket.</li>
  <li>Under ${fld('CSOC Hostname')}, enter the portal's full hostname, for example ${ex('portal')}. The zone is this hostname without its first label, so ${ex('portal')} gives the zone ${ex('zone')}.</li>
  <li>Under ${fld('DNS for the hostnames')}, keep <b>A Route 53 hosted zone in this account</b>.</li>
  <li>Press ${btn('Validate')} inside the hostname field. <b>If the zone already exists in this account and is delegated</b>, the green <b>Domain Verified</b> box appears straight away; skip to <a href="#e-leave-advanced-options-as-they-are">E</a>.</li>
</ol>

<h3>D. Create and delegate the zone</h3>
<p>Delegation is one NS record set in the parent domain's zone that lists your new zone's four name servers. It is what lets the internet, and ACM, find the new zone.</p>
<ol class="steps">
  <li>A yellow box titled <b>No hosted zone yet</b> appears. ${fld('Hosted zone to create')} shows ${ex('zone')}; leave it.</li>
  <li>Under ${fld('Delegate it from the parent zone using')}, choose the branch that matches where ${ex('parentzone')} is (from the <a href="prerequisites.html#get-your-subdomain-delegated">decision table</a>):
    <ul>
      <li><b>If the parent zone is in Route 53 in this same account</b>, keep <b>The credentials above</b>, the default.</li>
      <li><b>If it is in Route 53 in another account</b>, choose <b>Profile: </b> followed by a profile for that account, for example <b>Profile: dns-admin</b>.</li>
      <li><b>If central IT manages it</b>, choose <b>I'll add the NS records myself</b>.</li>
    </ul></li>
  <li>Press ${btn('Set up zone and delegation')}. The wizard creates the zone, and the button changes to ${btn('Check again', 'light')}.
    <ul>
      <li><b>If you chose a profile or The credentials above</b>, the wizard adds the NS records itself.</li>
      <li><b>If you chose I'll add the NS records myself</b>, a yellow box titled <b>Add these records to the parent zone</b> lists them, in this form:
        ${cmd(`csoc.example.org.  300  IN  NS  ns-123.awsdns-45.com.
csoc.example.org.  300  IN  NS  ns-678.awsdns-12.net.
csoc.example.org.  300  IN  NS  ns-1234.awsdns-56.org.
csoc.example.org.  300  IN  NS  ns-1890.awsdns-34.co.uk.`, 'dns')}
        ${where('Your DNS provider')}Send your four records to central IT with the <a href="how-to/request-dns-delegation.html">request template</a>, or add them yourself.</li>
    </ul></li>
  <li>Wait for the green box <b>Delegation is live</b>, then the green <b>Domain Verified</b>. The page checks again every 20 seconds by itself; you can also press <b>Check again</b>.</li>
</ol>
${adm('note', 'While you wait for central IT', 'The wizard cannot go past <b>Setup</b> until public DNS finds the zone: <b>Next</b> stays disabled, and the plan, the apply, the bootstrap and the finish all check the zone before they start. Close the wizard; the zone and the bucket stay in your account. When the delegation is in place, <a href="how-to/resume.html">resume</a>, and the page continues by itself.')}
${shot(R, '05-zone-delegate-from.png', 'Hosted zone to create, and the Delegate it from the parent zone using menu', 'Choosing how the wizard reaches the parent zone.')}
${shot(R, '06-zone-ready.png', 'Domain Verified', '<b>Domain Verified</b>: public DNS finds the new zone.')}

<h3>E. Leave Advanced Options as they are</h3>
<p><b>Advanced Options</b>, below the hostname, holds three fields. Keep their defaults:</p>
<ul>
  <li>${fld('Keycloak Hostname')}: ${ex('auth')}.</li>
  <li>${fld('VPC CIDR Block')}: <code>${F.cidr}</code>. Change it only if it overlaps a network you will connect to the CSOC's VPC.</li>
  <li>${fld('Commons data bucket')}: off. A CSOC does not need one.</li>
</ul>
${doneWhen('the green <b>Domain Verified</b> box shows "Served by Route53 hosted zone csoc.example.org" with its zone ID, and <b>Next</b> is enabled. Press <b>Next</b>.')}

<h2>Expected result</h2>
<div class="expect">
${banner('green', 'Bucket created', 'The list of environments in the bucket is empty.')}
${banner('green', 'Domain Verified', `Served by Route53 hosted zone ${EX.zone}, with its zone ID.`)}
<h4>Time</h4>
<p>About 5 minutes from opening <b>Setup</b> to <b>Domain Verified</b>, when the wizard adds the delegation itself. When central IT adds it, this step waits for them.</p>
</div>

<h2>What's happening</h2>
<p>The wizard confirms which account your profile reaches, then creates two resources. The <b>state bucket</b> holds the Terraform state and the wizard's record of every environment and run, which is why you can leave and resume. The <b>hosted zone</b> holds the DNS records for the CSOC's hostnames, and later for every commons.</p>
${diagram('dns', 'Creating and delegating the zone', [
  `The wizard creates the hosted zone ${ex('zone')} in your account. Route 53 assigns it four name servers.`,
  `One NS record set, listing the four name servers, is added to the parent zone, ${ex('parentzone')}.`,
  'A public DNS resolver asked about your zone follows that NS record set and gets an answer from the new zone.',
  'The wizard sees the answer and shows <b>Domain Verified</b>.',
])}
<p>For how your profile becomes the credentials each run uses, and what the bucket contains, see ${arch('aws-credentials', 'AWS credentials')} and ${arch('state-bucket-and-registry', 'State bucket and registry')}.</p>

<h2>Troubleshooting</h2>
{{TS:setup}}
` },

/* ================================================================ REVIEW */
{ file: 'review-and-provision.html', key: 'review-and-provision', nav: 'Review and provision', section: T, group: 'Review', title: 'Review and provision',
  lead: 'Check the configuration, then save it and compute a plan.',
  meta: [pill('Wizard step', 'Review'), pill('Time', 'about 1 minute')],
  body: () => `
<h2>Goal</h2>
<p>Confirm the configuration on the <b>Review</b> step, then press <b>Provision</b>. The Provision button saves your settings and computes a plan. Nothing is built until you press Apply.</p>

<h2>Steps</h2>
<ol class="steps">
  <li>Read <b>Review &amp; Confirm</b>. With the example values it reads:
    ${table(['Line', 'Reads'], [
      ['CSOC Name', ex('name')],
      ['Portal', `<code>https://${EX.portal}</code>`],
      ['Keycloak', `<code>https://${EX.auth}</code>`],
      ['Certificate', 'chosen after the infrastructure is up (request, import or existing, on the Certificate step)'],
      ['DNS', `Route 53 zone ${EX.zone}`],
      ['Region', ex('region')],
      ['AWS Account', 'your account ID'],
      ['State', `<code>s3://${EX.bucket}/gen3-csoc/environments/${EX.name}/</code>`],
      ['VPC CIDR', `<code>${F.cidr}</code>`],
      ['Data bucket', 'none'],
    ])}
    If a line is wrong, press <b>Back</b> and change it on <b>Setup</b>.</li>
  <li>Read the <b>Rough Monthly Cost Estimate</b>. Its badge shows <b>${F.costBadge}</b>: a us-east-1 figure before commons and data transfer, on Kubernetes ${F.eksVersion}, which is billed at the EKS extended-support rate. <a href="concepts/security.html#cost">Cost</a> breaks it down.</li>
  <li>Press ${btn('Provision')} at the top right. The text below the cost reads "Provision registers ${EX.name} in the state bucket and starts Terraform."</li>
</ol>
${doneWhen('the stepper moves to <b>Provision</b> and the banner reads <b>Init in progress</b>.')}

<h2>Expected result</h2>
<div class="expect">
${banner('', 'Init in progress', F.ui.init, '[Stop this run]')}
<p>The plan follows by itself. Continue with <a href="plan.html">Plan</a>.</p>
</div>

<h2>What's happening</h2>
<p><b>Provision</b> writes a record for ${ex('name')} into the state bucket. Every banner the wizard shows from now on is derived from that record. Then Terraform prepares its working directory (<code>terraform init</code>) and computes the plan. A failed run never erases what was already done, so every failure can be retried from where it stopped. <a href="reference/wizard-states.html">Wizard states</a> lists every banner.</p>
${adm('note', 'One run at a time', 'The wizard refuses to start a second run while one is in progress for the same environment, from any browser tab or computer.')}

<h2>Troubleshooting</h2>
{{TS:review-and-provision}}
` },

/* ================================================================ PLAN */
{ file: 'plan.html', key: 'plan', nav: 'Plan', section: T, group: 'Provision', title: 'Plan: review what will be created',
  lead: 'Read the Terraform plan before anything is created in AWS.',
  meta: [pill('Wizard step', 'Provision'), pill('Time', F.plan)],
  body: () => `
<h2>Goal</h2>
<p>Review the plan: ${F.resources} AWS resources, grouped by service, shown as a list and as a diagram. The plan changes nothing in AWS.</p>

<h2>Steps</h2>
<ol class="steps">
  <li>Wait while the banner reads <b>Init in progress</b> and then <b>Plan in progress</b> ("${F.ui.plan}").</li>
  <li>When the <b>Plan review</b> appears, read the badge. On a new account it reads <b>+120 to create</b>; any number from ${F.resourcesNormal} is normal, and there are no other badges.</li>
  <li>In the <b>List</b> view, click a group to open it: network, firewall rules, the Kubernetes cluster, IAM roles and policies, DNS, logging.</li>
  <li>Click <b>Diagram</b> and try these:
    <ul>
      <li>Type ${cp('nat')} in <b>Find a resource</b>. The diagram zooms to the match.</li>
      <li>Click a resource. Its connections are drawn and named, everything else dims, and its details open. Press <kbd>Esc</kbd> to clear.</li>
      <li>Click a service block, or <b>Open all blocks</b>. "Security, Identity &amp; Compliance" holds one IAM role for each controller.</li>
    </ul></li>
  <li>Check that there are no <b>−N to destroy</b> or <b>±N to replace</b> badges. On a new account there are none. Then press ${btn('Apply')} in the banner and continue with <a href="apply.html">Apply</a>.</li>
</ol>
${doneWhen('the banner reads <b>Plan ready</b>, "Review what the plan creates, then apply it. Nothing exists in AWS yet."')}
${shot(R, '10-plan-list.png', 'The plan review as a list', 'The plan review as a list, grouped by service.')}
${shot(R, '11-plan-diagram.png', 'The plan review as a diagram', 'The diagram view: the VPC, its availability zones and subnets, with account-wide services in blocks.')}
${shot(R, '15-selected.png', 'The NAT gateway selected, with its connections named', 'A selected resource, with its connections drawn and named.')}

<h2>Expected result</h2>
<div class="expect">
${banner('', 'Plan ready', 'Review what the plan creates, then apply it. Nothing exists in AWS yet.', '[Plan again] [Edit configuration] <b>[Apply]</b>')}
<p>The badges and labels mean:</p>
${table(['Badge or label', 'Meaning'], [
  ['<code>+N to create</code> (green)', 'New resources. On a new account this is the only badge.'],
  ['<code>~N to update</code> (yellow)', 'Resources changed in place.'],
  ['<code>±N to replace</code> (orange)', 'Resources destroyed and created again. On a running CSOC, read each one before you apply.'],
  ['<code>−N to destroy</code> (red)', 'Resources removed. If the infrastructure already exists, an apply with any of these asks you to type the environment name.'],
  ['<code>+N</code> on a diagram card', 'Settings folded into the resource they configure, such as policy attachments and rules.'],
  ['"Availability zone picked at apply · one subnet of each kind per zone"', 'Subnets whose availability zone Terraform chooses during the apply, so the plan cannot show which zone each one lands in.'],
])}
<h4>Time</h4><p>${F.plan[0].toUpperCase() + F.plan.slice(1)} from <b>Provision</b> to <b>Plan ready</b>, for the init and the plan together.</p>
</div>

<h2>What's happening</h2>
<p>Terraform downloads the providers and the gen3-terraform modules it needs, connects to the state in your bucket, and compares the configuration with what exists, which on a new account is nothing. The plan is the complete list of changes. Only a summary reaches your browser; the full plan, which contains your settings, stays in the runner. <b>Apply</b> carries out exactly the plan you reviewed.</p>
${diagram('plan', 'The init and the plan', [
  'The runner downloads the Terraform providers and modules.',
  'It connects to the state in your bucket, which Terraform locks while it works.',
  `Terraform computes the changes: ${F.resources} resources to create. Nothing in AWS changes.`,
  'The full plan stays in the runner. Only a summary is extracted.',
  'Your browser draws the summary as the list and the diagram.',
])}
<p>For the state and the lock, see ${arch('state-bucket-and-registry', 'State bucket and registry')}.</p>

<h2>Troubleshooting</h2>
{{TS:plan}}
` },

/* ================================================================ APPLY */
{ file: 'apply.html', key: 'apply', nav: 'Apply', section: T, group: 'Provision', title: 'Apply: create the infrastructure',
  lead: 'Terraform creates the network and the EKS cluster. This is the longest wait in the tutorial.',
  meta: [pill('Wizard step', 'Provision'), pill('Time', F.apply)],
  body: () => `
<h2>Goal</h2>
<p>Let Terraform create the VPC, the NAT gateway, the Squid proxy, the EKS cluster with Karpenter, and the IAM roles. The apply carries out exactly the plan you reviewed.</p>

<h2>Steps</h2>
<ol class="steps">
  <li>Press ${btn('Apply')} in the banner. If less than 45 minutes are left on your SSO sign-in, the wizard does not start the apply; it asks you to sign in again and shows the <code>aws sso login</code> command. ${where('Terminal')}Run it, then press <b>Apply</b> again.</li>
  <li>Watch the plan review become a progress view. Each resource shows waiting, in progress with its elapsed time, done, or failed, and a bar shows overall progress. The blue <b>Right now</b> box above the list names the resources Terraform is working on at this moment; click one to open its group.</li>
  <li>Read <a href="#whats-happening">What's happening</a> while you wait. You can close the tab and come back; the wizard follows a run that is still in progress.</li>
</ol>
${doneWhen('every resource in the progress view is done, and the banner changes from <b>Apply in progress</b> to <b>Infrastructure up; the CSOC needs a certificate</b>.')}
${shot(R, '20-applying-list.png', 'Apply progress in the list', 'Progress during an apply, with a done count for each group and an overall bar.')}
${shot(R, '21-applying-diagram.png', 'Apply progress on the diagram', 'The same progress on the diagram.')}
${adm('warning', 'Let the apply finish', `Stopping an apply leaves the environment <code>partial</code>, with some resources created. The EKS control plane takes ${F.eks} with little visible progress; the <b>Right now</b> box shows it is still being created.`)}

<h2>Expected result</h2>
<div class="expect">
${banner('', 'Apply in progress', F.ui.apply, '[Stop this run]')}
<p>The network, the NAT gateway and Squid come first. The EKS control plane follows and takes ${F.eks}. Karpenter is installed last. The apply does not wait for EC2 nodes: Karpenter starts the first one when the bootstrap needs it, and it joins the cluster in under 1 minute.</p>
${banner('', 'Infrastructure up; the CSOC needs a certificate', 'Request a public certificate from ACM, import one, or use one the account already has. The install serves it on the load balancer.')}
<h4>Time</h4><p>${F.apply} from <b>Apply</b> until the banner above appears; normal up to ${F.applyMax} minutes.</p>
${timer('apply', F.applyTyp, F.applyMax, 'apply', F.apply)}
</div>

<h2>What's happening</h2>
<p>Terraform builds a small, locked-down network and a Kubernetes cluster without fixed worker nodes. The cluster's private subnets have no direct route to the internet: all outbound traffic passes through the Squid proxy, which allows only listed destinations. Each controller that will run in the cluster gets its own narrowly scoped IAM role. Karpenter, which starts EC2 nodes when workloads need them, runs on AWS Fargate so that it needs no nodes of its own. Storage drivers and the other cluster services are installed later, on the <b>Install</b> step.</p>
${diagram('apply', 'What the apply creates', [
  'The VPC, across three availability zones, with public and private subnets.',
  'The internet gateway and the NAT gateway, with a private DNS zone and a CloudWatch log group.',
  'Squid, the outbound proxy, in an auto-scaling group.',
  'A small AWS Lambda function that keeps the private subnets\' outbound route pointed at a healthy Squid instance.',
  `The EKS control plane, Kubernetes ${F.eksVersion}. Creating it takes ${F.eks}.`,
  'IAM roles: one for each controller, trusted only by that controller.',
  'Karpenter, running on Fargate.',
  'EC2 nodes, which Karpenter starts later, when the bootstrap needs them.',
])}
${adm('warning', 'Kubernetes version and cost', `The cluster runs Kubernetes ${F.eksVersion}, the configuration's default. Its EKS standard support ended on ${F.eks133StdEnd}, so AWS bills the control plane at the extended-support rate of ${F.eksExtRate} (${F.eksExt} instead of ${F.eksStd}) until extended support ends on ${F.eks133ExtEnd}. That makes the CSOC cost ${F.costNow} ${COST_IN}. See the ${ext('ekscal', 'Amazon EKS Kubernetes release calendar')}, ${ext('ekspricing', 'Amazon EKS pricing')} and <a href="next-steps.html#upgrade-kubernetes">Upgrade Kubernetes</a>.`)}
<p>The certificate is not part of the apply; you choose it on the next step. For every component, see ${arch('network-and-outbound-traffic', 'Network and outbound traffic')} and ${arch('the-eks-cluster', 'The EKS cluster')}.</p>

<h2>Troubleshooting</h2>
{{TS:apply}}
${shot(R, '18-apply-failed.png', 'An apply failure in the plan review', 'A failed apply names each failed resource and its error.')}
${adm('tip', 'A failed apply can be resumed', 'Terraform keeps what it created. Fix the cause and press <b>Plan again</b>: the new plan lists only what is still missing. Then press <b>Apply</b>.')}
` },

/* ================================================================ CERTIFICATE */
{ file: 'certificate-and-dns.html', key: 'certificate-and-dns', nav: 'Certificate', section: T, group: 'Certificate', title: 'Certificate: request and validate it',
  lead: 'Get an ACM certificate for the CSOC portal and Keycloak hostnames, validated through your zone.',
  meta: [pill('Wizard step', 'Certificate'), pill('Time', F.cert)],
  body: () => `
<h2>Goal</h2>
<p>Have an issued certificate that covers ${ex('portal')} and ${ex('auth')}. The CSOC's load balancer serves it, and the <b>Install</b> step cannot start until it is issued.</p>

<h2>Steps</h2>
<ol class="steps">
  <li>On the <b>Certificate &amp; DNS</b> page, keep <b>Request a public certificate</b>. The other two choices are for a certificate you already have: <b>Import a certificate</b> (your own certificate and key) and <b>Use an existing certificate</b> (one already in ACM in this account).</li>
  <li>Check that ${fld('Fully qualified domain names')} lists ${ex('portal')} and ${ex('auth')}. Keep ${fld('Validation method')} at <b>DNS validation (recommended)</b> and ${fld('Key algorithm')} at <b>RSA 2048</b>.</li>
  <li>Press ${btn('Request')}.</li>
  <li>Wait while the table fills in.
    <ul>
      <li><b>If you use a Route 53 zone</b> (the default), there is nothing to press: the wizard writes the validation records into your zone and checks every 10 seconds.</li>
      <li><b>If you chose I manage DNS myself</b>, the banner reads <b>Create the validation records in your DNS</b>. ${where('Your DNS provider')}Create one CNAME record for each row of the table, with the name and value shown, then press <b>Check now</b>.</li>
    </ul></li>
</ol>
${doneWhen('the table shows both hostnames as validated, and the page reads "Issued. The install serves it on the CSOC\'s load balancer."')}

<h2>Expected result</h2>
<div class="expect">
${banner('', 'ACM is preparing the validation records', 'They appear below within a few seconds.')}
${banner('', 'Validating the certificate', 'Writing the validation records to Route 53. Usually a few minutes; this page checks every 10 seconds and moves on to Install by itself.')}
<p>The first sentence of the second banner changes as validation progresses: "Writing the validation records to Route 53", then "Records in Route 53; waiting for public DNS to answer", then "Records in Route 53 and public DNS; waiting for ACM to issue". The table shows each hostname as <i>in csoc.example.org</i>, then <i>Seen in public DNS: yes</i>, then validated. When ACM issues the certificate, the wizard moves to the <b>Install</b> step by itself.</p>
<h4>Time</h4><p>${F.cert} from <b>Request</b> until the wizard moves to the <b>Install</b> step; normal up to ${F.certMax} minutes.</p>
${timer('cert', F.certTyp, F.certMax, 'validation', F.cert)}
</div>

<h2>What's happening</h2>
<p>ACM issues a certificate only after it confirms that you control each hostname (${ext('acmdns', 'DNS validation')}). For each hostname, ACM names a DNS record that must exist. The wizard writes those records into your zone, and ACM looks them up through public DNS like any other resolver. The records stay in place, so ACM renews the certificate by itself before it expires, without anyone having to act.</p>
${diagram('cert', 'ACM DNS validation', [
  'The wizard requests a certificate for the two hostnames. ACM marks it as pending validation.',
  'ACM names one validation record for each hostname.',
  'The wizard writes those records into your zone.',
  'Public DNS answers for them, through the delegation you set up on the <b>Setup</b> step.',
  'ACM finds every record and issues the certificate. The wizard moves on to <b>Install</b>.',
])}

<h2>Troubleshooting</h2>
{{TS:certificate-and-dns}}
` },

/* ================================================================ INSTALL: BOOTSTRAP */
{ file: 'install.html', key: 'install', nav: 'Bootstrap the CSOC', section: T, group: 'Install', title: 'Bootstrap the CSOC',
  lead: 'Choose who may reach the CSOC and set the administrator password, then install Keycloak, the CSOC portal and the services they need.',
  meta: [pill('Wizard step', 'Install'), pill('Time', F.install)],
  body: () => `
<h2>Goal</h2>
<p>Fill in the <b>Install CSOC</b> form and press <b>Bootstrap CSOC</b>. The bootstrap stores the CSOC's secrets and installs everything that runs in the cluster.</p>

<h2>Steps</h2>
<ol class="steps">
  <li>Under <b>1. How to deploy</b>, choose <b>Directly, from this wizard</b>. The other choice, <b>With a GitOps repo</b>, needs a GitHub App and a repository and is not part of this tutorial.</li>
  <li>Under ${fld('Allowed addresses')}, check the address the wizard filled in: your computer's current public address as a <code>/32</code> range, for example ${ex('ip')}. Add every other range that needs to reach the CSOC, such as your campus or VPN outbound range, for example ${ex('campus')}. Only these addresses can reach the CSOC portal, Keycloak and the agent endpoint. The cluster's own outbound address (shown later as "Cluster egress IP") is added automatically.</li>
  <li>Under ${fld('Admin email (optional)')}, enter the email you will sign in with, for example ${ex('email')}. Do not leave it empty: you use the same email in the commons' user.yaml, and without it Keycloak asks for an email and a name at the first sign-in.</li>
  <li>Press ${btn('Generate password', 'light')}. It fills ${fld('Admin password')} and ${fld('Confirm admin password')}.</li>
  <li>Save the password in your password manager now.</li>
  <li>Open <b>Images</b>. For a test, leave ${fld('API image')} and ${fld('Frontend image')} empty, which runs <code>quay.io/cdis/csoc-api:master</code> and <code>quay.io/cdis/csoc-frontend:master</code>. For real use, enter a release tag in both fields so that a restarted pod does not change version (see <a href="concepts/security.html#images-and-pinning">Images and pinning</a>).</li>
  <li>Press ${btn('Bootstrap CSOC')} in the banner. The text under the form reads "Ready: press Bootstrap CSOC in the banner above." once every field is valid.</li>
</ol>
${doneWhen('the log ends with <code>=== CSOC is applied ===</code> and the banner reads <b>Bootstrapped; ready to finish</b>.')}
${adm('danger', 'Save the administrator password', 'The password is for the CSOC user <code>admin</code>. The wizard does not store it. The bootstrap writes it to the cluster as the Kubernetes Secret <code>csoc-admin-bootstrap</code>, Keycloak reads it once, and the finish deletes that Secret; after that only Keycloak holds it. If you lose it, see <a href="how-to/reset-admin-password.html">Reset the admin password</a>.')}
${shot(R, '22-install.png', 'The Install CSOC form: how to deploy, allowed addresses, admin password', 'The <b>Install CSOC</b> form.')}

<h2>Expected result</h2>
<div class="expect">
${banner('', 'Bootstrap in progress', F.ui.install, '[Stop this run]')}
<p>The log shows one <code>=== … ===</code> heading for each stage.</p>
${banner('', 'Bootstrapped; ready to finish', 'Finishing waits for Keycloak and the portal, adds the egress IP to the allowlist and creates the DNS records.', '<b>[Finish install]</b>')}
<h4>Time</h4><p>${F.install[0].toUpperCase() + F.install.slice(1)} from <b>Bootstrap CSOC</b> to <b>Bootstrapped; ready to finish</b>; normal up to ${F.installMax} minutes.</p>
${timer('boot', F.installTyp, F.installMax, 'bootstrap', F.install)}
</div>

<h2>What's happening</h2>
<p>The bootstrap connects to the new cluster and generates the CSOC's secrets (Keycloak's administrator login, the portal's client secret and session keys), storing them in AWS Secrets Manager. It finds the cluster's outbound address so that it can be allowed through the load balancer. Then it installs, in order, the controllers the CSOC relies on, Keycloak with its database, and the CSOC portal. The portal's load balancer is created at the end, open only to the allowed addresses.</p>
${diagram('install', 'What the bootstrap installs', [
  'The runner connects to the cluster and waits for a node to be ready.',
  'It creates the CSOC\'s secrets in Secrets Manager, if they do not exist yet.',
  'It finds the cluster\'s outbound address.',
  'It stores the first administrator password for Keycloak to read once.',
  'External Secrets Operator, which copies secrets from Secrets Manager into the cluster.',
  'The AWS Load Balancer Controller, which creates load balancers for the cluster.',
  'external-dns, which will publish each commons\' hostname in your zone.',
  'The EBS CSI driver, so that the cluster can create storage volumes.',
  'CloudNativePG, which runs Keycloak\'s PostgreSQL database.',
  'Keycloak and the CSOC sign-in realm, <code>csoc-realm</code>.',
  'The CSOC portal and its API, behind an internet-facing load balancer limited to your allowed addresses.',
])}
<p>For namespaces, releases and the secrets involved, see ${arch('what-the-bootstrap-installs', 'What the bootstrap installs')}.</p>

<h2>Troubleshooting</h2>
{{TS:install}}
` },

/* ================================================================ INSTALL: FINISH */
{ file: 'finish.html', key: 'finish', nav: 'Finish the install', section: T, group: 'Install', title: 'Finish the install',
  lead: 'Add the cluster\'s outbound address to the allowed addresses, wait for Keycloak and the portal, and point the hostnames at the load balancer.',
  meta: [pill('Wizard step', 'Install'), pill('Time', F.finish)],
  body: () => `
<h2>Goal</h2>
<p>Press <b>Finish install</b> and wait until the banner says <b>CSOC is ready</b>.</p>

<h2>Steps</h2>
<ol class="steps">
  <li>Press ${btn('Finish install')} in the banner.</li>
  <li>Wait for <code>=== CSOC is installed ===</code> at the end of the log:
    ${cmd(`=== CSOC is installed ===
Portal:   https://${EX.portal}  (user: admin)
Keycloak: https://${EX.auth}`, 'log')}</li>
  <li>Wait for the banner <b>CSOC is ready</b>. Do not open ${ex('portal')} in your browser before then: if your computer looks up the name before its record exists, your network's resolver can keep answering "no such name" after the record exists.</li>
</ol>
${doneWhen('the banner reads <b>CSOC is ready</b>, "Sign in as admin with the password you set. DNS can take a few minutes.", with the buttons <b>Open the CSOC</b> and <b>Tear down</b>, and the wizard moves to the <b>Done</b> step.')}

<h2>Expected result</h2>
<div class="expect">
${banner('', 'Finish install in progress', F.ui.finish, '[Stop this run]')}
${banner('', 'CSOC installed; waiting for DNS', 'The records are in Route 53; public DNS usually answers within a minute or two. The portal link appears then. Opening it earlier can make your network remember that the name does not exist.')}
${banner('green', 'CSOC is ready', 'Sign in as admin with the password you set. DNS can take a few minutes.', '<b>[Open the CSOC]</b> [Tear down]')}
<p>The wizard shows <b>CSOC is ready</b> only after its own check finds both hostnames in public DNS. "DNS can take a few minutes" refers to your own network's resolver, which can lag behind.</p>
<h4>Time</h4><p>${F.finish} from <b>Finish install</b> to <b>CSOC is ready</b>; normal up to ${F.finishMax} minutes.</p>
${timer('finish', F.finishTyp, F.finishMax, 'finish', F.finish)}
</div>

<h2>What's happening</h2>
<p>The finish adds the cluster's outbound address to the allowed addresses, because the portal signs users in by calling Keycloak at its public hostname. It waits until Keycloak and the portal are running and the sign-in realm has been imported, and then removes the first administrator password from the cluster, so that only Keycloak holds it. Finally it creates two DNS records that point the CSOC's hostnames at the load balancer.</p>
${diagram('finish', 'What the finish does', [
  'The allowed addresses are applied again, now with the cluster\'s outbound address added.',
  'The finish waits for Keycloak to be ready and for the portal to finish rolling out.',
  'Once the sign-in realm is imported, the first administrator password is removed from the cluster.',
  'The finish reads the load balancer\'s address.',
  `It creates DNS records for ${ex('portal')} and ${ex('auth')} that point at the load balancer.`,
  'Public DNS answers, and the <b>Done</b> step shows the link to the CSOC.',
])}
<p>For the details, see ${arch('what-the-finish-does', 'What the finish does')}.</p>

<h2>Troubleshooting</h2>
{{TS:finish}}
` },

/* ================================================================ DONE: SIGN IN */
{ file: 'sign-in.html', key: 'sign-in', nav: 'Sign in', section: T, group: 'Done', title: 'Sign in to the CSOC',
  lead: 'Sign in to the CSOC portal as the administrator. From here on, you manage Gen3 from the CSOC.',
  meta: [pill('Wizard step', 'Done'), pill('Time', 'about 1 minute')],
  body: () => `
<h2>Goal</h2>
<p>Sign in to the CSOC portal through its Keycloak as the user <code>admin</code>.</p>

<h2>Steps</h2>
<ol class="steps">
  <li>On the <b>Done</b> step, press ${btn('Open the CSOC')}, or open ${cp(`https://${EX.portal}`)}.</li>
  <li>${where('Browser')}The portal sends you to Keycloak's sign-in page for the realm <code>csoc-realm</code>, which shows its name as "CSOC-REALM". Enter the username ${cp('admin')} and the password you saved, and press <b>Sign In</b>.</li>
  <li><b>If the page does not load (403 Forbidden, or a refused connection)</b>, you are on a network that is not in the allowed addresses, for example a VPN. Add it with <a href="how-to/allow-an-address.html">Allow a new IP address</a>.</li>
</ol>
${doneWhen('the CSOC portal opens, signed in as <code>admin</code>, with its setup wizard <b>Welcome to CSOC</b> and "Connected to AWS".')}
${shot(R, '23-portal.png', 'The Keycloak CSOC-REALM sign-in page', 'Keycloak\'s sign-in page for <code>csoc-realm</code>.')}
${shot(R, '24-portal-signed-in.png', 'Signed in to the CSOC portal', 'Signed in, with "Connected to AWS".')}

<h2>Expected result</h2>
<div class="expect">
<p>The CSOC portal opens. "Connected to AWS" means the portal reached its cluster's Kubernetes API and found that the cluster's nodes run on AWS. A sign-in to the CSOC realm lasts up to 12 hours, and ends after 8 hours without activity.</p>
</div>

<h2>What's happening</h2>
<p>The load balancer admits your browser because your address is in the allowed addresses. The portal has no session for you yet, so it sends you to Keycloak. After you sign in, Keycloak returns you to the portal, which confirms the sign-in with Keycloak directly; that call leaves the cluster through its outbound address, which is why that address is allowed too. The portal reaches AWS with its own IAM role and reads the same state bucket as the wizard, so it already knows this environment's history.</p>
${diagram('signin', 'Signing in', [
  `Your browser connects to ${ex('portal')}. The load balancer admits it because your address is allowed.`,
  `The portal sends you to Keycloak at ${ex('auth')}.`,
  'You sign in to <code>csoc-realm</code>. Keycloak keeps its data in a PostgreSQL database in the cluster.',
  'Keycloak returns you to the portal, and the portal confirms the sign-in with Keycloak.',
  'The portal reaches AWS with its own IAM role and reads the state bucket.',
])}
<p>To let people sign in with their institutional accounts, see <a href="how-to/connect-identity-provider.html">Connect your institution's sign-in</a>. For the flow in detail, see ${arch('sign-in', 'Sign-in')}.</p>

<h2>Troubleshooting</h2>
{{TS:sign-in}}
` },

/* ================================================================ PORTAL: AGENT */
{ file: 'connect-cluster.html', key: 'connect-cluster', nav: 'Connect the cluster', section: T, group: 'In the CSOC portal', title: 'Connect the CSOC\'s cluster',
  lead: 'Deploy an agent into the CSOC\'s own cluster, so that the CSOC can install commons there.',
  meta: [pill('Where', 'CSOC portal'), pill('Time', 'about 2 minutes')],
  body: () => `
<h2>Goal</h2>
<p>The CSOC installs commons through an agent in each cluster. Deploy the first agent, into the CSOC's own cluster.</p>

<h2>Steps</h2>
<ol class="steps">
  <li>${where('CSOC portal')}After you sign in, the portal opens its setup wizard, <b>Welcome to CSOC</b>. Press ${btn('Get Started')}.</li>
  <li>On <b>Configure Your Agent</b>, ${fld('Agent Name')} is filled in from the detected provider, which for the CSOC's cluster is <code>aws</code>. Keep it. You choose this name as the <b>Cluster</b> when you deploy a commons.</li>
  <li>Press ${btn('Deploy Agent', 'green')}. The portal shows "Installing Agent" while the agent image downloads.</li>
  <li>Leave the setup wizard here: the remaining steps, labeled <b>ArgoCD</b>, <b>Monitor</b> and <b>Alloy</b>, install Argo CD, Grafana with Loki, and Alloy log collection, and a commons needs none of them. <b>ArgoCD</b> and <b>Alloy</b> have no skip button, so open ${cp(`https://${EX.portal}/helm/gen3/deploy`)} directly instead of continuing.</li>
</ol>
${doneWhen('the portal shows "Resources applied to cluster" and the agent <code>aws</code> as connected.')}

<h2>Expected result</h2>
<div class="expect">
<p>The portal lists the agent <code>aws</code> as a cluster.</p>
<h4>Time</h4><p>About 2 minutes from <b>Deploy Agent</b> until the agent shows as connected, including the image download.</p>
</div>

<h2>What's happening</h2>
<p>The CSOC does not connect to a cluster's Kubernetes API. Instead, each cluster runs an agent that connects out to the CSOC and keeps the connection open. Both sides prove their identity with certificates issued by the CSOC (mutual TLS), and the CSOC sends work, such as a Helm install, over that connection.</p>
${diagram('agent', 'Deploying the agent', [
  'You press <b>Deploy Agent</b>, and the portal asks the CSOC API for a new agent.',
  'The API issues the agent a certificate from the CSOC\'s own certificate authority.',
  'The API installs the agent into the cluster, with its certificate.',
  'The agent starts and connects to the CSOC. Both sides present certificates.',
  'The agent registers, and the portal lists the cluster.',
])}
<p>For the endpoint and the certificates, see ${arch('agents', 'Agents')}.</p>

<h2>Troubleshooting</h2>
{{TS:connect-cluster}}
` },

/* ================================================================ PORTAL: GEN3 */
{ file: 'deploy-gen3.html', key: 'deploy-gen3', nav: 'Deploy a Gen3 commons', section: T, group: 'In the CSOC portal', title: 'Deploy a Gen3 commons',
  lead: 'Use the portal\'s Gen3 deployment wizard to install a first commons, with sign-in through the CSOC.',
  meta: [pill('Where', 'CSOC portal'), pill('Time', `${F.gen3} from Deploy Gen3`)],
  body: () => `
<h2>Goal</h2>
<p>Install a Gen3 commons named <code>commons-a</code> into the CSOC's cluster, at ${ex('commons')}, with sign-in through the CSOC's Keycloak and administrator rights for ${ex('email')}.</p>
<p>A commons is made of Gen3 services, among them <b>Fence</b> (sign-in and access tokens), <b>Arborist</b> (permissions), <b>Indexd</b> (the index of data files) and <b>Sheepdog</b> (metadata submission).</p>

<h2>Steps</h2>
<h3>Prepare the user.yaml</h3>
<ol class="steps">
  <li>Copy the user.yaml below.</li>
  <li>Replace both occurrences of ${v('email')} with the email you sign in with, for example ${ex('email')}: once under <code>users:</code> in the <code>administrators</code> group, and once under <code>users:</code> at the end.</li>
  <li>Keep it at hand; you paste the whole file into the <b>Auth</b> step.</li>
</ol>
${cmd(USERYAML, 'yaml', true)}
<p>In plain terms, this file does four things:</p>
<ul>
  <li>It gives nobody access by default. Anonymous visitors, and signed-in users without a policy, can do nothing.</li>
  <li>It gives your email full control of all programs and projects, including creating them and submitting metadata.</li>
  <li>It lets your email manage the index of data files and upload data files.</li>
  <li>It marks your email as a commons administrator.</li>
</ul>
<p>To give a colleague the same rights, add their email as a second line under <code>users:</code> in the <code>administrators</code> group, and add them under <code>users:</code> at the end with <code>admin: true</code>. The ${ext('useryaml', 'user.yaml guide')} describes other permissions.</p>

<h3>Fill in the deployment wizard</h3>
<p>Open <b>Deploy a new Gen3 instance</b> (<code>/helm/gen3/deploy</code>). Fill in each step as below, and press <b>Next</b> at the bottom of each.</p>
<div class="tw"><table><thead><tr><th>Step</th><th>Field</th><th>Value</th></tr></thead><tbody>
  <tr><td rowspan="3"><b>Destination</b></td><td>Cluster</td><td>The agent from <a href="connect-cluster.html">Connect the cluster</a>: <code>aws</code></td></tr>
  <tr><td>Release Name</td><td>${cp('commons-a')}</td></tr>
  <tr><td>Use custom namespace</td><td>Leave off; the namespace is the release name. Keep the Helm repository (<code>https://helm.gen3.org</code>, chart <code>gen3</code>).</td></tr>
  <tr><td rowspan="2"><b>Globals</b></td><td>Target cloud platform</td><td><b>Amazon Web Services (AWS)</b>, Region ${cp(EX.region)}, with <b>AWS Enabled (controls ingress annotations)</b> on, so that the commons gets an AWS load balancer</td></tr>
  <tr><td>Other fields</td><td>Keep the defaults. <b>Data Upload Bucket</b> stays empty and <b>Enable Crossplane</b> stays off; see <a href="#where-the-data-lives">Where the data lives</a>.</td></tr>
  <tr><td rowspan="3"><b>Hostname</b></td><td>Hostname (lower on the page)</td><td>Fill this in first: ${cp(EX.commons)}. If the form shows "Subdomain for *.csoc.example.org" instead, enter <code>commons-a</code>.</td></tr>
  <tr><td>Certificate Source</td><td><b>AWS ACM</b></td></tr>
  <tr><td>Certificate</td><td>Press <b>Request a certificate for ${EX.commons}</b>. The CSOC writes the validation records into your zone. Wait until the badge changes from "waiting for ACM to validate" to issued and the certificate is selected for this commons.</td></tr>
  <tr><td rowspan="3"><b>Database</b></td><td>Local or external</td><td><b>Local</b>, a PostgreSQL database in the commons' namespace.</td></tr>
  <tr><td>Automatically Create Databases</td><td>Keep on.</td></tr>
  <tr><td>Enable Persistence?</td><td>Turn on, so that the database is kept on an EBS volume. Leave it off only for a throwaway test: off, the database lives in the pod's temporary storage and is lost whenever the pod is replaced.</td></tr>
  <tr><td><b>Services</b></td><td>Modules</td><td>Keep the defaults: the core services and the frontend.</td></tr>
  <tr><td rowspan="3"><b>Auth</b></td><td>Log in through this CSOC</td><td>Press ${btn('Use CSOC login')}. It changes to <b>Connected</b> and fills in the sign-in settings.</td></tr>
  <tr><td>Authorization Source</td><td><b>Custom user.yaml (inline)</b></td></tr>
  <tr><td>Custom Role Definitions (YAML format)</td><td>Paste the whole user.yaml you prepared. This field holds the complete file.</td></tr>
  <tr><td><b>Config</b></td><td>Service settings</td><td>Keep the defaults.</td></tr>
  <tr><td><b>Deploy</b></td><td>Review and launch</td><td>Check the summary and press ${btn('Deploy Gen3')} straight away.</td></tr>
</tbody></table></div>
${adm('warning', 'Press Deploy Gen3 straight away', 'The portal\'s access token is short-lived. If the page stays open too long, pressing <b>Deploy Gen3</b> shows <b>Deployment Failed</b> with the message "Token verification failed". Nothing is installed in that case: reload the page or sign in again, check the summary, and press <b>Deploy Gen3</b> again.')}

<h3>Open the commons</h3>
<ol class="steps">
  <li>When the portal shows <b>Gen3 Deployed Successfully!</b>, open the address under "Access your instance at:", ${cp(`https://${EX.commons}`)}.</li>
  <li>If the browser shows <code>502 Bad Gateway</code>, wait 5 minutes and reload: the services are still starting (see the note under <a href="#expected-result">Expected result</a>).</li>
  <li>Press <b>Login</b>, and sign in through the CSOC's Keycloak as <code>admin</code>.</li>
</ol>
${doneWhen(`${EX.commons} shows the Gen3 portal, signed in as <code>admin</code>, whose email is ${EX.email}.`)}

<h3>Where the data lives</h3>
<p>A Gen3 commons keeps metadata in its database and data files in object storage. This tutorial's commons has a database, on an EBS volume with persistence on, but <b>no data bucket</b>: <b>Data Upload Bucket</b> on the <b>Globals</b> step is empty, and Crossplane, which could create one, is off. Uploading data files needs an S3 bucket and Fence access to it, which the tutorial does not create; see <a href="next-steps.html#known-gaps">Known gaps</a>.</p>
<p>A commons also adds cost on top of the CSOC: the EC2 nodes Karpenter starts for its services, its own Application Load Balancer, and its EBS volume. See <a href="concepts/security.html#what-a-commons-adds">What a commons adds</a>.</p>

<h3>Deploy a second commons</h3>
<p>On the success page, press <b>Deploy Another</b> and repeat the steps with the release name <code>commons-b</code> and the hostname ${ex('commonsb')}.</p>

<h2>Expected result</h2>
<div class="expect">
<p>The portal shows <b>Deploying Gen3</b>, with "Sending configuration to <i>cluster</i>" and a grid of deployments with ready and total counts. When the release is installed, it shows <b>Gen3 Deployed Successfully!</b> with the status, chart and revision, and the buttons <b>Go to Dashboard</b> and <b>Deploy Another</b>.</p>
${adm('note', 'A 502 error for several minutes is expected', `Right after the deploy, ${ex('commons')} returns <code>502 Bad Gateway</code> for several minutes. The load balancer is ready before the services behind it: arborist and indexd wait for their database secrets before they start. The site answers once they are ready.`)}
<p>If the deploy takes longer than the portal waits, it shows <b>Deployment Timeout</b>. That is not a failure; follow the deployments in the dashboard.</p>
<h4>Time</h4><p>${F.gen3[0].toUpperCase() + F.gen3.slice(1)} from <b>Deploy Gen3</b> to a working site, including several minutes of 502 responses while the services start; normal up to ${F.gen3Max} minutes.</p>
${timer('gen3', F.gen3Typ, F.gen3Max, 'Gen3 deploy', F.gen3)}
</div>

<h2>What's happening</h2>
<p>Before the install, the CSOC requests an ACM certificate for the commons and registers the commons with Keycloak, so that the commons can sign users in through the CSOC. When you press <b>Deploy Gen3</b>, the CSOC sends the settings to the agent, and the agent installs the Gen3 Helm chart into the commons' own namespace. The commons' services start, Karpenter adds nodes if they do not fit, a load balancer is created with the certificate, and external-dns publishes the hostname in your zone.</p>
${diagram('gen3', 'Deploying a Gen3 commons', [
  `The CSOC requests a certificate for ${ex('commons')} and writes its validation records into your zone.`,
  '<b>Use CSOC login</b> registers the commons with the CSOC\'s Keycloak and fills in the sign-in settings.',
  '<b>Deploy Gen3</b> sends your settings to the CSOC API.',
  'The CSOC forwards the install to the agent over its open connection.',
  'The agent installs the Gen3 Helm chart into the namespace <code>commons-a</code>.',
  'The commons\' services and database start. Karpenter adds nodes if needed.',
  'A load balancer is created for the commons, with its certificate.',
  `external-dns publishes ${ex('commons')} in your zone.`,
  'You open the commons and sign in through the CSOC\'s Keycloak. The user.yaml gives your email administrator rights.',
])}
<p>For the details, see ${arch('deploying-a-commons', 'Deploying a commons')}. To change permissions later, see <a href="how-to/edit-user-yaml.html">Edit a commons' user.yaml</a>.</p>

<h2>Troubleshooting</h2>
{{TS:deploy-gen3}}

<h2>Next</h2>
<p>You have a running CSOC and a first commons. When you no longer need them, <a href="how-to/tear-down.html">tear them down</a> to stop the costs. For what to do next, see <a href="next-steps.html">After the tutorial</a>.</p>
` },
];
