import { Box, Button, Container, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

export default function AdminLayout({ title, children, onLogout }) {
  return (
    <Container sx={{ py: 4 }}>
      <Paper sx={{ p: 3, mb: 3 }}>
        <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
          <Typography variant="h5">INVENTRAK Admin</Typography>
          <Box>
            <Button component={RouterLink} to="/" sx={{ mr: 1 }}>Dashboard</Button>
            <Button component={RouterLink} to="/products" sx={{ mr: 1 }}>Products</Button>
            <Button component={RouterLink} to="/inventory" sx={{ mr: 1 }}>Inventory</Button>
            <Button component={RouterLink} to="/stock-movement" sx={{ mr: 1 }}>Stock Movement</Button>
            <Button component={RouterLink} to="/order-inquiries" sx={{ mr: 1 }}>Order Inquiries</Button>
            <Button component={RouterLink} to="/locations" sx={{ mr: 1 }}>Locations</Button>
            <Button component={RouterLink} to="/optimization" sx={{ mr: 1 }}>Optimization</Button>
            {onLogout ? <Button color="error" onClick={onLogout}>Logout</Button> : null}
          </Box>
        </Stack>
      </Paper>
      <Typography variant="h4" mb={2}>{title}</Typography>
      {children}
    </Container>
  );
}
