import { beforeAll, afterAll, describe, it, expect } from 'bun:test';
import { createServer } from 'node:http';
import { Image } from 'imagescript';
import { createHttpHandler } from './src/httpHandler';
import { AvatarStore } from './src/AvatarStore';

const boundary = '----testboundary';

async function buildSamplePng(): Promise<Buffer> {
  const img = new Image(10, 20);
  return Buffer.from(await img.encode());
}

function buildMultipart(body: Buffer, filename: string, contentType: string): Blob {
  const preamble = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
  );
  const ending = Buffer.from(`\r\n--${boundary}--\r\n`);
  return new Blob([preamble, new Uint8Array(body), ending], { type: `multipart/form-data; boundary=${boundary}` });
}

describe('POST /avatar/upload', () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let avatarStore: AvatarStore;

  beforeAll(() => {
    avatarStore = new AvatarStore();
    const handler = createHttpHandler({ avatarStore });
    server = createServer(handler);
    server.listen(0);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('accepts jpeg/png/webp <=2MB and returns avatarId', async () => {
    const png = await buildSamplePng();
    const body = buildMultipart(png, 'tiny.png', 'image/png');
    const res = await fetch(`${baseUrl}/avatar/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=----testboundary'
      },
      body
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.avatarId).toBeDefined();
    expect(typeof json.avatarId).toBe('string');

    const stored = avatarStore.get(json.avatarId);
    expect(stored).toBeDefined();
    expect(stored?.width).toBe(256);
    expect(stored?.height).toBe(256);
    expect(stored?.contentType.startsWith('image/')).toBe(true);
  });

  it('rejects files over 2MB', async () => {
    const bigBuffer = Buffer.alloc(2 * 1024 * 1024 + 1, 1);
    const body = buildMultipart(bigBuffer, 'big.png', 'image/png');
    const res = await fetch(`${baseUrl}/avatar/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=----testboundary'
      },
      body
    });

    expect(res.status).toBe(413);
  });

  it('rejects unsupported types', async () => {
    const body = buildMultipart(Buffer.from('not-an-image'), 'file.txt', 'text/plain');
    const res = await fetch(`${baseUrl}/avatar/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=----testboundary'
      },
      body
    });

    expect(res.status).toBe(415);
  });
});
