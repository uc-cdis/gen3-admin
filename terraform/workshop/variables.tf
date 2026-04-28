variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "m6i.2xlarge"
}

variable "workshop_name" {
  description = "Workshop name (used for tagging and naming)"
  type        = string
  default     = "gen3-workshop"
}

variable "git_branch" {
  description = "Git branch to clone for setup scripts"
  type        = string
  default     = "feat/bootstrap-onboarding-impl"
}

variable "git_repo" {
  description = "Git repo URL to clone"
  type        = string
  default     = "https://github.com/uc-cdis/gen3-admin.git"
}

variable "vpc_cidr" {
  description = "CIDR block for workshop VPC"
  type        = string
  default     = "10.100.0.0/16"
}
