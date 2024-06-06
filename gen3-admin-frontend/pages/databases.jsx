import { Container, Skeleton, Title } from "@mantine/core";

export default function Databases() {
    return <>
        <Skeleton visible={false}>
            <Container fluid my={20}>
                <Title>Database Dashboard</Title>
            </Container>
        </Skeleton>
    </>
}