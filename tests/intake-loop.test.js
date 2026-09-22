import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IntakeLoop,
} from '../src/runtime/intake-loop.js';

function createDeferred() {
  let resolve;
  let reject;

  const promise =
    new Promise(
      (
        resolvePromise,
        rejectPromise,
      ) => {
        resolve =
          resolvePromise;

        reject =
          rejectPromise;
      },
    );

  return {
    promise,
    resolve,
    reject,
  };
}

async function waitFor(
  predicate,
  {
    timeoutMs = 1000,
    intervalMs = 5,
  } = {},
) {
  const startedAt =
    Date.now();

  while (
    !predicate()
  ) {
    if (
      Date.now()
      - startedAt
      >= timeoutMs
    ) {
      throw new Error(
        'Timed out waiting for condition.',
      );
    }

    await new Promise(
      (resolveDelay) => {
        setTimeout(
          resolveDelay,
          intervalMs,
        );
      },
    );
  }
}

test(
  'IntakeLoop never overlaps cycles and graceful stop waits for an active cycle',
  async () => {
    const cycleStarted =
      createDeferred();

    const releaseCycle =
      createDeferred();

    let calls =
      0;

    let activeCycles =
      0;

    let maximumActiveCycles =
      0;

    const portalIntakeService = {
      async runCycle() {
        calls +=
          1;

        activeCycles +=
          1;

        maximumActiveCycles =
          Math.max(
            maximumActiveCycles,
            activeCycles,
          );

        cycleStarted.resolve();

        await releaseCycle.promise;

        activeCycles -=
          1;

        return {
          consumed:
            1,

          created:
            1,

          duplicates:
            0,

          effectiveCapacity:
            1,

          blocker:
            null,

          jobs: [
            {
              jobId:
                'job-1',
            },
          ],
        };
      },
    };

    const loop =
      new IntakeLoop({
        portalIntakeService,

        pollIntervalMs:
          60_000,
      });

    assert.equal(
      loop.start(),
      true,
    );

    assert.equal(
      loop.start(),
      false,
    );

    await cycleStarted.promise;

    let stopSettled =
      false;

    const stopPromise =
      loop.stop()
        .then(
          (result) => {
            stopSettled =
              true;

            return result;
          },
        );

    await new Promise(
      (resolveDelay) => {
        setTimeout(
          resolveDelay,
          20,
        );
      },
    );

    assert.equal(
      stopSettled,
      false,
    );

    assert.equal(
      calls,
      1,
    );

    assert.equal(
      maximumActiveCycles,
      1,
    );

    releaseCycle.resolve();

    const stopResult =
      await stopPromise;

    assert.deepEqual(
      stopResult,
      {
        stopped:
          true,

        reason:
          'STOP_REQUESTED',

        completedCycles:
          1,

        failed:
          false,
      },
    );

    assert.equal(
      calls,
      1,
    );

    assert.equal(
      maximumActiveCycles,
      1,
    );

    assert.deepEqual(
      loop.getStatus(),
      {
        started:
          true,

        running:
          false,

        stopRequested:
          true,

        completedCycles:
          1,

        failed:
          false,

        failure:
          null,

        lastCycle: {
          consumed:
            1,

          created:
            1,

          duplicates:
            0,

          effectiveCapacity:
            1,

          blocker:
            null,

          jobCount:
            1,
        },
      },
    );
  },
);

test(
  'IntakeLoop stop wakes an idle polling delay without starting another cycle',
  async () => {
    let calls =
      0;

    const portalIntakeService = {
      async runCycle() {
        calls +=
          1;

        return {
          consumed:
            0,

          created:
            0,

          duplicates:
            0,

          effectiveCapacity:
            0,

          blocker:
            'NO_EXECUTION_IP',

          jobs: [],
        };
      },
    };

    const loop =
      new IntakeLoop({
        portalIntakeService,

        pollIntervalMs:
          60_000,
      });

    loop.start();

    await waitFor(
      () => (
        loop
          .getStatus()
          .completedCycles
        === 1
      ),
    );

    const stopTimeout =
      new Promise(
        (
          _resolve,
          reject,
        ) => {
          setTimeout(
            () => {
              reject(
                new Error(
                  'IntakeLoop.stop() did not wake the polling delay.',
                ),
              );
            },
            500,
          );
        },
      );

    const stopResult =
      await Promise.race([
        loop.stop(),
        stopTimeout,
      ]);

    assert.equal(
      stopResult.stopped,
      true,
    );

    assert.equal(
      stopResult.failed,
      false,
    );

    assert.equal(
      calls,
      1,
    );

    assert.equal(
      loop
        .getStatus()
        .running,
      false,
    );
  },
);

test(
  'IntakeLoop does not blindly retry a failed destructive intake cycle',
  async () => {
    let calls =
      0;

    const errorLogged =
      createDeferred();

    const intakeError =
      new Error(
        'remote outcome intentionally unknown',
      );

    intakeError.code =
      'PORTAL_INTAKE_FAILED';

    const portalIntakeService = {
      async runCycle() {
        calls +=
          1;

        throw intakeError;
      },
    };

    const logger = {
      info() {},

      error() {
        errorLogged.resolve();
      },
    };

    const loop =
      new IntakeLoop({
        portalIntakeService,

        pollIntervalMs:
          1,

        logger,
      });

    loop.start();

    await errorLogged.promise;

    await waitFor(
      () => (
        loop
          .getStatus()
          .running
        === false
      ),
    );

    await new Promise(
      (resolveDelay) => {
        setTimeout(
          resolveDelay,
          20,
        );
      },
    );

    assert.equal(
      calls,
      1,
    );

    const status =
      loop.getStatus();

    assert.equal(
      status.failed,
      true,
    );

    assert.deepEqual(
      status.failure,
      {
        name:
          'Error',

        code:
          'PORTAL_INTAKE_FAILED',
      },
    );

    assert.equal(
      status.completedCycles,
      0,
    );

    assert.equal(
      status.lastCycle,
      null,
    );

    const stopResult =
      await loop.stop();

    assert.deepEqual(
      stopResult,
      {
        stopped:
          true,

        reason:
          'FAILED',

        completedCycles:
          0,

        failed:
          true,
      },
    );

    assert.equal(
      calls,
      1,
    );
  },
);

test(
  'IntakeLoop passes completed cycle results downstream but keeps status payload-free',
  async () => {
    const callbackCalled =
      createDeferred();

    const cycleResult = {
      consumed:
        1,

      created:
        1,

      duplicates:
        0,

      effectiveCapacity:
        1,

      blocker:
        null,

      health: {
        status:
          'READY',
      },

      jobs: [
        {
          jobId:
            'job-sensitive-test-id',

          applicationId:
            'application-sensitive-test-id',

          assignedIp:
            '192.0.2.10',

          port:
            8080,
        },
      ],
    };

    let receivedResult =
      null;

    const portalIntakeService = {
      async runCycle() {
        return cycleResult;
      },
    };

    const loop =
      new IntakeLoop({
        portalIntakeService,

        pollIntervalMs:
          60_000,

        onCycleResult:
          async (result) => {
            receivedResult =
              result;

            callbackCalled.resolve();
          },
      });

    loop.start();

    await callbackCalled.promise;

    assert.equal(
      receivedResult,
      cycleResult,
    );

    const status =
      loop.getStatus();

    assert.deepEqual(
      status.lastCycle,
      {
        consumed:
          1,

        created:
          1,

        duplicates:
          0,

        effectiveCapacity:
          1,

        blocker:
          null,

        jobCount:
          1,
      },
    );

    assert.equal(
      JSON.stringify(
        status,
      ).includes(
        'application-sensitive-test-id',
      ),
      false,
    );

    assert.equal(
      JSON.stringify(
        status,
      ).includes(
        '192.0.2.10',
      ),
      false,
    );

    assert.equal(
      JSON.stringify(
        status,
      ).includes(
        'job-sensitive-test-id',
      ),
      false,
    );

    await loop.stop();
  },
);

test(
  'IntakeLoop validates required constructor dependencies',
  () => {
    assert.throws(
      () => {
        new IntakeLoop({
          portalIntakeService:
            null,

          pollIntervalMs:
            1000,
        });
      },
      /portalIntakeService must be an object/,
    );

    assert.throws(
      () => {
        new IntakeLoop({
          portalIntakeService: {},

          pollIntervalMs:
            1000,
        });
      },
      /portalIntakeService\.runCycle must be a function/,
    );

    assert.throws(
      () => {
        new IntakeLoop({
          portalIntakeService: {
            runCycle() {},
          },

          pollIntervalMs:
            0,
        });
      },
      /pollIntervalMs must be a positive integer/,
    );

    assert.throws(
      () => {
        new IntakeLoop({
          portalIntakeService: {
            runCycle() {},
          },

          pollIntervalMs:
            1000,

          onCycleResult:
            'invalid',
        });
      },
      /onCycleResult must be a function/,
    );
  },
);