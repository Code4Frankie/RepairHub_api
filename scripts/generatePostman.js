// Generates postman/RepairHub.postman_collection.json from the route table in config/swagger.js.
// Run: npm run docs:generate
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { routes } from '../config/swagger.js';

const sample = { string: 'string', integer: 1, number: 1, boolean: true, array: [], object: {}, date: new Date(Date.now() + 864e5).toISOString() };
const example = (schema) => Object.fromEntries(Object.entries(schema).map(([k, v]) => {
    const t = String(Array.isArray(v) ? v[0] : v).replace('!', '');
    return [k, Array.isArray(v) ? v[0] : sample[t] ?? 'string'];
}));

const items = {};
for (const r of routes) {
    const url = `{{baseUrl}}${r.path.replace(/\{(\w+)\}/g, ':$1')}`;
    const req = {
        method: r.method.toUpperCase(),
        header: [],
        url: {
            raw: url,
            host: ['{{baseUrl}}'],
            path: r.path.split('/').filter(Boolean).map((s) => s.replace(/\{(\w+)\}/, ':$1')),
            variable: [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ key: m[1], value: `{{${m[1]}}}` })),
            query: Object.keys(r.query || {}).map((k) => ({ key: k, value: '', disabled: true })),
        },
        description: r.summary + (r.roles ? `\n\nRoles: ${r.roles.join(', ')}` : ''),
    };
    if (r.auth === false) req.auth = { type: 'noauth' };
    if (r.body) {
        req.header.push({ key: 'Content-Type', value: 'application/json' });
        req.body = { mode: 'raw', raw: JSON.stringify(r.example || example(r.body), null, 2), options: { raw: { language: 'json' } } };
    }
    if (r.multipart) {
        req.body = { mode: 'formdata', formdata: Object.entries(r.multipart).map(([k, v]) => (v === 'file' ? { key: k, type: 'file', src: [] } : { key: k, type: 'text', value: String(Array.isArray(v) ? v[0] : sample[String(v).replace('!', '')] ?? '') })) };
    }
    const item = { name: r.summary.split(' — ')[0].slice(0, 80), request: req };
    if (r.saveToken) {
        item.event = [{ listen: 'test', script: { type: 'text/javascript', exec: ["const j = pm.response.json();", "if (j.data && j.data.token) { pm.collectionVariables.set('token', j.data.token); }"] } }];
    }
    (items[r.tag] ||= []).push(item);
}

const collection = {
    info: { name: 'RepairHub API', description: 'Generated from config/swagger.js — run `npm run docs:generate` to refresh.', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
    variable: [
        { key: 'baseUrl', value: 'http://localhost:5000/api' },
        { key: 'token', value: '' },
        ...['id', 'jobId', 'userId', 'claimId', 'technicianId', 'reference'].map((key) => ({ key, value: '' })),
    ],
    item: Object.entries(items).map(([name, item]) => ({ name, item })),
};

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../postman/RepairHub.postman_collection.json');
fs.writeFileSync(out, JSON.stringify(collection, null, 2));
console.log(`Wrote ${out} (${routes.length} requests)`);
