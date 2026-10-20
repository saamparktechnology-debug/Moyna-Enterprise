// A small HTTP client for the ERP API, with a cookie jar and the CSRF token, so a script can act as several people.
import { gstinCheckCharacter } from '../../packages/contracts/dist/index.js';

export class ApiError extends Error {
  constructor(method, path, status, body) {
    const detail = body?.details?.map((d) => `${d.field ?? ''}: ${d.message}`).join('; ');
    super(
      `${method} ${path} -> ${status} ${body?.code ?? ''} ${body?.message ?? ''}${detail ? ` (${detail})` : ''}`,
    );
    this.status = status;
    this.body = body;
  }
}

export class Api {
  constructor({ baseUrl, origin, label = '' }) {
    this.baseUrl = baseUrl;
    this.origin = origin;
    this.label = label;
    this.cookies = new Map();
    this.csrf = '';
    this.branchId = null;
  }

  async request(method, path, body, headers = {}) {
    const init = {
      method,
      headers: {
        Origin: this.origin,
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(this.csrf && method !== 'GET' ? { 'X-CSRF-Token': this.csrf } : {}),
        ...(this.branchId ? { 'X-Branch-Id': this.branchId } : {}),
        ...headers,
      },
    };
    if (body !== undefined) {
      if (Buffer.isBuffer(body)) init.body = body;
      else {
        init.body = JSON.stringify(body);
        init.headers['Content-Type'] = 'application/json';
      }
    }
    const response = await fetch(`${this.baseUrl}${path}`, init);
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
    }
    const text = await response.text();
    const parse = () => {
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        return text;
      }
    };
    return { status: response.status, body: parse() };
  }

  async call(method, path, body, headers) {
    const result = await this.request(method, path, body, headers);
    if (result.status >= 400) throw new ApiError(method, path, result.status, result.body);
    return result.body;
  }

  get = (path) => this.call('GET', path);
  post = (path, body = {}) => this.call('POST', path, body);
  patch = (path, body = {}) => this.call('PATCH', path, body);
  put = (path, body = {}) => this.call('PUT', path, body);

  async login(username, password) {
    const result = await this.request('POST', '/auth/login', { username, password });
    if (result.status !== 200)
      throw new ApiError('POST', '/auth/login', result.status, result.body);
    this.csrf = result.body.csrfToken;
    return result.body;
  }

  /** Lists every page of a paginated endpoint. */
  async all(path, pageSize = 100) {
    const out = [];
    for (let page = 1; ; page += 1) {
      const sep = path.includes('?') ? '&' : '?';
      const result = await this.get(`${path}${sep}page=${page}&pageSize=${pageSize}`);
      out.push(...result.items);
      if (page >= result.totalPages) return out;
    }
  }
}

/** A small seeded random number generator, so every run produces the same demo. */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    shuffle: (list) => {
      const copy = [...list];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
  };
}

/** A GSTIN with a correct check character, built from a state code and a made-up PAN. */
export function makeGstin(stateCode, pan, entity = '1') {
  const first14 = `${stateCode}${pan}${entity}Z`;
  return `${first14}${gstinCheckCharacter(first14)}`;
}

export const money = (value) => Number(value).toFixed(2);
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const isoDay = (offsetDays = 0, from = new Date()) =>
  new Date(from.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);
export const log = (message) => process.stdout.write(`${message}\n`);
