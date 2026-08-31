import { useEffect } from 'react';

const SITE_NAME = 'INVENTRAK';
const DEFAULT_TITLE = `${SITE_NAME} — Admin Dashboard`;

// Route-specific title map: keeps page titles unique and descriptive for SEO
// and browser tab clarity. Each title follows the pattern "Page — INVENTRAK".
const ROUTE_TITLES = {
  '/': 'Dashboard',
  '/products': 'Products',
  '/inventory': 'Inventory Levels',
  '/scan-stock': 'Scan & Stock',
  '/stock-movement': 'Stock Movement',
  '/stock-adjustments': 'Stock Adjustments',
  '/stock-transfers': 'Stock Transfers',
  '/locations': 'Branch Locations',
  '/order-inquiries': 'Order Inquiries',
  '/approvals': 'Approvals',
  '/optimization': 'Optimization',
  '/reports': 'Reports',
  '/security': 'Security',
};

/**
 * Sets a unique document title for the current route.
 * Called in each page component: usePageTitle('Products') → "Products — INVENTRAK"
 * Also updates the og:title meta tag for social sharing.
 */
export default function usePageTitle(pageKey) {
  useEffect(() => {
    const pageTitle = pageKey
      ? `${ROUTE_TITLES[pageKey] || pageKey} — ${SITE_NAME}`
      : DEFAULT_TITLE;

    document.title = pageTitle;

    // Keep og:title in sync for social shares
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', pageTitle);
  }, [pageKey]);
}

export { ROUTE_TITLES, SITE_NAME };
