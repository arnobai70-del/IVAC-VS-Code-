function requireNonNegativeInteger(
  value,
  name,
) {
  if (
    !Number.isInteger(value)
    || value < 0
  ) {
    throw new TypeError(
      `${name} must be a non-negative integer.`,
    );
  }

  return value;
}

export function calculateEffectiveCapacity({
  configuredConcurrency,
  jobsPerCycle,
  healthyAvailableIpCount,
  liveAllocationCount,
}) {
  if (
    !Number.isInteger(configuredConcurrency)
    || configuredConcurrency < 1
  ) {
    throw new TypeError(
      'configuredConcurrency must be a positive integer.',
    );
  }

  if (
    !Number.isInteger(jobsPerCycle)
    || jobsPerCycle < 1
  ) {
    throw new TypeError(
      'jobsPerCycle must be a positive integer.',
    );
  }

  requireNonNegativeInteger(
    healthyAvailableIpCount,
    'healthyAvailableIpCount',
  );

  requireNonNegativeInteger(
    liveAllocationCount,
    'liveAllocationCount',
  );

  const concurrencyHeadroom =
    Math.max(
      0,
      configuredConcurrency
      - liveAllocationCount,
    );

  return Math.min(
    concurrencyHeadroom,
    jobsPerCycle,
    healthyAvailableIpCount,
  );
}