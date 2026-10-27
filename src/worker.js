// Cloudflare Worker entry point for ToolGuard edge deployment
import { repairJson } from './repair.js';

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        }
      });
    }

    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', runtime: 'cloudflare-worker', version: '0.1.0' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (url.pathname === '/proxy') {
      const authHeader = request.headers.get('authorization') || '';
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
      const key = request.headers.get('x-toolguard-key') || url.searchParams.get('key') || bearer;

      if (!key) {
        return new Response(JSON.stringify({ error: 'Unauthorized', message: 'Missing x-toolguard-key or ?key= parameter' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      const target = url.searchParams.get('url') || request.headers.get('x-target-url');
      if (!target) {
        return new Response(JSON.stringify({ error: 'Missing target url parameter (?url=...)' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      let attempt = 0;
      const maxRetries = 3;
      let lastRes = null;

      while (attempt < maxRetries) {
        attempt++;
        try {
          const forwardHeaders = new Headers(request.headers);
          forwardHeaders.delete('x-target-url');
          forwardHeaders.delete('x-toolguard-key');
          forwardHeaders.delete('host');

          const response = await fetch(target, {
            method: request.method,
            headers: forwardHeaders,
            body: ['GET', 'HEAD'].includes(request.method) ? null : await request.clone().arrayBuffer()
          });

          lastRes = response;

          if (response.status === 429 || response.status >= 500) {
            if (attempt < maxRetries) {
              await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt - 1)));
              continue;
            }
          }

          let bodyText = await response.text();
          let healed = false;

          if (bodyText.trim().startsWith('{') || bodyText.trim().startsWith('[')) {
            try {
              JSON.parse(bodyText);
            } catch (err) {
              try {
                const repaired = repairJson(bodyText);
                bodyText = JSON.stringify(repaired);
                healed = true;
              } catch (_) {}
            }
          }

          const outHeaders = new Headers(response.headers);
          outHeaders.set('Access-Control-Allow-Origin', '*');
          outHeaders.set('x-toolguard-attempts', attempt.toString());
          outHeaders.set('x-toolguard-healed', healed ? 'true' : 'false');

          return new Response(bodyText, {
            status: response.status,
            headers: outHeaders
          });

        } catch (err) {
          if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt - 1)));
          }
        }
      }

      return new Response(JSON.stringify({
        error: 'ToolGuard failed to forward request after retries',
        attempts: attempt,
        status: lastRes ? lastRes.status : 502
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
