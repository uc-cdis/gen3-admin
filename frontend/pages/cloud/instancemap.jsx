import React, { useState, useEffect } from "react";
import { TextInput, Loader, Alert, Text, Group, Modal, Select, Paper, Stack, Grid, Tooltip, Badge, Divider } from "@mantine/core";
import { IconAlertCircle, IconSearch } from "@tabler/icons-react";
import HexagonGrid from "@/components/HexagonGrid";

function InstancesHexGrid() {
    const [allInstances, setAllInstances] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState('');
    const [opened, setOpened] = useState(false);
    const [selectedInstance, setSelectedInstance] = useState(null);
    const [groupBy, setGroupBy] = useState('none');

    const groupOptions = [
        { value: 'none', label: 'No Grouping' },
        { value: 'Environment', label: 'Environment' },
        { value: 'InstanceType', label: 'Instance Type' },
        { value: 'State.Name', label: 'State' },
        { value: 'Placement.AvailabilityZone', label: 'Availability Zone' }
    ];

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await fetch('/api/aws/instances');
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const rawData = await response.json();
                const flattenedInstances = rawData.reduce((acc, reservation) => {
                    if (Array.isArray(reservation.Instances)) {
                        return acc.concat(
                            reservation.Instances.map((instance) => {
                                const envTag = instance.Tags?.find(tag => tag.Key === 'Environment');
                                const nameTag = instance.Tags?.find(tag => tag.Key === 'Name');
                                return {
                                    ...instance,
                                    Environment: envTag?.Value || 'No Environment',
                                    Name: nameTag?.Value || 'Unnamed',
                                    ReservationId: reservation.ReservationId,
                                    OwnerId: reservation.OwnerId
                                };
                            })
                        );
                    }
                    return acc;
                }, []);
                setAllInstances(flattenedInstances);
            } catch (err) {
                console.error("Error fetching instances:", err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    const getGroupValue = (instance, groupKey) => {
        if (groupKey === 'none') return 'All Instances';
        if (groupKey === 'State.Name') return instance.State?.Name || 'Unknown';
        if (groupKey === 'Placement.AvailabilityZone') return instance.Placement?.AvailabilityZone || 'Unknown';
        return instance[groupKey] || 'Unknown';
    };

    const prepareGroupedInstances = (instances) => {
        const groupedInstances = new Map();
        instances.forEach(instance => {
            const groupKey = getGroupValue(instance, groupBy);
            if (!groupedInstances.has(groupKey)) {
                groupedInstances.set(groupKey, []);
            }
            groupedInstances.get(groupKey).push(instance);
        });

        return Array.from(groupedInstances.entries()).map(([groupName, groupInstances]) => ({
            name: groupName,
            instances: groupInstances,
        }));
    };

    const filteredInstances = allInstances.filter(instance => {
        if (!filter) return true;
        const nameTag = instance.Tags?.find(tag => tag.Key === 'Name')?.Value || '';
        return nameTag.toLowerCase().includes(filter.toLowerCase()) ||
            instance.InstanceId.toLowerCase().includes(filter.toLowerCase());
    });

    const groupedInstances = prepareGroupedInstances(filteredInstances);

    const getHexProps = (instance) => ({
        style: {
            fill: instance.State?.Name === "running" ? "#4CAF50" : "#757575",
            stroke: "22black",
            strokeWidth: "20",
            transition: "all 1s ease-in-out",
            cursor: "pointer"
        },
        onClick: () => {
            setSelectedInstance(instance);
            setOpened(true);
        },
    });


    const renderHexagonContent = (hex) => {
        if (!hex?.instance) return null;

        const instanceType = hex?.instance?.InstanceType;
        // Split up into small, large, xlarge by splitting string after .
        const instanceSize = instanceType.split('.')[1];

        const instanceSizeMap = {
            "small": 1,
            "medium": 2,
            "large": 3,
            "xlarge": 4,
            "2xlarge": 5,
            "4xlarge": 6,
            "8xlarge": 7,
            "12xlarge": 8,
            "16xlarge": 9,
            "24xlarge": 10,
            "32xlarge": 11,
            "metal": 12,
        };

        // Approximate cost per month for instance type (rough estimates)
        const instanceCostMap = {
            "small": 15,      // ~$0.02/hr
            "medium": 30,     // ~$0.04/hr
            "large": 60,      // ~$0.08/hr
            "xlarge": 120,    // ~$0.16/hr
            "2xlarge": 240,   // ~$0.32/hr
            "4xlarge": 480,   // ~$0.64/hr
            "8xlarge": 960,   // ~$1.28/hr
            "12xlarge": 1440, // ~$1.92/hr
            "16xlarge": 1920, // ~$2.56/hr
            "24xlarge": 2880, // ~$3.84/hr
            "32xlarge": 3840, // ~$5.12/hr
            "metal": 5000,    // ~$6.67/hr
        };




        return (
            <>
                <text x="50%" y="70%" fontSize={50} fontWeight="bold" textAnchor="middle" style={{ fill: "white" }}>
                    {hex.instance.InstanceType}
                </text>
                <text x="50%" y="30%" fontSize={50 } fontWeight="bold" textAnchor="middle" style={{ fill: "white", stroke: "black", strokeWidth: 1 }}>
                    ~${instanceCostMap[instanceSize]}/mo
                </text>
            </>
        );
    };

    return (
        <Paper p="md" radius="sm">
            <Grid gutter="md">
                <Grid.Col span={12}>
                    <Group mb="md" spacing="md">
                        <TextInput
                            placeholder="Filter instances..."
                            value={filter}
                            onChange={(event) => setFilter(event.currentTarget.value)}
                            icon={<IconSearch size="1rem" />}
                            style={{ flex: 1 }}
                        />
                        <Select
                            placeholder="Group by..."
                            value={groupBy}
                            onChange={(value) => setGroupBy(value)}
                            data={groupOptions}
                            style={{ width: 200 }}
                        />
                    </Group>
                </Grid.Col>

                <Grid.Col span={12}>
                    {loading ? (
                        <Group position="center" style={{ minHeight: 400 }}>
                            <Loader size="lg" />
                        </Group>
                    ) : error ? (
                        <Alert icon={<IconAlertCircle size="1rem" />} title="Error!" color="red">
                            {error}
                        </Alert>
                    ) : (
                        <Grid gutter="xl" >
                            {groupedInstances.map((group, index) => {
                                let hexagons = group.instances.map((instance, i) => ({
                                    id: instance.InstanceId || `hex-${i}`,
                                    instance
                                }));

                                // Dynamic sizing logic
                                // const hexSize = Math.max(20, Math.min(50, 800 / (3 * hexagons.length + 0.5)));
                                const hexSize = 20;

                                const gridWidth = Math.max(400, hexSize * 3 * Math.ceil(Math.sqrt(hexagons.length)));
                                const gridHeight = Math.max(300, hexSize * Math.ceil(hexagons.length / 3));

                                const span = gridWidth > 600 ? 3 : 6

                                return (
                                    <Grid.Col key={index} span={span}>
                                        <Text weight={600} size="lg" align="center" mb="xs">
                                            {group.name} ({group.instances.length})
                                        </Text>
                                        <HexagonGrid
                                            gridWidth={gridWidth}
                                            gridHeight={gridHeight}
                                            hexagons={hexagons}
                                            hexSize={hexSize}
                                            hexProps={(hex) => hex.instance ? getHexProps(hex.instance) : {}}
                                            renderHexagonContent={renderHexagonContent}
                                        />
                                    </Grid.Col>
                                );
                            })}
                        </Grid>
                    )}
                </Grid.Col>
            </Grid>

            <Modal
                transitionProps={{ transition: 'scale' }}
                withCloseButton
                centered opened={opened} onClose={() => setOpened(false)}
                title={"Instance Details: " + selectedInstance?.InstanceId || ''}
                size="xl"
                overlayProps={{
                    backgroundOpacity: 0.55,
                    blur: 3,
                }}
            >
                {selectedInstance && (
                    <Stack spacing="xs">
                        <Text><strong>Instance ID:</strong> {selectedInstance?.InstanceId}</Text>
                        <Text><strong>Name:</strong> {selectedInstance?.Name || 'Unnamed'}</Text>
                        <Text><strong>AMI:</strong> {selectedInstance?.ImageId}</Text>
                        <Text><strong>Type:</strong> {selectedInstance?.InstanceType}</Text>
                        <Text><strong>State:</strong> {selectedInstance?.State?.Name}</Text>
                        <Text><strong>Launch Time:</strong> {selectedInstance?.LaunchTime}</Text>
                        <Text><strong>IAM Role:</strong> {selectedInstance?.IamInstanceProfile?.Arn}</Text>
                        <Text><strong>Key Name:</strong> {selectedInstance?.KeyName}</Text>
                        <Divider my="sm" />
                        <Text><strong>Private IP:</strong> {selectedInstance?.PrivateIpAddress}</Text>
                        <Text><strong>Public IP:</strong> {selectedInstance?.PublicIpAddress}</Text>
                        <Text><strong>Availability Zone:</strong> {selectedInstance?.Placement?.AvailabilityZone}</Text>
                        <Text><strong>VPC ID:</strong> {selectedInstance?.VpcId}</Text>
                        <Text><strong>Subnet ID:</strong> {selectedInstance?.SubnetId}</Text>
                        <Divider my="sm" />
                        <Text><strong>Tags</strong></Text>
                        {selectedInstance?.Tags.map(tag => (
                            <Badge color="blue" variant="filled" size="lg">{tag.Key}: {tag.Value}</Badge>
                        ))}
                        <Divider my="sm" />
                        <Text><strong>Security Groups</strong></Text>
                        {selectedInstance?.SecurityGroups.map(securityGroup => (
                            <Badge color="blue" variant="filled" size="lg">{securityGroup.GroupName}</Badge>
                        ))}
                    </Stack>
                )}

                {console.log(selectedInstance)}

            </Modal>
        </Paper>
    );
}

export default InstancesHexGrid;
