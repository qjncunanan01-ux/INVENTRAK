// Keep this version aligned with backend/src/catalog-orders/order-terms.js.
export const ORDER_TERMS_VERSION = '2026-10-21-v1';

export const ORDER_TERMS = [
  'Submitting an order creates an inquiry. Sylver confirms availability, final pricing, and acceptance before the order is final.',
  'Stock is deducted when the store marks an approved inquiry fulfilled. Availability may change while an inquiry is being reviewed.',
  'Bulk quantities are subject to available stock. The system allows up to 10,000 units of one product per inquiry; larger requests must be discussed with the store.',
  'Pickup or courier is a preference. The store confirms courier fees and timing after reviewing the inquiry.',
  'An inquiry may be cancelled while pending or approved. The app does not allow cancellation after fulfillment or delivery.',
  'GCash payments are checked by the store using the receipt reference you submit. Card checkout is a demo transaction only; it does not charge a card or collect card details.',
  'The app does not process refunds or set courier fees. Confirm return, refund, and delivery charges with Sylver before paying.',
];
