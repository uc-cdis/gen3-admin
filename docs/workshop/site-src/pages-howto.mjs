import { v, ex, EX, btn, fld, cp, cmd, banner, adm, shot, timer, table, pill, F, ext, where } from './lib.mjs';

const R = '../';
const H = 'How-to guides';
const ts = (id, text) => `<a href="../reference/troubleshooting.html#${id}">${text}</a>`;

export const HOWTO = [
/* ================================================================ TEAR DOWN */
{ file: 'how-to/tear-down.html', key: 'tear-down', nav: 'Tear down', section: H, title: 'Tear down a CSOC',
  lead: 'Remove the CSOC, its commons and its infrastructure, and optionally the hosted zone and the state bucket.',
  meta: [pill('Wizard step', 'Done'), pill('Time', F.teardown)],
  body: () => `
${adm('danger', 'A teardown permanently deletes all data', 'Every commons in the cluster is deleted with it: its databases, its volumes and its Kubernetes Secrets, with no way to recover them. The CSOC\'s secrets in Secrets Manager are deleted without a recovery window, and Keycloak\'s users and settings go with its database. The bootstrap configures no backups.')}

<h2>When you need this</h2>
<p>When you no longer need a CSOC, for example after a test, and want to stop its costs (${F.costNow} in us-east-1).</p>

<h2>Before you start</h2>
<ul>
  <li>Back up everything you want to keep: commons databases, data files, and the users and settings in Keycloak.</li>
  <li>${where('Terminal')}Sign in so that at least 45 minutes are left on your SSO sign-in. Otherwise the wizard stops before it starts, with the message "${F.ui.teardownPrompt}"</li>
  <li>Open the wizard at <code>localhost:3000/bootstrap</code> and resume the environment if needed (see <a href="resume.html">Resume after closing the tab</a>).</li>
</ul>

<h2>Steps</h2>
<ol class="steps">
  <li>On the <b>Done</b> step, press ${btn('Tear down', 'red')} in the banner. You can also open <b>Advanced</b> under the run log and press <b>Tear down…</b>.</li>
  <li>Leave <b>Force: don't wait for anything graceful</b> on, the default. For test environments, leave Force on. It deletes nodes and disks immediately instead of shutting them down cleanly. Turn it off only if workloads must stop gracefully, which makes the uninstall slower.</li>
  <li>Choose whether to delete the zone:
    <ul>
      <li><b>If you will not reuse ${EX.zone}</b>, select <b>Also delete the hosted zone and its delegation</b>. Under ${fld('Parent zone reached with')}, choose <b>These credentials</b> (the default) if the parent zone is in this account, <b>Profile: …</b> for another account, or <b>Nothing: I remove the NS records myself</b> if central IT manages it (then ask them to remove the NS record set).</li>
      <li><b>If you will reuse it</b>, leave the box off.</li>
    </ul></li>
  <li>Select <b>Also empty and delete the state bucket</b> only if you will not come back to this environment. The bucket is deleted only after every environment in it is destroyed.</li>
  <li>Type the CSOC name, for example ${ex('name')}, to confirm, and press ${btn('Tear down', 'red')}.</li>
</ol>
<p>The teardown panel lists its steps with their state. Each starts only after the previous one succeeds:</p>
<ol>
  <li><b>Uninstall the CSOC</b> removes what the bootstrap added outside Terraform: load balancers, volumes, Karpenter's nodes, DNS records and secrets. It takes ${F.uninstall}.</li>
  <li><b>Destroy the infrastructure</b> runs <code>terraform destroy</code> ("${F.ui.destroyPanel}").</li>
  <li><b>Delete the hosted zone</b>, with the CSOC's certificate and the NS records in the parent zone, if selected.</li>
  <li><b>Delete the state bucket</b>, if selected.</li>
</ol>

<h2>Check it worked</h2>
<div class="expect">
${banner('', 'Uninstall in progress', F.ui.uninstall)}
${banner('', 'Destroy in progress', F.ui.destroy)}
${banner('gray', 'Torn down', 'Terraform destroyed everything it created. Below is what is left outside it.', '[Provision again] [Start over]')}
<p>Below the banner, <b>What is left</b> checks AWS for the CSOC's certificate, the hosted zone and the state bucket, each with its own delete button. When nothing is left, the banner reads <b>Back to a blank account</b>.</p>
<p>The commons <code>commons-a</code> is removed with the cluster. Its ACM certificate, which the portal requested, is not; it is free, and you can delete it in the ACM console.</p>
<h4>Time</h4><p>${F.teardown} from <b>Tear down</b> to <b>Torn down</b>: ${F.uninstall} for the uninstall, then ${F.destroy} for the destroy; normal up to ${F.teardownMax} minutes.</p>
${timer('teardown', F.teardownTyp, F.teardownMax, 'teardown', F.teardown)}
</div>
<p>For what the uninstall removes and in what order, see <a href="../concepts/architecture.html#teardown">Teardown</a> in Architecture.</p>

<h2>If it fails</h2>
<ul>
  <li><b>No progress for ${F.stuck} minutes:</b> open the run log and search for <code>DependencyViolation</code>. It names the resource AWS will not delete yet, for example a network interface or a security group that something still uses. Do not change the runner scripts or stop the run; wait, then see ${ts('tear-down', 'Tear down troubleshooting')}.</li>
  <li><b>A banner reports a failure:</b> see ${ts('tear-down', 'Tear down troubleshooting')}.</li>
</ul>
{{TS:tear-down}}
` },

/* ================================================================ RESUME */
{ file: 'how-to/resume.html', key: 'resume', nav: 'Resume after closing the tab', section: H, title: 'Resume after closing the tab',
  lead: 'Return to an environment after closing the browser, restarting the wizard, or switching computers.',
  body: () => `
<h2>When you need this</h2>
<p>When you come back to the wizard after closing it, waiting for DNS delegation, or moving to another computer. Nothing is lost: the state bucket records every environment and run, and a run in progress keeps going without the page.</p>

<h2>Before you start</h2>
<ul>
  <li>${where('Terminal')}Start the wizard if it is not running (<a href="../start-the-wizard.html">Start the wizard</a>).</li>
  <li>${where('Terminal')}Sign in: ${cp(`aws sso login --profile ${v('ssoprofile')}`)}.</li>
</ul>

<h2>Steps</h2>
<ol class="steps">
  <li>Open <code>localhost:3000/bootstrap</code>.</li>
  <li><b>If you use the same browser as before</b>, the wizard returns to the step you were on, and follows a run that is still in progress. You are done.</li>
  <li><b>Otherwise</b>, on the <b>Setup</b> step, choose the same ${fld('AWS Profile')}, enter the same ${fld('Terraform State Bucket')}, for example ${ex('bucket')}, and press ${btn('Check', 'light')}.</li>
  <li>Under <b>Environments in this bucket</b>, press <b>Resume</b> next to your CSOC, for example ${ex('name')}.</li>
</ol>
${shot(R, '12-resume.png', 'Environments in this bucket, with Resume', 'The environments in a state bucket, each with <b>Resume</b>.')}

<h2>Check it worked</h2>
<p>The wizard opens the step that matches the environment's state, and the banner offers the next action.</p>

<h2>If it fails</h2>
<ul>
  <li><b>A yellow box AWS session expired appears</b>, and every button is disabled: ${where('Terminal')}sign in again, then press <b>Check again</b> in the box.</li>
  <li><b>The bucket shows no environments</b>: check that the profile reaches the same account as before; the blue box shows the account ID.</li>
</ul>
` },

/* ================================================================ ALLOW AN ADDRESS */
{ file: 'how-to/allow-an-address.html', key: 'allow-an-address', nav: 'Allow a new IP address', section: H, title: 'Allow a new IP address',
  lead: 'Let a new network, such as a VPN or another campus, reach the CSOC portal and Keycloak.',
  body: () => `
<h2>When you need this</h2>
<p>When the CSOC portal returns <code>403 Forbidden</code> or refuses the connection from a network that worked before, or when a new team or campus needs access. Only the ranges in <b>Allowed addresses</b> can reach the CSOC portal, Keycloak and the agent endpoint.</p>

<h2>Before you start</h2>
<ul>
  <li>Find the range to add. For a single computer, it is its public IP address as a <code>/32</code> range, for example ${ex('ip')}; a site such as <code>checkip.amazonaws.com</code> shows the address. For a campus or VPN network, ask your network team for its outbound range, for example ${ex('campus')}.</li>
  <li>${where('Terminal')}Sign in so that at least 15 minutes are left on your SSO sign-in.</li>
</ul>

<h2>Steps</h2>
<ol class="steps">
  <li>Open the wizard and resume the environment. Go to the <b>Install</b> step.</li>
  <li>Open <b>Advanced</b> under the run log (not <b>Advanced Options</b> on <b>Setup</b>) and press <b>Bootstrap</b>. The <b>Install CSOC</b> form opens again.</li>
  <li>Under ${fld('Allowed addresses')}, add the range. Keep the existing ranges you still need.</li>
  <li>Type the same value of 12 or more characters in ${fld('Admin password')} and ${fld('Confirm admin password')}, or press <b>Generate password</b>. The form requires a password, but the existing admin password is not changed: the bootstrap sets it only when <code>csoc-realm</code> is first created.</li>
  <li>Press ${btn('Bootstrap CSOC')} and wait for the banner <b>Bootstrapped; ready to finish</b>.</li>
  <li>Press ${btn('Finish install')} and wait for <b>CSOC is ready</b>. The finish applies the new ranges.</li>
</ol>

<h2>Check it worked</h2>
<p>From the new network, ${ex('portal')} loads the sign-in page instead of returning <code>403 Forbidden</code>. On the <b>Install</b> step, the summary lists the allowed addresses and the "Cluster egress IP".</p>

<h2>If it fails</h2>
<ul>
  <li><b>Still 403 from the new network:</b> the range does not contain the address the network uses on the internet. Check it again at <code>checkip.amazonaws.com</code> from that network.</li>
  <li><b>The bootstrap or the finish fails:</b> see ${ts('bootstrap-the-csoc', 'Bootstrap troubleshooting')} and ${ts('finish-the-install', 'Finish troubleshooting')}.</li>
</ul>
` },

/* ================================================================ RESET PASSWORD */
{ file: 'how-to/reset-admin-password.html', key: 'reset-admin-password', nav: 'Reset the admin password', section: H, title: 'Reset the admin password',
  lead: 'Set a new password for the CSOC user admin when the old one is lost.',
  body: () => `
<h2>When you need this</h2>
<p>When nobody knows the password of the CSOC user <code>admin</code>. The wizard does not store it, but it can set a new one through Keycloak.</p>

<h2>Before you start</h2>
<ul>
  <li>Open the wizard and resume the environment.</li>
</ul>

<h2>Steps</h2>
<ol class="steps">
  <li>Go to the <b>Done</b> step.</li>
  <li>In the <b>Admin account</b> panel, which shows the username and email, press ${btn('Reset admin password…', 'light')}. It generates a new password.</li>
  <li>Copy the password into your password manager.</li>
  <li>Press <b>Set this password</b>.</li>
</ol>

<h2>Check it worked</h2>
<p>You can sign in to ${ex('portal')} as <code>admin</code> with the new password.</p>
<p>The wizard signs in to Keycloak's own administration account, whose login the bootstrap stored in AWS Secrets Manager, and sets the new password for <code>admin</code> in <code>csoc-realm</code>. Running the bootstrap again does not change the password.</p>

<h2>If it fails</h2>
<ul>
  <li><b>The panel shows an error:</b> your address must be in the allowed addresses, because the wizard reaches Keycloak at ${ex('auth')}. See <a href="allow-an-address.html">Allow a new IP address</a>.</li>
</ul>
` },

/* ================================================================ SELF-MANAGED DNS */
{ file: 'how-to/self-managed-dns.html', key: 'self-managed-dns', nav: 'Use DNS you manage yourself', section: H, title: 'Use DNS you manage yourself',
  lead: 'Run the CSOC without a Route 53 zone, creating its DNS records at your own DNS host.',
  body: () => `
<h2>When you need this</h2>
<p>When your institution will not delegate a subdomain to the CSOC account and keeps the CSOC's hostnames in its own DNS. If delegation is possible, use it instead (<a href="request-dns-delegation.html">Request DNS delegation</a>): with self-managed DNS, the bootstrap does not install external-dns and the CSOC cannot write validation records, so every commons also needs its records created by hand.</p>

<h2>Before you start</h2>
<ul>
  <li>Arrange with whoever manages your DNS to add four CNAME records during the tutorial, two to validate the certificate and two for the hostnames, and more for each commons later.</li>
</ul>

<h2>Steps</h2>
<ol class="steps">
  <li>On the <b>Setup</b> step, under ${fld('DNS for the hostnames')}, choose <b>I manage DNS myself</b>. The wizard then does not create or check a hosted zone.</li>
  <li>Continue through <b>Review</b> and <b>Provision</b> as in the tutorial.</li>
  <li>On the <b>Certificate</b> step, press ${btn('Request')}. When the banner says <b>Create the validation records in your DNS</b>, ${where('Your DNS provider')}create one CNAME record for each row of the table, with the name and value shown.</li>
  <li>Press <b>Check now</b>, or wait: the page checks every 10 seconds. When public DNS answers, the banner says <b>Records found; waiting for ACM to issue</b>, and the wizard moves on once the certificate is issued.</li>
  <li>Run the <b>Install</b> step as in the tutorial. After the finish, the <b>Done</b> step shows two CNAME records under "Create these records where your DNS is hosted", one for each hostname, both pointing at the load balancer. ${where('Your DNS provider')}Create them.</li>
</ol>

<h2>Check it worked</h2>
<p>The banner reads <b>CSOC is ready</b>, and ${ex('portal')} and ${ex('auth')} open the CSOC. Keep the validation records in place: ACM uses them to renew the certificate (${ext('acmdns', 'DNS validation')}).</p>

<h2>If it fails</h2>
<ul>
  <li><b>The banner stays at Create the validation records in your DNS:</b> public DNS does not answer for the records yet. Check with <code>dig CNAME</code> followed by the record name.</li>
  <li>See ${ts('certificate', 'Certificate troubleshooting')}.</li>
</ul>
` },

/* ================================================================ DNS DELEGATION REQUEST */
{ file: 'how-to/request-dns-delegation.html', key: 'request-dns-delegation', nav: 'Request DNS delegation', section: H, title: 'Request DNS delegation from your DNS administrators',
  lead: 'Ask the people who manage your institution\'s domain to delegate a subdomain to the CSOC\'s AWS account.',
  body: () => `
<h2>When you need this</h2>
<p>When central IT, not you, manages your institution's domain, for example ${ex('parentzone')}, and you need ${ex('zone')} delegated to the CSOC account. Requests at most universities take days, so start early.</p>

<h2>Before you start</h2>
<ul>
  <li>Ask central IT whether the subdomain is free and whether delegation to an AWS account is allowed. Some institutions require a security review or a named technical contact.</li>
  <li>Complete <a href="../setup.html">Setup</a> up to the zone, choosing <b>I'll add the NS records myself</b> under ${fld('Delegate it from the parent zone using')}. After ${btn('Set up zone and delegation')}, the box <b>Add these records to the parent zone</b> lists the four name servers.</li>
</ul>

<h2>Steps</h2>
<ol class="steps">
  <li>Copy the request below and replace the placeholders, including the four name servers from the box.</li>
  <li>Send it through your institution's DNS request process.</li>
  <li>While you wait, close the wizard; the zone and the bucket stay in your account, and the empty zone costs $0.50 a month. Use the time to finish the other prerequisites, have <a href="../concepts/security.html">Security, cost and responsibilities</a> reviewed, and ask your cloud administrators to confirm that the services the CSOC uses are allowed. The wizard cannot go past <b>Setup</b> until the delegation is in place.</li>
  <li>When central IT confirms, <a href="resume.html">resume</a>. The page continues by itself once it sees the zone.</li>
</ol>
${cmd(`Subject: DNS delegation request for ${v('zone')}

Hello,

We are setting up a Gen3 CSOC, a platform for deploying research data commons,
in an AWS account owned by &lt;your-department&gt;. Please delegate the subdomain
${v('zone')} to our Amazon Route 53 hosted zone by adding one NS record set
for it, with these four name servers, in the ${v('parentzone')} zone:

  ${v('zone')}.  NS  &lt;name-server-1&gt;
  ${v('zone')}.  NS  &lt;name-server-2&gt;
  ${v('zone')}.  NS  &lt;name-server-3&gt;
  ${v('zone')}.  NS  &lt;name-server-4&gt;

A TTL of 3600 seconds or less is fine.

We will create records only under ${v('zone')}, for example portal.${v('zone')},
auth.${v('zone')} and one hostname per data commons. The zone also holds the DNS
validation records that AWS Certificate Manager uses to issue and renew TLS
certificates for those hostnames.

Technical contact: &lt;your-name&gt;, &lt;your-email&gt;
Account owner: &lt;owner-name&gt;, &lt;owner-email&gt;

Thank you.`, 'text')}

<h2>Check it worked</h2>
<p>${where('Terminal')}<code>dig NS csoc.example.org</code> (with your subdomain) returns the four name servers, and the wizard shows <b>Delegation is live</b> and then <b>Domain Verified</b>.</p>

<h2>If it fails</h2>
<ul>
  <li><b>Central IT will not delegate subdomains:</b> use <a href="self-managed-dns.html">Use DNS you manage yourself</a>, or register a separate domain for the CSOC and host its zone in Route 53.</li>
  <li><b>Red box Not delegated: the parent already uses this name:</b> see ${ts('setup', 'Setup troubleshooting')}.</li>
</ul>
` },

/* ================================================================ IDENTITY PROVIDER */
{ file: 'how-to/connect-identity-provider.html', key: 'connect-identity-provider', nav: 'Keycloak: add your institution\'s sign-in', section: H, title: 'Add your institution\'s sign-in to Keycloak (general Keycloak guidance)',
  lead: 'General Keycloak steps for letting people sign in to the CSOC, and to every commons that uses it, with their institutional accounts.',
  body: () => `
<h2>When you need this</h2>
<p>When people other than the local <code>admin</code> user need to sign in, through campus single sign-on or a federation such as ${ext('incommon', 'InCommon')}. This page gives the general Keycloak procedure for identity brokering; the exact screens depend on your Keycloak version, and the authority is "Identity Brokering" in the ${ext('kcadmin', 'Keycloak Server Administration Guide')}.</p>

<h2>Before you start</h2>
<ul>
  <li>Ask your identity team whether they offer SAML 2.0 or OpenID Connect, and what they need from you to register a service. For SAML they need Keycloak's service provider metadata; for OpenID Connect they issue a client ID and secret.</li>
  <li>Agree which attributes they release. Gen3 identifies users by email, so the email attribute must be released and must match the emails in each commons' user.yaml.</li>
  <li>Your address must be in the allowed addresses, because the Keycloak administration console is reached through ${ex('auth')}.</li>
  <li>${where('AWS console')}Get Keycloak's administration login from AWS Secrets Manager, under <code>gen3-csoc/${EX.name}/</code>.</li>
</ul>

<h2>Steps</h2>
<ol class="steps">
  <li>${where('Browser')}Sign in to the Keycloak administration console at <code>https://${EX.auth}/admin/</code> with that login.</li>
  <li>Switch to the realm <code>csoc-realm</code>.</li>
  <li>Open <b>Identity providers</b> and add a provider of the type your identity team offers: <b>SAML v2.0</b> or <b>OpenID Connect v1.0</b>.</li>
  <li>Give your identity team the redirect URI or the SAML metadata that Keycloak shows for the new provider, and enter the client ID and secret, or the metadata URL, that they give you.</li>
  <li>Add mappers so that the email, and the first and last names, are copied from the provider's attributes into the Keycloak user.</li>
  <li>Sign out, open ${ex('portal')}, and choose the new provider on the sign-in page.</li>
</ol>

<h2>Check it worked</h2>
<p>You can sign in to the CSOC portal through your institution's sign-in, and Keycloak lists your account under <b>Users</b> in <code>csoc-realm</code>, linked to the provider. Commons that use <b>Use CSOC login</b> accept the same sign-in; what each user may do there still comes from its user.yaml.</p>
${adm('tip', 'Protect the administrator accounts', `Require a second factor for the Keycloak administration login and the CSOC's <code>admin</code> user. Keycloak supports one-time passwords as a required action and in authentication flows; see the ${ext('kcadmin', 'Server Administration Guide')}.`)}

<h2>If it fails</h2>
<ul>
  <li><b>The admin console does not load:</b> add your address; see <a href="allow-an-address.html">Allow a new IP address</a>.</li>
  <li><b>Sign-in works but commons deny access:</b> compare the email Keycloak shows for the user with the email in the commons' user.yaml.</li>
</ul>
` },

/* ================================================================ EDIT USER.YAML */
{ file: 'how-to/edit-user-yaml.html', key: 'edit-user-yaml', nav: 'Edit a commons\' user.yaml', section: H, title: 'Edit a commons\' user.yaml',
  lead: 'Change who may do what in a commons after it is deployed.',
  body: () => `
<h2>When you need this</h2>
<p>When you add a user to a commons, remove one, or change their permissions. The portal does this by reopening the deployment wizard with the commons' current settings.</p>

<h2>Before you start</h2>
<ul>
  <li>Write the new user.yaml. The tutorial's file is in <a href="../deploy-gen3.html#prepare-the-useryaml">Prepare the user.yaml</a>, and the ${ext('useryaml', 'user.yaml guide')} describes the format.</li>
</ul>

<h2>Steps</h2>
<ol class="steps">
  <li>${where('CSOC portal')}Open the <b>Projects</b> page, <code>https://${EX.portal}/projects</code>.</li>
  <li>Find the commons, for example <code>commons-a</code>, and press <b>Edit</b>. The Gen3 deployment wizard opens with the release's current values loaded.</li>
  <li>Go to the <b>Auth</b> step and replace the whole content of <b>Custom Role Definitions (YAML format)</b> with the new user.yaml.</li>
  <li>Go to the <b>Deploy</b> step, check the summary, and press <b>Update Deployment</b>.</li>
</ol>

<h2>Check it worked</h2>
<p>The portal shows <b>Deployment Updated!</b>. Sign in to ${ex('commons')} as an affected user and check that their access changed.</p>
<p>The commons applies user.yaml with a Kubernetes Job named <code>useryaml</code> in its namespace. ${where('Terminal')}To see when it last ran:</p>
${cmd(`aws eks update-kubeconfig --name ${v('name')} --region ${v('region')} --profile ${v('profile')}
kubectl -n commons-a get job useryaml`)}

<h2>If it fails</h2>
<ul>
  <li><b>Access did not change, and the <code>useryaml</code> job's completion time is older than the update:</b> the job did not run again. Re-running it is listed in <a href="../next-steps.html#known-gaps">Known gaps</a>.</li>
  <li><b>A user still has no access:</b> the email in user.yaml must match the email Keycloak passes to Gen3 exactly.</li>
  <li><b>Update Deployment shows Deployment Failed with Token verification failed:</b> reload the page and press <b>Update Deployment</b> again.</li>
</ul>
` },
];
