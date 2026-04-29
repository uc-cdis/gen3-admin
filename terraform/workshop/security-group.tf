resource "aws_security_group" "workshop" {
  name        = "${var.workshop_name}-sg"
  description = "Workshop VM security group - no SSH, SSM only"
  vpc_id      = aws_vpc.workshop.id

  # HTTP — CSOC portal + Keycloak
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTPS
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # All outbound
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name     = "${var.workshop_name}-sg"
    Workshop = var.workshop_name
  }
}
