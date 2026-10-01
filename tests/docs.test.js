import listEndpoints from 'express-list-endpoints';
import app from '../app.js';
import { routes } from '../config/swagger.js';

// Guards against docs drift: every real route must be documented in config/swagger.js
// (which also feeds the Postman collection), and every documented route must exist.
describe('API docs match the real routes', () => {
  const norm = (p) => p.replace(/^\/api/, '').replace(/:(\w+)/g, '{$1}').replace(/\/$/, '') || '/';
  const real = new Set();
  for (const e of listEndpoints(app)) {
    if (!e.path.startsWith('/api/') || e.path.startsWith('/api-docs')) continue;
    for (const m of e.methods) real.add(`${m.toLowerCase()} ${norm(e.path)}`);
  }
  const documented = new Set(routes.map((r) => `${r.method} ${r.path}`));

  test('every route is documented', () => {
    expect([...real].filter((r) => !documented.has(r))).toEqual([]);
  });
  test('every documented route exists', () => {
    expect([...documented].filter((r) => !real.has(r))).toEqual([]);
  });
});