import {
  z,
} from 'zod';

const environmentSchema =
  z.enum([
    'development',
    'test',
    'production',
  ]);

const activationProfileSchema =
  z.enum([
    'safe',
    'controlled',
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


const httpsUrlSchema =
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
              'URL must use HTTPS.',
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
              'URL must not contain embedded credentials.',
          });
        }
      },
    );

function isSafeSameOriginPath(
  value,
) {
  if (
    typeof value !== 'string'
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || value.includes('\r')
    || value.includes('\n')
  ) {
    return false;
  }

  try {
    const base =
      new URL(
        'https://portal.invalid/',
      );

    const resolved =
      new URL(
        value,
        base,
      );

    return (
      resolved.origin
      === base.origin
    );
  } catch {
    return false;
  }
}


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
    )
    .refine(
      isSafeSameOriginPath,
      {
        message:
          'Path must remain on the configured origin and must not use a network-path reference.',
      },
    );

const portalStatusPathTemplateSchema =
  z.string()
    .trim()
    .min(1)
    .refine(
      (value) =>
        value.startsWith('/'),
      {
        message:
          'Portal status path template must start with "/".',
      },
    )
    .refine(
      isSafeSameOriginPath,
      {
        message:
          'Portal status path template must remain on the configured origin and must not use a network-path reference.',
      },
    )
    .refine(
      (value) =>
        (
          value.match(
            /\{application\}/g,
          )
          ?? []
        ).length === 1,
      {
        message:
          'Portal status path template must contain exactly one "{application}" placeholder.',
      },
    );

const portalWorkerServerNameSchema =
  z.string()
    .trim()
    .min(1)
    .max(255)
    .refine(
      (value) =>
        !value.includes('\r')
        && !value.includes('\n'),
      {
        message:
          'Portal worker Server-Name must not contain newline characters.',
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

const optionalActivationProfileSchema =
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

    activationProfileSchema
      .optional(),
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

const portalResultSchema =
  z.object({
    /*
     * Final-result delivery is destructive remote mutation.
     *
     * Knowing the verified route is not enough to activate it.
     * The operator must explicitly enable this contract.
     */
    enabled:
      z.boolean()
        .default(false),

    statusPathTemplate:
      portalStatusPathTemplateSchema
        .default(
          '/api/application/{application}/status',
        ),
  })
    .default({
      enabled: false,
      statusPathTemplate:
        '/api/application/{application}/status',
    });

const portalSchema =
  z.object({
    baseUrl:
      httpsUrlSchema,

    pendingPath:
      pathSchema,

    healthPath:
      pathSchema.nullable(),

    /*
     * Portal Server-Name is the static Portal worker identity.
     *
     * It is deliberately separate from the per-job proxy/IP
     * allocation held by the IVAC runtime.
     */
    workerServerName:
      portalWorkerServerNameSchema
        .nullable()
        .default(null),

    result:
      portalResultSchema,

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

        if (
          value.result
            .statusPathTemplate
          === value.pendingPath
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              'result',
              'statusPathTemplate',
            ],

            message:
              'Portal final-result status route must not use the pending endpoint.',
          });
        }

        if (
          value.healthPath !== null
          && value.result
            .statusPathTemplate
            === value.healthPath
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              'result',
              'statusPathTemplate',
            ],

            message:
              'Portal final-result status route must not use the health endpoint.',
          });
        }
      },
    );

const otpSchema =
  z.object({
    baseUrl:
      httpsUrlSchema,

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
      httpsUrlSchema,

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
    /*
     * Workflow execution is destructive-capable runtime
     * behavior and therefore remains disabled unless an
     * operator explicitly enables it.
     */
    enabled:
      z.boolean()
        .default(false),

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

const dashboardSchema =
  z.object({
    enabled:
      z.boolean()
        .default(false),

    host:
      z.enum([
        '127.0.0.1',
        '::1',
        'localhost',
      ])
        .default(
          '127.0.0.1',
        ),

    port:
      z.number()
        .int()
        .min(1)
        .max(65_535)
        .default(8787),
  })
    .default({});

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

        /*
         * Phase 33 activation profile.
         *
         * SAFE is the default and cannot authorize destructive
         * intake. CONTROLLED is an explicit operator-selected
         * profile evaluated by the runtime activation gate.
         *
         * An environment override may select CONTROLLED later;
         * simply selecting the profile does not itself enable
         * workflow execution or Portal intake.
         */
        activationProfile:
          activationProfileSchema
            .default(
              'safe',
            ),

        /*
         * Destructive Portal intake must be an explicit
         * operational choice.
         *
         * Safe default is disabled so normal startup,
         * development, tests, and verification cannot consume
         * a pending Portal application merely by launching the
         * process.
         */
        intakeEnabled:
          z.boolean()
            .default(false),

        /*
         * Delay between destructive Portal intake cycles.
         *
         * This is separate from requestDelayMs because
         * requestDelayMs may legally be zero while a long-lived
         * intake scheduler must always have a positive bounded
         * delay to prevent accidental hot-loop consumption.
         */
        intakePollIntervalMs:
          z.number()
            .int()
            .min(250)
            .max(60_000)
            .default(3000),
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
          httpsUrlSchema,

        timeoutMs:
          z.number()
            .int()
            .min(100)
            .max(120_000),
      }),

    workflow:
      workflowRuntimeSchema,

    dashboard:
      dashboardSchema,

    logging:
      z.object({
        level:
          logLevelSchema,
      }),
  })
    .superRefine(
      (
        value,
        context,
      ) => {
        /*
         * Portal intake consumes pending remote work.
         * It must never be enabled while workflow execution
         * itself remains disabled.
         */
        if (
          value.runtime.intakeEnabled
          && !value.workflow.enabled
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              'runtime',
              'intakeEnabled',
            ],

            message:
              'Portal intake cannot be enabled while workflow execution is disabled.',
          });
        }

        /*
         * The production Portal assigns applications to a static
         * worker identity carried in Server-Name.
         *
         * This identity is separate from the per-job proxy IP and
         * is required before destructive intake can be enabled.
         */
        if (
          value.runtime.intakeEnabled
          && !value.portal
            .workerServerName
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              'portal',
              'workerServerName',
            ],

            message:
              'Portal intake cannot be enabled without a configured static worker Server-Name.',
          });
        }

        /*
         * Every consumed application must eventually pass through
         * the verified final-result contract.
         *
         * Merely knowing the route does not activate it.
         */
        if (
          value.runtime.intakeEnabled
          && value.portal.result
            .enabled !== true
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              'portal',
              'result',
              'enabled',
            ],

            message:
              'Portal intake cannot be enabled while verified final-result delivery is disabled.',
          });
        }
      },
    );

export const environmentConfigSchema =
  z.object({
    PORTAL_API_ACCESS_TOKEN:
      optionalSecretSchema,

    /*
     * Operator-only activation selector.
     *
     * Blank/missing value means no override. The loader therefore
     * preserves the safe profile injected by appConfigSchema.
     */
    ACTIVATION_PROFILE:
      optionalActivationProfileSchema,

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