import {
  createIvacWorkflowDefinition,
} from './ivac-workflow-definition.js';


/*
 * Evidence-backed IVAC authentication workflow.
 *
 * Source evidence used for this definition:
 *
 * 1. POST /auth/sign-in-v2
 *
 *    body:
 *      {
 *        phone,
 *        password
 *      }
 *
 *    headers include:
 *      Content-Type: application/json
 *      Accept: application/json, text/plain, wildcard
 *      x-device-id: stable 20-character per-session value
 *
 *    successful response exposes:
 *      data.accessToken
 *      data.requestId
 *
 * 2. POST /otp/verifySigninOtp
 *
 *    body:
 *      {
 *        requestId,
 *        phone,
 *        code,
 *        otpChannel: 'PHONE'
 *      }
 *
 *    headers include:
 *      Content-Type: application/json
 *      Accept: application/json, text/plain, wildcard
 *      Authorization: Bearer <accessToken>
 *
 * Important safety boundaries:
 *
 * - OTP baseline is captured before sign-in so an old OTP cannot
 *   be reused;
 * - OTP itself remains memory-only in JobContext;
 * - device ID remains memory-only and stable for this JobContext;
 * - no CAPTCHA, Cloudflare, reCAPTCHA, Turnstile, or anti-bot
 *   solving/bypass step exists here;
 * - if target-side human verification is encountered,
 *   TargetHttpClient must surface MANUAL_CHALLENGE_REQUIRED;
 * - no automatic challenge retry is defined here;
 * - target execution still requires exact METHOD + PATH coverage
 *   from the verified IVAC target contract;
 * - this module does not activate runtime intake or workflow
 *   execution by itself.
 */

export function createIvacAuthWorkflow() {
  return createIvacWorkflowDefinition({
    steps: [
      {
        id:
          'prepare_signin_otp',

        type:
          'otp.prepare',

        phone:
          '{{input.phone}}',
      },

      {
        id:
          'sign_in',

        type:
          'http',

        method:
          'POST',

        route:
          '/auth/sign-in-v2',

        headers: {
          Accept:
            'application/json, text/plain, */*',

          'Content-Type':
            'application/json',

          'x-device-id':
            '{{runtime.deviceId}}',
        },

        body: {
          phone:
            '{{input.phone}}',

          password:
            '{{input.password}}',
        },

        expect: {
          statuses: [
            200,
          ],

          response:
            'json',
        },
      },

      {
        id:
          'wait_signin_otp',

        type:
          'otp.wait',
      },

      {
        id:
          'verify_signin_otp',

        type:
          'http',

        method:
          'POST',

        route:
          '/otp/verifySigninOtp',

        headers: {
          Accept:
            'application/json, text/plain, */*',

          'Content-Type':
            'application/json',

          Authorization:
            'Bearer {{responses.sign_in.data.data.accessToken}}',
        },

        body: {
          requestId:
            '{{responses.sign_in.data.data.requestId}}',

          phone:
            '{{input.phone}}',

          code:
            '{{otp.code}}',

          otpChannel:
            'PHONE',
        },

        expect: {
          statuses: [
            200,
          ],

          response:
            'json',
        },
      },
    ],
  });
}