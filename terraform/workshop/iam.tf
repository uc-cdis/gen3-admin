data "aws_iam_policy_document" "ssm_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "workshop" {
  name               = "${var.workshop_name}-role"
  assume_role_policy = data.aws_iam_policy_document.ssm_assume.json

  tags = {
    Workshop = var.workshop_name
  }
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.workshop.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "workshop" {
  name = "${var.workshop_name}-profile"
  role = aws_iam_role.workshop.name
}
