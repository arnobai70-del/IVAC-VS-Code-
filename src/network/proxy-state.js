export const PROXY_STATES = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  RESERVED: 'RESERVED',
  ACTIVE: 'ACTIVE',
  RETRY_RESERVED: 'RETRY_RESERVED',
  COOLDOWN: 'COOLDOWN',
  DISABLED: 'DISABLED',
  RELEASING: 'RELEASING',
});

export const ALLOCATION_STATES = Object.freeze({
  RESERVED: 'RESERVED',
  ACTIVE: 'ACTIVE',
  RETRY_RESERVED: 'RETRY_RESERVED',
  RELEASING: 'RELEASING',
  RELEASED: 'RELEASED',
});

export const RELEASE_REASONS = Object.freeze({
  JOB_COMPLETED: 'JOB_COMPLETED',
  JOB_CANCELLED: 'JOB_CANCELLED',
  JOB_EXPIRED: 'JOB_EXPIRED',
  FAILED_FINAL: 'FAILED_FINAL',
  ADMIN_RELEASE: 'ADMIN_RELEASE',
});

const ownedProxyStates = new Set([
  PROXY_STATES.RESERVED,
  PROXY_STATES.ACTIVE,
  PROXY_STATES.RETRY_RESERVED,
  PROXY_STATES.RELEASING,
]);

const liveAllocationStates = new Set([
  ALLOCATION_STATES.RESERVED,
  ALLOCATION_STATES.ACTIVE,
  ALLOCATION_STATES.RETRY_RESERVED,
  ALLOCATION_STATES.RELEASING,
]);

const releaseReasons = new Set(
  Object.values(RELEASE_REASONS),
);

export function isOwnedProxyState(state) {
  return ownedProxyStates.has(state);
}

export function isLiveAllocationState(state) {
  return liveAllocationStates.has(state);
}

export function isValidReleaseReason(reason) {
  return releaseReasons.has(reason);
}