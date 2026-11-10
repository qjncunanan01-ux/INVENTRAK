// Keep these versions aligned with backend/src/catalog-orders/order-terms.js.
const COMPANY_DEMO = process.env.EXPO_PUBLIC_SYLVER_POLICY_DEMO === 'true';
export const ORDER_TERMS_VERSION = COMPANY_DEMO ? '2026-11-10-sylver-demo-v5' : '2026-11-10-v4';

const PRODUCTION_TERMS = [
  'Check quantities and catalog prices before placing your order. Regular products have no minimum quantity; orders are limited to available stock. Syrups and sauces receive 3% off when their combined eligible subtotal reaches PHP 5,000. The discount applies only to eligible syrup and sauce items.',
  'Stock is held for your order when the store starts preparing it. The reservation becomes a completed sale when the order is ready for pickup or dispatch. Availability is checked again before preparation.',
  'Bulk quantities are subject to available stock. The system allows up to 10,000 units of one product per order; larger requests must be discussed with the store.',
  'Cash is due at store pickup. For courier orders, pay the Sylver goods total and wait for payment verification before courier collection. After the store marks the goods ready, book and pay Lalamove directly. Lalamove sets its fee and timing, which are separate from your store order.',
  'An unpaid order may be cancelled while it is waiting to be prepared. Paid orders must be cancelled with the store because refunds are not automated.',
  'QR Ph checkout uses the payment environment configured for the app. A test-mode checkout does not move real money. The store must verify payment before preparation or courier collection.',
  'The app does not place, pay for, or track your Lalamove booking. Confirm return and refund arrangements with Sylver; refunds are handled by the store and are not automatic.',
];

const COMPANY_TERMS = [
  'All orders are reviewed by Sylver staff. Confirmation means the requested quantities and final price were accepted.',
  'Regular products have no minimum quantity. Orders are limited to available stock; confirmed orders reserve stock for the customer.',
  'Syrups and sauces receive 3% off when their combined eligible subtotal reaches PHP 5,000. The discount applies to those items only.',
  'Pickup: Sylver Restaurant & Café Supplier OPC, 23-B Mohawk Street, Concepcion Uno, Marikina City, Monday–Saturday, 8:00 AM–5:00 PM.',
  'For courier orders, Sylver prepares the goods and marks them ready for courier pickup. You then request and pay for Lalamove directly. Lalamove confirms service availability, fee, and timing; its fee is separate from the Sylver order total.',
  'Demo payments are records only. The card option is a simulation: no card details are collected and no charge is made. GCash and bank-transfer proofs are manually reviewed by staff. Cash is due at store pickup; the goods order must be paid before a courier collects it. Pay any Lalamove fee directly to Lalamove. Do not transfer real money for demo orders.',
  'Customers may request changes or cancellation while an order is being reviewed or prepared. Courier orders cannot be changed or cancelled after dispatch. Any special-order cancellation charge requires staff approval.',
  'Report incorrect, damaged, defective, or discrepant items within 24 hours of receipt with order details and photo evidence. Staff review returns and refunds; refunds are recorded for bank transfer or original method when possible.',
  'Deposits, split payments, and credit require staff approval. Credit is limited to customers with an approved existing arrangement.',
  'Order history refreshes while the app is open. Email and SMS updates are sent only when a provider is configured; Facebook, Viber, and Messenger contact is handled manually in this demo.',
];

export const ORDER_TERMS = COMPANY_DEMO ? COMPANY_TERMS : PRODUCTION_TERMS;
