import {
  createIvacTargetContract,
} from './ivac-target-contract.js';


const IVAC_AUTH_ENDPOINTS =
  Object.freeze([
    Object.freeze({
      name:
        'sign-in',

      method:
        'POST',

      path:
        '/auth/sign-in-v2',

      verified:
        true,
    }),

    Object.freeze({
      name:
        'verify-signin-otp',

      method:
        'POST',

      path:
        '/otp/verifySigninOtp',

      verified:
        true,
    }),
  ]);


/*
 * Phase 29 verified authentication contract.
 *
 * This contract is intentionally minimal.
 *
 * It authorizes only the exact IVAC target METHOD + PATH pairs
 * required by createIvacAuthWorkflow().
 *
 * It does not authorize:
 *
 * - appointment creation;
 * - booking configuration;
 * - slot reservation;
 * - document upload;
 * - payment;
 * - invoice access;
 * - dynamic target routes;
 * - challenge or anti-bot handling.
 *
 * Additional IVAC target routes must be added only after their
 * method/path/request contract is separately locked by tests.
 */
export function createVerifiedIvacAuthTargetContract() {
  return createIvacTargetContract({
    verified:
      true,

    endpoints:
      IVAC_AUTH_ENDPOINTS,
  });
}


export function getVerifiedIvacAuthEndpoints() {
  return IVAC_AUTH_ENDPOINTS.map(
    (endpoint) => ({
      name:
        endpoint.name,

      method:
        endpoint.method,

      path:
        endpoint.path,

      verified:
        endpoint.verified,
    }),
  );
}