// Keep these versions aligned with backend/src/catalog-orders/order-terms.js.
const COMPANY_DEMO = process.env.EXPO_PUBLIC_SYLVER_POLICY_DEMO === 'true';
export const ORDER_TERMS_VERSION = COMPANY_DEMO ? '2026-10-24-sylver-demo-v3' : '2026-10-21-v1';

const PRODUCTION_TERMS = [
  'Submitting an order creates an inquiry. Sylver confirms availability, final pricing, and acceptance before the order is final.',
  'Stock is deducted when the store marks an approved inquiry fulfilled. Availability may change while an inquiry is being reviewed.',
  'Bulk quantities are subject to available stock. The system allows up to 10,000 units of one product per inquiry; larger requests must be discussed with the store.',
  'Pickup or courier is a preference. The store confirms courier fees and timing after reviewing the inquiry.',
  'An inquiry may be cancelled while pending or approved. The app does not allow cancellation after fulfillment or delivery.',
  'GCash payments are checked by the store using the receipt reference you submit. Card checkout is a demo transaction only; it does not charge a card or collect card details.',
  'The app does not process refunds or set courier fees. Confirm return, refund, and delivery charges with Sylver before paying.',
];

const COMPANY_TERMS = [
  'All orders are reviewed by Sylver staff. Confirmation means the requested quantities and final price were accepted.',
  'Regular products have no minimum quantity. Orders are limited to available stock; confirmed orders reserve stock for the customer.',
  'Syrups and sauces receive 3% off when their combined eligible subtotal reaches PHP 5,000. The discount applies to those items only.',
  'Pickup: Sylver Restaurant & Café Supplier OPC, 23-B Mohawk Street, Concepcion Uno, Marikina City, Monday–Saturday, 8:00 AM–5:00 PM.',
  'Delivery is mainly available in Marikina, Antipolo/Rizal, Pasig, selected Quezon City areas, and other Metro Manila areas by arrangement. Sylver confirms delivery fees and schedule before payment.',
  'Demo payments are records only. The card option is a simulation: no card details are collected and no charge is made. GCash and bank-transfer proofs are manually reviewed by staff. Cash is due at pickup; delivery orders must be paid before dispatch. Do not transfer real money for demo orders.',
  'Customers may request changes or cancellation while an order is being reviewed or prepared. Courier orders cannot be changed or cancelled after dispatch. Any special-order cancellation charge requires staff approval.',
  'Report incorrect, damaged, defective, or discrepant items within 24 hours of receipt with order details and photo evidence. Staff review returns and refunds; refunds are recorded for bank transfer or original method when possible.',
  'Deposits, split payments, and credit require staff approval. Credit is limited to customers with an approved existing arrangement.',
  'Order history refreshes while the app is open. Email and SMS updates are sent only when a provider is configured; Facebook, Viber, and Messenger contact is handled manually in this demo.',
];

export const ORDER_TERMS = COMPANY_DEMO ? COMPANY_TERMS : PRODUCTION_TERMS;
