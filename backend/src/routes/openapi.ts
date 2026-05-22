/**
 * OpenAPI / Swagger UI routes.
 *
 *   GET /api/openapi.json — Programmatically built OpenAPI 3.1 document.
 *   GET /api/docs         — Swagger UI HTML shell (loads CSS/JS from a
 *                           pinned CDN) that renders /api/openapi.json.
 *
 * Both endpoints are unauthenticated. The spec only describes the public
 * shape of the API; it never contains secrets, real user data, or
 * configuration values. Making the documentation un-gated keeps it usable
 * for external integrators and for the Nexus monitoring stack.
 */

import { Router, type Router as RouterType, type Request, type Response } from "express";
import { buildOpenApiSpec } from "../lib/openapi/spec.js";

const router: RouterType = Router();

// Keep in sync with `routes/health.ts`'s `APP_VERSION` — both reflect the
// backend package version. When we wire automatic package.json reading
// (D1 follow-up), both call sites consume that single source.
const APP_VERSION = "1.0.0";

/**
 * Swagger UI is loaded from a pinned major version on jsdelivr so we don't
 * pay an npm dependency for the documentation surface. Pinning to v5 keeps
 * the CSP-friendly inline-init script that we use below. If the
 * `cdn.jsdelivr.net` connect-src is ever removed from CSP, swap the URLs
 * for a self-hosted copy under `public/`.
 */
const SWAGGER_UI_CSS = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css";
const SWAGGER_UI_JS = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSwaggerUi(specUrl: string): string {
  // The init block is intentionally tiny — Swagger UI does the heavy lifting.
  // We pass `deepLinking: true` so the `?op=...` hash navigation works, and
  // disable the `tryItOutEnabled` global flag so requests aren't auto-fired
  // (the spec describes mutating endpoints; the "try it out" button is still
  // there but the operator has to opt in per-request).
  const safeUrl = escapeHtml(specUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ABC Agent Builder Console — API documentation</title>
    <link rel="stylesheet" href="${SWAGGER_UI_CSS}" />
    <style>
      body { margin: 0; background: #fafafa; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui" aria-label="API documentation"></div>
    <script src="${SWAGGER_UI_JS}" crossorigin></script>
    <script>
      window.addEventListener('load', function () {
        window.ui = SwaggerUIBundle({
          url: '${safeUrl}',
          dom_id: '#swagger-ui',
          deepLinking: true,
          docExpansion: 'list',
          defaultModelsExpandDepth: 1,
          tryItOutEnabled: false,
          persistAuthorization: true,
          syntaxHighlight: { theme: 'agate' },
        });
      });
    </script>
  </body>
</html>`;
}

router.get("/openapi.json", (_req: Request, res: Response) => {
  const spec = buildOpenApiSpec({ version: APP_VERSION });
  res.setHeader("Cache-Control", "public, max-age=60");
  res.status(200).json(spec);
});

router.get("/docs", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  // Override Helmet's default CSP for this response so Swagger UI can load
  // its bundled JS + CSS from jsdelivr. The narrower policy keeps the rest
  // of the app's CSP untouched. `'unsafe-inline'` on script-src is required
  // by Swagger UI's own loader; `connect-src 'self'` allows it to fetch the
  // OpenAPI spec from this same origin. `frame-ancestors 'none'` continues
  // the click-jacking protection from the global CSP.
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "img-src 'self' data: https:",
      "font-src 'self' https://cdn.jsdelivr.net",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
    ].join("; "),
  );
  res.status(200).send(renderSwaggerUi("/api/openapi.json"));
});

export default router;
