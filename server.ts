import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { closeApiResources } from './server/api.js';
import app from './server/app.js';

const PORT = Number(process.env.PORT) || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const distDir = path.resolve(__dirname, 'dist');
  if (!fs.existsSync(distDir)) {
    throw new Error(`Frontend build not found at ${distDir}. Run npm run build first.`);
  }
  app.use(express.static(distDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(distDir, 'index.html'));
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const type = error && typeof error === 'object' ? (error as { type?: unknown }).type : undefined;
    const status = type === 'entity.too.large' ? 413 : type === 'entity.parse.failed' ? 400 : 500;
    if (status === 500) console.error('Unhandled request error');
    res.status(status).json({ error: status === 413 ? 'Isi permintaan terlalu besar.' : status === 400 ? 'Format JSON tidak valid.' : 'Terjadi kesalahan internal.' });
  });

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`CatatUang server listening on port ${PORT}${process.env.APP_URL ? ` (${process.env.APP_URL})` : ''}`);
  });

  const shutdown = () => {
    httpServer.close(() => {
      void closeApiResources().catch(() => {
        console.error('Failed to close the PostgreSQL session pool cleanly.');
      });
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.env.VERCEL !== '1' && !process.env.VERCEL_ENV) {
  void startServer().catch(async (error: unknown) => {
    await closeApiResources().catch(() => undefined);
    console.error(error instanceof Error ? error.message : 'Server startup failed.');
    process.exitCode = 1;
  });
}
