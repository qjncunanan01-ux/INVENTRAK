const { SYLVER_POLICY_DEMO, COMPANY_POLICY_VERSION } = require('./company-policy');

const ORDER_TERMS_VERSION = '2026-11-05-v3';
const ORDER_TERMS = [
  'Check item quantities and catalog prices before placing your order. Current stock is checked at checkout, and QRPh totals use the current product catalog. Online payments must be verified before preparation; cash orders may proceed when staff start processing them and are paid at pickup or delivery.',
  'Stock is held for your order when the store starts preparing it. The reservation becomes a completed sale when the order is ready for pickup or dispatch. Availability is checked again before preparation.',
  'Bulk quantities are subject to available stock. The system allows up to 10,000 units of one product per order; larger requests must be discussed with the store.',
  'For courier orders, the store prepares the items and marks them ready for pickup. You then book and pay Lalamove directly; Lalamove sets the fee and timing, which are separate from your store order.',
  'An unpaid order may be cancelled while it is waiting to be prepared. Paid orders must be cancelled with the store because refunds are not automated.',
  'GCash payments are checked by the store using the receipt reference you submit. Card checkout is a demo transaction only; it does not charge a card or collect card details.',
  'The app does not place, pay for, or track your Lalamove booking. The courier fee is charged by Lalamove separately from your store order. Confirm return and refund arrangements with Sylver.',
];

const COMPANY_ORDER_TERMS = [
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

function currentOrderTerms() {
  return SYLVER_POLICY_DEMO
    ? { version: COMPANY_POLICY_VERSION, terms: COMPANY_ORDER_TERMS }
    : { version: ORDER_TERMS_VERSION, terms: ORDER_TERMS };
}

module.exports = {
  ORDER_TERMS_VERSION,
  ORDER_TERMS,
  COMPANY_ORDER_TERMS,
  currentOrderTerms,
};
