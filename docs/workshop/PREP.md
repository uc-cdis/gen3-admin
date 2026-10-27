# Workshop prep: what has to be true before Wednesday

Organizer checklist, not for attendees.

## Attendees pull images from quay, they do not build them

Today only `csoc-frontend`, `csoc-api` and `csoc-agent` are published
(`.github/workflows/docker-builds.yaml`). The Terraform runner
(`gen3-terraform:latest`) is local-only, and `docker-compose-bootstrap-csoc.yml`
builds the API and frontend from source. To make this a pull:

- [ ] Publish the runner: add a `build-terraform` job for `Dockerfile.terraform`
      (`quay.io/cdis/csoc-terraform`, amd64 + arm64).
- [ ] Point the API at it: default runner image `quay.io/cdis/csoc-terraform:<tag>`
      instead of `gen3-terraform:latest` (`api/internal/terraform/terraform.go`),
      overridable for local development.
- [ ] Bake into the runner image what plan and install runs now mount from the
      checkout: `scripts/runner/`, `third_party/tf-arch/`, `helm/csoc/`.
- [ ] A compose file that uses `image:` (quay, pinned tag) for api and
      frontend, with no `build:`, so the only prerequisite is Docker.
- [ ] Merge this work so the published images contain it. `master` images do
      not have the bootstrap wizard changes yet.
- [ ] Pin the gen3-terraform module ref the runner uses (the
      `feat/csoc-bootstrap` branch is pushed and merged, or tagged).
- [ ] Pre-pull test from a clean machine: `docker compose pull`, time it.

## Wizard rough edges found in the walkthrough

- [ ] Auto-detect silently picks the default profile's account. Make the
      account number louder, or ask "is this the account you meant?".
- [ ] Bucket **Check** right after picking a profile can be wiped when the
      identity check lands (seen once on Oct 22; not reproduced on Oct 26,
      where the "lost" checks were clicks on the stepper's "Check config").
- [x] Subnet titles in the plan diagram cut off by "assigned at apply": the
      EKS subnets now sit in a "picked at apply" band, one column per zone.
- [ ] The diagram fits with empty space above and below on a narrow
      (960 px) window. Fine on a full-width one.
- [ ] Card names are cut at 180 px (`workshop-externa…`); the full name is
      in the tooltip and the side panel.

## gen3-terraform: must be pushed before Wednesday

All local, on `feat/csoc-bootstrap-master` in
`~/projects/uc-cdis/gen3-terraform-csoc-bootstrap`: origin/master (d964e45)
+ a merge of terraform-docker + these commits. Not pushed. Without them the
CSOC does not come up in any account but CTDS's.

`examples/csoc` exists only on `terraform-docker`, which split from master on
2025-12-03 and is 73 commits behind it, and the example fetches `vpc` and
`eks` from `ref=terraform-docker`: it ran December-2025 modules. The merge
brings it onto master.

- [ ] **Squid AMI.** The example read it from an SSM parameter in the CTDS
      account. Now: latest Amazon Linux 2023. squid_auto's user data used
      IMDSv1, which AL2023 refuses; now IMDSv2.
- [ ] **Data bucket.** vpc always created `<vpc>-data-bucket` (a global name:
      `workshop-data-bucket` was taken) with logs bucket, CloudTrail, KMS key
      and fence-bot user. Now `deploy_data_bucket` / `data_bucket_name`
      (moved blocks for existing commons); the CSOC leaves it out.
- [ ] **users bucket policy.** eks attached `bucket_reader_cdis-gen3-users_<vpc>`,
      which a CSOC does not have. Now `attach_users_bucket_policy`.
- [ ] **depends_on on module.vpc.** Any pending vpc change deferred every eks
      lookup and the plan replaced the cluster's subnets and security groups.
      eks now takes the VPC ID and Squid ASG name as vpc outputs.
- [ ] **Nodes.** The ASG's bootstrap.sh does not work on AL2023 (EKS 1.33), so
      nodes never joined. Now Karpenter: controller on Fargate, chart and
      NodePool/EC2NodeClass from Terraform, ASG off. Fixed in karpenter.tf:
      SQS permission named a literal `karpenter-sqs-vpc_name`; pre-v1 chart
      settings; two IAM read actions; chart wait 5 -> 15 minutes.
- [ ] **Squid lambda.** Since #83 (no VPC endpoints) it needs a subnet routed
      through the NAT gateway to reach AWS; commons creates that route only
      with `csoc_managed = true`, and the csoc example not at all, so it timed
      out and the private subnets never got a default route. The example now
      has the int_services subnet + NAT route. **Standalone commons
      (`csoc_managed = false`) likely have the same problem.**
- [ ] master's `examples/gen3-deployment` did not init (an invalid reference,
      and `user_yaml_bucket_name` passed to commons, which takes
      `users_bucket_name`); fixed in the merge.
- [ ] Point the examples' module refs at master (or a tag) once merged.
- [ ] Karpenter's NodePool is r-family, spot or on-demand (module defaults).
      Decide for a CSOC: on-demand, smaller instances?

## gen3-admin bugs found and fixed (uncommitted)

- [x] Runs longer than 10 minutes were recorded as **succeeded** while still
      running: the Docker socket proxy closes connections at 10 minutes, the
      recorder ignored the cut-off `docker wait`, and a running container
      reports exit code 0. The log stream ended the same way. Now: wait again
      until it has really stopped, follow logs with timestamps across
      cut-offs, never read an exit code from a running container.
- [x] Returning to the wizard auto-ran `init`, even beside a running apply.
- [x] Install/finish runs mounted ~/.aws read-only and the AWS CLI could not
      refresh the SSO token. Every run now copies ~/.aws into a writable
      home; the host's files stay read-only.
- [x] CSOC chart: the API (uid 1000) could not write its CA to the new EBS
      volume (`podSecurityContext` was never used by the template; now
      `fsGroup: 1000`), and a rolling update deadlocked on the RWO volume
      (Multi-Attach); now `strategy: Recreate`.
- [x] A run stopped mid-upgrade left the Helm release pending and every later
      install failed ("another operation is in progress"); direct.sh now
      rolls back / removes a stuck release first.
- [ ] Stopping a run marks the environment `failed`, and finish then demands a
      new install. Fine, but say so in the UI.
- [ ] The install's egress-IP probe gave up (3 minutes for a pod, and its
      image pull, on a new node); retry or wait longer.
- [ ] The egress IP is the public IP of whichever Squid holds the route: a
      failover or instance replacement changes it and in-cluster calls to
      Keycloak's public hostname are refused. Give Squid an EIP, or call
      Keycloak in-cluster.
- [ ] With no admin email, Keycloak demands email/first/last name at first
      login. Set first/last name in the realm import, or require the email.
- [ ] The in-cluster CSOC runs quay.io/cdis/csoc-*:master, which has none of
      this work (it shows the old "CSOC Setup Wizard"). Publish images with it.

## Teardown (Destroy) findings, 2026-10-26

- [x] `uninstall-csoc` runs before every Destroy of an applied CSOC; Force
      skips graceful waits (terminates this cluster's Karpenter nodes, drops
      finalizers, deletes its PV volumes by ID).
- [x] Namespaces installed outside Helm (ArgoCD, monitoring from the CSOC
      portal) are deleted too; orphaned webhooks are removed; ExternalSecrets
      go while ESO runs; leftover finalizers are dropped after a grace period.
- [x] `cloud-proxy.internal.io` (made by the squid lambda) blocked deleting the
      private zone; the uninstall deletes it now.
- [ ] The squid lambda's VPC network interface takes AWS ~20 minutes to
      release after the lambda is deleted, holding the int_services subnet
      and eks_nodes_sg; the destroy waits. Expect a 25-30 minute destroy.
- [ ] A Karpenter node would not drain (graceful uninstall waits 15 min, the
      NodePool allows 48h): look at PDBs and terminationGracePeriod for a CSOC.
- [ ] No wizard teardown for the zone, its delegation and the state bucket.

## Overriding Terraform variables from the wizard

- [ ] The example declares 115 variables; the wizard sets about 20 and the
      "View Configuration" panel is read-only. Add an "All Terraform
      variables" editor: the example's declared variables with descriptions
      and defaults, any of them overridable, saved with the environment.
- [ ] A published environment copies the example on first init only, so it
      never picks up newer module code. (Local checkouts are now re-copied on
      every init.) Decide how an environment upgrades.
