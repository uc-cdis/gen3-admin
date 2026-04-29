resource "aws_vpc" "workshop" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name     = "${var.workshop_name}-vpc"
    Workshop = var.workshop_name
  }
}

resource "aws_internet_gateway" "workshop" {
  vpc_id = aws_vpc.workshop.id

  tags = {
    Name     = "${var.workshop_name}-igw"
    Workshop = var.workshop_name
  }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.workshop.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 1)
  map_public_ip_on_launch = true
  availability_zone       = "${var.aws_region}a"

  tags = {
    Name     = "${var.workshop_name}-public-subnet"
    Workshop = var.workshop_name
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.workshop.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.workshop.id
  }

  tags = {
    Name     = "${var.workshop_name}-public-rt"
    Workshop = var.workshop_name
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}
