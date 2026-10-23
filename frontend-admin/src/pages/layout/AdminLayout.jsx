import { useEffect, useId, useState } from 'react';
import { Box, Button, Chip, Divider, Drawer, IconButton, Stack, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import MenuOutlined from '@mui/icons-material/MenuOutlined';
import MenuOpenOutlined from '@mui/icons-material/MenuOpenOutlined';
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined';
import CameraAltOutlined from '@mui/icons-material/CameraAltOutlined';
import CompareArrowsOutlined from '@mui/icons-material/CompareArrowsOutlined';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import PointOfSaleOutlined from '@mui/icons-material/PointOfSaleOutlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import RuleOutlined from '@mui/icons-material/RuleOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import LocationOnOutlined from '@mui/icons-material/LocationOnOutlined';
import ShoppingCartOutlined from '@mui/icons-material/ShoppingCartOutlined';
import SecurityOutlined from '@mui/icons-material/SecurityOutlined';
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined';
import TuneOutlined from '@mui/icons-material/TuneOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import CloudDownloadOutlined from '@mui/icons-material/CloudDownloadOutlined';
import WarehouseOutlined from '@mui/icons-material/WarehouseOutlined';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { getCurrentUser, getMeta } from '../../api';
import { ADMIN_TIER, STAFF_TIER, MANAGEMENT_TIER, roleMeta } from '../../roles';
import { brandSidebar, colors, company } from '../../theme';
import Breadcrumbs from '../../components/Breadcrumbs';
import LiquidGlassCard from '../../components/LiquidGlassCard';


// Sections group the modules the way the daily workflow reads (see the stock
// → catalog → money → governance flow). Core operations stay expanded on a
// fresh install; lower-frequency sections start folded but remain available.
// The sidebar keeps the confirmed daily workflow easy to scan. Policy-dependent
// or low-use pages remain routed in App.jsx but are omitted here until Sylver
// confirms the workflow needs them. `roles` drives the role-based nav per the
// role spec (see src/roles.js):
//
//   ADMIN_TIER (admin, super_admin, owner) — day-to-day business operations.
//   MANAGEMENT_TIER (super_admin, owner) — reporting, audit, backup and system
//     configuration in addition to daily operations.
//   STAFF_TIER (staff + the admin tiers) — the daily inventory modules staff
//     legitimately need: stock levels, movements, counts, requests, scanning.
//
// Inventory Staff deliberately do NOT get the dashboard, reports, optimization
// or any money surface — the spec forbids them from viewing sales, prices,
// customers, orders, reports or business analytics. The backend enforces the
// same split, so this is defense in depth rather than the only gate.
// Exported so the structure guard (pages/navSections.test.js) can assert the
// per-section page folders mirror these sections.
export const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', path: '/', Icon: DashboardOutlined, roles: ADMIN_TIER }],
  },
  {
    label: 'Inventory',
    items: [
      { label: 'Inventory Levels', path: '/inventory', Icon: WarehouseOutlined, roles: STAFF_TIER },
      { label: 'Shelf vs System', path: '/reconciliation', Icon: RuleOutlined, roles: STAFF_TIER },
      { label: 'Branch Locations', path: '/locations', Icon: LocationOnOutlined, roles: ADMIN_TIER },
    ],
  },
  {
    label: 'Stock Control',
    items: [
      // The Till takes MONEY, so it is admin-tier only. POST /api/sales is
      // adminOnly on both backends and the role policy is explicit that staff
      // handle counts, scanning and requests but "NO money". Offering staff a
      // link they cannot use would be a button that always 403s — the exact
      // affordance lie this nav is supposed to avoid.
      { label: 'Till', path: '/till', Icon: PointOfSaleOutlined, roles: ADMIN_TIER },
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
      { label: 'Reports', path: '/reports', Icon: AssessmentOutlined, roles: MANAGEMENT_TIER },
    ],
  },
  {
    label: 'Governance',
    items: [
      { label: 'Approvals', path: '/approvals', Icon: FactCheckOutlined, roles: ADMIN_TIER },
      { label: 'Audit Trail', path: '/audit-trail', Icon: HistoryOutlined, roles: MANAGEMENT_TIER },
      { label: 'Backup & Restore', path: '/backup', Icon: CloudDownloadOutlined, roles: MANAGEMENT_TIER },
      { label: 'System Settings', path: '/settings', Icon: SettingsOutlined, roles: MANAGEMENT_TIER },
    ],
  },
  {
    label: 'Account',
    items: [{ label: 'Security', path: '/security', Icon: SecurityOutlined, roles: ADMIN_TIER }],
  },
];

const COLLAPSED_W = 76;
const EXPANDED_W = 280;
const NAV_SECTIONS_STORAGE_KEY = 'inventrak.sidebar.collapsedSections';

// AdminLayout wraps every page, so it remounts per navigation — cache the
// meta answer in module scope to keep GET /api/meta to one request per page
// load. A failed fetch is NOT cached so a later mount can retry.
let metaBuildCache = null;

// Shared nav body: rendered in the fixed desktop sidebar AND the mobile
// temporary drawer so both stay identical. `collapsed` renders the
// mini-variant icon rail (labels hidden, tooltips on hover).
function NavContent({ collapsed = false, onNavigate, uiBuild, apiBuild }) {
  const location = useLocation();
  const theme = useTheme();
  const sectionIdsPrefix = useId();
  const role = getCurrentUser()?.role || 'admin';
  const navSectionsStorageKey = `${NAV_SECTIONS_STORAGE_KEY}.${role}`;
  const defaultCollapsedSections = role === 'admin' ? ['Account'] : [];
  const [collapsedSections, setCollapsedSections] = useState(() => {
    try {
      const saved = localStorage.getItem(navSectionsStorageKey);
      const parsed = saved === null ? null : JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : defaultCollapsedSections;
    } catch {
      return defaultCollapsedSections;
    }
  });

  // Filter the nav to the signed-in account's role. Defaults to admin so a
  // render without a session (tests, pre-login) still shows the full menu.
  const sections = NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.roles || item.roles.includes(role)),
    }))
    .filter((section) => section.items.length > 0);
  const activeSectionLabel = sections.find((section) =>
    section.items.some((item) => item.path === location.pathname))?.label;

  // Opening a page directly should reveal its section in the navigation.
  useEffect(() => {
    if (!activeSectionLabel) return;
    setCollapsedSections((current) => (current.includes(activeSectionLabel)
      ? current.filter((label) => label !== activeSectionLabel)
      : current));
  }, [activeSectionLabel]);

  useEffect(() => {
    try {
      localStorage.setItem(navSectionsStorageKey, JSON.stringify(collapsedSections));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [collapsedSections, navSectionsStorageKey]);

  // First-load stagger: one running index across ALL sections so the slide-in
  // delay reads as a single top-down wave through the whole sidebar.
  let rowIndex = 0;

  return (
    <>
      {/* Brand block: the official Sylver mark, the software name, and the
          company tagline. The mark ships on opaque white, so it sits in a white
          chip — that reads as a deliberate badge on the green rail instead of a
          pasted-on square. Collapsed rail keeps the chip so the brand is still
          identifiable at 72px wide. */}
      <Box sx={{ px: collapsed ? 0 : 2, textAlign: collapsed ? 'center' : 'left' }}>
        {collapsed ? (
          <Box
            // The rail has no room for the wordmark, so the mark itself is the
            // brand: labelled with the Sylver's product name for screen readers
            // where the old "INV" text used to be.
            role="img"
            aria-label={company.software}
            title={company.name}
            sx={{
              width: 40,
              height: 40,
              mx: 'auto',
              mb: 1,
              p: 0.4,
              borderRadius: 2,
              backgroundColor: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Box
              component="img"
              src={company.symbol}
              alt=""
              sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </Box>
        ) : (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 0.5 }}>
              <Box
                sx={{
                  width: 42,
                  height: 42,
                  p: 0.4,
                  borderRadius: 2,
                  backgroundColor: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Box
                  component="img"
                  src={company.symbol}
                  alt={`${company.name} logo`}
                  sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h6" sx={{ letterSpacing: 0.5, fontWeight: 800, lineHeight: 1.1 }}>
                  {company.software}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.82, letterSpacing: 0.3 }}>
                  Inventory admin portal
                </Typography>
              </Box>
            </Box>
            <Typography
              variant="caption"
              component="p"
              sx={{
                mt: 0.75,
                mb: 1.5,
                fontSize: '0.56rem',
                letterSpacing: 0.7,
                // One line: the tagline broke mid-phrase at the sidebar width
                // and read as two unrelated fragments.
                whiteSpace: 'nowrap',
                opacity: 0.72,
              }}
            >
              {company.tagline}
            </Typography>
          </>
        )}
      </Box>

      {sections.map((section) => {
        // Active-section highlight: when one of this section's modules is the
        // current page, the header glows brand-green. On a long nav this
        // is the quick "where am I" cue — and it reads well on a projector
        // during the demo. Exact-path match, same rule the module rows use.
        const sectionActive = section.items.some((item) => item.path === location.pathname);
        const sectionIsCollapsed = !collapsed && collapsedSections.includes(section.label);
        const sectionId = `${sectionIdsPrefix}-admin-nav-${section.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

        const toggleSection = () => {
          setCollapsedSections((current) => (current.includes(section.label)
            ? current.filter((label) => label !== section.label)
            : [...current, section.label]));
        };

        return (
          <Box key={section.label}>
            {collapsed ? (
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
                  color: sectionActive ? colors.brandSecondary : '#fff',
                  opacity: sectionActive ? 1 : 0.75,
                  textShadow: sectionActive ? '0 0 14px rgba(168, 210, 43, 0.55)' : 'none',
                  mb: 0.5,
                  px: 0,
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
                }}
              />
            ) : (
              <Button
                type="button"
                onClick={toggleSection}
                aria-expanded={!sectionIsCollapsed}
                aria-controls={sectionId}
                aria-current={sectionActive ? 'true' : undefined}
                endIcon={sectionIsCollapsed ? <ChevronRightOutlined /> : <ExpandMoreOutlined />}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  width: '100%',
                  minHeight: 32,
                  mb: 0.5,
                  px: 2,
                  color: sectionActive ? colors.brandSecondary : 'rgba(255,255,255,0.82)',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  letterSpacing: 1.2,
                  textAlign: 'left',
                  textTransform: 'uppercase',
                  '& .MuiButton-endIcon': { ml: 1, mr: 0, opacity: 0.8 },
                  '&:hover': { backgroundColor: 'rgba(255,255,255,0.08)' },
                }}
              >
                {section.label}
              </Button>
            )}

            <Stack
              id={sectionId}
              role="group"
              aria-label={section.label}
              spacing={0.5}
              alignItems={collapsed ? 'center' : 'stretch'}
              sx={{ display: sectionIsCollapsed ? 'none' : 'flex' }}
            >
              {section.items.map(({ label, path, Icon }) => {
                const rowStagger = sectionIsCollapsed ? rowIndex : rowIndex++;
                const active = location.pathname === path;
                const button = (
                  <Button
                    component={RouterLink}
                    to={path}
                    fullWidth={!collapsed}
                    onClick={onNavigate}
                    startIcon={<Icon sx={{ fontSize: 20 }} />}
                    aria-label={collapsed ? label : undefined}
                    // First-load polish: a gentle slide-in, staggered per row
                    // (running counter so the list reads top-down). Global CSS
                    // keyframes + prefers-reduced-motion guard in index.css.
                    className="nav-row-enter"
                    style={{ animationDelay: `${rowStagger * 28}ms` }}
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
        {/* Build versions (expanded sidebar only): the UI stamp is baked into
            this browser bundle at build time and the API line is the LIVE
            backend's answer from GET /api/meta. If the two disagree — or the
            sidebar lacks the Scan & Stock module — the browser is running a
            stale cached bundle: hard-refresh (Ctrl+Shift+R). Hover either
            line for the full explanation. */}
        {collapsed ? null : (
          <Typography
            variant="caption"
            component="div"
            aria-label="Build versions"
            data-testid="build-stamp"
            sx={{ mt: 1.5, fontSize: '0.65rem', lineHeight: 1.7, opacity: 0.75, wordBreak: 'break-word' }}
          >
            <Tooltip title="UI build — this browser bundle. If modules look wrong or missing, hard-refresh (Ctrl+Shift+R)." arrow placement="top">
              <span>UI {uiBuild}</span>
            </Tooltip>
            <br />
            <Tooltip title={apiBuild && apiBuild !== '…' ? 'Live backend build — GET /api/meta' : 'Asking the live backend for its build (GET /api/meta)…'} arrow placement="top">
              <span>API {apiBuild || '…'}</span>
            </Tooltip>
          </Typography>
        )}
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

  // Build versions: the UI stamp comes from the bundle (Vite define), the
  // API build is fetched once from the public GET /api/meta. Held HERE (not
  // in NavContent) because NavContent mounts twice on mobile widths — the
  // footer must not own state or it would fetch per instance.
  // Read the define WITHOUT a `typeof process` guard: Vite replaces the whole
  // `process.env.INVENTRAK_UI_BUILD` token with a string literal at build time,
  // and the browser bundle has no `process` object — so the guard short-circuits
  // to 'dev' and the deployed stamp never names the build it came from. The
  // guard added nothing: an un-replaced token only happens in a non-Vite
  // context (jsdom under Vitest), where `process` exists.
  const uiBuildRaw = process.env.INVENTRAK_UI_BUILD || 'dev';
  // Shorten a full 40-char sha in the stamp to 7 for display.
  const uiBuild = uiBuildRaw.replace(/\(([0-9a-f]{8,40})\)/i, (_m, sha) => `(${sha.slice(0, 7)})`);
  const [apiBuild, setApiBuild] = useState(metaBuildCache);
  useEffect(() => {
    if (metaBuildCache) return undefined;
    let alive = true;
    getMeta()
      .then((m) => {
        if (!alive) return;
        const commit = m && m.commit ? String(m.commit).slice(0, 7) : null;
        const version = m && m.version ? String(m.version) : null;
        metaBuildCache = commit || (version ? `v${version}` : 'unknown');
        setApiBuild(metaBuildCache);
      })
      .catch(() => {
        if (alive) setApiBuild('offline');
      });
    return () => {
      alive = false;
    };
  }, []);

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
        data-testid="admin-sidebar"
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
        <NavContent collapsed={collapsed} uiBuild={uiBuild} apiBuild={apiBuild} />
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
          <NavContent onNavigate={closeDrawer} uiBuild={uiBuild} apiBuild={apiBuild} />
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
              data-testid="role-badge"
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
