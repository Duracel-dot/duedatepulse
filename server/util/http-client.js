// Client HTTP(S) minimal (sans dependance) pour les API vSphere / Proxmox / etc.
// Gere les certificats auto-signes (option insecure) ou une AC specifique (ca).
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';

export class HttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

/**
 * @param {string} url
 * @param {{method?:string, headers?:object, body?:any, form?:object, insecure?:boolean, ca?:string,
 *          timeoutMs?:number, json?:boolean}} opts
 * @returns {Promise<{status:number, headers:object, body:any, text:string}>}
 */
export function httpRequest(url, opts = {}) {
  const u = new URL(url);
  const isHttps = u.protocol === 'https:';
  const headers = { Accept: 'application/json', ...(opts.headers || {}) };
  let payload = null;
  if (opts.form) {
    payload = new URLSearchParams(opts.form).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (opts.body !== undefined && opts.body !== null) {
    payload = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
  }
  if (payload != null) headers['Content-Length'] = Buffer.byteLength(payload);

  const reqOpts = {
    method: opts.method || (payload != null ? 'POST' : 'GET'),
    hostname: u.hostname,
    port: u.port || (isHttps ? 443 : 80),
    path: u.pathname + u.search,
    headers,
  };
  if (isHttps) {
    reqOpts.rejectUnauthorized = !opts.insecure;
    if (opts.ca) reqOpts.ca = fs.readFileSync(opts.ca);
  }
  const timeoutMs = opts.timeoutMs ?? 30000;

  return new Promise((resolve, reject) => {
    const req = (isHttps ? https : http).request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body = text;
        const ct = String(res.headers['content-type'] || '');
        if (opts.json !== false && (ct.includes('json') || /^\s*[[{]/.test(text))) {
          try { body = text ? JSON.parse(text) : null; } catch { body = text; }
        }
        const result = { status: res.statusCode, headers: res.headers, body, text };
        if (res.statusCode >= 400) {
          reject(new HttpError(`HTTP ${res.statusCode} ${reqOpts.method} ${u.pathname}`, res.statusCode, body));
        } else {
          resolve(result);
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`delai depasse (${timeoutMs} ms) ${u.host}`)));
    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}
