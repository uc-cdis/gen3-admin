data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_instance" "workshop" {
  ami                  = data.aws_ami.ubuntu.id
  instance_type        = var.instance_type
  subnet_id            = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.workshop.id]
  iam_instance_profile = aws_iam_instance_profile.workshop.name

  user_data = templatefile("${path.module}/user-data.sh.tpl", {
    git_repo   = var.git_repo
    git_branch = var.git_branch
  })

  root_block_device {
    volume_size = 80
    volume_type = "gp3"
    tags = {
      Name     = "${var.workshop_name}-root"
      Workshop = var.workshop_name
    }
  }

  # Don't force replacement on security group changes
  lifecycle {
    ignore_changes = [security_groups, vpc_security_group_ids, user_data]
  }

  tags = {
    Name     = "${var.workshop_name}-vm"
    Workshop = var.workshop_name
  }
}
