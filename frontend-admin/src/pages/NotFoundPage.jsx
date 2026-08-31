import { Box, Button, Container, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import { colors } from '../theme';

/**
 * Custom 404 page. Uses the same green branding as the login page so
 * even errors feel like part of the product. Provides a clear path back
 * to the dashboard.
 */
export default function NotFoundPage() {
  return (
    <Container
      maxWidth="sm"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        py: 8,
      }}
    >
      <Box>
        <Typography
          variant="h1"
          sx={{
            fontSize: { xs: '4rem', md: '6rem' },
            fontWeight: 900,
            color: colors.brandPrimary,
            lineHeight: 1,
            mb: 1,
          }}
        >
          404
        </Typography>
        <Typography variant="h5" sx={{ mb: 1, fontWeight: 600 }}>
          Page not found
        </Typography>
        <Typography variant="body1" sx={{ color: colors.textSecondary, mb: 4, maxWidth: 400, mx: 'auto' }}>
          The page you are looking for does not exist or has been moved.
        </Typography>
        <Button
          component={RouterLink}
          to="/"
          variant="contained"
          startIcon={<HomeOutlined />}
          size="large"
          sx={{
            backgroundColor: colors.brandPrimary,
            '&:hover': { backgroundColor: '#19570c' },
          }}
        >
          Back to Dashboard
        </Button>
      </Box>
    </Container>
  );
}
