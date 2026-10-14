// Copies the API spec (docs/api/openapi.yaml, the single source) into public/ so the
// app serves it at /openapi.yaml for the Swagger UI page (/api-docs.html). Runs before dev and build.
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../docs/api/openapi.yaml', import.meta.url));
const target = fileURLToPath(new URL('../public/openapi.yaml', import.meta.url));
copyFileSync(source, target);
