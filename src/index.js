const http = require('http');
const https = require('https');
const { URL } = require('url');
const { repairJson } = require('./repair');
const { validateLicense } = require('./whop');

const PORT = process.env.PORT || 8787;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const INITIAL_BACKOFF_MS = parseInt(process.env.INITIAL_BACKOFF_MS || '300', 10);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function forwardRequest(targetUrl, method, headers, body, attempt = 1) {
  const urlObj = new URL(targetUrl);
  const client = urlObj.protocol === 'https:' ? https : http;

  const sanitizedHeaders = { ...headers };
  delete sanitizedHeaders.host;
  delete sanitizedHeaders['x-target-url'];
  delete sanitizedHeaders['x-toolguard-key'];

  return new Promise((resolve, reject) => {
    const req = client.request(urlObj, {
      method,
      headers: sanitizedHeaders,
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Gateway timeout from target service'));
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (reqUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'ToolGuard Proxy', version: '0.1.0' }));
    return;
  }

  if (reqUrl.pathname === '/proxy') {
    // 1. License / Whop Key Validation
    const authHeader = req.headers['authorization'] || '';
    const bearerKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const clientKey = req.headers['x-toolguard-key'] || reqUrl.searchParams.get('key') || bearerKey;

    const licenseCheck = await validateLicense(clientKey);
    if (!licenseCheck.valid) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Unauthorized',
        message: licenseCheck.error || 'Invalid or missing Whop license key. Provide via x-toolguard-key header or ?key=...',
        portal: 'https://whop.com'
      }));
      return;
    }

    // 2. Target validation
    const target = reqUrl.searchParams.get('url') || req.headers['x-target-url'];
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing target url parameter (?url=...) or x-target-url header' }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      let attempt = 0;
      let lastResult = null;
      let lastError = null;

      while (attempt < MAX_RETRIES) {
        attempt++;
        try {
          const result = await forwardRequest(target, req.method, req.headers, body, attempt);
          lastResult = result;

          // Retry on 429 (Rate Limit) or 5xx (Server Errors)
          if (result.statusCode === 429 || result.statusCode >= 500) {
            if (attempt < MAX_RETRIES) {
              const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
              await sleep(backoff);
              continue;
            }
          }

          // If JSON response, verify & auto-heal if broken
          const contentType = result.headers['content-type'] || '';
          let responseBody = result.body;
          let healed = false;

          if (contentType.includes('application/json') || responseBody.trim().startsWith('{') || responseBody.trim().startsWith('[')) {
            try {
              JSON.parse(responseBody);
            } catch (err) {
              try {
                const repaired = repairJson(responseBody);
                responseBody = JSON.stringify(repaired);
                healed = true;
              } catch (repairErr) {
                // Keep original if repair fails
              }
            }
          }

          res.writeHead(result.statusCode, {
            'Content-Type': 'application/json',
            'x-toolguard-attempts': attempt,
            'x-toolguard-healed': healed ? 'true' : 'false',
            'x-toolguard-tier': licenseCheck.tier || 'standard'
          });
          res.end(responseBody);
          return;

        } catch (err) {
          lastError = err;
          if (attempt < MAX_RETRIES) {
            await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1));
          }
        }
      }

      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'ToolGuard failed to forward request after retries',
        attempts: attempt,
        details: lastError ? lastError.message : (lastResult ? `Upstream returned status ${lastResult.statusCode}` : 'Unknown error')
      }));
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found. Use /proxy?url=...' }));
});

server.listen(PORT, () => {
  console.log(`ToolGuard proxy running on http://localhost:${PORT}`);
});
