const DEFAULT_CONTRACT_STATUS =
  'UNVERIFIED';

const VERIFIED_CONTRACT_STATUS =
  'VERIFIED';

const CONTRACT_VERSION =
  1;

const supportedMethods =
  new Set([
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'HEAD',
  ]);


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

  const method =
    endpoint.method
      .trim()
      .toUpperCase();

  if (
    !supportedMethods.has(
      method,
    )
  ) {
    throw new TypeError(
      `Unsupported endpoint method: ${method}`,
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

  const path =
    endpoint.path.trim();

  if (
    !path.startsWith(
      '/',
    )
    || path.startsWith(
      '//',
    )
    || path.includes(
      '://',
    )
    || path.includes(
      '\\',
    )
  ) {
    throw new TypeError(
      'Endpoint path must remain relative to the configured IVAC target API.',
    );
  }

  return {
    name:
      endpoint.name.trim(),

    method,

    path,

    verified:
      endpoint.verified === true,
  };
}


function validateVerifiedEndpoints(
  endpoints,
) {
  if (
    !Array.isArray(
      endpoints,
    )
    || endpoints.length === 0
  ) {
    throw new Error(
      'Verified IVAC target contract requires at least one endpoint definition.',
    );
  }

  const seenRoutes =
    new Set();

  for (
    const endpoint
    of endpoints
  ) {
    const normalized =
      validateEndpoint(
        endpoint,
      );

    if (
      normalized.verified
      !== true
    ) {
      throw new Error(
        'Verified IVAC target contract cannot contain an unverified endpoint.',
      );
    }

    const routeKey =
      `${normalized.method} ${normalized.path}`;

    if (
      seenRoutes.has(
        routeKey,
      )
    ) {
      throw new Error(
        `Duplicate IVAC target contract route: ${routeKey}`,
      );
    }

    seenRoutes.add(
      routeKey,
    );
  }
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
  if (
    !Array.isArray(
      endpoints,
    )
  ) {
    throw new TypeError(
      'IVAC target contract endpoints must be an array.',
    );
  }

  const normalizedEndpoints =
    endpoints.map(
      validateEndpoint,
    );

  if (
    verified === true
  ) {
    validateVerifiedEndpoints(
      normalizedEndpoints,
    );
  }

  return freezeContract({
    version:
      CONTRACT_VERSION,

    status:
      verified === true
        ? VERIFIED_CONTRACT_STATUS
        : DEFAULT_CONTRACT_STATUS,

    verified:
      verified === true,

    endpoints:
      normalizedEndpoints,
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
    contract.status
      !== VERIFIED_CONTRACT_STATUS
  ) {
    throw new Error(
      'Verified IVAC target contract must declare VERIFIED status.',
    );
  }

  validateVerifiedEndpoints(
    contract.endpoints,
  );

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