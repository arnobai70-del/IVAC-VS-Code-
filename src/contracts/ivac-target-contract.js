const DEFAULT_CONTRACT_STATUS =
  'UNVERIFIED';

const CONTRACT_VERSION =
  1;

function freezeContract(
  contract,
) {
  Object.freeze(
    contract.endpoints,
  );

  return Object.freeze(
    contract,
  );
}

function cloneEndpoints(
  endpoints,
) {
  if (
    !Array.isArray(
      endpoints,
    )
  ) {
    return [];
  }

  return endpoints.map(
    (endpoint) => ({
      name:
        endpoint.name,

      method:
        endpoint.method,

      path:
        endpoint.path,

      verified:
        endpoint.verified === true,
    }),
  );
}

function validateEndpoint(
  endpoint,
) {
  if (
    !endpoint
    || typeof endpoint
      !== 'object'
  ) {
    throw new TypeError(
      'Endpoint must be an object.',
    );
  }

  if (
    typeof endpoint.name
      !== 'string'
    || endpoint.name.trim() === ''
  ) {
    throw new TypeError(
      'Endpoint name must be a non-empty string.',
    );
  }

  if (
    typeof endpoint.method
      !== 'string'
    || endpoint.method.trim() === ''
  ) {
    throw new TypeError(
      'Endpoint method must be a non-empty string.',
    );
  }

  if (
    typeof endpoint.path
      !== 'string'
    || endpoint.path.trim() === ''
  ) {
    throw new TypeError(
      'Endpoint path must be a non-empty string.',
    );
  }

  if (
    !endpoint.path.startsWith(
      '/',
    )
  ) {
    throw new TypeError(
      'Endpoint path must be relative.',
    );
  }

  return {
    name:
      endpoint.name.trim(),

    method:
      endpoint.method
        .trim()
        .toUpperCase(),

    path:
      endpoint.path.trim(),

    verified:
      endpoint.verified === true,
  };
}

export function createUnverifiedIvacTargetContract() {
  return freezeContract({
    version:
      CONTRACT_VERSION,

    status:
      DEFAULT_CONTRACT_STATUS,

    verified:
      false,

    endpoints:
      [],
  });
}

export function createIvacTargetContract({
  endpoints = [],
  verified = false,
} = {}) {
  const normalizedEndpoints =
    endpoints.map(
      validateEndpoint,
    );

  return freezeContract({
    version:
      CONTRACT_VERSION,

    status:
      verified === true
        ? 'VERIFIED'
        : DEFAULT_CONTRACT_STATUS,

    verified:
      verified === true,

    endpoints:
      Object.freeze(
        normalizedEndpoints,
      ),
  });
}

export function validateIvacTargetContract(
  contract,
) {
  if (
    !contract
    || typeof contract
      !== 'object'
  ) {
    throw new TypeError(
      'IVAC target contract must be an object.',
    );
  }

  if (
    contract.version
      !== CONTRACT_VERSION
  ) {
    throw new Error(
      'Unsupported IVAC target contract version.',
    );
  }

  if (
    contract.verified !== true
  ) {
    return false;
  }

  if (
    !Array.isArray(
      contract.endpoints,
    )
  ) {
    throw new Error(
      'Verified IVAC target contract requires endpoint definitions.',
    );
  }

  for (
    const endpoint
    of contract.endpoints
  ) {
    validateEndpoint(
      endpoint,
    );
  }

  return true;
}

export function getIvacTargetContractSummary(
  contract,
) {
  return {
    version:
      contract.version,

    status:
      contract.status,

    verified:
      contract.verified === true,

    endpointCount:
      Array.isArray(
        contract.endpoints,
      )
        ? contract.endpoints.length
        : 0,

    endpoints:
      cloneEndpoints(
        contract.endpoints,
      ),
  };
}