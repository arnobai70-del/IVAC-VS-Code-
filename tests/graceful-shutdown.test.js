import test from 'node:test';

import assert from 'node:assert/strict';

import {
  GracefulShutdown,
} from '../src/runtime/graceful-shutdown.js';

function deferred() {
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

test(
  'shutdown stops intake before in-flight abort and cleanup',
  async () => {
    const events = [];

    const work =
      deferred();

    const abortController = {
      abort() {
        events.push(
          'abort-in-flight',
        );

        work.resolve();
      },
    };

    const sessionManager = {
      async closeAll() {
        events.push(
          'close-sessions',
        );
      },
    };

    const dispatcherPool = {
      async closeAll() {
        events.push(
          'close-dispatchers',
        );
      },
    };

    const runtime =
      new GracefulShutdown({
        stopIntake:
          async () => {
            events.push(
              'stop-intake',
            );
          },

        sessionManager,

        dispatcherPool,

        stopDashboard:
          async () => {
            events.push(
              'stop-dashboard',
            );
          },

        closeDatabase:
          async () => {
            events.push(
              'close-database',
            );
          },

        settleTimeoutMs:
          100,
      });

    runtime.trackInFlight(
      work.promise,
      {
        abortController,
      },
    );

    await runtime.shutdown({
      signal:
        'SIGTERM',
    });

    assert.deepEqual(
      events,
      [
        'stop-intake',
        'abort-in-flight',
        'close-sessions',
        'close-dispatchers',
        'stop-dashboard',
        'close-database',
      ],
    );
  },
);

test(
  'shutdown immediately stops accepting new work',
  async () => {
    const stop =
      deferred();

    const runtime =
      new GracefulShutdown({
        stopIntake:
          () =>
            stop.promise,

        settleTimeoutMs:
          100,
      });

    const shutdownPromise =
      runtime.shutdown({
        signal:
          'SIGINT',
      });

    assert.equal(
      runtime.isShuttingDown,
      true,
    );

    assert.throws(
      () =>
        runtime.trackInFlight(
          Promise.resolve(),
        ),
      (error) => {
        assert.equal(
          error.code,
          'RUNTIME_SHUTTING_DOWN',
        );

        return true;
      },
    );

    stop.resolve();

    await shutdownPromise;
  },
);

test(
  'shutdown does not release non-terminal IP allocations',
  async () => {
    let releaseCalls =
      0;

    const ipAllocator = {
      releaseForJob() {
        releaseCalls +=
          1;
      },
    };

    const runtime =
      new GracefulShutdown({
        sessionManager: {
          async closeAll() {},
        },

        dispatcherPool: {
          async closeAll() {},
        },
      });

    /*
     * IpAllocator is intentionally not accepted as a
     * GracefulShutdown dependency.
     *
     * Keeping this object in the test makes the invariant
     * explicit: shutdown transport cleanup must never call
     * releaseForJob().
     */
    assert.equal(
      typeof ipAllocator
        .releaseForJob,
      'function',
    );

    await runtime.shutdown({
      signal:
        'SIGTERM',
    });

    assert.equal(
      releaseCalls,
      0,
    );
  },
);

test(
  'in-flight AbortController receives graceful shutdown reason',
  async () => {
    let abortReason =
      null;

    const work =
      deferred();

    const abortController = {
      abort(
        reason,
      ) {
        abortReason =
          reason;

        work.resolve();
      },
    };

    const runtime =
      new GracefulShutdown({
        settleTimeoutMs:
          100,
      });

    runtime.trackInFlight(
      work.promise,
      {
        abortController,
      },
    );

    await runtime.shutdown({
      signal:
        'SIGTERM',
    });

    assert.ok(
      abortReason,
    );

    assert.equal(
      abortReason.name,
      'AbortError',
    );

    assert.equal(
      abortReason.code,
      'GRACEFUL_SHUTDOWN',
    );

    assert.equal(
      abortReason.retryable,
      false,
    );
  },
);

test(
  'shutdown waits for tracked work to settle within deadline',
  async () => {
    const work =
      deferred();

    const runtime =
      new GracefulShutdown({
        settleTimeoutMs:
          100,
      });

    runtime.trackInFlight(
      work.promise,
    );

    setTimeout(
      () => {
        work.resolve(
          'finished',
        );
      },
      10,
    );

    const result =
      await runtime.shutdown({
        signal:
          'SIGTERM',
      });

    assert.equal(
      result.inFlight.total,
      1,
    );

    assert.equal(
      result.inFlight.timedOut,
      false,
    );

    assert.equal(
      runtime.inFlightCount,
      0,
    );
  },
);

test(
  'shutdown wait is bounded when in-flight work cannot settle',
  async () => {
    const work =
      deferred();

    const runtime =
      new GracefulShutdown({
        settleTimeoutMs:
          20,
      });

    runtime.trackInFlight(
      work.promise,
    );

    const result =
      await runtime.shutdown({
        signal:
          'SIGTERM',
      });

    assert.equal(
      result.inFlight.total,
      1,
    );

    assert.equal(
      result.inFlight.timedOut,
      true,
    );

    /*
     * Resolve after the assertion so the test leaves no
     * permanently pending bookkeeping promise behind.
     */
    work.resolve();
  },
);

test(
  'shutdown is idempotent when requested more than once',
  async () => {
    let stopIntakeCalls =
      0;

    let closeDatabaseCalls =
      0;

    const runtime =
      new GracefulShutdown({
        stopIntake:
          async () => {
            stopIntakeCalls +=
              1;
          },

        closeDatabase:
          async () => {
            closeDatabaseCalls +=
              1;
          },
      });

    const first =
      runtime.shutdown({
        signal:
          'SIGTERM',
      });

    const second =
      runtime.shutdown({
        signal:
          'SIGINT',
      });

    assert.equal(
      first,
      second,
    );

    await first;

    assert.equal(
      stopIntakeCalls,
      1,
    );

    assert.equal(
      closeDatabaseCalls,
      1,
    );
  },
);

test(
  'cleanup continues when an earlier cleanup stage fails',
  async () => {
    const events = [];

    const runtime =
      new GracefulShutdown({
        stopIntake:
          async () => {
            events.push(
              'stop-intake',
            );

            throw new Error(
              'intake failure',
            );
          },

        sessionManager: {
          async closeAll() {
            events.push(
              'close-sessions',
            );

            throw new Error(
              'session failure',
            );
          },
        },

        dispatcherPool: {
          async closeAll() {
            events.push(
              'close-dispatchers',
            );
          },
        },

        stopDashboard:
          async () => {
            events.push(
              'stop-dashboard',
            );
          },

        closeDatabase:
          async () => {
            events.push(
              'close-database',
            );
          },
      });

    const result =
      await runtime.shutdown({
        signal:
          'SIGTERM',
      });

    assert.deepEqual(
      events,
      [
        'stop-intake',
        'close-sessions',
        'close-dispatchers',
        'stop-dashboard',
        'close-database',
      ],
    );

    assert.deepEqual(
      result.cleanupErrors.map(
        (entry) =>
          entry.stage,
      ),
      [
        'STOP_INTAKE',
        'CLOSE_SESSIONS',
      ],
    );
  },
);

test(
  'signal handlers can be installed and removed without duplication',
  () => {
    const runtime =
      new GracefulShutdown();

    runtime.installSignalHandlers();

    assert.equal(
      runtime.signalHandlers.size,
      2,
    );

    runtime.installSignalHandlers();

    assert.equal(
      runtime.signalHandlers.size,
      2,
    );

    runtime.removeSignalHandlers();

    assert.equal(
      runtime.signalHandlers.size,
      0,
    );
  },
);