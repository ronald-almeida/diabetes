import QRCode from 'qrcode';
import { endpoint } from '../../lib/http.js';
import { createPayment } from '../../lib/payment.js';
export default endpoint('POST', async req => {
  const payment = await createPayment(req.body);
  return { ...payment, qrImage: payment.code ? await QRCode.toDataURL(payment.code, { width: 280, margin: 2, errorCorrectionLevel: 'M' }) : null };
});
