import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateEffectiveCapacity,
} from '../src/portal/capacity.js';

test('capacity is limited by healthy available IP count', () => {
  const capacity =
    calculateEffectiveCapacity({
      configuredConcurrency: 10,
      jobsPerCycle: 10,
      healthyAvailableIpCount: 3,
      liveAllocationCount: 0,
    });

  assert.equal(capacity, 3);
});

test('capacity subtracts existing live allocations', () => {
  const capacity =
    calculateEffectiveCapacity({
      configuredConcurrency: 5,
      jobsPerCycle: 10,
      healthyAvailableIpCount: 10,
      liveAllocationCount: 4,
    });

  assert.equal(capacity, 1);
});

test('capacity respects jobs-per-cycle limit', () => {
  const capacity =
    calculateEffectiveCapacity({
      configuredConcurrency: 10,
      jobsPerCycle: 2,
      healthyAvailableIpCount: 10,
      liveAllocationCount: 0,
    });

  assert.equal(capacity, 2);
});