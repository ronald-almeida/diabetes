import { endpoint } from '../lib/http.js';
import { AMOUNT, ready } from '../lib/payment.js';
export default endpoint('GET', async () => ({ amount: AMOUNT, ready: ready(), supportWhatsapp: process.env.SUPPORT_WHATSAPP || '5575988393742' }));
