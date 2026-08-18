import { useEffect, useState } from 'react';
import { Box, Button, Collapse, Divider, Drawer, IconButton, Stack, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import MenuOutlined from '@mui/icons-material/MenuOutlined';
import MenuOpenOutlined from '@mui/icons-material/MenuOpenOutlined';
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined';
import CameraAltOutlined from '@mui/icons-material/CameraAltOutlined';
import CompareArrowsOutlined from '@mui/icons-material/CompareArrowsOutlined';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
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
import { brandSidebar, colors } from '../theme';

// Grouped so module items read as a clean collapsible dropdown hierarchy.
// `roles` on each item drives the role-based nav: staff accounts only see
// the read/request modules they need (dashboard, inventory levels, movement
// history, adjustments, transfers, scan & stock, optimization, reports); the
// owner-only modules (products, approvals, orders, branch locations,
// security) stay visible to admins only. The backend enforces the same split.
const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', path: '/', Icon: DashboardOutlined, roles: ['admin', 'staff'] }],
  },
  {
    label: 'Inventory',
    collapsible: true,
    items: [
      { label: 'Inventory Levels', path: '/inventory', Icon: WarehouseOutlined, roles: ['admin', 'staff'] },
      { label: 'Stock Movement', path: '/stock-movement', Icon: SwapHorizOutlined, roles: ['admin', 'staff'] },
      { label: 'Stock Adjustments', path: '/stock-adjustments', Icon: TuneOutlined, roles: ['admin', 'staff'] },
      { label: 'Stock Transfers', path: '/stock-transfers', Icon: CompareArrowsOutlined, roles: ['admin', 'staff'] },
      { label: 'Branch Locations', path: '/locations', Icon: LocationOnOutlined, roles: ['admin'] },
    ],
  },
  {
    label: 'Catalog & Orders',
    collapsible: true,
    items: [
      { label: 'Products', path: '/products', Icon: Inventory2Outlined, roles: ['admin'] },
      { label: 'Scan & Stock', path: '/scan-stock', Icon: CameraAltOutlined, roles: ['admin', 'staff'] },
      { label: 'Order Inquiries', path: '/order-inquiries', Icon: ShoppingCartOutlined, roles: ['admin'] },
    ],
  },
  {
    label: 'Governance',
    collapsible: true,
    items: [
      { label: 'Approvals', path: '/approvals', Icon: FactCheckOutlined, roles: ['admin'] },
    ],
  },
  {
    label: 'Insights',
    collapsible: true,
    items: [
      { label: 'Optimization', path: '/optimization', Icon: InsightsOutlined, roles: ['admin', 'staff'] },
      { label: 'Reports', path: '/reports', Icon: AssessmentOutlined, roles: ['admin', 'staff'] },
    ],
  },
  {
    label: 'Account',
    items: [{ label: 'Security', path: '/security', Icon: SecurityOutlined, roles: ['admin'] }],
  },
];

const COLLAPSED_W = 76;
const EXPANDED_W = 280;

// Shared nav body: rendered in the fixed desktop sidebar AND the mobile
// temporary drawer so both stay identical. `collapsed` renders the
// mini-variant icon rail (labels hidden, tooltips on hover).
function NavContent({ collapsed = false, onNavigate }) {
  const location = useLocation();
  const [expandedGroups, setExpandedGroups] = useState(() => {
    const initial = {};
    for (const section of NAV_SECTIONS) {
      if (section.collapsible) {
        initial[section.label] = true;
      }
    }
    return initial;
  });

  const toggleGroup = (label) => {
    setExpandedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

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
        const isCollapsible = Boolean(section.collapsible) && !collapsed;
        const isOpen = expandedGroups[section.label] ?? true;

        return (
          <Box key={section.label}>
            {collapsed ? (
              <Divider sx={{ borderColor: 'rgba(255,255,255,0.18)', my: 1 }} />
            ) : isCollapsible ? (
              <Button
                fullWidth
                onClick={() => toggleGroup(section.label)}
                endIcon={isOpen ? <ExpandLess sx={{ fontSize: 18, color: 'rgba(255,255,255,0.85)' }} /> : <ExpandMore sx={{ fontSize: 18, color: 'rgba(255,255,255,0.85)' }} />}
                sx={{
                  justifyContent: 'space-between',
                  px: 2,
                  py: 0.75,
                  mb: 0.5,
                  color: 'rgba(255,255,255,0.85)',
                  textTransform: 'uppercase',
                  letterSpacing: 1.2,
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  borderRadius: 1.5,
                  '&:hover': {
                    backgroundColor: 'rgba(255,255,255,0.12)',
                  },
                }}
              >
                {section.label}
              </Button>
            ) : (
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  textTransform: 'uppercase',
                  letterSpacing: 1.2,
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  opacity: 0.75,
                  mb: 1,
                  px: 2,
                }}
              >
                {section.label}
              </Typography>
            )}

            <Collapse in={collapsed ? true : isOpen} timeout="auto" unmountOnExit={false}>
              <Stack spacing={0.5} alignItems={collapsed ? 'center' : 'stretch'}>
                {section.items.map(({ label, path, Icon }) => {
                  const active = location.pathname === path;
                  const isSubItem = isCollapsible;
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
                        px: collapsed ? 1 : isSubItem ? 2.5 : 2,
                        py: 1.2,
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
                      {collapsed ? null : (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {isSubItem && (
                            <Typography variant="caption" sx={{ opacity: 0.6, fontSize: '0.9rem', lineHeight: 1 }}>
                              •
                            </Typography>
                          )}
                          <span>{label}</span>
                        </Box>
                      )}
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
            </Collapse>
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
          </Box>
          {onLogout ? (
            <Button variant="contained" color="secondary" onClick={onLogout}>
              Logout
            </Button>
          ) : null}
        </Box>
        {children}
      </Box>
    </Box>
  );
}
