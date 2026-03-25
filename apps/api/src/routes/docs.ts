import express, { Router, Request, Response } from 'express';
import { createRequire } from 'module';
import { buildOpenApiDocument } from '../openapi.js';

const require = createRequire(import.meta.url);
const swaggerUiDist = require('swagger-ui-dist') as {
  getAbsoluteFSPath: () => string;
};

const swaggerAssetPath = swaggerUiDist.getAbsoluteFSPath();
const router = Router();

function getBaseUrl(req: Request): string {
  const forwardedProto = req.header('x-forwarded-proto');
  const protocol = forwardedProto?.split(',')[0]?.trim() || req.protocol;
  const host = req.get('host') || 'localhost:3001';
  return `${protocol}://${host}`;
}

router.use('/docs/swagger-assets', express.static(swaggerAssetPath));

router.get('/docs', (_req: Request, res: Response) => {
  res.redirect('/docs/swagger');
});

router.get('/docs/openapi.json', (req: Request, res: Response) => {
  res.json(buildOpenApiDocument(getBaseUrl(req)));
});

router.get('/docs/swagger-init.js', (req: Request, res: Response) => {
  const specUrl = `${getBaseUrl(req)}/docs/openapi.json`;

  res.type('application/javascript').send([
    'window.onload = function () {',
    '  window.ui = SwaggerUIBundle({',
    `    url: ${JSON.stringify(specUrl)},`,
    "    dom_id: '#swagger-ui',",
    '    deepLinking: true,',
    '    displayRequestDuration: true,',
    '    docExpansion: \"list\",',
    '    defaultModelsExpandDepth: 1,',
    '    persistAuthorization: true,',
    '    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],',
    '    layout: \"StandaloneLayout\"',
    '  });',
    '};',
  ].join('\n'));
});

router.get('/docs/swagger', (_req: Request, res: Response) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FlowGuard API Docs</title>
    <link rel="icon" type="image/png" href="/docs/swagger-assets/favicon-32x32.png" sizes="32x32" />
    <link rel="stylesheet" href="/docs/swagger-assets/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/docs/swagger-assets/swagger-ui-bundle.js" defer></script>
    <script src="/docs/swagger-assets/swagger-ui-standalone-preset.js" defer></script>
    <script src="/docs/swagger-init.js" defer></script>
  </body>
</html>`);
});

export default router;