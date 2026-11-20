const $ = id => document.getElementById(id);
const form = $('checkout-form');
const button = $('pay-button');
const fields = ['name', 'email', 'phone', 'cpf', 'consent'];
const storageKey = 'diabetes-payment-v1';
let payment = null;
let busy = false;
let pollTimer;
let nextCheck = 0;
let clockTimer;
let configReady = false;
let orderId;
try { orderId = sessionStorage.getItem('diabetes-order-id') || crypto.randomUUID(); sessionStorage.setItem('diabetes-order-id', orderId); } catch { orderId = crypto.randomUUID(); }

function savePayment() { try { sessionStorage.setItem(storageKey, JSON.stringify(payment)); } catch { /* This tab can still complete payment without storage. */ } }
function showMessage(message) { $('form-message').textContent = message; $('form-message').hidden = !message; }
function fieldError(field, message) {
  $(field).setAttribute('aria-invalid', message ? 'true' : 'false');
  $(field).setAttribute('aria-describedby', `${field}-error`);
  $(`${field}-error`).textContent = message;
}
function validCpf(input) {
  const cpf = input.replace(/\D/g, '');
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let count = 9; count < 11; count++) {
    const sum = [...cpf.slice(0, count)].reduce((total, n, i) => total + Number(n) * (count + 1 - i), 0);
    if ((sum * 10) % 11 % 10 !== Number(cpf[count])) return false;
  }
  return true;
}
function validate() {
  fields.forEach(field => fieldError(field, ''));
  const errors = {};
  if (!/^[\p{L}][\p{L}'’ -]+\s[\p{L}'’ -]+$/u.test($('name').value.trim())) errors.name = 'Digite seu nome e sobrenome.';
  if (!$('email').validity.valid || !$('email').value) errors.email = 'Digite um e-mail válido.';
  if (!/^[1-9]{2}(?:9\d{8}|[2-8]\d{7})$/.test($('phone').value.replace(/\D/g, ''))) errors.phone = 'Confira o telefone e o DDD.';
  if (!validCpf($('cpf').value)) errors.cpf = 'Confira os números do CPF.';
  if (!$('consent').checked) errors.consent = 'Aceite os termos para continuar.';
  Object.entries(errors).forEach(([field, message]) => fieldError(field, message));
  const first = Object.keys(errors)[0];
  if (first) $(first).focus();
  return !first;
}
$('phone').addEventListener('input', event => {
  const value = event.target.value.replace(/\D/g, '').slice(0, 11);
  event.target.value = value.length > 2 ? `(${value.slice(0, 2)}) ${value.slice(2, value.length > 10 ? 7 : 6)}${value.length > 6 ? '-' + value.slice(value.length > 10 ? 7 : 6) : ''}` : value;
});
$('cpf').addEventListener('input', event => {
  event.target.value = event.target.value.replace(/\D/g, '').slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
});
fields.forEach(field => $(field).addEventListener('input', () => fieldError(field, '')));

async function api(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(35000), cache: 'no-store' });
  let data;
  try { data = await response.json(); } catch { throw new Error('O serviço não respondeu. Tente novamente em alguns instantes.'); }
  if (!response.ok) { const error = new Error(data.error || 'Não foi possível concluir esta operação.'); Object.assign(error, data); throw error; }
  return data;
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !validate()) return;
  if (!configReady) return showMessage('O pagamento está temporariamente indisponível. Tente novamente em breve.');
  busy = true; button.disabled = true; button.querySelector('span').textContent = 'GERANDO SEU PIX…'; showMessage('');
  try {
    payment = await api('/api/pix/create', { orderId, name: $('name').value, email: $('email').value, phone: $('phone').value, cpf: $('cpf').value, consent: $('consent').checked, website: $('website').value });
    savePayment(); form.reset(); showPayment();
  } catch (error) {
    if (error.field && fields.includes(error.field)) { fieldError(error.field, error.message); $(error.field).focus(); }
    else showMessage(error.name === 'TimeoutError' ? 'Estamos aguardando a confirmação da emissão. Tente novamente: recuperaremos a mesma cobrança.' : error.message);
  } finally { busy = false; button.disabled = false; button.querySelector('span').textContent = 'GARANTIR MEU ACESSO POR R$ 197'; }
});
function showPayment() {
  $('form-view').hidden = true; $('pix-view').hidden = false;
  $('order-reference').textContent = `Pedido: ${payment.txId}`;
  $('pix-view').focus({ preventScroll: true }); $('checkout').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (payment.status === 'PAID') return approved();
  renderPayment();
  nextCheck = Math.max(Date.now() + 30000, payment.nextCheck || 0);
  clockTimer = setInterval(tick, 1000); tick(); schedule();
}
function renderPayment() {
  const terminal = ['EXPIRED', 'FAILED', 'CANCELLED'].includes(payment.status);
  $('qr-area').hidden = !payment.code || terminal;
  if (payment.code) { $('qr-image').src = payment.qrImage; $('pix-code').value = payment.code; }
  $('payment-status').textContent = ({ PROCESSING: 'Seu Pix está sendo preparado', EXPIRED: 'Este Pix expirou', FAILED: 'Pagamento não concluído', CANCELLED: 'Este Pix foi cancelado' })[payment.status] || 'Aguardando pagamento';
  if (payment.status === 'PROCESSING') $('payment-help').textContent = 'A emissão está sendo confirmada pela operadora. Aguarde nesta página. Não faça uma nova inscrição enquanto a consulta estiver em andamento.';
  $('retry-button').hidden = !terminal;
  $('check-button').hidden = terminal;
  if (terminal) { clearTimeout(pollTimer); clearInterval(clockTimer); $('payment-help').textContent = 'Se você já pagou, fale com o suporte com o comprovante antes de gerar outro Pix.'; }
}
function tick() {
  const remaining = Math.max(0, Math.ceil((payment.expiresAt - Date.now()) / 1000));
  if (remaining > 0) {
    const h = Math.floor(remaining / 3600); const m = Math.floor(remaining % 3600 / 60); const s = remaining % 60;
    $('expires').textContent = `Válido por ${h ? `${h}h ` : ''}${String(m).padStart(2, '0')}min ${String(s).padStart(2, '0')}s`;
  } else {
    $('expires').textContent = 'Prazo encerrado. Consulte o status antes de tentar pagar.';
    $('qr-area').hidden = true;
  }
  const wait = Math.max(0, Math.ceil((nextCheck - Date.now()) / 1000));
  $('check-button').disabled = wait > 0 || busy;
  $('check-button').textContent = wait ? `Nova verificação em ${wait}s` : 'Já paguei · verificar pagamento';
}
function schedule() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => { if (document.hidden) schedule(); else checkPayment(); }, Math.max(30000, nextCheck - Date.now()));
}
async function checkPayment() {
  if (busy || Date.now() < nextCheck || !payment) return;
  busy = true; $('check-button').disabled = true; $('pix-error').hidden = true;
  nextCheck = Date.now() + 31000;
  try {
    const result = await api('/api/pix/status', { token: payment.token });
    payment = { ...payment, ...result, code: result.code || payment.code, qrImage: result.qrImage || payment.qrImage, nextCheck };
    savePayment();
    if (result.status === 'PAID') return approved();
    renderPayment();
  } catch (error) {
    nextCheck = Date.now() + Math.max(31, error.retryAfter || 0) * 1000;
    $('pix-error').textContent = error.message || 'Não foi possível consultar agora. Vamos tentar novamente.'; $('pix-error').hidden = false;
  } finally {
    busy = false; tick();
    if (!['PAID', 'EXPIRED', 'FAILED', 'CANCELLED'].includes(payment.status)) schedule();
  }
}
function approved() {
  clearTimeout(pollTimer); clearInterval(clockTimer); savePayment();
  // The signed token contains no CPF, email, name or phone. Hashes are not sent in HTTP referrers.
  location.assign(`/obrigado.html#${encodeURIComponent(payment.token)}`);
}
$('check-button').addEventListener('click', checkPayment);
$('copy-button').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(payment.code); $('copy-status').textContent = 'Código copiado! Agora abra o aplicativo do seu banco.'; }
  catch { $('pix-code').focus(); $('pix-code').select(); $('copy-status').textContent = 'Selecione e copie o código acima.'; }
});
$('retry-button').addEventListener('click', () => {
  clearTimeout(pollTimer); clearInterval(clockTimer); payment = null; orderId = crypto.randomUUID();
  try { sessionStorage.removeItem(storageKey); sessionStorage.setItem('diabetes-order-id', orderId); } catch { /* no storage */ }
  $('pix-view').hidden = true; $('form-view').hidden = false; $('name').focus();
});
async function init() {
  try { const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); if (saved?.token && saved.txId) payment = saved; } catch { /* no saved order */ }
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const config = await response.json(); configReady = config.ready;
    $('support').hidden = false;
    const link = document.createElement('a'); link.href = `https://wa.me/${config.supportWhatsapp}`; link.textContent = 'Precisa de ajuda? Fale com a equipe.'; link.target = '_blank'; link.rel = 'noopener noreferrer'; $('support').append(link);
    if (!configReady && !payment) { showMessage('O pagamento está temporariamente indisponível. Tente novamente em breve.'); button.disabled = true; }
  } catch { showMessage('Não foi possível conectar ao pagamento. Recarregue a página em alguns instantes.'); button.disabled = true; }
  if (payment) showPayment();
}
init();
