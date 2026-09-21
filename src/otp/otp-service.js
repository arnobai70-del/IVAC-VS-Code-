import {
  JobCancelledError,
  OtpTimeoutError,
} from '../core/errors.js';

function assertNotAborted(
  signal,
) {
  if (signal?.aborted) {
    throw new JobCancelledError(
      'OTP polling was cancelled.',
    );
  }
}

function defaultSleep(
  milliseconds,
  signal,
) {
  if (signal?.aborted) {
    return Promise.reject(
      new JobCancelledError(
        'OTP polling was cancelled.',
      ),
    );
  }

  return new Promise(
    (
      resolve,
      reject,
    ) => {
      let settled =
        false;

      const cleanup = () => {
        if (!signal) {
          return;
        }

        signal.removeEventListener(
          'abort',
          onAbort,
        );
      };

      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve();
      };

      const onAbort = () => {
        if (settled) {
          return;
        }

        settled = true;

        clearTimeout(
          timer,
        );

        cleanup();

        reject(
          new JobCancelledError(
            'OTP polling was cancelled.',
          ),
        );
      };

      const timer =
        setTimeout(
          finish,
          milliseconds,
        );

      if (signal) {
        signal.addEventListener(
          'abort',
          onAbort,
          {
            once: true,
          },
        );
      }
    },
  );
}

export class OtpService {
  constructor({
    otpClient,
    otpTableParser,
    otpMatcher,
    pollIntervalMs,
    timeoutMs,
    nowFn = Date.now,
    sleepFn = defaultSleep,
  }) {
    if (
      !otpClient
      || typeof otpClient
        .fetchTableHtml
        !== 'function'
    ) {
      throw new TypeError(
        'otpClient with fetchTableHtml() is required.',
      );
    }

    if (
      !otpTableParser
      || typeof otpTableParser
        .parse
        !== 'function'
    ) {
      throw new TypeError(
        'otpTableParser with parse() is required.',
      );
    }

    if (
      !otpMatcher
      || typeof otpMatcher
        .createWatch
        !== 'function'
      || typeof otpMatcher
        .findNewOtp
        !== 'function'
    ) {
      throw new TypeError(
        'A valid otpMatcher is required.',
      );
    }

    if (
      !Number.isInteger(
        pollIntervalMs,
      )
      || pollIntervalMs < 1
    ) {
      throw new TypeError(
        'pollIntervalMs must be a positive integer.',
      );
    }

    if (
      !Number.isInteger(
        timeoutMs,
      )
      || timeoutMs < 1
    ) {
      throw new TypeError(
        'timeoutMs must be a positive integer.',
      );
    }

    this.otpClient =
      otpClient;

    this.otpTableParser =
      otpTableParser;

    this.otpMatcher =
      otpMatcher;

    this.pollIntervalMs =
      pollIntervalMs;

    this.timeoutMs =
      timeoutMs;

    this.nowFn =
      nowFn;

    this.sleepFn =
      sleepFn;
  }

  async fetchRecords() {
    const html =
      await this.otpClient
        .fetchTableHtml();

    return this.otpTableParser
      .parse(html);
  }

  async captureBaseline({
    phone,
  }) {
    const records =
      await this.fetchRecords();

    return this.otpMatcher
      .createWatch(
        records,
        {
          phone,

          capturedAt:
            new Date(
              this.nowFn(),
            ).toISOString(),
        },
      );
  }

  async prepareForJobContext({
    jobContext,
    phone,
  }) {
    if (
      !jobContext
      || typeof jobContext
        .setOtpWatch
        !== 'function'
    ) {
      throw new TypeError(
        'A valid jobContext is required.',
      );
    }

    const watch =
      await this.captureBaseline({
        phone,
      });

    jobContext.setOtpWatch(
      watch,
    );

    jobContext.clearOtp?.();

    return watch;
  }

  async waitForOtp({
    watch,
    signal = null,
  }) {
    if (!watch) {
      throw new TypeError(
        'OTP watch is required.',
      );
    }

    const startedAt =
      this.nowFn();

    const deadline =
      startedAt
      + this.timeoutMs;

    let polls = 0;

    while (true) {
      assertNotAborted(
        signal,
      );

      if (
        polls > 0
        && this.nowFn()
          >= deadline
      ) {
        throw new OtpTimeoutError();
      }

      const records =
        await this.fetchRecords();

      polls += 1;

      const matched =
        this.otpMatcher
          .findNewOtp(
            records,
            watch,
          );

      if (matched) {
        return {
          ...matched,

          polls,

          matchedAt:
            new Date(
              this.nowFn(),
            ).toISOString(),
        };
      }

      const now =
        this.nowFn();

      if (now >= deadline) {
        throw new OtpTimeoutError();
      }

      const remainingMs =
        deadline - now;

      await this.sleepFn(
        Math.min(
          this.pollIntervalMs,
          remainingMs,
        ),
        signal,
      );
    }
  }

  async waitForJobContext({
    jobContext,
    watch =
      jobContext?.otpWatch
      ?? null,
    signal = null,
  }) {
    if (
      !jobContext
      || typeof jobContext
        .setOtp
        !== 'function'
    ) {
      throw new TypeError(
        'A valid jobContext is required.',
      );
    }

    if (!watch) {
      throw new TypeError(
        'Job context has no prepared OTP watch.',
      );
    }

    const result =
      await this.waitForOtp({
        watch,
        signal,
      });

    jobContext.setOtp({
      code:
        result.code,

      createdAt:
        result.createdAt,

      matchedAt:
        result.matchedAt,

      watchId:
        watch.watchId,
    });

    jobContext.clearOtpWatch?.();

    return result;
  }
}