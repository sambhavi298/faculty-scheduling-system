import cors from 'cors';

/**
 * CORS was the last item in the "Remaining backend dependencies" list
 * (docs/MIGRATION_REPORT.md, Section 8): `services/api` registered no CORS
 * middleware at all, so each frontend app's Vite dev server had to work
 * around it with a same-origin `/api` proxy — which only works in local dev.
 *
 * This is genuinely an application-layer, deployment-shaped decision (which
 * origins may call this API), not a data-integrity rule, so per Level 2/5's
 * database-first split it belongs here, not in the database.
 *
 * `CORS_ALLOWED_ORIGINS` is a comma-separated allowlist read from the
 * environment (see .env.example) rather than a wildcard `*` — an API that
 * accepts `Authorization: Bearer <token>` credentials (see
 * identify.middleware.ts) must not pair that with a wildcard origin;
 * browsers block credentialed requests against `*` anyway, and an explicit
 * allowlist is the honest, auditable choice regardless. Defaults to the
 * three local Vite dev ports so `npm run dev` keeps working out of the box
 * without requiring an .env change.
 */
const DEFAULT_DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'];

export function buildCorsOptions(): cors.CorsOptions {
  const configured = process.env.CORS_ALLOWED_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  const allowedOrigins = configured && configured.length > 0 ? configured : DEFAULT_DEV_ORIGINS;

  return {
    origin(origin, callback) {
      // No Origin header at all (server-to-server calls, curl, Postman,
      // same-origin requests) — nothing to check against an origin
      // allowlist, so allow it through; this mirrors how the dev proxy
      // behaved (same-origin requests never carried a cross-origin Origin
      // header either).
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS: origin ${origin} is not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Id', 'X-User-Role'],
  };
}

export const corsMiddleware = cors(buildCorsOptions());
