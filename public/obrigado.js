const $ = id => document.getElementById(id);
async function verify() {
  let token = decodeURIComponent(location.hash.slice(1));
  history.replaceState(null, '', location.pathname);
  try {
    if (!token) token = JSON.parse(sessionStorage.getItem('diabetes-payment-v1') || 'null')?.token;
    if (token) sessionStorage.setItem('diabetes-receipt-token', token);
    else token = sessionStorage.getItem('diabetes-receipt-token');
  } catch { /* Hash token works without browser storage. */ }
  try {
    if (!token) throw new Error('Volte ao checkout para acompanhar seu Pix. Se já pagou, fale com a equipe e envie seu comprovante.');
    const response = await fetch('/api/receipt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), cache: 'no-store', signal: AbortSignal.timeout(30000) });
    const receipt = await response.json();
    if (!response.ok) throw new Error(receipt.error || 'Não foi possível consultar o pagamento agora.');
    if (receipt.status !== 'PAID') throw new Error('Seu pagamento ainda não consta como aprovado. Retorne ao checkout para acompanhar a confirmação automática.');
    $('release-access').href = receipt.contactUrl;
    $('receipt-order').textContent = `Pedido: ${receipt.txId}`;
    $('receipt-success').hidden = false;
  } catch (error) {
    $('receipt-error').textContent = error.name === 'TimeoutError' ? 'A operadora demorou a responder. Volte ao checkout para consultar novamente.' : error.message;
    $('receipt-unverified').hidden = false;
  } finally { $('receipt-loading').hidden = true; }
}
verify();
