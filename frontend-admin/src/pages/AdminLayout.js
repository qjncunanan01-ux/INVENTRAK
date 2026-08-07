import { Box, Button, Divider, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { colors } from '../theme';

const navItems = [
  { label: 'Dashboard', path: '/' },
  { label: 'Products', path: '/products' },
  { label: 'Inventory', path: '/inventory' },
  { label: 'Stock Movement', path: '/stock-movement' },
  { label: 'Stock Adjustments', path: '/stock-adjustments' },
  { label: 'Stock Transfers', path: '/stock-transfers' },
  { label: 'Approvals', path: '/approvals' },
  { label: 'Order Inquiries', path: '/order-inquiries' },
  { label: 'Locations', path: '/locations' },
  { label: 'Optimization', path: '/optimization' },
  { label: 'Reports', path: '/reports' },
];

export default function AdminLayout({ title, children, onLogout }) {
  const location = useLocation();

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: colors.background, pb: 4 }}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' } }}>
        <Box
          component="aside"
          sx={{
            width: { xs: '100%', md: 280 },
            backgroundColor: colors.brandPrimary,
            color: '#fff',
            px: 3,
            py: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          <Box>
            <Typography variant="h5" sx={{ mb: 1, letterSpacing: 0.5 }}>
              INVENTRAK
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.88 }}>
              Inventory admin portal
            </Typography>
          </Box>

          <Stack spacing={1}>
            {navItems.map((item) => {
              const active = location.pathname === item.path;
              return (
                <Button
                  key={item.path}
                  component={RouterLink}
                  to={item.path}
                  fullWidth
                  variant={active ? 'contained' : 'text'}
                  color="secondary"
                  sx={{
                    justifyContent: 'flex-start',
                    px: 2,
                    py: 1.5,
                    borderRadius: 2,
                    color: '#fff',
                    backgroundColor: active ? 'rgba(255,255,255,0.18)' : 'transparent',
                    '&:hover': {
                      backgroundColor: 'rgba(255,255,255,0.24)',
                    },
                  }}
                >
                  {item.label}
                </Button>
              );
            })}
          </Stack>

          <Box sx={{ mt: 'auto' }}>
            <Divider sx={{ borderColor: 'rgba(255,255,255,0.2)' }} />
            <Typography variant="body2" sx={{ mt: 2, color: '#f7ffdc' }}>
              Secure operations
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.82 }}>
              Manage stock, orders, and inventory data.
            </Typography>
          </Box>
        </Box>

        <Box component="main" sx={{ flex: 1, p: { xs: 3, md: 4 } }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 2,
              mb: 3,
            }}
          >
            <Typography variant="h4" color="text.primary">
              {title}
            </Typography>
            {onLogout ? (
              <Button variant="contained" color="secondary" onClick={onLogout}>
                Logout
              </Button>
            ) : null}
          </Box>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
