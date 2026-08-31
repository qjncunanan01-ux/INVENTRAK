import { Breadcrumbs as MuiBreadcrumbs, Link, Typography } from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { Link as RouterLink, useLocation } from 'react-router-dom';

/**
 * Breadcrumb navigation component.
 * Automatically generates breadcrumb items from the current URL path.
 * Follows WCAG 2.1 breadcrumb pattern: <nav aria-label="Breadcrumb">
 */

const BREADCRUMB_MAP = {
  '/': 'Dashboard',
  '/products': 'Products',
  '/inventory': 'Inventory',
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

export default function Breadcrumbs() {
  const location = useLocation();
  const pathnames = location.pathname.split('/').filter(Boolean);

  // The first item is always "Dashboard" (root)
  const items = [{ label: 'Dashboard', path: '/' }];

  // Build path segments (skip root since we already added it)
  if (pathnames.length > 0) {
    const currentPath = `/${pathnames.join('/')}`;
    const label = BREADCRUMB_MAP[currentPath];
    if (label) {
      items.push({ label, path: currentPath });
    }
  }

  // Don't show breadcrumbs on the dashboard (no hierarchy to show)
  if (items.length <= 1) return null;

  return (
    <nav aria-label="Breadcrumb">
      <MuiBreadcrumbs
        separator={<NavigateNextIcon fontSize="small" />}
        sx={{ mb: 2 }}
      >
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return isLast ? (
            <Typography key={item.path} color="text.primary" sx={{ fontSize: '0.85rem' }}>
              {item.label}
            </Typography>
          ) : (
            <Link
              key={item.path}
              component={RouterLink}
              to={item.path}
              underline="hover"
              color="inherit"
              sx={{ fontSize: '0.85rem' }}
            >
              {item.label}
            </Link>
          );
        })}
      </MuiBreadcrumbs>
    </nav>
  );
}
