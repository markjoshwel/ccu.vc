import { IncomingMessage, ServerResponse } from 'node:http';
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { ImageType } from 'imagescript';
import { AvatarStore } from './AvatarStore';
import { processAvatarImage } from './ImagePipeline';

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024; // allow small multipart overhead
const MAX_URL_BODY_BYTES = 8 * 1024; // small JSON payload

const defaultResolveHost = async (hostname: string): Promise<string[]> => {
  const lookups = await dns.lookup(hostname, { all: true });
  return lookups.map(entry => entry.address);
};

export type HttpHandlerDeps = {
  avatarStore: AvatarStore;
  fetchImpl?: typeof fetch;
  resolveHost?: (hostname: string) => Promise<string[]>;
  getStats?: () => { rooms: number; players: number; avatars: number };
};


export function createHttpHandler(deps: HttpHandlerDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const resolveHost = deps.resolveHost ?? defaultResolveHost;

  return async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    // Add CORS headers for all requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const parsedUrl = req.url ? new URL(req.url, 'http://localhost') : null;

      if (req.url === '/health' && req.method === 'GET') {
        const stats = deps.getStats?.() ?? { rooms: 0, players: 0, avatars: deps.avatarStore.size };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          status: 'ok',
          uptime: process.uptime(),
          rooms: stats.rooms,
          players: stats.players,
          avatars: stats.avatars
        }));
        return;
      }

      if (parsedUrl && req.method === 'GET' && parsedUrl.pathname.startsWith('/avatars/')) {
        const avatarId = parsedUrl.pathname.slice('/avatars/'.length);
        if (!avatarId) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        const stored = deps.avatarStore.get(avatarId);
        if (!stored) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': stored.contentType,
          'Content-Length': stored.data.byteLength
        });
        res.end(Buffer.from(stored.data));
        return;
      }

      if (req.url === '/avatar/upload' && req.method === 'POST') {
        await handleAvatarUpload(req, res, deps.avatarStore);
        return;
      }

      if (req.url === '/avatar/from-url' && req.method === 'POST') {
        await handleAvatarFromUrl(req, res, deps.avatarStore, fetchImpl, resolveHost);
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    } catch (err) {
      console.error('Request handler error', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  };
}

async function handleAvatarUpload(req: IncomingMessage, res: ServerResponse, avatarStore: AvatarStore) {
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.startsWith('multipart/form-data')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Expected multipart/form-data with field "file"' }));
    return;
  }

  const boundary = getBoundary(contentType);
  if (!boundary) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing boundary' }));
    return;
  }

  const bodyResult = await readRequestBody(req, MAX_BODY_BYTES, res);
  if (!bodyResult.buffer) {
    return;
  }

  const part = parseMultipart(bodyResult.buffer, boundary);
  if (!part) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid multipart body' }));
    return;
  }

  if (part.data.byteLength > MAX_FILE_BYTES) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'File too large' }));
    return;
  }

  const sniffedType = ImageType.getType(new Uint8Array(part.data));
  if (!sniffedType || !isAllowedImageType(sniffedType)) {
    res.writeHead(415, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unsupported image type' }));
    return;
  }

  try {
    const processed = await processAvatarImage(
      part.data.buffer.slice(part.data.byteOffset, part.data.byteOffset + part.data.byteLength) as ArrayBuffer,
      sniffedType
    );

    const avatarId = avatarStore.save({
      data: processed.data,
      contentType: processed.contentType,
      width: processed.width,
      height: processed.height
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ avatarId }));
  } catch (error) {
    console.error('Failed to process avatar upload', error);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid image' }));
  }
}

async function handleAvatarFromUrl(
  req: IncomingMessage,
  res: ServerResponse,
  avatarStore: AvatarStore,
  fetchImpl: typeof fetch,
  resolveHost: (hostname: string) => Promise<string[]>
) {
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('application/json')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Expected application/json body' }));
    return;
  }

  const bodyResult = await readRequestBody(req, MAX_URL_BODY_BYTES, res);
  if (!bodyResult.buffer) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyResult.buffer.toString('utf8'));
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const urlValue = (parsed as { url?: string }).url;
  if (typeof urlValue !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing url' }));
    return;
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(urlValue);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid url' }));
    return;
  }

  if (targetUrl.protocol !== 'https:') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Only https is allowed' }));
    return;
  }

  const hostCheck = await validateRemoteHost(targetUrl.hostname, resolveHost);
  if (!hostCheck.ok) {
    res.writeHead(hostCheck.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: hostCheck.message }));
    return;
  }

  let response: Response;
  try {
    response = await fetchImpl(targetUrl.toString(), { redirect: 'error' });
  } catch (err) {
    console.error('Failed to fetch avatar url', err);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to download image' }));
    return;
  }

  if (response.redirected) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Redirects are not allowed' }));
    return;
  }

  if (!response.ok) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to download image' }));
    return;
  }

  if (response.url) {
    const { hostname } = new URL(response.url, targetUrl);
    const redirectCheck = await validateRemoteHost(hostname, resolveHost);
    if (!redirectCheck.ok) {
      res.writeHead(redirectCheck.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: redirectCheck.message }));
      return;
    }
  }

  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(contentLength) && contentLength > MAX_FILE_BYTES) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File too large' }));
      return;
    }
  }

  const downloaded = await readStreamWithLimit(response.body, MAX_FILE_BYTES);
  if (!downloaded.ok) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'File too large' }));
    return;
  }

  const data = downloaded.data;
  const sniffedType = ImageType.getType(data);
  if (!sniffedType || !isAllowedImageType(sniffedType)) {
    res.writeHead(415, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unsupported image type' }));
    return;
  }

  try {
    const processed = await processAvatarImage(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      sniffedType
    );

    const avatarId = avatarStore.save({
      data: processed.data,
      contentType: processed.contentType,
      width: processed.width,
      height: processed.height
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ avatarId }));
  } catch (error) {
    console.error('Failed to process avatar from url', error);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid image' }));
  }
}

function getBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary=(.*)$/);
  if (!match) return null;
  const value = match[1].trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

async function readRequestBody(req: IncomingMessage, maxBytes: number, res: ServerResponse): Promise<{ buffer: Buffer | null; tooLarge: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  let tooLarge = false;

  return new Promise((resolve) => {
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      total += chunk.length;
      if (total > maxBytes) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (tooLarge) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File too large' }));
        resolve({ buffer: null, tooLarge: true });
        return;
      }
      resolve({ buffer: Buffer.concat(chunks), tooLarge: false });
    });

    req.on('error', () => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request' }));
      resolve({ buffer: null, tooLarge: false });
    });
  });
}

function parseMultipart(buffer: Buffer, boundary: string): { filename?: string; contentType?: string; data: Buffer } | null {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = [] as Buffer[];

  let searchIndex = 0;
  while (true) {
    const boundaryIndex = buffer.indexOf(boundaryBuffer, searchIndex);
    if (boundaryIndex === -1) break;
    const nextIndex = buffer.indexOf(boundaryBuffer, boundaryIndex + boundaryBuffer.length);
    if (nextIndex === -1) break;
    const part = buffer.slice(boundaryIndex + boundaryBuffer.length + 2, nextIndex - 2); // skip CRLF after boundary and before next
    parts.push(part);
    searchIndex = nextIndex;
  }

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerSection = part.slice(0, headerEnd).toString('utf8');
    const body = part.slice(headerEnd + 4);

    const headers = headerSection.split('\r\n');
    const disposition = headers.find(h => h.toLowerCase().startsWith('content-disposition'));
    if (!disposition) continue;
    if (!/name="file"/.test(disposition)) continue;

    const filenameMatch = disposition.match(/filename="(.+?)"/);
    const contentTypeHeader = headers.find(h => h.toLowerCase().startsWith('content-type'));
    const contentType = contentTypeHeader ? contentTypeHeader.split(':')[1].trim() : undefined;

    return {
      filename: filenameMatch ? filenameMatch[1] : undefined,
      contentType,
      data: body
    };
  }

  return null;
}

function isAllowedImageType(type: string): boolean {
  const lower = type.toLowerCase();
  return lower.includes('png') || lower.includes('jpeg') || lower.includes('jpg') || lower.includes('webp');
}

async function validateRemoteHost(hostname: string, resolveHost: (hostname: string) => Promise<string[]>): Promise<{ ok: boolean; status: number; message: string }> {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost') {
    return { ok: false, status: 403, message: 'Local addresses are not allowed' };
  }

  const ipVersion = isIP(hostname);
  if (ipVersion) {
    if (isPrivateAddress(hostname)) {
      return { ok: false, status: 403, message: 'Local addresses are not allowed' };
    }
    return { ok: true, status: 200, message: 'ok' };
  }

  try {
    const addresses = await resolveHost(hostname);
    if (!addresses.length) {
      return { ok: false, status: 400, message: 'Unable to resolve host' };
    }
    const hasPrivate = addresses.some(entry => isPrivateAddress(entry));
    if (hasPrivate) {
      return { ok: false, status: 403, message: 'Local addresses are not allowed' };
    }
    return { ok: true, status: 200, message: 'ok' };
  } catch (err) {
    console.error('DNS resolution failed', err);
    return { ok: false, status: 400, message: 'Unable to resolve host' };
  }
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    return false;
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local
    if (normalized.startsWith('fe80')) return true; // link local
    return false;
  }
  return true;
}

async function readStreamWithLimit(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<{ ok: boolean; data: Uint8Array }> {
  if (!stream) return { ok: false, data: new Uint8Array() };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      return { ok: false, data: new Uint8Array() };
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, data: merged };
}
