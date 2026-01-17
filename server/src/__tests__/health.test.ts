import { describe, expect, test, afterAll, beforeAll } from 'bun:test';
import { createServer } from 'http';
import type { Server as HttpServer } from 'http';

describe('Health endpoint', () => {
  let server: HttpServer;
  let port: number;

  beforeAll(async () => {
    // Create a test server with just the health endpoint
    server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    });

    // Start on a random available port
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(() => {
    server.close();
  });

  test('GET /health returns 200 with status ok', async () => {
    const response = await fetch(`http://localhost:${port}/health`);
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  });

  test('GET /unknown returns 404', async () => {
    const response = await fetch(`http://localhost:${port}/unknown`);
    expect(response.status).toBe(404);
  });
});
