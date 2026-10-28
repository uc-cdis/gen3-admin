import { v, ex, cmd, adm, table, ext, F, where } from './lib.mjs';

export const MORE = [
/* ================================================================ NEXT STEPS */
{ file: 'next-steps.html', key: 'next-steps', nav: 'After the tutorial', section: 'Next steps', title: 'After the tutorial',
  lead: 'What to set up before real use, how to keep the CSOC current, the gaps these docs do not cover yet, and where to get help.',
  body: () => `
<h2>Before real use</h2>
<ul>
  <li><b>Connect your identity provider.</b> Broker Keycloak to your campus single sign-on so that people sign in with their institutional accounts. See <a href="how-to/connect-identity-provider.html">Add your institution's sign-in to Keycloak</a>.</li>
  <li><b>Configure backups.</b> The bootstrap configures none. Back up Keycloak's database and each commons' database before they hold anything you need to keep. See <a href="concepts/security.html#what-this-setup-is-not">What this setup is not</a>.</li>
  <li><b>Plan for data.</b> Turn on persistence for each commons' database, or use an external database, and configure a data bucket before anyone uploads files. See <a href="deploy-gen3.html#where-the-data-lives">Where the data lives</a>.</li>
  <li><b>Pin image tags.</b> Replace the <code>master</code> tags of the CSOC images with release tags. See <a href="concepts/security.html#images-and-pinning">Images and pinning</a>.</li>
  <li><b>Plan the Kubernetes version.</b> The default version is in EKS extended support, the largest avoidable cost. See <a href="#upgrade-kubernetes">Upgrade Kubernetes</a>.</li>
  <li><b>Set a budget alert.</b> See <a href="concepts/security.html#cost">Cost</a>.</li>
  <li><b>Review the allowed addresses.</b> Replace individual addresses with your campus and VPN ranges. See <a href="how-to/allow-an-address.html">Allow a new IP address</a>.</li>
  <li><b>Have the setup reviewed.</b> Give your security and compliance reviewers <a href="concepts/security.html">Security, cost and responsibilities</a> and <a href="concepts/architecture.html">Architecture</a>, and agree on what data each commons may hold.</li>
</ul>

<h2>Keep it up to date</h2>
<p>Upgrades are not automated. Test each change on a CSOC that holds nothing important first.</p>
<ul>
  <li><b>Infrastructure.</b> Resume the environment in the wizard, press <b>Plan again</b>, and read the plan. Apply only changes you expect; an apply that destroys or replaces resources asks for the environment name.</li>
  <li><b>The CSOC portal and API.</b> On the <b>Install</b> step, open <b>Advanced</b>, press <b>Bootstrap</b>, enter the new tags under <b>Images</b>, and run the bootstrap and the finish again.</li>
  <li><b>Commons.</b> Each commons is a Helm release of the <code>gen3</code> chart. Before you change its version, read the ${ext('gen3helm', 'gen3-helm')} release notes and the ${ext('gen3docs', 'Gen3 documentation')}.</li>
</ul>

<h3 id="upgrade-kubernetes">Upgrade Kubernetes</h3>
<p>The cluster runs Kubernetes ${F.eksVersion}, which bills at the EKS extended-support rate, ${F.eksExt} instead of ${F.eksStd}. The wizard has no field for the version. The version is the Terraform variable <code>eks_version</code> in gen3-terraform's <code>examples/csoc/variables.tf</code> (default <code>"1.33"</code>). To change it:</p>
<ol>
  <li>Check the ${ext('ekscal', 'Amazon EKS Kubernetes release calendar')} for the target version. EKS upgrades one minor version at a time, so 1.33 goes to 1.34, then 1.35.</li>
  <li>${where('Terminal')}In a local gen3-terraform checkout, set the default of <code>eks_version</code> to the next minor version, and start the wizard with <code>TERRAFORM_MODULES_DIR</code> pointing at that checkout (see <a href="contributing.html#developer-settings">For developers</a>).</li>
  <li>Resume the environment, press <b>Plan again</b>, and check that the plan updates the cluster in place (<b>~N to update</b>) rather than replacing it.</li>
  <li>Press <b>Apply</b>. Repeat for each minor version.</li>
</ol>
<p>Test this on a CSOC that holds nothing important first: changing the version this way is a developer procedure, not a wizard feature.</p>

<h2>Add more commons</h2>
<p>Deploy further commons into the CSOC's cluster from the portal: on the success page press <b>Deploy Another</b>, or open <b>Deploy a new Gen3 instance</b>. Give each one its own release name, such as <code>commons-b</code>, and hostname, such as ${ex('commonsb')}.</p>

<h2 id="known-gaps">Known gaps</h2>
<p>These topics are not covered by these docs yet, or the behavior has not been checked:</p>
<ul>
  <li><b>Data uploads.</b> Creating a data bucket for a commons and giving Fence access to it.</li>
  <li><b>Agents in other clusters.</b> Connecting an agent in a cluster in another AWS account to the CSOC's agent endpoint.</li>
  <li><b>Re-applying user.yaml.</b> Whether <b>Update Deployment</b> re-runs the commons' <code>useryaml</code> job, and how to re-run it if not.</li>
  <li><b>Identity brokering.</b> The Keycloak steps in <a href="how-to/connect-identity-provider.html">Add your institution's sign-in to Keycloak</a> are general Keycloak guidance and have not been tried end to end with a CSOC.</li>
  <li><b>The EKS public endpoint.</b> Restricting it to CIDR ranges, or closing it; the configuration sets <code>eks_public_access</code>, which the wizard does not expose.</li>
  <li><b>EKS secrets encryption.</b> What EKS applies by default to Kubernetes Secrets in this configuration.</li>
  <li><b>Commons cost.</b> The cost of a commons has not been measured.</li>
  <li><b>Published wizard images.</b> The wizard's images must be built on your computer; there are no published images to pull.</li>
  <li><b>The Kubernetes version.</b> There is no wizard field for it; see <a href="#upgrade-kubernetes">Upgrade Kubernetes</a>.</li>
</ul>

<h2>Get help</h2>
${table(['Where', 'For'], [
  [ext('issues', 'uc-cdis/gen3-admin issues'), 'Problems with the bootstrap wizard, the CSOC portal or these docs. Include the banner text and the run log\'s <code>Error:</code> lines, with account numbers removed. Do not report security vulnerabilities here; see <a href="concepts/security.html#reporting-vulnerabilities-and-license">Reporting vulnerabilities</a>.'],
  [ext('gen3community', 'Gen3 community'), 'Questions about Gen3 and data commons, and contact with other operators.'],
  [ext('gen3docs', 'Gen3 documentation'), 'Gen3 services, configuration and operation.'],
])}
` },

/* ================================================================ CONTRIBUTING */
{ file: 'contributing.html', key: 'contributing', nav: 'For developers', section: 'Next steps', title: 'For developers',
  lead: 'Settings and notes for people who change the wizard, the CSOC chart, the Terraform modules or these docs.',
  body: () => `
<h2>Build from source</h2>
<p>The wizard's API and frontend, and the runner image, are built from the repository:</p>
${cmd(`./scripts/build-terraform-image.sh
docker compose -f docker-compose-bootstrap-csoc.yml up -d --build`)}

<h2>Developer settings</h2>
<p>Put these in the repository's <code>.env</code> file, which is not committed, so that they survive restarts of the containers.</p>
${table(['Variable', 'Effect'], [
  ['<code>TERRAFORM_MODULES_DIR</code>', 'Use a local gen3-terraform checkout, for example <code>~/src/gen3-terraform</code>, for every plan, apply and destroy. Keep it set for the life of the environment: a destroy without it fails with "Module not installed".'],
  ['<code>CSOC_CHART_REPO</code>, <code>CSOC_CHART_REVISION</code>', 'Where a GitOps CSOC\'s Argo CD gets the CSOC chart, for testing chart changes from a fork or branch.'],
])}
${adm('warning', 'Destroy fails with "Module not installed"', 'The containers were restarted without <code>TERRAFORM_MODULES_DIR</code> for an environment created with it. Put it back in <code>.env</code>, restart the containers, and press <b>Retry teardown</b>.')}
${adm('danger', 'The wizard does not ask anyone to sign in', 'The bootstrap API and frontend run with <code>MOCK_AUTH=true</code>: every request is treated as coming from an administrator, and the API acts with your AWS credentials. Keep their ports bound to <code>127.0.0.1</code>.')}

<h2 id="source-code">Source code</h2>
<h3>In the gen3-admin repository</h3>
${table(['Path', 'Contents'], [
  ['<code>docker-compose-bootstrap-csoc.yml</code>', 'The wizard\'s containers: api, frontend and docker-proxy.'],
  ['<code>scripts/build-terraform-image.sh</code>, <code>Dockerfile.terraform</code>', 'The runner image, <code>gen3-terraform:latest</code>.'],
  ['<code>frontend/pages/bootstrap.jsx</code>', 'The bootstrap wizard.'],
  ['<code>frontend/lib/wizardState.ts</code>', 'The rules that turn an environment\'s record into the banner (see <a href="reference/wizard-states.html">Wizard states</a>).'],
  ['<code>frontend/components/bootstrap/</code>', 'The banner, run panel, certificate step, teardown panel, leftovers list and admin account panel.'],
  ['<code>frontend/components/PlanReview.jsx</code>', 'The plan review list and its progress view.'],
  ['<code>api/internal/terraform/docker_runner.go</code>', 'How runner containers start: mounts, the copy of <code>~/.aws</code>, and <code>AWS_PROFILE</code>.'],
  ['<code>api/internal/environments/registry.go</code>', 'The layout of the registry in the state bucket.'],
  ['<code>scripts/runner/install-csoc.sh</code>, <code>direct.sh</code>', 'The bootstrap; <code>direct.sh</code> installs with Helm.'],
  ['<code>scripts/runner/finish-csoc.sh</code>', 'The finish: allowlist, realm, load balancer and DNS.'],
  ['<code>scripts/runner/uninstall-csoc.sh</code>', 'The uninstall that runs before a destroy.'],
  ['<code>helm/csoc/</code>', 'The CSOC portal\'s Helm chart.'],
  ['<code>frontend/components/StepperForm/</code>', 'The portal\'s Gen3 deployment wizard.'],
  ['<code>frontend/components/Welcome/OnboardingStepper.jsx</code>', 'The portal\'s setup wizard: Deploy Agent, Argo CD and monitoring.'],
  ['<code>docs/workshop/site-src/</code>', 'The source of these docs. See <a href="#these-docs">These docs</a>.'],
])}

<h3>In gen3-terraform</h3>
<p><code>examples/csoc/</code> holds the CSOC's Terraform configuration: <code>main.tf</code> (the <code>vpc</code> and <code>eks</code> modules and the subnet for the Squid route-check function), <code>bootstrap.tf</code> (the IRSA roles, EKS access and the external-dns policy), <code>variables.tf</code> and <code>outputs.tf</code>. The modules are in <code>tf_files/aws/modules/vpc</code> and <code>tf_files/aws/modules/eks</code>. See ${ext('tfrepo', 'uc-cdis/gen3-terraform')}.</p>


<h2>The wizard's state rules</h2>
<p><code>frontend/lib/wizardState.ts</code> derives every banner. <code>frontend/lib/wizardState.audit.test.ts</code> runs every combination of status, last run, certificate, blocker and pull request through the rules; update it with any change to them, and update <a href="reference/wizard-states.html">Wizard states</a>.</p>

<h2>These docs</h2>
<p>The site in <code>docs/workshop/site/</code> is generated from <code>docs/workshop/site-src/</code>. Edit the page sources there and regenerate:</p>
${cmd(`cd docs/workshop/site-src
node build.mjs
node check.mjs`)}
<p>The README in <code>site-src</code> has the style guide and the terminology the docs use.</p>
` },
];
