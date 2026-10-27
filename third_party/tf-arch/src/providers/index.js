import awsProvider from './aws/index.js';
import gcpProvider from './gcp/index.js';
import azureProvider from './azure/index.js';

/**
 * Registry of supported cloud providers, keyed by provider id.
 * Adding a provider means adding one entry here — nothing else in the app
 * needs to know which clouds exist.
 */
export const PROVIDERS = {
  aws: awsProvider,
  gcp: gcpProvider,
  azure: azureProvider
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

/** Fallback used when a resource type belongs to no known provider. */
export const UNKNOWN_PROVIDER = {
  id: 'unknown',
  name: 'Unknown Provider',
  shortName: 'Other',
  accentColor: '#64748b',
  typePrefixes: [],
  categories: { general: { name: 'General', color: '#64748b', bgColor: 'rgba(100, 116, 139, 0.15)' } },
  icons: {
    generic: {
      category: 'general',
      name: 'Terraform Resource',
      svg: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="64" height="64" rx="8" fill="#334155"/>
        <path d="M22 20L32 26V38L22 32V20Z" fill="#7B42BC"/>
        <path d="M34 26L44 20V32L34 38V26Z" fill="#7B42BC" fill-opacity="0.7"/>
      </svg>`
    }
  },
  resourceMap: {},
  genericIconKey: 'generic',
  terms: { network: 'Network', subnet: 'Subnet', zone: 'Zone', region: 'Region', tags: 'Tags', group: 'Group' },
  hierarchy: {
    networkTypes: [], subnetTypes: [], networkRefKeys: [], subnetRefKeys: [],
    zoneKeys: [], regionKeys: [], cidrKeys: [], tagKeys: ['tags'], groupKeys: [],
    publicSubnetHints: [], isPublicSubnet: () => false
  },
  inferEdges() {},
  isEntryResource: () => false
};

/**
 * Resolves the provider that owns a Terraform resource type
 * (e.g. `aws_instance` → aws, `google_compute_instance` → gcp).
 */
export function getProviderForType(resourceType) {
  if (typeof resourceType === 'string') {
    for (const provider of Object.values(PROVIDERS)) {
      if (provider.typePrefixes.some(prefix => resourceType.startsWith(prefix))) {
        return provider;
      }
    }
  }
  return UNKNOWN_PROVIDER;
}

/** Resolves a provider by its id, falling back to the unknown provider. */
export function getProvider(providerId) {
  return PROVIDERS[providerId] || UNKNOWN_PROVIDER;
}

/**
 * Resolves a resource type to an icon key: an exact `resourceMap` entry first,
 * then the longest `servicePrefixes` token that equals the type or prefixes it
 * at a `_` boundary (`aws_glue` covers `aws_glue_job`, not `aws_gluex`), then
 * the provider's generic icon.
 */
export function resolveIconKey(provider, resourceType) {
  const exact = provider.resourceMap[resourceType];
  if (exact) return exact;
  let best = '';
  for (const token of Object.keys(provider.servicePrefixes || {})) {
    if (token.length > best.length &&
        (resourceType === token || resourceType.startsWith(`${token}_`))) {
      best = token;
    }
  }
  return best ? provider.servicePrefixes[best] : provider.genericIconKey;
}

/**
 * Returns icon + category metadata for a Terraform resource type,
 * resolved through the owning provider's icon set.
 */
export function getIconForType(resourceType) {
  const provider = getProviderForType(resourceType);
  const iconKey = resolveIconKey(provider, resourceType);
  const iconDef = provider.icons[iconKey] || provider.icons[provider.genericIconKey];
  const categoryDef = provider.categories[iconDef.category] || provider.categories.general;

  return {
    key: `${provider.id}:${iconKey}`,
    name: iconDef.name,
    providerId: provider.id,
    providerName: provider.shortName,
    categoryKey: iconDef.category,
    categoryName: categoryDef.name,
    categoryColor: categoryDef.color,
    categoryBgColor: categoryDef.bgColor,
    backdrop: provider.iconBackdrop || null,
    svg: iconDef.svg
  };
}

/**
 * Merges the category definitions of the given providers into one map for
 * the sidebar filter. Category keys are shared across providers (compute,
 * networking, …) so a multi-cloud plan filters consistently; the display
 * name of the first provider that defines a key wins.
 */
export function getMergedCategories(providerIds = PROVIDER_IDS) {
  const merged = {};
  providerIds.forEach(id => {
    const provider = getProvider(id);
    Object.entries(provider.categories).forEach(([key, def]) => {
      if (!merged[key]) merged[key] = { ...def };
    });
  });
  return merged;
}

/**
 * Reads a possibly-nested attribute from a Terraform values object using a
 * dotted path with numeric segments for list indexes
 * (e.g. `network_interface.0.subnetwork`).
 */
export function readAttr(values, path) {
  if (!values || !path) return undefined;
  let current = values;
  for (const segment of String(path).split('.')) {
    if (current === null || current === undefined) return undefined;
    current = Array.isArray(current) ? current[Number(segment)] : current[segment];
  }
  return current;
}

/** Returns the first defined value among a list of dotted attribute paths. */
export function readFirstAttr(valueSets, paths = []) {
  const sets = Array.isArray(valueSets) ? valueSets : [valueSets];
  for (const path of paths) {
    for (const values of sets) {
      const value = readAttr(values, path);
      if (value !== undefined && value !== null && value !== '') return value;
    }
  }
  return undefined;
}
