import { endpoint } from '../lib/http.js';
import { paymentStatus, readSession } from '../lib/payment.js';
export default endpoint('POST', async req => {
  const session = readSession(req.body.token, process.env.CHECKOUT_SECRET || 'unconfigured');
  // Reuse the server's fresh verification to respect Nexum's 30-second poll interval.
  const payment = session.paidAt && Date.now() - session.paidAt < 30000
    ? { status: 'PAID', txId: session.txId }
    : await paymentStatus(req.body.token);
  if (payment.status !== 'PAID') return { status: payment.status };
  const phone = (process.env.SUPPORT_WHATSAPP || '5575988393742').replace(/\D/g, '');
  const message = `Olá! Meu pagamento de R$ 197,00 pelo Combo Vitalício do Dr. Moacir Rosa foi aprovado. Quero liberar meu acesso. Pedido: ${payment.txId}`;
  return { status: 'PAID', txId: payment.txId, amount: 197, contactUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}` };
});
