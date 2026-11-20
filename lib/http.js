import { HttpError } from './payment.js';

export function endpoint(method, callback, { webhook = false } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== method) { res.setHeader('Allow', method); return res.status(405).json({ error: 'Método não permitido.' }); }
    try {
      if (method === 'POST') {
        if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Envie os dados em JSON.');
        if (Number(req.headers['content-length'] || 0) > 16384) throw new HttpError(413, 'Solicitação muito grande.');
        if (!webhook) {
          const origin = req.headers.origin;
          const allowed = [process.env.APP_URL, process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`, process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`].filter(Boolean).map(url => new URL(url).origin);
          if (process.env.NODE_ENV !== 'production') allowed.push('http://localhost:3000', 'http://127.0.0.1:3000');
          if (!origin || !allowed.includes(origin)) throw new HttpError(403, 'Origem não autorizada.');
        }
        if (typeof req.body === 'string') { try { req.body = JSON.parse(req.body); } catch { throw new HttpError(400, 'Dados inválidos.'); } }
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || JSON.stringify(req.body).length > 16384) throw new HttpError(400, 'Dados inválidos.');
      }
      const result = await callback(req, res);
      if (!res.writableEnded) res.status(200).json(result);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 503;
      if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
      if (!(error instanceof HttpError)) console.error('payment_service_error', { name: error.name });
      res.status(status).json({ error: error instanceof HttpError ? error.message : 'O serviço está demorando a responder. Tente novamente para recuperar a mesma cobrança.', ...(error.field ? { field: error.field } : {}), ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) });
    }
  };
}
