import {
  z,
} from 'zod';

const environmentSchema =
  z.enum([
    'development',
    'test',
    'production',
  ]);

const logLevelSchema =
  z.enum([
    'trace',
    'debug',
    'info',
    'warn',
    'error',
    'fatal',
  ]);

const pathSchema =
  z.string()
    .min(1)
    .refine(
      (value) =>
        value.startsWith('/'),
      {
        message:
          'Path must start with "/"',
      },
    );

const mappingPathSchema =
  z.string()
    .trim()
    .min(1);

const nullableMappingPathSchema =
  mappingPathSchema.nullable();

const optionalSecretSchema =
  z.preprocess(
    (value) => {
      if (
        typeof value === 'string'
        && value.trim() === ''
      ) {
        return undefined;
      }

      return value;
    },

    z.string()
      .trim()
      .min(1)
      .optional(),
  );

const optionalEnvironmentSchema =
  z.preprocess(
    (value) => {
      if (
        typeof value === 'string'
        && value.trim() === ''
      ) {
        return undefined;
      }

      return value;
    },

    environmentSchema.optional(),
  );

const optionalLogLevelSchema =
  z.preprocess(
    (value) => {
      if (
        typeof value === 'string'
        && value.trim() === ''
      ) {
        return undefined;
      }

      return value;
    },

    logLevelSchema.optional(),
  );

const portalSchema =
  z.object({
    baseUrl:
      z.string().url(),

    pendingPath:
      pathSchema,

    healthPath:
      pathSchema.nullable(),

    timeoutMs:
      z.number()
        .int()
        .min(100)
        .max(120_000),

    maxResponseBytes:
      z.number()
        .int()
        .min(1024)
        .max(
          10
          * 1024
          * 1024,
        ),

    mapping:
      z.object({
        applicationId:
          mappingPathSchema,

        userId:
          nullableMappingPathSchema,

        phone:
          nullableMappingPathSchema,

        password:
          nullableMappingPathSchema,

        passportNumber:
          nullableMappingPathSchema,

        documents:
          nullableMappingPathSchema,
      }),
  })
    .superRefine(
      (
        value,
        context,
      ) => {
        if (
          value.healthPath !== null
          && value.healthPath
            === value.pendingPath
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              'healthPath',
            ],

            message:
              'Portal healthPath must not use the destructive pending endpoint.',
          });
        }
      },
    );

const otpSchema =
  z.object({
    baseUrl:
      z.string().url(),

    tablePath:
      pathSchema,

    pollIntervalMs:
      z.number()
        .int()
        .min(250)
        .max(60_000),

    timeoutMs:
      z.number()
        .int()
        .min(1_000)
        .max(600_000),

    maxResponseBytes:
      z.number()
        .int()
        .min(1024)
        .max(
          10
          * 1024
          * 1024,
        ),

    maxRows:
      z.number()
        .int()
        .min(1)
        .max(100_000),

    tableSelector:
      z.string()
        .trim()
        .min(1),

    columns:
      z.object({
        phone:
          z.string()
            .trim()
            .min(1),

        code:
          z.string()
            .trim()
            .min(1),

        createdAt:
          z.string()
            .trim()
            .min(1),
      }),
  });

const originSchema =
  z.string()
    .url()
    .superRefine(
      (
        value,
        context,
      ) => {
        let url;

        try {
          url =
            new URL(
              value,
            );
        } catch {
          return;
        }

        if (
          url.protocol !== 'https:'
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            message:
              'Document origin must use HTTPS.',
          });
        }

        if (
          url.username
          || url.password
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            message:
              'Document origin must not contain credentials.',
          });
        }

        if (
          url.pathname !== '/'
          || url.search
          || url.hash
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            message:
              'Document allowedOrigins entries must contain only an origin.',
          });
        }
      },
    );

const documentsSchema =
  z.object({
    baseUrl:
      z.string()
        .url(),

    allowedOrigins:
      z.array(
        originSchema,
      )
        .min(1)
        .max(20)
        .refine(
          (values) =>
            new Set(
              values.map(
                (value) =>
                  new URL(
                    value,
                  ).origin,
              ),
            ).size
            === values.length,
          {
            message:
              'Document allowedOrigins contains duplicates.',
          },
        ),

    timeoutMs:
      z.number()
        .int()
        .min(100)
        .max(120_000),

    maxCount:
      z.number()
        .int()
        .min(1)
        .max(100),

    maxFileBytes:
      z.number()
        .int()
        .min(1024)
        .max(
          50
          * 1024
          * 1024,
        ),

    maxTotalBytes:
      z.number()
        .int()
        .min(1024)
        .max(
          200
          * 1024
          * 1024,
        ),
  })
    .superRefine(
      (
        value,
        context,
      ) => {
        if (
          value.maxTotalBytes
          < value.maxFileBytes
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              'maxTotalBytes',
            ],

            message:
              'maxTotalBytes must be greater than or equal to maxFileBytes.',
          });
        }
      },
    );

const workflowRuntimeSchema =
  z.object({
    file:
      z.string()
        .trim()
        .min(1),

    maxSteps:
      z.number()
        .int()
        .min(1)
        .max(1000),
  });

export const appConfigSchema =
  z.object({
    app:
      z.object({
        name:
          z.string()
            .trim()
            .min(1),

        environment:
          environmentSchema,
      }),

    runtime:
      z.object({
        concurrency:
          z.number()
            .int()
            .min(1)
            .max(100),

        jobsPerCycle:
          z.number()
            .int()
            .min(1)
            .max(100),

        requestDelayMs:
          z.number()
            .int()
            .min(0)
            .max(60_000),
      }),

    database:
      z.object({
        file:
          z.string()
            .trim()
            .min(1),

        busyTimeoutMs:
          z.number()
            .int()
            .min(100)
            .max(120_000),
      }),

    network:
      z.object({
        proxyConfigFile:
          z.string()
            .trim()
            .min(1),

        healthCheckUrl:
          z.string()
            .url()
            .nullable(),

        healthTimeoutMs:
          z.number()
            .int()
            .min(250)
            .max(120_000),

        cooldownMs:
          z.number()
            .int()
            .min(1_000)
            .max(3_600_000),
      }),

    portal:
      portalSchema,

    otp:
      otpSchema,

    documents:
      documentsSchema,

    target:
      z.object({
        baseUrl:
          z.string()
            .url(),

        timeoutMs:
          z.number()
            .int()
            .min(100)
            .max(120_000),
      }),

    workflow:
      workflowRuntimeSchema,

    logging:
      z.object({
        level:
          logLevelSchema,
      }),
  });

export const environmentConfigSchema =
  z.object({
    PORTAL_API_ACCESS_TOKEN:
      optionalSecretSchema,

    APP_ENV:
      optionalEnvironmentSchema,

    LOG_LEVEL:
      optionalLogLevelSchema,
  })
    .passthrough();

export function validateAppConfig(
  value,
) {
  return appConfigSchema.parse(
    value,
  );
}

export function validateEnvironmentConfig(
  value,
) {
  return environmentConfigSchema
    .parse(
      value,
    );
}

export function formatZodIssues(
  error,
) {
  if (
    !(error instanceof z.ZodError)
  ) {
    return [];
  }

  return error.issues.map(
    (issue) => ({
      path:
        issue.path.join('.'),

      message:
        issue.message,
    }),
  );
}