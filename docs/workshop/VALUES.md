# What to type in the wizard

One page for following along. Values are for our test run in account
354484406138. Workshop attendees use their own account and domain; the
pattern is in the right-hand column. The full walkthrough, with what each
step does, is in [README.md](README.md).

## Environment Setup

| Field | Our run | Your own |
|---|---|---|
| AWS Credentials | **Select AWS profile** → `csoc-workshop` | the profile for the account the CSOC goes in |
| Assume role | empty | empty, unless you deploy into another account via a role |
| | **Check the blue box: account 354484406138** | your account number |
| Terraform State Bucket | `gen3-csoc-workshop-354484406138` → **Check** → **Create bucket** | `gen3-csoc-<csoc name>-<account id>` (bucket names are global) |
| CSOC Name | `workshop` | lowercase letters, digits, hyphens |
| AWS Region | `us-east-1` | your region |
| CSOC Hostname | `portal.workshop.planx-pla.net` → **Validate** | `portal.<subdomain>.<your domain>` |
| Hosted zone to create | `workshop.planx-pla.net` (filled in) | `<subdomain>.<your domain>` |
| Delegate it from the parent zone using | **Profile: default** | the profile that reaches your domain's zone, or "I'll add the NS records myself" |
| | **Set up zone and delegation**, then **Check again** until *Domain Verified* | |

**Advanced Options**: leave as they are.
- Keycloak hostname `auth.workshop.planx-pla.net`.
- No existing certificate.
- VPC CIDR `172.24.16.0/20`.
- Commons data bucket off.

## Review & Confirm

Check the account, hostnames and **Data bucket: none**, then **Provision**.

## Provisioning

1. Init starts by itself (about 20 seconds).
2. **Plan**: about 101 to add. Look over the list and the diagram.
3. **Apply**: about 20–25 minutes. Progress shows in the list and diagram.

## Install CSOC

| Field | Value |
|---|---|
| How to deploy | **Directly, from this wizard** |
| Allowed addresses | your IP is filled in; add others if needed |
| Admin email | your email (or leave empty) |
| Admin password | **Generate password**, and save it |
| Images | empty for now (`:master`); for the redeploy, the branch tag CI builds |

**Bootstrap CSOC** (about 5 minutes), then **Finish install** (about 5 minutes).

## Sign in

`https://portal.workshop.planx-pla.net` → user `admin`, the password you saved.

## Tear down afterwards

Provisioning → **Destroy** → type `workshop`. Tick **Force** if nothing
needs keeping. It uninstalls the CSOC, then runs `terraform destroy`
(25–30 minutes). The zone, its delegation and the state bucket are removed
separately (see PREP.md).
