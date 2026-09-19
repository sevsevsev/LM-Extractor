import express from 'express';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { config as loadDotenv } from 'dotenv';
import { handleExtractRequest, handleDetectLogicModelGroupsRequest } from './server/apiCore.js';
import { handlePptxToPdfRequest } from './server/pptxConvertApi.js';
import { getLibreOfficeWasmPath } from './server/libreOfficeConverter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadDotenv({ path: path.join(__dirname, '.env.local'), override: true });

const port = Number(process.env.PORT || 3011);
const apiKey = (process.env.GEMINI_API_KEY || '').trim();
const isProd = process.env.NODE_ENV === 'production';
const distPath = path.join(__dirname, 'dist');
const wasmPath = getLibreOfficeWasmPath();

if (!apiKey) {
  console.warn('Warning: GEMINI_API_KEY is not set in .env.local');
}

const app = express();

// PPTX→PDF must run before JSON body parser (raw binary upload).
app.post(
  '/api/convert/pptx-to-pdf',
  express.raw({ type: () => true, limit: '80mb' }),
  async (req, res) => {
    const filename =
      typeof req.query.filename === 'string' && req.query.filename.trim()
        ? req.query.filename.trim()
        : 'presentation.pptx';
    const result = await handlePptxToPdfRequest(req.body, filename);
    res.status(result.status).json(result.body);
  }
);

app.use(express.json({ limit: '40mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(apiKey),
    mode: isProd ? 'production' : 'development',
    libreOfficeWasm: existsSync(path.join(wasmPath, 'soffice.wasm')),
  });
});

app.post('/api/gemini/extract', async (req, res) => {
  const result = await handleExtractRequest(req.body);
  res.status(result.status).json(result.body);
});

app.post('/api/gemini/detect-logic-models', async (req, res) => {
  const result = await handleDetectLogicModelGroupsRequest(req.body);
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
  console.log(`LibreOffice WASM path: ${wasmPath}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  console.error('Failed to start API server:', err.message);
  process.exit(1);
});

process.stdin.resume();
