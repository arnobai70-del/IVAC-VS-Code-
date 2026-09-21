import { z } from 'zod';

const environmentSchema = z.enum([
  'development',
  'test',
  'production',
]);

const logLevelSchema = z.enum([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
]);

const pathSchema = z
  .string()
  .min(1)
  .refine((value) => value.startsWith('/'), {
    message: 'Path must start with "/"',
  });

const optionalSecretSchema = z.preprocess(
  (value) => {
    if (typeof value === 'string' && value.trim() === '') {
      return undefined;
    }

    return value;
  },
  z.string().trim().min(1).optional(),
);

const optionalEnvironmentSchema = z.preprocess(
  (value) => {
    if (typeof value === 'string' && value.trim() === '') {
      return undefined;
    }

    return value;
  },
  environmentSchema.optional(),
);

const optionalLogLevelSchema = z.preprocess(
  (value) => {
    if (typeof value === 'string' && value.trim() === '') {
      return undefined;
    }

    return value;
  },
  logLevelSchema.optional(),
);

export const appConfigSchema = z.object({
  app: z.object({
    name: z.string().trim().min(1),
    environment: environmentSchema,
  }),

  runtime: z.object({
    concurrency: z.number().int().min(1).max(100),
    jobsPerCycle: z.number().int().min(1).max(100),
    requestDelayMs: z.number().int().min(0).max(60_000),
  }),

  database: z.object({
    file: z.string().trim().min(1),
    busyTimeoutMs: z.number().int().min(100).max(120_000),
  }),

  portal: z.object({
    baseUrl: z.string().url(),
    pendingPath: pathSchema,
    healthPath: pathSchema.nullable(),
    timeoutMs: z.number().int().min(100).max(120_000),
  }),

  otp: z.object({
    baseUrl: z.string().url(),
    tablePath: pathSchema,
    pollIntervalMs: z.number().int().min(250).max(60_000),
    timeoutMs: z.number().int().min(1_000).max(600_000),
  }),

  target: z.object({
    baseUrl: z.string().url(),
    timeoutMs: z.number().int().min(100).max(120_000),
  }),

  logging: z.object({
    level: logLevelSchema,
  }),
});

export const environmentConfigSchema = z
  .object({
    PORTAL_API_ACCESS_TOKEN: optionalSecretSchema,
    APP_ENV: optionalEnvironmentSchema,
    LOG_LEVEL: optionalLogLevelSchema,
  })
  .passthrough();

export function validateAppConfig(value) {
  return appConfigSchema.parse(value);
}

export function validateEnvironmentConfig(value) {
  return environmentConfigSchema.parse(value);
}

export function formatZodIssues(error) {
  if (!(error instanceof z.ZodError)) {
    return [];
  }

  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}