import test from 'node:test';
import assert from 'node:assert/strict';
import { AMOUNT, createPayment, paymentStatus, forwardNotification, validCpf, validateCustomer, orderReference, validReference, signSession, readSession, normalizeStatus } from '../lib/payment.js';
import { endpoint } from '../lib/http.js';

const env = { NEXUM_CHAT_ID: 'test-account', NEXUM_API_CREDENTIAL: 'test-credential', CHECKOUT_SECRET: 'test-signature-secret', NEXUM_WEBHOOK_TOKEN: 'test-webhook-token', APP_URL: 'https://checkout.example.com', PUSH_PENDING_URL: 'https://api.pushcut.io/test/notifications/pending', PUSH_PAID_URL: 'https://api.pushcut.io/test/notifications/paid' };
const input = { name: 'João da Silva', email: 'TEST@example.com', phone: '(75) 98839-3742', cpf: '529.982.247-25', consent: true, orderId: 'a17aeb1a-2243-4b5d-b89c-a75bbf4f39bb' };
const response = (body, status = 200, headers) => new Response(JSON.stringify(body), { status, headers });
const reference = orderReference(input.orderId, validateCustomer(input), env.CHECKOUT_SECRET);
const token = signSession({ txId: 'tx_test_123', reference }, env.CHECKOUT_SECRET);

test('validates CPF check digits, consent, phone, email and full name', () => {
  assert.equal(validCpf(input.cpf), true);
  for (const cpf of ['11111111111', '52998224726', '123']) assert.equal(validCpf(cpf), false);
  assert.equal(validateCustomer(input).generatedName, 'Joao da Silva');
  for (const [field, value] of [['name', 'João'], ['email', 'bad'], ['phone', '00000000000'], ['cpf', '123'], ['consent', false]]) assert.throws(() => validateCustomer({ ...input, [field]: value }), error => error.field === field);
});
test('fixes price server-side and sends documented fields with stable idempotency', async () => {
  const calls = [];
  const deps = { env, fetchImpl: async (url, options) => { calls.push({ url, options }); return response({ ok: true, tx_id: 'tx_test_123', amount: 197, status: 'PENDING', qr_code_text: '000201-test', expires_in_seconds: 900 }); } };
  const result = await createPayment({ ...input, amount: 1 }, deps);
  await createPayment(input, deps);
  const sent = JSON.parse(calls[0].options.body);
  assert.equal(sent.amount, 197);
  assert.equal(sent.generatedDocument, '52998224725');
  assert.equal(sent.generatedEmail, 'test@example.com');
  assert.equal(sent.webhook.url, 'https://checkout.example.com/api/pix/webhook');
  assert.equal(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
  assert.equal(result.amount, AMOUNT);
  assert.ok(validReference(sent.externalReference, env.CHECKOUT_SECRET));
  assert.equal(result.token.includes('52998224725'), false);
  assert.deepEqual(Object.keys(readSession(result.token, env.CHECKOUT_SECRET)).sort(), ['exp', 'reference', 'txId']);
});
test('fails closed without configuration and rejects mismatched amounts', async () => {
  await assert.rejects(createPayment(input, { env: {} }), error => error.status === 503);
  await assert.rejects(createPayment(input, { env, fetchImpl: async () => response({ ok: true, tx_id: 'tx_test_123', amount: 1, status: 'PENDING', qr_code_text: '000201' }) }), error => error.status === 502);
});
test('processing response retains transaction without inventing a QR code', async () => {
  const data = await createPayment(input, { env, fetchImpl: async () => response({ ok: true, tx_id: 'tx_test_123', amount: 197, status: 'PROCESSING', reconciliation_required: true }, 202) });
  assert.equal(data.status, 'PROCESSING'); assert.equal(data.code, ''); assert.ok(data.token);
});
test('session tampering and expiry cannot authorize a receipt', () => {
  assert.throws(() => readSession(token + 'x', env.CHECKOUT_SECRET), error => error.status === 401);
  const expired = signSession({ txId: 'tx_test_123', reference }, env.CHECKOUT_SECRET, 0);
  assert.throws(() => readSession(expired, env.CHECKOUT_SECRET), error => error.status === 401);
  assert.equal(validReference(reference + 'x', env.CHECKOUT_SECRET), false);
});
test('status accepts only a signed transaction and verifies paid amount', async () => {
  let calls = 0;
  const deps = { env, fetchImpl: async () => { calls++; return response({ ok: true, tx_id: 'tx_test_123', amount: 197, status: 'PAID' }); } };
  await assert.rejects(paymentStatus('forged', deps)); assert.equal(calls, 0);
  const result = await paymentStatus(token, deps);
  assert.equal(result.status, 'PAID'); assert.ok(readSession(result.token, env.CHECKOUT_SECRET).paidAt);
  await assert.rejects(paymentStatus(token, { env, fetchImpl: async () => response({ ok: true, amount: 1, status: 'PAID' }) }));
});
test('provider rate limit is respected and error bodies are not reflected', async () => {
  await assert.rejects(paymentStatus(token, { env, fetchImpl: async () => response({ ok: false }, 429, { 'Retry-After': '90' }) }), error => error.retryAfter === 90);
  await assert.rejects(paymentStatus(token, { env, fetchImpl: async () => response({ ok: false, secret: 'private-data' }, 500) }), error => !error.message.includes('private-data'));
});
const event = status => ({ event: 'pix.status_changed', tx_id: 'tx_test_123', status, transaction: { id: 'tx_test_123', status, amount: 197, external_reference: reference } });
test('webhook rejects missing token, forged references and wrong amount before network', async () => {
  let calls = 0; const deps = { env, fetchImpl: async () => { calls++; return response({}); } };
  await assert.rejects(forwardNotification(event('PAID'), 'wrong', deps), error => error.status === 401);
  const forged = event('PAID'); forged.transaction.external_reference = 'someone-elses-order';
  await assert.rejects(forwardNotification(forged, env.NEXUM_WEBHOOK_TOKEN, deps));
  const wrong = event('PAID'); wrong.transaction.amount = 1;
  await assert.rejects(forwardNotification(wrong, env.NEXUM_WEBHOOK_TOKEN, deps));
  assert.equal(calls, 0);
});
test('pending and approved webhooks use separate Pushcut URLs; approval is rechecked', async () => {
  const calls = [];
  const deps = { env, fetchImpl: async (url, options) => { calls.push({ url, options }); return response(url.includes('nexumpaybot') ? { ok: true, amount: 197, status: 'PAID', tx_id: 'tx_test_123' } : {}); } };
  await forwardNotification(event('PENDING'), env.NEXUM_WEBHOOK_TOKEN, deps);
  assert.equal(calls[0].url, env.PUSH_PENDING_URL);
  await forwardNotification(event('PAID'), env.NEXUM_WEBHOOK_TOKEN, deps);
  assert.ok(calls[1].url.includes('/pix/status/tx_test_123'));
  assert.equal(calls[2].url, env.PUSH_PAID_URL);
  assert.equal(JSON.stringify(calls).includes('52998224725'), false);
});
test('failed notification is retriable and unconfirmed payment never notifies approval', async () => {
  await assert.rejects(forwardNotification(event('PENDING'), env.NEXUM_WEBHOOK_TOKEN, { env, fetchImpl: async () => response({}, 500) }), error => error.status === 503);
  let calls = 0;
  await assert.rejects(forwardNotification(event('PAID'), env.NEXUM_WEBHOOK_TOKEN, { env, fetchImpl: async () => { calls++; return response({ ok: true, amount: 197, status: 'PENDING' }); } }), error => error.status === 503);
  assert.equal(calls, 1);
});
test('failed and refunded statuses never become paid', () => {
  for (const value of ['FAILED', 'REFUNDED', 'ERROR']) assert.equal(normalizeStatus(value), 'FAILED');
  assert.equal(normalizeStatus('CANCELED'), 'CANCELLED');
  assert.equal(normalizeStatus('EXPIRED'), 'EXPIRED');
  assert.equal(normalizeStatus('UNKNOWN'), 'PENDING');
});
test('HTTP boundary rejects cross-origin and oversized requests', async () => {
  const handler = endpoint('POST', async () => ({ ok: true }));
  const res = () => ({ headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(data) { this.data = data; this.writableEnded = true; } });
  const cross = res(); await handler({ method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: {} }, cross); assert.equal(cross.code, 403);
  const big = res(); await handler({ method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '17000' }, body: {} }, big); assert.equal(big.code, 413);
  const get = res(); await handler({ method: 'GET', headers: {} }, get); assert.equal(get.code, 405);
});
