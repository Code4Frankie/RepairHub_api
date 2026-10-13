// Regenerates postman/collection.json from the Swagger route table (config/swagger.js),
// so the collection never drifts from the code.  Run with:  npm run docs:generate
import 'dotenv/config';
import fs from 'node:fs';
import { buildSpec } from '../config/swagger.js';

const spec = buildSpec();

const requests = Object.entries(spec.paths).flatMap(([route, ops]) =>
  Object.entries(ops).map(([method, op]) => {
    const urlPath = route.replace(/\{(\w+)\}/g, ':$1');
    const header = [];
    if (!op.security || op.security.length) header.push({ key: 'Authorization', value: 'Bearer {{token}}' });
    const body = (() => {
      if (!op.requestBody) return undefined;
      const jsonBody = op.requestBody.content['application/json'];
      if (jsonBody) return { mode: 'raw', raw: JSON.stringify(jsonBody.example || {}, null, 2), options: { raw: { language: 'json' } } };
      const formData = op.requestBody.content['multipart/form-data'];
      if (formData) {
        return { mode: 'formdata', formdata: Object.keys(formData.schema.properties).map((k) => ({ key: k, value: '', type: 'text' })) };
      }
      return undefined;
    })();
    return {
      name: `${method.toUpperCase()} ${urlPath} — ${op.summary}`,
      request: {
        method: method.toUpperCase(),
        header,
        url: `{{baseUrl}}/api${urlPath}`,
        ...(body ? { body } : {}),
      },
    };
  })
);

fs.writeFileSync(
  new URL('../postman/collection.json', import.meta.url),
  JSON.stringify({ info: { name: 'RepairHub API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: requests }, null, 2)
);
console.log(`Wrote ${requests.length} requests to postman/collection.json`);