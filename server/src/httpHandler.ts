import { IncomingMessage, ServerResponse } from 'node:http';
import { ImageType } from 'imagescript';
import { AvatarStore } from './AvatarStore';
import { processAvatarImage } from './ImagePipeline';

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024; // allow small multipart overhead

export type HttpHandlerDeps = {
  avatarStore: AvatarStore;
};


export function createHttpHandler(deps: HttpHandlerDeps) {
  return async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    try {
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (req.url === '/avatar/upload' && req.method === 'POST') {
        await handleAvatarUpload(req, res, deps.avatarStore);
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
