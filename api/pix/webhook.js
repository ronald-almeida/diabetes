import { endpoint } from '../../lib/http.js';
import { forwardNotification } from '../../lib/payment.js';
export default endpoint('POST', req => forwardNotification(req.body, req.headers['x-webhook-token']), { webhook: true });
