// Pin the proxy's supported revisions independently of future SDK upgrades.
export const DEFAULT_PROTOCOL_VERSION = '2025-11-25';
export const LEGACY_PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOL_VERSIONS = [
  DEFAULT_PROTOCOL_VERSION,
  LEGACY_PROTOCOL_VERSION,
  '2025-03-26',
  '2024-11-05',
  '2024-10-07',
];

export function isSupportedProtocolVersion(version: unknown): version is string {
  return typeof version === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}

export function selectProtocolVersion(version: unknown): string {
  return isSupportedProtocolVersion(version) ? version : DEFAULT_PROTOCOL_VERSION;
}
