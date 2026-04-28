output "public_ip" {
  value = aws_instance.workshop.public_ip
}

output "instance_id" {
  value = aws_instance.workshop.id
}

output "ssm_command" {
  value = "aws ssm start-session --target ${aws_instance.workshop.id}"
}

output "ssh_command" {
  value = "ssh ubuntu@${aws_instance.workshop.public_ip}"
}

output "hosts_entries" {
  value = <<-EOT
  ${aws_instance.workshop.public_ip}  csoc.aws
  ${aws_instance.workshop.public_ip}  keycloak.aws
  EOT
}
