import { parseCpuToMillicores, parseMemoryToMiB, summarizeUsage } from './DataTable';

/**
 * Kubernetes reports CPU in nanocores or millicores and memory in binary
 * suffixes, and PodMetrics splits both per container. The previous code read
 * a top-level `metric.usage` that pods do not have, so every pod row silently
 * lost its metrics.
 */
describe('parseCpuToMillicores', () => {
  it('converts the units the API actually emits', () => {
    expect(parseCpuToMillicores('123456789n')).toBeCloseTo(123.456789);
    expect(parseCpuToMillicores('15m')).toBe(15);
    expect(parseCpuToMillicores('2')).toBe(2000);
    expect(parseCpuToMillicores('500u')).toBe(0.5);
  });

  it('treats missing usage as zero rather than NaN', () => {
    expect(parseCpuToMillicores(undefined)).toBe(0);
    expect(parseCpuToMillicores('')).toBe(0);
  });
});

describe('parseMemoryToMiB', () => {
  it('converts binary suffixes', () => {
    expect(parseMemoryToMiB('1024Ki')).toBe(1);
    expect(parseMemoryToMiB('512Mi')).toBe(512);
    expect(parseMemoryToMiB('2Gi')).toBe(2048);
  });

  it('treats a bare number as bytes', () => {
    expect(parseMemoryToMiB(String(1024 * 1024))).toBe(1);
  });

  it('treats missing usage as zero', () => {
    expect(parseMemoryToMiB(undefined)).toBe(0);
  });
});

describe('summarizeUsage', () => {
  // The case the old code got wrong.
  it('sums across containers for a pod', () => {
    const podMetric = {
      containers: [
        { usage: { cpu: '10m', memory: '100Mi' } },
        { usage: { cpu: '5m', memory: '156Mi' } },
      ],
    };
    expect(summarizeUsage(podMetric)).toEqual({ cpu: '15m', memory: '256Mi' });
  });

  // NodeMetrics does put usage at the top level.
  it('reads top-level usage when there are no containers', () => {
    expect(summarizeUsage({ usage: { cpu: '250m', memory: '1Gi' } })).toEqual({
      cpu: '250m',
      memory: '1.0Gi',
    });
  });

  it('switches to cores once past a full core', () => {
    expect(summarizeUsage({ usage: { cpu: '2500m', memory: '10Mi' } }).cpu).toBe('2.50');
  });

  it('does not throw on a metric with no usage at all', () => {
    expect(() => summarizeUsage({})).not.toThrow();
    expect(summarizeUsage({})).toEqual({ cpu: '0m', memory: '0Mi' });
  });
});
