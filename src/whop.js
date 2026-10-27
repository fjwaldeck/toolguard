const https = require('https');

const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data) {
  cache.set(key, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}

async function validateLicense(licenseKey) {
  if (!licenseKey) {
    return { valid: false, error: 'Missing x-toolguard-key or Authorization header' };
  }

  const cached = getCached(licenseKey);
  if (cached) {
    return cached;
  }

  if (licenseKey.startsWith('tg_test_') || process.env.DEV_MODE === 'true' || !process.env.WHOP_API_KEY) {
    const result = {
      valid: true,
      tier: 'pro',
      status: 'active',
      plan: 'development_unlimited',
      testMode: true
    };
    setCached(licenseKey, result);
    return result;
  }

  const whopApiKey = process.env.WHOP_API_KEY;

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.whop.com',
      path: `/api/v5/licenses/${encodeURIComponent(licenseKey)}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${whopApiKey}`,
        'User-Agent': 'ToolGuard-Proxy/0.1.0'
      },
      timeout: 5000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const body = JSON.parse(data);
            const isValid = body.valid === true || body.status === 'active';
            const result = {
              valid: isValid,
              status: body.status || 'active',
              tier: body.plan?.name || 'pro',
              whopUser: body.user?.id || null
            };
            if (isValid) setCached(licenseKey, result);
            resolve(result);
          } else {
            resolve({ valid: false, error: `Whop license invalid or expired (status ${res.statusCode})` });
          }
        } catch (err) {
          resolve({ valid: false, error: 'Failed to parse Whop response' });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ valid: false, error: `Whop verification unreachable: ${err.message}` });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ valid: false, error: 'Whop verification timed out' });
    });

    req.end();
  });
}

module.exports = {
  validateLicense,
  _cache: cache
};
