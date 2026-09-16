import { useEffect, useState } from 'react';
import { Box, Button, Chip, Divider, Drawer, IconButton, Stack, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import MenuOutlined from '@mui/icons-material/MenuOutlined';
import MenuOpenOutlined from '@mui/icons-material/MenuOpenOutlined';
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined';
import CameraAltOutlined from '@mui/icons-material/CameraAltOutlined';
import CompareArrowsOutlined from '@mui/icons-material/CompareArrowsOutlined';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import InsightsOutlined from '@mui/icons-material/InsightsOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import LocationOnOutlined from '@mui/icons-material/LocationOnOutlined';
import ShoppingCartOutlined from '@mui/icons-material/ShoppingCartOutlined';
import SecurityOutlined from '@mui/icons-material/SecurityOutlined';
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined';
import TuneOutlined from '@mui/icons-material/TuneOutlined';
import WarehouseOutlined from '@mui/icons-material/WarehouseOutlined';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { getCurrentUser } from '../api';
import { ADMIN_TIER, STAFF_TIER, roleMeta } from '../roles';
import { brandSidebar, colors } from '../theme';
import Breadcrumbs from '../components/Breadcrumbs';

// One flat, always-expanded module list: every module is its own visible row
// under a small section header — nothing is buried inside a collapsed
// accordion. Sections group the modules the way the daily workflow reads
// (see the stock → catalog → money → governance flow), and `roles` on each
// item drives the role-based nav per the role spec (see src/roles.js):
//
//   ADMIN_TIER (admin, super_admin, owner) — everything, because every one of
//     these roles may see money, pricing and business analytics.
//   STAFF_TIER (staff + the admin tiers) — the daily inventory modules staff
//     legitimately need: stock levels, movements, counts, requests, scanning.
//
// Inventory Staff deliberately do NOT get the dashboard, reports, optimization
// or any money surface — the spec forbids them from viewing sales, prices,
// customers, orders, reports or business analytics. The backend enforces the
// same split, so this is defense in depth rather than the only gate.
const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', path: '/', Icon: DashboardOutlined, roles: ADMIN_TIER }],
  },
  {
    label: 'Inventory',
    items: [
      { label: 'Inventory Levels', path: '/inventory', Icon: WarehouseOutlined, roles: STAFF_TIER },
      { label: 'Branch Locations', path: '/locations', Icon: LocationOnOutlined, roles: ADMIN_TIER },
    ],
  },
  {
    label: 'Stock Control',
    items: [
      { label: 'Stock Movement', path: '/stock-movement', Icon: SwapHorizOutlined, roles: STAFF_TIER },
      { label: 'Stock Adjustments', path: '/stock-adjustments', Icon: TuneOutlined, roles: STAFF_TIER },
      { label: 'Stock Transfers', path: '/stock-transfers', Icon: CompareArrowsOutlined, roles: STAFF_TIER },
    ],
  },
  {
    label: 'Catalog & Orders',
    items: [
      { label: 'Products', path: '/products', Icon: Inventory2Outlined, roles: ADMIN_TIER },
      { label: 'Scan & Stock', path: '/scan-stock', Icon: CameraAltOutlined, roles: STAFF_TIER },
      { label: 'Order Inquiries', path: '/order-inquiries', Icon: ShoppingCartOutlined, roles: ADMIN_TIER },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Optimization', path: '/optimization', Icon: InsightsOutlined, roles: ADMIN_TIER },
      { label: 'Reports', path: '/reports', Icon: AssessmentOutlined, roles: ADMIN_TIER },
    ],
  },
  {
    label: 'Governance',
    items: [
      { label: 'Approvals', path: '/approvals', Icon: FactCheckOutlined, roles: ADMIN_TIER },
      { label: 'Audit Trail', path: '/audit-trail', Icon: HistoryOutlined, roles: ADMIN_TIER },
    ],
  },
  {
    label: 'Account',
    items: [{ label: 'Security', path: '/security', Icon: SecurityOutlined, roles: ADMIN_TIER }],
  },
];

const COLLAPSED_W = 76;
const EXPANDED_W = 280;

// Shared nav body: rendered in the fixed desktop sidebar AND the mobile
// temporary drawer so both stay identical. `collapsed` renders the
// mini-variant icon rail (labels hidden, tooltips on hover).
function NavContent({ collapsed = false, onNavigate }) {
  const location = useLocation();
  const theme = useTheme();

  // Filter the nav to the signed-in account's role. Defaults to admin so a
  // render without a session (tests, pre-login) still shows the full menu.
  const role = getCurrentUser()?.role || 'admin';
  const sections = NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.roles || item.roles.includes(role)),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <>
      <Box sx={{ px: collapsed ? 0 : 2, textAlign: collapsed ? 'center' : 'left' }}>
        {collapsed ? (
          <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: 1 }} aria-label="INVENTRAK">
            INV
          </Typography>
        ) : (
          <>
            <Typography variant="h5" sx={{ mb: 1, letterSpacing: 0.5, fontWeight: 800 }}>
              INVENTRAK
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.88 }}>
              Inventory admin portal
            </Typography>
          </>
        )}
      </Box>

      {sections.map((section) => {
        // Active-section highlight: when one of this section's modules is the
        // current page, the header glows brand-green. On a long flat nav this
        // is the quick "where am I" cue — and it reads well on a projector
        // during the demo. Exact-path match, same rule the module rows use.
        const sectionActive = section.items.some((item) => item.path === location.pathname);

        return (
          <Box key={section.label}>
            <Typography
              variant="caption"
              component="div"
              aria-current={sectionActive ? 'true' : undefined}
              sx={{
                display: 'block',
                textTransform: 'uppercase',
                letterSpacing: 1.2,
                fontSize: '0.68rem',
                fontWeight: 700,
                // Active: full-strength brand green + soft glow; idle: dimmed white.
                color: sectionActive ? colors.brandSecondary : '#fff',
                opacity: sectionActive ? 1 : 0.75,
                textShadow: sectionActive ? '0 0 14px rgba(168, 210, 43, 0.55)' : 'none',
                mb: 1,
                px: 2,
                transition: theme.transitions.create(['color', 'opacity']),
                // Collapsed rail: the divider itself glows when this section
                // holds the current page (height stays constant so nothing shifts).
                ...(collapsed
                  ? {
                      px: 0,
                      mb: 0.5,
                      '&::before': {
                        content: '""',
                        display: 'block',
                        margin: '4px auto 8px',
                        width: '60%',
                        height: 2,
                        borderRadius: 1,
                        backgroundColor: sectionActive ? colors.brandSecondary : 'rgba(255,255,255,0.25)',
                        boxShadow: sectionActive ? '0 0 8px rgba(168, 210, 43, 0.6)' : 'none',
                        transition: theme.transitions.create(['background-color']),
                      },
                    }
                  : {}),
              }}
            >
              {collapsed ? '' : section.label}
            </Typography>

            <Stack spacing={0.5} alignItems={collapsed ? 'center' : 'stretch'}>
              {section.items.map(({ label, path, Icon }) => {
                const active = location.pathname === path;
                const button = (
                  <Button
                    component={RouterLink}
                    to={path}
                    fullWidth={!collapsed}
                    onClick={onNavigate}
                    startIcon={<Icon sx={{ fontSize: 20 }} />}
                    aria-label={collapsed ? label : undefined}
                    sx={{
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      minWidth: collapsed ? 44 : 0,
                      px: collapsed ? 1 : 2,
                      py: 1.1,
                      borderRadius: 2,
                      color: '#fff',
                      backgroundColor: active ? 'rgba(255,255,255,0.18)' : 'transparent',
                      borderLeft: active ? `3px solid ${colors.brandSecondary}` : '3px solid transparent',
                      fontWeight: active ? 700 : 500,
                      '&:hover': {
                        backgroundColor: 'rgba(255,255,255,0.24)',
                      },
                    }}
                  >
                    {collapsed ? null : <span>{label}</span>}
                  </Button>
                );
                return collapsed ? (
                  <Tooltip key={path} title={label} placement="right" arrow>
                    {button}
                  </Tooltip>
                ) : (
                  <Box key={path}>{button}</Box>
                );
              })}
            </Stack>
          </Box>
        );
      })}

      <Box sx={{ mt: 'auto' }}>
        <Divider sx={{ borderColor: 'rgba(255,255,255,0.2)' }} />
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            mt: 2,
          }}
        >
          {collapsed ? null : (
            <Box>
              <Typography variant="body2" sx={{ color: '#f7ffdc' }}>
                Secure operations
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.82 }}>
                Manage stock, orders, and inventory data.
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </>
  );
}

export default function AdminLayout({ title, children, onLogout }) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));

  // Signed-in role for the header badge so the active account's permission
  // level is obvious at a glance — helpful on stage and in the demo.
  const role = getCurrentUser()?.role || 'admin';
  const meta = roleMeta(role);

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('inventrak.sidebar.collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Persist the desktop collapse preference.
  useEffect(() => {
    try {
      localStorage.setItem('inventrak.sidebar.collapsed', collapsed ? '1' : '0');
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [collapsed]);

  // If the viewport grows to desktop while the drawer is open, close it.
  useEffect(() => {
    if (isDesktop) setDrawerOpen(false);
  }, [isDesktop]);

  const toggleSidebar = () => {
    if (isDesktop) setCollapsed((c) => !c);
    else setDrawerOpen((o) => !o);
  };
  const closeDrawer = () => setDrawerOpen(false);

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: colors.background, pb: 4, display: 'flex' }}>
      {/* Desktop: fixed sidebar, collapsible to an icon rail (hidden on mobile). */}
      <Box
        component="aside"
        aria-label="Sidebar navigation"
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          gap: 2,
          width: collapsed ? COLLAPSED_W : EXPANDED_W,
          backgroundColor: brandSidebar,
          color: '#fff',
          px: collapsed ? 1 : 3,
          py: 3,
          flexShrink: 0,
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflowY: 'auto',
          transition: theme.transitions.create('width'),
        }}
      >
        <NavContent collapsed={collapsed} />
      </Box>

      {/* Mobile: temporary slide-in drawer (same nav, always expanded).
          No keepMounted: a closed drawer must not keep focusable nav links
          hidden in the DOM — unmounting avoids stray tab stops and keeps
          tests/AT clean. The nav is static, so remount is free.
          NOTE: NavContent mounts twice on mobile (this drawer + the hidden
          display:none aside). Harmless while NavContent stays stateless —
          if it ever gains internal state, reconcile the two instances. */}
      <Drawer
        variant="temporary"
        open={drawerOpen}
        onClose={closeDrawer}
        PaperProps={{ sx: { width: EXPANDED_W, backgroundColor: brandSidebar, color: '#fff' } }}
      >
        <Box
          role="navigation"
          aria-label="Sidebar navigation"
          sx={{ height: '100%', px: 3, py: 3, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}
        >
          <NavContent onNavigate={closeDrawer} />
        </Box>
      </Drawer>

      <Box component="main" sx={{ flex: 1, minWidth: 0, p: { xs: 2, md: 4 } }}>
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <IconButton
              onClick={toggleSidebar}
              edge="start"
              aria-label={isDesktop ? (collapsed ? 'Expand sidebar' : 'Collapse sidebar') : 'Open navigation menu'}
              sx={{ color: 'text.primary' }}
            >
              {isDesktop ? (collapsed ? <MenuOutlined /> : <MenuOpenOutlined />) : <MenuOutlined />}
            </IconButton>
            <Typography variant="h4" color="text.primary" noWrap>
              {title}
            </Typography>
            <Chip
              label={meta.label}
              size="small"
              aria-label={`Signed in as ${meta.label}`}
              sx={{
                fontWeight: 800,
                letterSpacing: 1.2,
                fontSize: '0.68rem',
                color: '#fff',
                backgroundColor: meta.color,
                ml: 1,
              }}
            />
          </Box>
          {onLogout ? (
            <Button variant="contained" color="secondary" onClick={onLogout}>
              Logout
            </Button>
          ) : null}
        </Box>
        <Breadcrumbs />
        {children}
      </Box>
    </Box>
  );
}
