import express from 'express';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { config as loadDotenv } from 'dotenv';
import { handleCritiqueRequest, handleExtractRequest } from './server/apiCore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadDotenv({ path: path.join(__dirname, '.env.local'), override: true });

const port = Number(process.env.PORT || 3011);
const apiKey = (process.env.GEMINI_API_KEY || '').trim();
const isProd = process.env.NODE_ENV === 'production';
const distPath = path.join(__dirname, 'dist');

if (!apiKey) {
  console.warn('Warning: GEMINI_API_KEY is not set in .env.local');
}

const app = express();
app.use(express.json({ limit: '40mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, configured: Boolean(apiKey), mode: isProd ? 'production' : 'development' });
});

app.post('/api/gemini/extract', async (req, res) => {
  const result = await handleExtractRequest(req.body);
  res.status(result.status).json(result.body);
});

app.post('/api/gemini/critique', async (req, res) => {
  const result = await handleCritiqueRequest(req.body);
  res.status(result.status).json(result.body);
});

if (isProd) {
  if (!existsSync(distPath)) {
    console.error(`Production mode requires a build at ${distPath}. Run npm run build first.`);
    process.exit(1);
  }
  app.use(express.static(distPath));
  app.get('/{*path}', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const server = app.listen(port, () => {
  console.log(`API server listening on http://localhost:${port} (${isProd ? 'production' : 'development'})`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  console.error('Failed to start API server:', err.message);
  process.exit(1);
});

process.stdin.resume();
