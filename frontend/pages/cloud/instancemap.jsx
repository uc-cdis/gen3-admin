import React, { useState, useEffect } from "react";
import { TextInput, Loader, Alert, Text, Group, Modal, Select, Badge, Divider, Button, Switch } from "@mantine/core";
import { IconAlertCircle, IconSearch, IconRefresh } from "@tabler/icons-react";

function InstancesCostViz() {
    const [allInstances, setAllInstances] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState('');
    const [opened, setOpened] = useState(false);
    const [selectedInstance, setSelectedInstance] = useState(null);
    const [groupBy, setGroupBy] = useState('none');
    const [pricingData, setPricingData] = useState(null);

    const [showOnlyRunning, setShowOnlyRunning] = useState(true);

    const groupOptions = [
        { value: 'none', label: 'No Grouping' },
        { value: 'Environment', label: 'Environment' },
        { value: 'InstanceType', label: 'Instance Type' },
        { value: 'State.Name', label: 'State' },
        { value: 'Placement.AvailabilityZone', label: 'Availability Zone' }
    ];

    // Comprehensive EC2 Instance Type Cost Mapping for us-east-1
    // Based on Linux Shared pricing (hourly_rate * 730 hours/month)
    // Extracted from https://tedivm.github.io/ec2details/api/ec2instances.json
    const instanceCostMap = {
        // A1 instances (ARM-based)
        "a1.medium": 18.62,
        "a1.large": 37.23,
        "a1.xlarge": 74.46,
        "a1.2xlarge": 148.92,
        "a1.4xlarge": 297.84,
        "a1.metal": 297.84,

        // C1 instances (old generation)
        "c1.medium": 94.90,
        "c1.xlarge": 379.60,

        // C3 instances
        "c3.large": 76.65,
        "c3.xlarge": 153.30,
        "c3.2xlarge": 306.60,
        "c3.4xlarge": 613.20,
        "c3.8xlarge": 1226.40,

        // C4 instances
        "c4.large": 73.00,
        "c4.xlarge": 145.27,
        "c4.2xlarge": 290.54,
        "c4.4xlarge": 581.08,
        "c4.8xlarge": 1161.43,

        // C5 instances (Intel Xeon Platinum)
        "c5.large": 73.00,
        "c5.xlarge": 145.27,
        "c5.2xlarge": 290.54,
        "c5.4xlarge": 581.08,
        "c5.9xlarge": 1307.43,
        "c5.12xlarge": 1489.20,
        "c5.18xlarge": 2233.80,
        "c5.24xlarge": 2978.40,
        "c5.metal": 2978.40,

        // C5a instances (AMD EPYC)
        "c5a.large": 65.70,
        "c5a.xlarge": 131.40,
        "c5a.2xlarge": 262.80,
        "c5a.4xlarge": 525.60,
        "c5a.8xlarge": 1051.20,
        "c5a.12xlarge": 1576.80,
        "c5a.16xlarge": 2102.40,
        "c5a.24xlarge": 3153.60,

        // C5d instances (with NVMe SSD)
        "c5d.large": 84.46,
        "c5d.xlarge": 168.92,
        "c5d.2xlarge": 337.84,
        "c5d.4xlarge": 675.68,
        "c5d.9xlarge": 1520.28,
        "c5d.12xlarge": 1627.56,
        "c5d.18xlarge": 2441.34,
        "c5d.24xlarge": 3254.52,
        "c5d.metal": 3254.52,

        // C5n instances (enhanced networking)
        "c5n.large": 78.11,
        "c5n.xlarge": 156.22,
        "c5n.2xlarge": 312.44,
        "c5n.4xlarge": 624.88,
        "c5n.9xlarge": 1405.98,
        "c5n.18xlarge": 2811.96,
        "c5n.metal": 2811.96,

        // C6i instances (3rd gen Intel Xeon)
        "c6i.large": 73.00,
        "c6i.xlarge": 145.27,
        "c6i.2xlarge": 290.54,
        "c6i.4xlarge": 581.08,
        "c6i.8xlarge": 1162.16,
        "c6i.12xlarge": 1743.24,
        "c6i.16xlarge": 2324.32,
        "c6i.24xlarge": 3486.48,
        "c6i.32xlarge": 4648.64,
        "c6i.metal": 4648.64,

        // C6a instances (3rd gen AMD EPYC)
        "c6a.large": 65.70,
        "c6a.xlarge": 131.40,
        "c6a.2xlarge": 262.80,
        "c6a.4xlarge": 525.60,
        "c6a.8xlarge": 1051.20,
        "c6a.12xlarge": 1576.80,
        "c6a.16xlarge": 2102.40,
        "c6a.24xlarge": 3153.60,
        "c6a.32xlarge": 4204.80,
        "c6a.48xlarge": 6307.20,
        "c6a.metal": 6307.20,

        // C6g instances (AWS Graviton2)
        "c6g.medium": 31.03,
        "c6g.large": 62.05,
        "c6g.xlarge": 124.10,
        "c6g.2xlarge": 248.20,
        "c6g.4xlarge": 496.40,
        "c6g.8xlarge": 992.80,
        "c6g.12xlarge": 1489.20,
        "c6g.16xlarge": 1985.60,
        "c6g.metal": 1985.60,

        // C7g instances (AWS Graviton3)
        "c7g.medium": 32.85,
        "c7g.large": 65.70,
        "c7g.xlarge": 131.40,
        "c7g.2xlarge": 262.80,
        "c7g.4xlarge": 525.60,
        "c7g.8xlarge": 1051.20,
        "c7g.12xlarge": 1576.80,
        "c7g.16xlarge": 2102.40,
        "c7g.metal": 2102.40,

        // M5 instances (General Purpose)
        "m5.large": 87.60,
        "m5.xlarge": 175.20,
        "m5.2xlarge": 350.40,
        "m5.4xlarge": 700.80,
        "m5.8xlarge": 1401.60,
        "m5.12xlarge": 2102.40,
        "m5.16xlarge": 2803.20,
        "m5.24xlarge": 4204.80,
        "m5.metal": 4204.80,

        // M5a instances (AMD EPYC)
        "m5a.large": 78.84,
        "m5a.xlarge": 157.68,
        "m5a.2xlarge": 315.36,
        "m5a.4xlarge": 630.72,
        "m5a.8xlarge": 1261.44,
        "m5a.12xlarge": 1892.16,
        "m5a.16xlarge": 2522.88,
        "m5a.24xlarge": 3784.32,

        // M6i instances (3rd gen Intel Xeon)
        "m6i.large": 87.60,
        "m6i.xlarge": 175.20,
        "m6i.2xlarge": 350.40,
        "m6i.4xlarge": 700.80,
        "m6i.8xlarge": 1401.60,
        "m6i.12xlarge": 2102.40,
        "m6i.16xlarge": 2803.20,
        "m6i.24xlarge": 4204.80,
        "m6i.32xlarge": 5606.40,
        "m6i.metal": 5606.40,

        // M6g instances (AWS Graviton2)
        "m6g.medium": 35.04,
        "m6g.large": 70.08,
        "m6g.xlarge": 140.16,
        "m6g.2xlarge": 280.32,
        "m6g.4xlarge": 560.64,
        "m6g.8xlarge": 1121.28,
        "m6g.12xlarge": 1681.92,
        "m6g.16xlarge": 2242.56,
        "m6g.metal": 2242.56,

        // T2 instances (Burstable)
        "t2.nano": 4.23,
        "t2.micro": 8.47,
        "t2.small": 16.93,
        "t2.medium": 33.87,
        "t2.large": 67.74,
        "t2.xlarge": 135.48,
        "t2.2xlarge": 270.96,

        // T3 instances (Burstable)
        "t3.nano": 3.80,
        "t3.micro": 7.59,
        "t3.small": 15.18,
        "t3.medium": 30.37,
        "t3.large": 60.74,
        "t3.xlarge": 121.47,
        "t3.2xlarge": 242.94,

        // T3a instances (AMD EPYC - Burstable)
        "t3a.nano": 3.42,
        "t3a.micro": 6.84,
        "t3a.small": 13.69,
        "t3a.medium": 27.38,
        "t3a.large": 54.75,
        "t3a.xlarge": 109.50,
        "t3a.2xlarge": 219.00,

        // T4g instances (AWS Graviton2 - Burstable)
        "t4g.nano": 3.04,
        "t4g.micro": 6.09,
        "t4g.small": 12.18,
        "t4g.medium": 24.35,
        "t4g.large": 48.70,
        "t4g.xlarge": 97.40,
        "t4g.2xlarge": 194.80,

        // R5 instances (Memory Optimized)
        "r5.large": 113.88,
        "r5.xlarge": 227.76,
        "r5.2xlarge": 455.52,
        "r5.4xlarge": 911.04,
        "r5.8xlarge": 1822.08,
        "r5.12xlarge": 2733.12,
        "r5.16xlarge": 3644.16,
        "r5.24xlarge": 5466.24,
        "r5.metal": 5466.24,

        // R6i instances (3rd gen Intel Xeon - Memory Optimized)
        "r6i.large": 113.88,
        "r6i.xlarge": 227.76,
        "r6i.2xlarge": 455.52,
        "r6i.4xlarge": 911.04,
        "r6i.8xlarge": 1822.08,
        "r6i.12xlarge": 2733.12,
        "r6i.16xlarge": 3644.16,
        "r6i.24xlarge": 5466.24,
        "r6i.32xlarge": 7288.32,
        "r6i.metal": 7288.32,

        // R6g instances (AWS Graviton2 - Memory Optimized)
        "r6g.medium": 45.55,
        "r6g.large": 91.10,
        "r6g.xlarge": 182.21,
        "r6g.2xlarge": 364.42,
        "r6g.4xlarge": 728.84,
        "r6g.8xlarge": 1457.68,
        "r6g.12xlarge": 2186.52,
        "r6g.16xlarge": 2915.36,
        "r6g.metal": 2915.36,

        // X1 instances (Memory Optimized - High Memory)
        "x1.16xlarge": 4809.84,
        "x1.32xlarge": 9619.68,

        // X1e instances (Memory Optimized - Extra High Memory)
        "x1e.xlarge": 600.60,
        "x1e.2xlarge": 1201.20,
        "x1e.4xlarge": 2402.40,
        "x1e.8xlarge": 4804.80,
        "x1e.16xlarge": 9609.60,
        "x1e.32xlarge": 19219.20,


        // M8i-flex instances (Intel Xeon 5th Gen - Flexible compute)
        "m8i-flex.large": 87.60,
        "m8i-flex.xlarge": 175.20,
        "m8i-flex.2xlarge": 350.40,
        "m8i-flex.4xlarge": 700.80,
        "m8i-flex.8xlarge": 1401.60,


        // Default fallback for unknown types
        "default": 50.00
    };

    const getCost = (instanceType) => {
        if (!instanceType) return instanceCostMap["default"];

        // Try exact match first
        if (instanceCostMap[instanceType]) {
            return instanceCostMap[instanceType];
        }

        // Try to estimate based on size for unknown types
        const parts = instanceType.split('.');
        if (parts.length === 2) {
            const [family, size] = parts;

            // Try to find a similar instance in the same family
            const familyPrefix = family.substring(0, 2); // e.g., "c5" from "c5d"
            const similarKey = `${familyPrefix}.${size}`;

            if (instanceCostMap[similarKey]) {
                return instanceCostMap[similarKey];
            }
        }

        // Fallback to default
        return instanceCostMap["default"];
    };

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
                                const actualCost = getCost(instance.InstanceType);

                                return {
                                    ...instance,
                                    Environment: envTag?.Value || 'No Environment',
                                    Name: nameTag?.Value || 'Unnamed',
                                    ReservationId: reservation.ReservationId,
                                    OwnerId: reservation.OwnerId,
                                    Cost: actualCost,
                                    // Add flag to show if using estimated vs actual pricing
                                    HasExactPricing: instanceCostMap[instance.InstanceType] !== undefined
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
            totalCost: groupInstances.reduce((sum, inst) => sum + inst.Cost, 0)
        }));
    };

    const filteredInstances = allInstances.filter(instance => {

        // Filter by running state if toggle is on
        if (showOnlyRunning && instance.State?.Name !== 'running') {
            return false;
        }
        if (!filter) return true;
        const nameTag = instance.Tags?.find(tag => tag.Key === 'Name')?.Value || '';
        return nameTag.toLowerCase().includes(filter.toLowerCase()) ||
            instance.InstanceId.toLowerCase().includes(filter.toLowerCase()) ||
            instance.InstanceType.toLowerCase().includes(filter.toLowerCase());
    });

    const groupedInstances = prepareGroupedInstances(filteredInstances);
    const totalCost = filteredInstances.reduce((sum, inst) => sum + inst.Cost, 0);
    const runnningCost = filteredInstances
        .filter(inst => inst.State?.Name === 'running')
        .reduce((sum, inst) => sum + inst.Cost, 0);

    const getStateColor = (state) => {
        const colors = {
            'running': '#10b981',
            'stopped': '#ef4444',
            'pending': '#f59e0b',
            'stopping': '#f59e0b',
            'terminated': '#6b7280'
        };
        return colors[state] || '#6b7280';
    };

    return (
        <div style={{
            padding: '2rem',
            // background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            minHeight: '100vh'
        }}>
            <style>{`
                
                @keyframes slideIn {
                    from {
                        opacity: 0;
                        transform: translateY(20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                
                .instance-card {
                    background: rgba(30, 41, 59, 0.4);
                    border: 1px solid rgba(148, 163, 184, 0.15);
                    border-radius: 12px;
                    padding: 1.25rem;
                    cursor: pointer;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    backdrop-filter: blur(10px);
                    position: relative;
                    overflow: hidden;
                    animation: slideIn 0.4s ease-out;
                }
                
                .instance-card::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    height: 3px;
                    background: var(--state-color);
                    opacity: 0.8;
                    transition: opacity 0.3s;
                }
                
                .instance-card:hover {
                    transform: translateY(-4px);
                    border-color: rgba(148, 163, 184, 0.3);
                    background: rgba(30, 41, 59, 0.6);
                }
                
                .instance-card:hover::before {
                    opacity: 1;
                }
                
                .instance-card.running:hover {
                    box-shadow: 0 0 20px rgba(16, 185, 129, 0.2);
                }
                
                .cost-badge {
                    font-family: 'Space Mono', monospace;
                    font-weight: 700;
                    font-size: 1.25rem;
                    color: #fbbf24;
                    text-shadow: 0 0 8px rgba(251, 191, 36, 0.3);
                }
                
                .instance-name {
                    font-family: 'Outfit', sans-serif;
                    font-weight: 600;
                    color: #e2e8f0;
                    font-size: 1.1rem;
                    margin-bottom: 0.5rem;
                }
                
                .instance-type {
                    font-family: 'Space Mono', monospace;
                    color: #94a3b8;
                    font-size: 0.9rem;
                }
                
                .state-indicator {
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    background: var(--state-color);
                    display: inline-block;
                    margin-right: 8px;
                    box-shadow: 0 0 10px var(--state-color);
                }
                
                .group-header {
                    font-family: 'Outfit', sans-serif;
                    font-weight: 700;
                    font-size: 2rem;
                    color: #f1f5f9;
                    margin-bottom: 1.5rem;
                    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
                }
                
                .total-cost-banner {
                    background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
                    padding: 1.5rem 2rem;
                    border-radius: 16px;
                    margin-bottom: 2rem;
                    box-shadow: 0 10px 40px rgba(251, 191, 36, 0.2);
                }
                
                .grid-container {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                    gap: 1rem;
                    margin-bottom: 3rem;
                }
                
                .estimated-badge {
                    font-size: 0.7rem;
                    padding: 2px 6px;
                    background: rgba(251, 191, 36, 0.2);
                    color: #fbbf24;
                    border-radius: 4px;
                    font-family: 'Space Mono', monospace;
                }
            `}</style>

            <div style={{ maxWidth: '1600px', margin: '0 auto' }}>
                <div style={{ marginBottom: '2rem' }}>
                    <Text style={{
                        fontFamily: 'Outfit, sans-serif',
                        fontSize: '3rem',
                        fontWeight: 700,
                        color: '#f1f5f9',
                        marginBottom: '0.5rem',
                        textShadow: '0 2px 20px rgba(0, 0, 0, 0.5)'
                    }}>
                        AWS EC2 Cost Dashboard
                    </Text>
                    <Text style={{
                        fontFamily: 'Space Mono, monospace',
                        fontSize: '0.9rem',
                        color: '#94a3b8',
                        marginBottom: '2rem'
                    }}>
                        Real-time pricing data for us-east-1 region • Updated from ec2details.json
                    </Text>

                    <Group style={{ marginBottom: '1.5rem' }}>
                        <TextInput
                            placeholder="Search instances..."
                            value={filter}
                            onChange={(event) => setFilter(event.currentTarget.value)}
                            icon={<IconSearch size="1rem" />}
                            style={{ flex: 1 }}
                            styles={{
                                input: {
                                    background: 'rgba(30, 41, 59, 0.6)',
                                    border: '1px solid rgba(148, 163, 184, 0.2)',
                                    color: '#e2e8f0',
                                    backdropFilter: 'blur(10px)'
                                }
                            }}
                        />
                        <Select
                            placeholder="Group by..."
                            value={groupBy}
                            onChange={(value) => setGroupBy(value)}
                            data={groupOptions}
                            style={{ width: 250 }}
                            styles={{
                                input: {
                                    background: 'rgba(30, 41, 59, 0.6)',
                                    border: '1px solid rgba(148, 163, 184, 0.2)',
                                    color: '#e2e8f0',
                                    backdropFilter: 'blur(10px)'
                                }
                            }}
                        />
                        <Switch
                            label="Running only"
                            checked={showOnlyRunning}
                            onChange={(event) => setShowOnlyRunning(event.currentTarget.checked)}
                            styles={{
                                label: {
                                    color: '#e2e8f0',
                                    fontFamily: 'Outfit, sans-serif'
                                }
                            }}
                        />
                    </Group>

                    <div className="total-cost-banner">
                        <Group position="apart" align="center">
                            <div>
                                <Text style={{
                                    fontFamily: 'Outfit, sans-serif',
                                    fontSize: '0.9rem',
                                    color: '#78350f',
                                    fontWeight: 600,
                                    textTransform: 'uppercase',
                                    letterSpacing: '1px'
                                }}>
                                    Running Monthly Cost
                                </Text>
                                <Text style={{
                                    fontFamily: 'Space Mono, monospace',
                                    fontSize: '2.5rem',
                                    fontWeight: 700,
                                    color: '#1f2937',
                                    lineHeight: 1.2
                                }}>
                                    ${runnningCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo
                                </Text>
                                <Text style={{
                                    fontFamily: 'Outfit, sans-serif',
                                    fontSize: '0.85rem',
                                    color: '#78350f',
                                    marginTop: '0.5rem'
                                }}>
                                    Total if all running: ${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo
                                </Text>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <Text style={{
                                    fontFamily: 'Outfit, sans-serif',
                                    fontSize: '0.9rem',
                                    color: '#78350f',
                                    fontWeight: 600
                                }}>
                                    {filteredInstances.filter(i => i.State?.Name === 'running').length} of {filteredInstances.length} running
                                </Text>
                                <Text style={{
                                    fontFamily: 'Space Mono, monospace',
                                    fontSize: '0.75rem',
                                    color: '#78350f',
                                    marginTop: '0.25rem'
                                }}>
                                    {filteredInstances.length - filteredInstances.filter(i => i.State?.Name === 'running').length} stopped
                                </Text>
                            </div>
                        </Group>
                    </div>
                </div>

                {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
                        <Loader size="xl" color="yellow" />
                    </div>
                ) : error ? (
                    <Alert icon={<IconAlertCircle size="1rem" />} title="Error!" color="red">
                        {error}
                    </Alert>
                ) : (
                    <div>
                        {groupedInstances.map((group, groupIndex) => (
                            <div key={groupIndex} style={{ marginBottom: '3rem', animationDelay: `${groupIndex * 0.1}s` }}>
                                <div style={{ marginBottom: '1.5rem' }}>
                                    <Text className="group-header">
                                        {group.name}
                                    </Text>
                                    <Text style={{
                                        fontFamily: 'Space Mono, monospace',
                                        color: '#fbbf24',
                                        fontSize: '1.2rem',
                                        fontWeight: 700
                                    }}>
                                        ${group.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo · {group.instances.length} instances
                                    </Text>
                                </div>

                                <div className="grid-container">
                                    {group.instances.map((instance, idx) => {
                                        const stateColor = getStateColor(instance.State?.Name);

                                        return (
                                            <div
                                                key={instance.InstanceId}
                                                className={`instance-card ${instance.State?.Name}`}
                                                style={{
                                                    '--state-color': stateColor,
                                                    animationDelay: `${idx * 0.05}s`
                                                }}
                                                onClick={() => {
                                                    setSelectedInstance(instance);
                                                    setOpened(true);
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                                                    <span className="state-indicator" style={{ background: stateColor, boxShadow: `0 0 10px ${stateColor}` }}></span>
                                                    <Text className="instance-name" style={{ marginBottom: 0, flex: 1 }}>
                                                        {instance.Name}
                                                    </Text>
                                                    {!instance.HasExactPricing && (
                                                        <span className="estimated-badge" title="Estimated pricing">~</span>
                                                    )}
                                                </div>

                                                <Text className="instance-type" style={{ marginBottom: '1rem' }}>
                                                    {instance.InstanceType}
                                                </Text>

                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                    <Text className="cost-badge">
                                                        ${instance.Cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </Text>
                                                    <Text style={{
                                                        fontFamily: 'Space Mono, monospace',
                                                        fontSize: '0.75rem',
                                                        color: '#64748b'
                                                    }}>
                                                        /mo
                                                    </Text>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <Modal
                opened={opened}
                onClose={() => setOpened(false)}
                title={<Text style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: '1.5rem' }}>Instance Details</Text>}
                size="xl"
                styles={{
                    modal: {
                        background: '#1e293b',
                        color: '#e2e8f0'
                    },
                    header: {
                        background: '#1e293b',
                        borderBottom: '1px solid rgba(148, 163, 184, 0.2)'
                    },
                    title: {
                        color: '#e2e8f0'
                    }
                }}
            >
                {selectedInstance && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div>
                            <Text style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.25rem' }}>Instance ID</Text>
                            <Text style={{ fontFamily: 'Space Mono, monospace', fontSize: '1rem' }}>{selectedInstance.InstanceId}</Text>
                        </div>
                        <div>
                            <Text style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.25rem' }}>Name</Text>
                            <Text style={{ fontSize: '1rem', fontWeight: 600 }}>{selectedInstance.Name}</Text>
                        </div>
                        <Group>
                            <div>
                                <Text style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.25rem' }}>Type</Text>
                                <Text style={{ fontFamily: 'Space Mono, monospace' }}>{selectedInstance.InstanceType}</Text>
                            </div>
                            <div>
                                <Text style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.25rem' }}>State</Text>
                                <Badge color={selectedInstance.State?.Name === 'running' ? 'green' : 'red'}>
                                    {selectedInstance.State?.Name}
                                </Badge>
                            </div>
                            <div>
                                <Text style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.25rem' }}>Monthly Cost</Text>
                                <Group spacing="xs">
                                    <Text style={{ fontFamily: 'Space Mono, monospace', color: '#fbbf24', fontWeight: 700 }}>
                                        ${selectedInstance.Cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo
                                    </Text>
                                    {!selectedInstance.HasExactPricing && (
                                        <Badge size="xs" color="yellow" variant="outline">Estimated</Badge>
                                    )}
                                </Group>
                            </div>
                        </Group>
                        <Divider />
                        <Group>
                            <div>
                                <Text style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.25rem' }}>Private IP</Text>
                                <Text style={{ fontFamily: 'Space Mono, monospace', fontSize: '0.9rem' }}>
                                    {selectedInstance.PrivateIpAddress || 'N/A'}
                                </Text>
                            </div>
                            <div>
                                <Text style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.25rem' }}>Public IP</Text>
                                <Text style={{ fontFamily: 'Space Mono, monospace', fontSize: '0.9rem' }}>
                                    {selectedInstance.PublicIpAddress || 'N/A'}
                                </Text>
                            </div>
                        </Group>
                        <div>
                            <Text style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.25rem' }}>Availability Zone</Text>
                            <Text>{selectedInstance.Placement?.AvailabilityZone}</Text>
                        </div>
                        <Divider />
                        <div>
                            <Text style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.5rem' }}>Tags</Text>
                            <Group spacing="xs">
                                {selectedInstance.Tags?.map((tag, idx) => (
                                    <Badge key={idx} variant="outline" style={{ borderColor: '#475569', color: '#e2e8f0' }}>
                                        {tag.Key}: {tag.Value}
                                    </Badge>
                                ))}
                            </Group>
                        </div>
                        <Divider />
                        <div style={{
                            background: 'rgba(251, 191, 36, 0.1)',
                            padding: '1rem',
                            borderRadius: '8px',
                            border: '1px solid rgba(251, 191, 36, 0.2)'
                        }}>
                            <Text style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.5rem' }}>💡 Cost Breakdown</Text>
                            <Text style={{ fontFamily: 'Space Mono, monospace', fontSize: '0.85rem', color: '#e2e8f0' }}>
                                Hourly: ${(selectedInstance.Cost / 730).toFixed(4)}<br />
                                Daily: ${(selectedInstance.Cost / 30).toFixed(2)}<br />
                                Monthly: ${selectedInstance.Cost.toFixed(2)}<br />
                                Yearly: ${(selectedInstance.Cost * 12).toFixed(2)}
                            </Text>
                            {!selectedInstance.HasExactPricing && (
                                <Text style={{ fontSize: '0.75rem', color: '#fbbf24', marginTop: '0.5rem' }}>
                                    ⚠️ This is an estimated cost based on similar instance types
                                </Text>
                            )}
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}

export default InstancesCostViz;