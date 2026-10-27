# Bootstrapping a CSOC into AWS from a laptop

The `/bootstrap` wizard takes an empty AWS account to a running CSOC. Terraform
builds the VPC and EKS cluster. The install then deploys the CSOC portal and
Keycloak, with secrets in AWS Secrets Manager: either directly from the
wizard, or through ArgoCD from a GitOps repo. You can then manage the CSOC,
and add Gen3 commons, from the CSOC itself.

## What you need

- Docker, with the Terraform runner image built: `./scripts/build-terraform-image.sh`
- AWS credentials for the target account: a profile (including SSO), access keys, or a
  role to assume. They need enough access to create a VPC, EKS, IAM roles, ACM
  certificates and Route53 records.
- A domain you can delegate a subdomain of, such as `example.org`. The wizard
  creates a public hosted zone for the subdomain (`csoc.example.org`) in the
  CSOC's account. If the parent zone is in Route53 and you have a profile
  that can reach it, the wizard adds the delegation; otherwise it shows the
  four NS records to add wherever the parent is hosted.
- Optionally, for GitOps: a GitHub repo for the CSOC's configuration (an
  empty one is fine), and a GitHub App installed on it with **Contents** and
  **Pull requests** read & write. You need the App ID, the installation ID and
  a private key (.pem). Without one, the wizard installs the CSOC directly.

## Start the wizard

With Docker only:

```bash
docker compose -f docker-compose-bootstrap-csoc.yml up --build
open http://localhost:3000/bootstrap
```

From a development checkout:

```bash
./scripts/dev.sh --bootstrap cloud
# to test unpublished gen3-terraform changes:
./scripts/dev.sh --bootstrap cloud --modules-dir ~/projects/uc-cdis/gen3-terraform
```

Both serve on `localhost` only. The bootstrap API runs without login, as a
superadmin that can use your AWS credentials, so it must not be reachable from
the network. The API binds to `127.0.0.1` whenever `MOCK_AUTH` is on outside a
cluster.

## What happens

1. **Environment setup.** The wizard checks your AWS identity (an expired SSO
   session shows the `aws sso login` command to run). It checks the state
   bucket, offering to create it versioned, encrypted, TLS-only and private.
   It validates the hostname against Route53. If no zone serves it, the
   wizard creates one (for `portal.csoc.example.org`, the zone is
   `csoc.example.org`) and delegates it from the parent zone. It refuses to
   delegate a name that already has records in the parent, and waits until
   public DNS sees the delegation, since the certificate cannot be validated
   before that. Keycloak defaults to `auth.<zone>`.
2. **Provision.** The wizard registers the environment and runs `init`, `plan`
   and `apply` of `gen3-terraform//examples/csoc` in the runner container.
   State is locked with an S3 lock object; no DynamoDB table is needed.
3. **Install CSOC, directly.** Without a GitOps repo:
   - **Install.** `install-csoc` creates the CSOC's secrets in Secrets
     Manager, then installs External Secrets, the load balancer controller,
     CloudNativePG, the Keycloak operator, Keycloak and the realm, and the
     CSOC chart from this checkout, with the same values and release names
     ArgoCD would use. It also finds the cluster's egress IP.
   - **Finish.** `finish-csoc` applies Keycloak's ingress and the CSOC chart
     again with the egress IP in the allowlist, waits for both, removes the
     first admin password, and points both hostnames at the ALB.

   Moving a directly installed CSOC to GitOps is not supported yet.

   **Install CSOC, with GitOps.** This happens in four parts:
   - **Connect the repo.** The wizard checks the GitHub App can reach the
     repo, and stores its key in Secrets Manager.
   - **Bootstrap.** `install-csoc` creates the CSOC's secrets in Secrets
     Manager, installs External Secrets Operator and ArgoCD, and points ArgoCD
     at the repo. It also finds the cluster's egress IP.
   - **Review and merge.** The wizard opens a pull request with the CSOC's
     whole configuration (see below) and waits for you to merge it.
   - **Finish.** `finish-csoc` waits for ArgoCD to deploy it, removes the
     first admin password from the cluster, and points both hostnames at the
     ALB.

   The ALB, and the agent NLB, only accept the CIDRs you allow: your current
   IP by default, plus the cluster's own egress IP, which is added
   automatically.
4. **Done.** Sign in at `https://<hostname>` as `admin`, with the password you
   set in the install step.

## The GitOps repo

Each CSOC gets a directory named after it. CSOC owns that directory and
re-renders it whole for every change, so make changes through CSOC. A hand
edit shows up as a diff in the next CSOC pull request.

```
<name>/root.yaml            root Application; syncs apps/
<name>/apps/                ArgoCD, External Secrets, LB controller, CloudNativePG,
                            Keycloak operator, csoc-config, csoc
<name>/values/              Helm values for those Applications
<name>/manifests/           Keycloak, its database, the realm, the StorageClass,
                            the ClusterSecretStore and the ExternalSecrets
<name>/keycloak-operator/   kustomization pinning the operator release
```

Every change is a pull request opened by the GitHub App. Merging it is what
deploys it. To change the allowlist after install, CSOC opens a new PR
(`POST /api/gitops/propose-csoc` with `allowed_cidrs`).

ArgoCD gets the CSOC chart from `uc-cdis/gen3-admin` (`helm/csoc`, `master`).
To test chart changes that aren't there yet, set `CSOC_CHART_REPO` and
`CSOC_CHART_REVISION` for the API before installing.

Before anything is committed, every file is checked for secrets. A private
key, an AWS or GitHub token, a Slack webhook, or a value under a key such as
`password` or `clientSecret` fails the pull request.

## Where things are kept

Everything is in the state bucket, so you can close the wizard and resume it
later, from this laptop or from the CSOC once it is running:

```
s3://<bucket>/gen3-csoc/environments/<name>/environment.json   config, status, non-sensitive outputs
s3://<bucket>/gen3-csoc/environments/<name>/terraform.tfstate
s3://<bucket>/gen3-csoc/environments/<name>/runs/<id>.json     one per run: operation, exit code, plan summary
s3://<bucket>/gen3-csoc/environments/<name>/runs/<id>.log
```

On the laptop, work dirs (module sources and the saved plan) live under
`~/.gen3-csoc/terraform`, or `TERRAFORM_WORK_ROOT` if set.

Secrets never go to the registry, the logs or the repo:

- AWS keys, and assumed-role credentials, reach each run through a 0600 file
  that is deleted when the run ends.
- Sensitive Terraform outputs are dropped before outputs are recorded.
- The CSOC's own secrets are in Secrets Manager, in the CSOC's region. External
  Secrets copies them into the cluster, and its IAM role can read only this
  prefix:

  ```
  gen3-csoc/<name>/github-app        GitHub App ID, installation ID, private key
  gen3-csoc/<name>/keycloak-admin    Keycloak's admin login (generated)
  gen3-csoc/<name>/keycloak-client   the portal's OIDC client secret (generated)
  gen3-csoc/<name>/nextauth          the portal's session secrets (generated)
  ```

  Rotate one in Secrets Manager and External Secrets updates the cluster
  within the hour. Destroying the environment does not delete them.
- The first admin password reaches the installer through a 0600 file that is
  deleted after the run. In the cluster it is a Secret that the realm import
  reads; `finish-csoc` deletes it once the realm exists.

## Checking it end to end without creating anything

```bash
./scripts/test-e2e-bootstrap.sh --bucket <existing-bucket> --profile <profile>
```

This runs the wizard's API calls up to `terraform plan` of the real module,
checks that the runs are recorded, checks that install, finish and the GitOps
calls are refused before their prerequisites, and cleans up its registry
records. It applies nothing and needs no GitHub App.
