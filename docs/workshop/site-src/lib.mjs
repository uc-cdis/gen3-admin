// Helpers shared by the page definitions.
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Placeholders the reader replaces with what they set up (introduced on prerequisites.html).
export const PH = {
  profile: '<your-aws-profile>', ssoprofile: '<your-sso-profile>', account: '<account-id>', region: '<your-region>',
  name: '<csoc-name>', zone: '<your-domain>', parentzone: '<parent-domain>', parent: '<parent-profile>', email: '<admin-email>',
  bucket: '<state-bucket>', portal: 'portal.<your-domain>', auth: 'auth.<your-domain>', commons: 'commons-a.<your-domain>',
};
export const v = (k) => `<span class="ph">${esc(PH[k])}</span>`;
// One consistent example, used in prose and steps. Placeholders (v) are for commands and templates only.
export const EX = {
  profile: 'csoc-admin', ssoprofile: 'campus-sso', account: '111122223333', region: 'us-east-1', name: 'csoc-dev',
  zone: 'csoc.example.org', parentzone: 'example.org', parent: 'dns-admin', email: 'jdoe@example.org',
  bucket: 'gen3-csoc-csoc-dev-111122223333', portal: 'portal.csoc.example.org', auth: 'auth.csoc.example.org',
  commons: 'commons-a.csoc.example.org', commonsb: 'commons-b.csoc.example.org', ip: '203.0.113.7/32', campus: '198.51.100.0/24',
  role: 'AdministratorAccess',
};
export const ex = (k) => `<code class="ex">${esc(EX[k])}</code>`;
// Where a step happens, when it is not the wizard.
export const where = (w) => `<span class="where">${w}</span> `;
// The closing line of a tutorial page's Steps.
export const doneWhen = (html) => `<p class="donewhen"><b>Done when:</b> ${html}</p>`;
export const btn = (l, cls = '') => `<span class="btn-ui${cls ? ' ' + cls : ''}">${l}</span>`;
export const fld = (l) => `<span class="field">${l}</span>`;
export const cp = (h) => `<code class="cp">${h}</code>`;
export const cmd = (h, lang = 'bash', tall = false) =>
  `<div class="codeblock${tall ? ' tall' : ''}">${lang ? `<span class="lang">${lang}</span>` : ''}<pre><code>${h.replace(/^\n/, '').replace(/\s+$/, '')}</code></pre></div>`;
export const banner = (tone, title, detail = '', acts = '') =>
  `<div class="banner${tone ? ' ' + tone : ''}"><b>${title}</b>${detail ? `<span>${detail}</span>` : ''}${acts ? `<span class="acts">Buttons: ${acts}</span>` : ''}</div>`;
export const adm = (kind, title, body) => {
  const label = title || { note: 'Note', tip: 'Tip', warning: 'Warning', danger: 'Danger' }[kind];
  return `<div class="adm ${kind}" role="note"><p class="adm-t">${label}</p>${/^\s*<(p|ul|ol|div|table)[\s>]/.test(body) ? body : `<p>${body}</p>`}</div>`;
};
export const used = new Set();
export const shot = (root, file, alt, cap) => {
  used.add(file);
  const note = '';
  return `<figure class="shot"><img src="${root}assets/img/${file}" alt="${esc(alt)}" loading="lazy"><figcaption>${cap}${note}</figcaption></figure>`;
};
export const diagram = (name, label, caps) =>
  `<figure class="anim" data-dg="${name}" data-label="${esc(label)}"><figcaption><b>Diagram: ${label}.</b> The numbered steps below describe it in full; <b>Play</b> highlights each step in turn.</figcaption><div class="svgwrap"></div><div class="ctl noprint"></div><ol class="caps" id="dg-${name}-steps">${caps.map((c) => `<li>${c}</li>`).join('')}</ol></figure>`;
export const timer = (id, typ, hi, label, typText) => `<div class="timer noprint" data-t="${id}" data-typ="${typ}" data-hi="${hi}" data-label="${label}" data-typtext="${typText}"></div>`;
export const table = (cols, rows) =>
  `<div class="tw"><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export const pill = (k, val) => `<span class="pill">${k} <b>${val}</b></span>`;

// One source of truth for every number the docs quote. Durations come from 58 recorded runs. The docs quote no prices.
// Style: a range ("15–20 minutes") or a single value ("about 5 minutes"),
// never "about" with a range; every bound has its unit.
export const F = {
  resources: 'about 120',            // plans of 119–123
  resourcesNormal: '110–130',
  plan: 'under 1 minute',            // init and plan together, from Provision or Plan to "Plan ready"
  apply: '15–20 minutes',            // from Apply to the Certificate step
  applyTyp: 20, applyMax: 30,
  eks: 'about 10 minutes',           // the EKS control plane, within the apply
  cert: '1–5 minutes',               // from Request to the Install step
  certTyp: 5, certMax: 10,
  install: 'about 5 minutes',        // from Bootstrap CSOC to "Bootstrapped; ready to finish"
  installTyp: 5, installMax: 10,
  finish: '3–6 minutes',             // from Finish install to "CSOC is ready"
  finishTyp: 6, finishMax: 12,
  total: 'about 40 minutes',         // Welcome to Done, after prerequisites and DNS delegation
  gen3: 'about 12 minutes',          // from Deploy Gen3 to a working site, including several minutes of 502
  gen3Typ: 12, gen3Max: 20,
  uninstall: '2–10 minutes',
  destroy: 'about 5 minutes',
  teardown: '10–15 minutes',         // from Tear down to "Torn down"
  teardownTyp: 15, teardownMax: 25,
  eks133StdEnd: 'July 29, 2026', eks133ExtEnd: 'July 29, 2027', eks134StdEnd: 'December 2, 2026',
  logRetention: '3653 days', lambdaLogRetention: '14 days', stuck: 30,
  cidr: '172.24.16.0/20',
  eksVersion: '1.33',
  // Banner details, quoted exactly as frontend/lib/wizardState.ts shows them.
  ui: {
    welcome: 'Estimated time: about 40 minutes.',
    init: 'Downloading the modules and providers. Under a minute.',
    plan: 'Working out what to create. Under a minute.',
    apply: 'Creating the infrastructure. 15–20 minutes; you can close this page and come back.',
    install: 'Installing External Secrets, the load balancer controller, Keycloak and the portal. About 5 minutes.',
    finish: 'Waiting for Keycloak and the portal, then creating the DNS records. 3–6 minutes.',
    uninstall: 'Removing the load balancers, volumes, nodes, DNS records and secrets the install added. A few minutes.',
    destroy: 'Deleting the infrastructure. About 5 minutes; up to 30 if AWS is slow to release network interfaces.',
    teardownPrompt: 'A teardown takes 10–15 minutes, up to 45, and stops part-way if the sign-in ends first.',
    destroyPanel: 'terraform destroy: the cluster, VPC, Squid, IAM roles and the certificate. About 5 minutes.',
  },

};

// Official documentation, in one place. Every URL here was checked to load.
export const URL = {
  awscli: 'https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html',
  sso: 'https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html',
  profiles: 'https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html',
  idc: 'https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html',
  iam: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html',
  scp: 'https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html',
  shared: 'https://aws.amazon.com/compliance/shared-responsibility-model/',
  calc: 'https://calculator.aws/',
  budgets: 'https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html',
  ekspricing: 'https://aws.amazon.com/eks/pricing/',
  vpcpricing: 'https://aws.amazon.com/vpc/pricing/',
  docker: 'https://docs.docker.com/desktop/',
  orbstack: 'https://orbstack.dev/',
  colima: 'https://github.com/abiosoft/colima',
  compose: 'https://docs.docker.com/compose/',
  r53zones: 'https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/hosted-zones-working-with.html',
  r53sub: 'https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/CreatingNewSubdomain.html',
  acm: 'https://docs.aws.amazon.com/acm/latest/userguide/acm-overview.html',
  acmdns: 'https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html',
  vpc: 'https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html',
  nat: 'https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html',
  alb: 'https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html',
  lambda: 'https://docs.aws.amazon.com/lambda/latest/dg/welcome.html',
  sm: 'https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html',
  eks: 'https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html',
  irsa: 'https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html',
  karpenter: 'https://karpenter.sh/docs/',
  lbc: 'https://kubernetes-sigs.github.io/aws-load-balancer-controller/',
  edns: 'https://kubernetes-sigs.github.io/external-dns/',
  eso: 'https://external-secrets.io/',
  cnpg: 'https://cloudnative-pg.io/',
  keycloak: 'https://www.keycloak.org/documentation',
  kcadmin: 'https://www.keycloak.org/docs/latest/server_admin/index.html',
  argo: 'https://argo-cd.readthedocs.io/',
  helm: 'https://helm.sh/docs/',
  terraform: 'https://developer.hashicorp.com/terraform/docs',
  tfs3: 'https://developer.hashicorp.com/terraform/language/backend/s3',
  squid: 'http://www.squid-cache.org/',
  oidc: 'https://openid.net/developers/how-connect-works/',
  incommon: 'https://incommon.org/',
  gen3: 'https://gen3.org/',
  gen3docs: 'https://docs.gen3.org/',
  gen3community: 'https://gen3.org/community/',
  gen3helm: 'https://github.com/uc-cdis/gen3-helm',
  fence: 'https://github.com/uc-cdis/fence',
  useryaml: 'https://github.com/uc-cdis/fence/blob/master/docs/additional_documentation/user.yaml_guide.md',
  issues: 'https://github.com/uc-cdis/gen3-admin/issues',
  repo: 'https://github.com/uc-cdis/gen3-admin',
  tfrepo: 'https://github.com/uc-cdis/gen3-terraform',
  git: 'https://git-scm.com/downloads',
  ekscal: 'https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html',
  eksendpoint: 'https://docs.aws.amazon.com/eks/latest/userguide/cluster-endpoint.html',
  ekslogs: 'https://docs.aws.amazon.com/eks/latest/userguide/control-plane-logs.html',
  flowlogs: 'https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html',
  cloudtrail: 'https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html',
  ghprivate: 'https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability',
  ctds: 'https://ctds.uchicago.edu/',
  squidlist: 'https://github.com/uc-cdis/cloud-automation/tree/master/files/squid_whitelist',
  opskeys: 'https://github.com/uc-cdis/cloud-automation/blob/master/files/authorized_keys/ops_team',
};
export const ext = (k, text) => `<a href="${URL[k]}">${text}</a>`;
// A wizard step, named by its stepper label.
export const wstep = (s) => `<b>${s}</b> step`;
