/**
 * Shared by AuthService (signs tokens) and identify.middleware.ts (verifies
 * them) so both always agree on the same secret without either importing
 * the other. `JWT_SECRET` is read from the environment (see .env.example);
 * the fallback below exists ONLY so local `npm run dev` and the test suite
 * work with zero setup, exactly like db/client.ts's own PG* fallbacks — it
 * is not a safe production value and .env.example says so explicitly.
 */
const DEV_FALLBACK_SECRET = 'dev-insecure-secret-do-not-use-in-production';

export function getJwtSecret(): string {
  return process.env.JWT_SECRET ?? DEV_FALLBACK_SECRET;
}
