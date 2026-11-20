import { createHmac, timingSafeEqual } from 'node:crypto';

export const AMOUNT = 197;
export const PRODUCT = 'Combo Vitalício — Dr. Moacir Rosa';
const PAID = new Set(['PAID', 'APPROVED', 'COMPLETED', 'SUCCESS', 'CONFIRMED', 'COMPLETO']);
const FAILED = new Set(['FAILED', 'FAIL', 'ERROR', 'REJECTED', 'REFUNDED']);
export const requiredEnv = ['NEXUM_CHAT_ID', 'NEXUM_API_CREDENTIAL', 'CHECKOUT_SECRET', 'NEXUM_WEBHOOK_TOKEN', 'APP_URL', 'PUSH_PAID_URL', 'PUSH_PENDING_URL'];

export class HttpError extends Error {
  constructor(status, message, field, retryAfter) { super(message); this.status = status; this.field = field; this.retryAfter = retryAfter; }
}
export function ready(env = process.env) { return requiredEnv.every(key => Boolean(env[key]?.trim())); }
export function normalizeStatus(value) {
  const status = String(value || '').toUpperCase();
  if (PAID.has(status)) return 'PAID';
  if (FAILED.has(status)) return 'FAILED';
  if (['CANCELLED', 'CANCELED'].includes(status)) return 'CANCELLED';
  if (status === 'EXPIRED') return 'EXPIRED';
  return status === 'PROCESSING' ? 'PROCESSING' : 'PENDING';
}
export function validCpf(input) {
  const cpf = String(input || '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let count = 9; count < 11; count++) {
    const sum = [...cpf.slice(0, count)].reduce((total, n, i) => total + Number(n) * (count + 1 - i), 0);
    const digit = (sum * 10) % 11 % 10;
    if (digit !== Number(cpf[count])) return false;
  }
  return true;
}
export function validateCustomer(body) {
  const name = String(body.name || '').trim().replace(/\s+/g, ' ');
  const generatedName = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[-'’]/g, ' ').replace(/\s+/g, ' ').trim();
  if (name.length > 120 || !/^[A-Za-z]{2,}(?: [A-Za-z]+)+$/.test(generatedName)) throw new HttpError(400, 'Informe seu nome e sobrenome, usando apenas letras.', 'name');
  const email = String(body.email || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, 'Informe um e-mail válido.', 'email');
  let phone = String(body.phone || '').replace(/\D/g, '');
  if (phone.length > 11 && phone.startsWith('55')) phone = phone.slice(2);
  if (!/^[1-9]{2}(?:9\d{8}|[2-8]\d{7})$/.test(phone)) throw new HttpError(400, 'Informe um telefone válido com DDD.', 'phone');
  const cpf = String(body.cpf || '').replace(/\D/g, '');
  if (!validCpf(cpf)) throw new HttpError(400, 'Confira os números do seu CPF.', 'cpf');
  if (body.consent !== true) throw new HttpError(400, 'Aceite os termos e a política de privacidade para continuar.', 'consent');
  if (body.website) throw new HttpError(400, 'Não foi possível validar esta solicitação.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.orderId || '')) throw new HttpError(400, 'Recarregue a página e tente novamente.');
  return { name, generatedName, email, phone, cpf };
}
function signature(value, secret) { return createHmac('sha256', secret).update(value).digest('base64url'); }
export function safeEqual(a, b) {
  const left = Buffer.from(String(a || '')); const right = Buffer.from(String(b || ''));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
export function orderReference(orderId, customer, secret) {
  // This identifier contains no customer data. Retries keep the same provider key.
  const hash = signature(JSON.stringify([orderId, customer.generatedName, customer.email, customer.cpf]), secret).slice(0, 24);
  const base = `diabetes_${orderId}_${hash}`;
  return `${base}.${signature(base, secret).slice(0, 24)}`;
}
export function validReference(ref, secret) {
  if (typeof ref !== 'string' || ref.length > 150) return false;
  const [base, sig, extra] = ref.split('.');
  return !extra && /^diabetes_[0-9a-f-]{36}_[\w-]{24}$/.test(base) && safeEqual(sig, signature(base, secret).slice(0, 24));
}
export function signSession(data, secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ ...data, exp: now + 7 * 86400000 })).toString('base64url');
  return `${payload}.${signature(payload, secret)}`;
}
export function readSession(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 2000) throw new HttpError(401, 'Pedido não encontrado. Volte ao checkout.');
  const [payload, sig, extra] = token.split('.');
  if (extra || !safeEqual(sig, signature(payload || '', secret))) throw new HttpError(401, 'Não foi possível validar este pedido.');
  let session;
  try { session = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw new HttpError(401, 'Pedido inválido.'); }
  if (!session.exp || session.exp < now || !/^[a-zA-Z0-9_-]{3,150}$/.test(session.txId) || !validReference(session.reference, secret)) throw new HttpError(401, 'Sua sessão expirou. Entre em contato com o suporte com seu comprovante.');
  return session;
}
export async function nexum(path, { env = process.env, fetchImpl = fetch, body, idempotencyKey } = {}) {
  const response = await fetchImpl(`https://api.nexumpaybot.com${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Origin: env.NEXUM_ORIGIN || 'https://nexumpaybot.com',
      'X-API-Chat-Id': env.NEXUM_CHAT_ID,
      'X-API-Credential': env.NEXUM_API_CREDENTIAL,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(25000),
  });
  let data;
  try { data = await response.json(); } catch { throw new HttpError(502, 'O serviço de pagamento não respondeu. Tente novamente para recuperar a mesma cobrança.'); }
  if (response.status === 429) {
    const seconds = Math.min(300, Math.max(30, Number(response.headers.get('retry-after')) || 30));
    throw new HttpError(429, 'Aguarde alguns instantes antes de consultar novamente.', null, seconds);
  }
  if (!response.ok || data.ok === false) {
    // Never return provider error bodies, credentials, or customer data to logs/browser.
    console.error('nexum_request_failed', { status: response.status, operation: body ? 'create' : 'status' });
    throw new HttpError(502, 'Não foi possível concluir a solicitação do Pix. Confira seus dados e tente novamente.');
  }
  return data;
}
export async function createPayment(body, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!ready(env)) throw new HttpError(503, 'As inscrições estão sendo preparadas. O pagamento estará disponível em breve.');
  const customer = validateCustomer(body);
  const reference = orderReference(body.orderId, customer, env.CHECKOUT_SECRET);
  const callback = new URL('/api/pix/webhook', env.APP_URL);
  const data = await nexum('/api/public/pix/create', { ...dependencies, env, idempotencyKey: reference, body: {
    amount: AMOUNT,
    generatedName: customer.generatedName,
    generatedEmail: customer.email,
    generatedDocument: customer.cpf,
    externalReference: reference,
    webhook: { url: callback.href, token: env.NEXUM_WEBHOOK_TOKEN },
  } });
  if (!/^[a-zA-Z0-9_-]{3,150}$/.test(data.tx_id || '') || Math.round(Number(data.amount) * 100) !== AMOUNT * 100) throw new HttpError(502, 'Não foi possível validar a cobrança. Tente novamente para recuperá-la.');
  const status = normalizeStatus(data.status);
  const code = typeof data.qr_code_text === 'string' ? data.qr_code_text : '';
  if (!code && !['PROCESSING', 'PAID'].includes(status)) throw new HttpError(502, 'O Pix ainda não está disponível. Tente novamente para recuperar a mesma cobrança.');
  const duration = Math.max(60, Math.min(7 * 86400, Number(data.expires_in_seconds) || 86400));
  const expiresAt = Date.now() + duration * 1000;
  return {
    txId: data.tx_id, amount: AMOUNT, status, code, expiresAt,
    token: signSession({ txId: data.tx_id, reference, ...(status === 'PAID' ? { paidAt: Date.now() } : {}) }, env.CHECKOUT_SECRET),
  };
}
export async function paymentStatus(token, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!ready(env)) throw new HttpError(503, 'A consulta de pagamentos está temporariamente indisponível.');
  const session = readSession(token, env.CHECKOUT_SECRET);
  const data = await nexum(`/api/public/pix/status/${encodeURIComponent(session.txId)}`, dependencies);
  if ((data.tx_id && data.tx_id !== session.txId) || Math.round(Number(data.amount) * 100) !== AMOUNT * 100) throw new HttpError(502, 'Não foi possível validar o valor deste pagamento.');
  const status = normalizeStatus(data.status);
  return { txId: session.txId, status, amount: AMOUNT, token: signSession({ txId: session.txId, reference: session.reference, ...(status === 'PAID' ? { paidAt: Date.now() } : {}) }, env.CHECKOUT_SECRET), code: typeof data.qr_code_text === 'string' ? data.qr_code_text : '' };
}
export async function forwardNotification(body, token, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!env.NEXUM_WEBHOOK_TOKEN || !safeEqual(token, env.NEXUM_WEBHOOK_TOKEN)) throw new HttpError(401, 'Não autorizado.');
  if (body.event !== 'pix.status_changed') return { ignored: true };
  const reference = body.transaction?.external_reference;
  if (!validReference(reference, env.CHECKOUT_SECRET)) throw new HttpError(400, 'Referência inválida.');
  const txId = body.tx_id;
  if (!/^[a-zA-Z0-9_-]{3,150}$/.test(txId || '') || body.transaction?.id !== txId) throw new HttpError(400, 'Transação inválida.');
  if (Math.round(Number(body.transaction?.amount) * 100) !== AMOUNT * 100) throw new HttpError(400, 'Valor inválido.');
  const status = normalizeStatus(body.status);
  if (status !== 'PAID' && status !== 'PENDING') return { ignored: true };
  // A signed webhook is mandatory. Paid notifications additionally check the source of truth.
  if (status === 'PAID') {
    const verified = await nexum(`/api/public/pix/status/${encodeURIComponent(txId)}`, dependencies);
    if (normalizeStatus(verified.status) !== 'PAID' || Math.round(Number(verified.amount) * 100) !== AMOUNT * 100 || (verified.tx_id && verified.tx_id !== txId)) throw new HttpError(503, 'Pagamento ainda não confirmado.');
  }
  const url = status === 'PAID' ? env.PUSH_PAID_URL : env.PUSH_PENDING_URL;
  if (!url || new URL(url).origin !== 'https://api.pushcut.io') throw new HttpError(503, 'Notificação indisponível.');
  const response = await (dependencies.fetchImpl || fetch)(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: status === 'PAID' ? 'VENDA APROVADA · R$ 197,00' : 'PIX GERADO · R$ 197,00', text: `${PRODUCT}\nPedido: ${txId}\n${status === 'PAID' ? 'Pagamento confirmado.' : 'Aguardando pagamento.'}` }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new HttpError(503, 'Falha temporária na notificação.');
  return { ok: true };
}
