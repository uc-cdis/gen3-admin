// Troubleshooting rows: the single source for each walkthrough page and reference/troubleshooting.html.
// Rows: [what you see, what it means, what to do]. {R} becomes the path to the site root.
import { v, cp, F } from './lib.mjs';

export const TS_COLS = ['What you see', 'What it means', 'What to do'];
const login = cp(`aws sso login --profile ${v('ssoprofile')}`);

export const TS = {
  prerequisites: { title: 'Prerequisites', rows: [
    ['<code>The SSO session associated with this profile has expired</code>', 'Your SSO sign-in ran out.', `In a terminal, run ${login}.`],
    ['<code>Cannot connect to the Docker daemon</code>', 'Docker is not running.', 'Start Docker Desktop or OrbStack, or run <code>colima start</code>.'],
    ['<code>get-caller-identity</code> prints the wrong account', 'The profile points at another account, for example the one that holds your DNS.', 'Correct <code>role_arn</code> or <code>sso_account_id</code> in the profile in <code>~/.aws/config</code>, or use another profile.'],
    ['<code>AccessDenied</code> or <code>explicit deny in a service control policy</code> for a service, even with administrator rights', 'An organization-wide Service Control Policy blocks that service or Region.', 'Send the error message to your cloud administrators and ask them to allow it. See <a href="{R}concepts/security.html#campus-realities">Campus realities</a>.'],
  ] },
  'start-the-wizard': { title: 'Start the wizard', rows: [
    ['<code>localhost:3000</code> does not load, or the page is blank', 'The frontend has not started, or it failed.', `Run ${cp('docker compose -f docker-compose-bootstrap-csoc.yml logs frontend api')} and look for <code>Error</code> in the last lines.`],
    ['<code>port is already allocated</code>', 'Another program uses port 3000 or 8002.', 'Stop that program (find it with <code>lsof -i :3000</code>), then run <code>docker compose … up -d</code> again.'],
    ['Later, a red box: <b>The init did not start</b>', 'The runner image is missing, or AWS refused the credentials. Nothing ran.', 'Check that <code>docker images</code> lists <code>gen3-terraform</code>; if not, build the images as in <a href="{R}prerequisites.html#install-the-tools">Prerequisites</a>. Otherwise sign in again.'],
  ] },
  setup: { title: 'Setup', rows: [
    ['Yellow box: <b>AWS SSO session expired</b>, with a command', 'Your SSO sign-in ran out. The Setup step cannot check anything until you sign in.', `In a terminal, run the command shown, for example ${login}, then press <b>Retry</b> in the box.`],
    ['The blue box shows the wrong account', '<b>Auto-detect</b> used your default credentials, or the profile points at another account.', 'Choose <b>Select AWS profile</b> and the profile for the CSOC account.'],
    ['Red box: <b>Bucket not available</b>', 'Another AWS account owns a bucket with that name (bucket names are global), or your profile cannot read it.', 'Choose another name, for example by adding your account ID.'],
    ['The bucket check result disappears right after you pick a profile', 'The identity check finished after the bucket check and reset it.', 'Wait for the blue box, then press <b>Check</b> again.'],
    ['Red box: <b>Not delegated: the parent already uses this name</b>', 'The parent zone already has records under that name; the box lists them. Nothing changed.', 'Choose another subdomain, or ask the owner of the listed records to remove them.'],
    ['Yellow box: <b>The zone is not delegated yet</b>', 'The zone exists in your account, but public DNS does not find it yet.', 'If the NS record set was added, wait: the page checks again every 20 seconds and continues by itself. Check the delegation with <code>dig NS</code> followed by your subdomain.'],
    ['Red box: <b>Domain Validation Failed</b>', 'No public zone in this account serves the hostname or a parent of it.', 'Check the spelling of the hostname, and that the blue box shows the CSOC account.'],
  ] },
  'review-and-provision': { title: 'Review and provision', rows: [
    ['Yellow box: <b>Configuration Incomplete</b>, with a list', 'An item on the <b>Setup</b> step is not confirmed: the identity, the bucket, the name, the hostname, or a Region with at least three availability zones.', 'Press <b>Back</b> and fix the item listed.'],
    ['Red box: <b>Could not register the environment</b>', 'Writing to the state bucket failed; the message names the cause, for example an expired sign-in.', 'Sign in again, then press <b>Provision</b> again.'],
    ['Banner: <b>Nothing created yet</b>', 'The environment is registered, but no plan has run.', 'Press <b>Plan</b> in the banner.'],
  ] },
  plan: { title: 'Plan', rows: [
    ['Banner: <b>The plan failed</b> or <b>The init failed</b>', 'Nothing in AWS changed. The log shows its <code>Error:</code> lines first.', 'Read the first <code>Error:</code> line; it names the cause. Fix it, then press <b>Retry plan</b>, or <b>Edit configuration</b> to change the setup.'],
    ['Banner: <b>The plan was stopped</b>', 'Someone pressed <b>Stop this run</b>.', 'Press <b>Retry plan</b>.'],
    ['Banner: <b>The plan\'s result is unknown</b>', 'The wizard\'s API restarted while the plan ran, so its end was not recorded.', 'Press <b>Retry plan</b>.'],
    ['Red box: <b>The plan did not start</b>', 'Your SSO sign-in expired. Nothing ran.', `In a terminal, run ${login}, then try again.`],
  ] },
  apply: { title: 'Apply', rows: [
    ['Banner: <b>The apply failed</b> or <b>Part of the infrastructure exists</b>', 'The environment is <code>partial</code>. The plan review marks each failed resource with its error. Terraform keeps what it created.', 'Fix the cause named in the error, press <b>Plan again</b> (the new plan lists only what is missing), then <b>Apply</b>. Or tear down.'],
    ['A prompt to sign in again before the apply starts', `Less than 45 minutes are left on your SSO sign-in, and an apply takes ${F.apply}.`, 'In a terminal, run the <code>aws sso login</code> command shown, then press <b>Apply</b>.'],
    ['A prompt to type the environment name', 'The plan destroys or replaces existing infrastructure.', 'Read the plan first. Type the name only if you intend those changes.'],
    ['The page reloaded during the apply', 'Nothing is lost; the apply keeps running.', 'Open <code>localhost:3000/bootstrap</code>. The wizard returns to the step and follows the run.'],
    [`No change in the <b>Right now</b> box for ${F.stuck} minutes`, 'Terraform is waiting on one resource.', 'Open the run log and read the last lines: they name the resource. If it is Karpenter or a Helm release, search the log for <code>timed out</code>. Do not press <b>Stop this run</b> while Terraform is still working; if the run fails, follow the first row of this table.'],
  ] },
  'certificate-and-dns': { title: 'Certificate', rows: [
    ['Red box: <b>Could not write the validation records</b>', 'Writing to Route 53 failed; the message names the cause, for example an expired sign-in.', 'Sign in again if needed, then press <b>Try again</b>.'],
    ['Banner: <b>Create the validation records in your DNS</b>', 'You chose <b>I manage DNS myself</b>, and ACM is waiting for the records.', 'Add the CNAME records shown at your DNS provider, then press <b>Check now</b>.'],
    ['Banner: <b>The certificate is failed</b> (or expired, or revoked)', 'ACM will not issue or use this certificate; the banner gives ACM\'s reason.', 'Press <b>Use a different certificate</b>, then request a new one.'],
    ['Banner: <b>The certificate does not cover <i>hostname</i></b>', 'The hostnames changed after the certificate was chosen.', 'Press <b>Use a different certificate</b>.'],
    [`The banner reads "waiting for public DNS to answer" for more than ${F.certMax} minutes`, 'Public DNS does not find the zone, or your network\'s DNS resolver remembers an earlier "no such name" answer.', 'Run <code>dig NS</code> followed by your subdomain. If it returns no name servers, the delegation is missing; see <a href="{R}setup.html#troubleshooting">Setup troubleshooting</a>.'],
  ] },
  install: { title: 'Bootstrap the CSOC', rows: [
    ['Banner: <b>The bootstrap failed</b>', 'The environment is still <code>applied</code>, and the cluster is running. "The log below says what went wrong."', 'Read the last <code>=== … ===</code> heading in the log: the failing stage is the one under it. Fix the cause, then press <b>Bootstrap again</b>. It is safe to repeat, and it asks for the form again.'],
    ['Banner: <b>The bootstrap was stopped</b>', 'Someone pressed <b>Stop this run</b>. "The log below shows where it stopped."', 'Press <b>Bootstrap again</b>.'],
    ['<b>Bootstrap CSOC</b> is disabled, and the form says "Needs at least one allowed address and a confirmed admin password."', 'The form is incomplete.', 'Fill in <b>Allowed addresses</b> and both password fields; the password needs 12 or more characters.'],
    ['A prompt to sign in again before the bootstrap starts', 'Less than 15 minutes are left on your SSO sign-in.', 'In a terminal, run the command shown.'],
    ['Log: <code>WARNING: could not detect the cluster\'s egress IP</code>', 'The check that finds the cluster\'s outbound address timed out.', 'Press <b>Bootstrap again</b>. Sign-in fails until that address is allowed.'],
    ['Log: <code>another operation is in progress</code>', 'An interrupted run left a Helm release locked.', 'Press <b>Bootstrap again</b>. The bootstrap rolls back or removes a locked release before it continues.'],
    ['Banner: <b>Waiting for pull request #N to be merged</b>', 'You chose <b>With a GitOps repo</b>. The configuration waits in a pull request.', 'Press <b>Open the pull request</b> and merge it.'],
  ] },
  finish: { title: 'Finish the install', rows: [
    ['Banner: <b>The finish failed</b>', 'The environment is still <code>bootstrapped</code>. Finishing again is safe.', 'Read the last lines of the log, then press <b>Finish again</b>. If the log points at the bootstrap, open <b>Advanced</b> and press <b>Bootstrap</b>.'],
    ['Log: <code>the ALB was not provisioned</code>', 'The AWS Load Balancer Controller could not create the load balancer; the controller\'s log names the cause, for example the certificate or the subnets.', 'The log line names the command to read the controller\'s log. Fix the cause it reports, then press <b>Finish again</b>.'],
    ['Banner: <b>CSOC installed; waiting for DNS</b> for more than 10 minutes', 'Public DNS does not answer for the hostnames yet, or your network\'s resolver remembers an earlier "no such name" answer.', 'Run <code>dig portal.csoc.example.org</code> (with your hostname). If it returns an address, switch your computer to a public resolver such as <code>1.1.1.1</code>.'],
  ] },
  'sign-in': { title: 'Sign in to the CSOC', rows: [
    ['<code>NXDOMAIN</code>, or "This site can\'t be reached"', 'Your resolver remembers an earlier "no such name" answer.', 'Run <code>dig</code> on the hostname; if it returns an address, switch your computer to a public resolver such as <code>1.1.1.1</code>.'],
    ['<code>403 Forbidden</code> or a refused connection', 'Your current address is not in the allowed addresses, for example after joining a VPN.', 'See <a href="{R}how-to/allow-an-address.html">Allow a new IP address</a>.'],
    ['Keycloak asks for your email, first and last name', '<b>Admin email (optional)</b> was left empty in the bootstrap.', 'Fill them in once.'],
    ['Sign-in loops, or fails after Keycloak', 'The cluster\'s outbound address changed, for example after a Squid instance was replaced, so the portal cannot reach Keycloak.', 'Open <b>Advanced</b> on the <b>Install</b> step, press <b>Bootstrap</b>, then <b>Finish install</b>. The bootstrap detects the new address.'],
    ['You do not know the admin password', 'The wizard does not store it.', 'See <a href="{R}how-to/reset-admin-password.html">Reset the admin password</a>.'],
  ] },
  'connect-cluster': { title: 'Connect the cluster', rows: [
    ['"Waiting for agent pod to start…" for more than 5 minutes', 'A node is starting, or the agent image is still downloading through Squid.', 'Press the retry button when it appears.'],
    ['<b>Connection Failed</b> on the portal\'s Welcome page', 'The portal cannot reach the CSOC API.', 'Reload the page. If it persists, check that the CSOC API pod in the <code>csoc</code> namespace is running: <code>kubectl -n csoc get pods</code>.'],
    ['The portal\'s labels differ from these docs', 'The portal image is newer or older than these docs.', 'Follow the labels on screen; the sequence of steps is the same.'],
  ] },
  'deploy-gen3': { title: 'Deploy a Gen3 commons', rows: [
    ['<b>Deployment Failed</b> with "Token verification failed"', 'The page was open too long and the portal\'s short-lived access token expired. Nothing was installed.', 'Reload the page, or sign in again, then check the summary and press <b>Deploy Gen3</b> again.'],
    ['<code>502 Bad Gateway</code> at the commons\' hostname after the deploy', 'Expected for several minutes: the load balancer is ready before the services. arborist and indexd wait for their database secrets before they start.', 'Wait 5 minutes and reload. If it lasts more than 20 minutes after the deploy, check the pods: <code>kubectl -n commons-a get pods</code>.'],
    ['Load warning: the hostname is <code>localhost</code>', 'The <b>Hostname</b> field was left empty.', 'Go back to the <b>Hostname</b> step and enter the commons\' hostname.'],
    ['The certificate badge stays at "waiting for ACM to validate"', 'The validation records are not in public DNS yet.', 'Wait 5 minutes. You can continue and select the certificate later.'],
    ['<b>Deployment Failed</b> with another message', 'The agent or Helm returned the error shown.', 'Read the message. A YAML error names the line; "agent not connected" means the agent must be reconnected first.'],
    ['<b>Deployment Timeout</b>', 'The deploy is still running ("Deployment is still in progress").', 'Watch the deployments in the portal\'s dashboard.'],
    ['The commons hostname does not resolve', 'external-dns writes the record only after the load balancer exists.', 'Wait 2 minutes, then run <code>dig</code> on the hostname.'],
    ['You can sign in to the commons but have no access', 'The email in user.yaml does not match your email in Keycloak.', 'See <a href="{R}how-to/edit-user-yaml.html">Edit a commons\' user.yaml</a>.'],
  ] },
  'tear-down': { title: 'Tear down', rows: [
    ['Banner: <b>The uninstall failed</b>', 'Removing what the bootstrap added did not complete. The CSOC is still recorded.', 'Press <b>Retry teardown with Force</b>. It retries with the Force setting you chose, which is on unless you turned it off. If the cluster cannot be reached at all, press <b>Destroy anyway…</b>, which lists what may be left behind and asks for the name.'],
    ['Banner: <b>The destroy failed</b>', 'The environment is <code>partial</code>; some resources still exist.', 'Search the log for <code>DependencyViolation</code> to see which resource blocked it, then press <b>Retry teardown</b>. It continues where it stopped. A retry does not delete the state bucket; delete it afterwards from <b>What is left</b>.'],
    ['A prompt to sign in again before the teardown starts', `"${F.ui.teardownPrompt}"`, `In a terminal, run ${login}.`],
    ['The state bucket is not deleted', 'Another environment in it is not destroyed, or it holds other objects.', 'Destroy the other environments first, or keep the bucket.'],
  ] },
};

export const TS_ORDER = ['prerequisites', 'start-the-wizard', 'setup', 'review-and-provision', 'plan', 'apply', 'certificate-and-dns', 'install', 'finish', 'sign-in', 'connect-cluster', 'deploy-gen3', 'tear-down'];
