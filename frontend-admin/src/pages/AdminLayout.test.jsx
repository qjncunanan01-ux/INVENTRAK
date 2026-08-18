import { vi } from 'vitest';
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import AdminLayout from './AdminLayout';
import { createAppTheme } from '../theme';

// AdminLayout reads the signed-in role from api.getCurrentUser() to filter
// the sidebar. Default to admin (full nav) for the existing tests; the staff
// describe block swaps it to prove the role-based split.
let mockUser = { role: 'admin' };
vi.mock('../api', () => ({
  getCurrentUser: () => mockUser,
}));

// jsdom has no matchMedia; MUI's useMediaQuery needs it. We emulate the
// desktop viewport (md breakpoint = 900px) by returning matches:true for
// min-width queries.
function setViewport(desktop) {
  window.matchMedia = (query) => ({
    matches: desktop && query.includes('min-width'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ThemeProvider theme={createAppTheme()}>
        <AdminLayout title="Test Dashboard">
          <div>page content</div>
        </AdminLayout>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('AdminLayout responsive sidebar', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('desktop: renders the fixed sidebar with full-width nav', () => {
    setViewport(true);
    const { container } = renderLayout();
    const aside = container.querySelector('aside');
    expect(aside).toBeInTheDocument();
    // Full labels visible
    expect(screen.getByText('Products')).toBeInTheDocument();
    expect(screen.getByText('Order Inquiries')).toBeInTheDocument();
    // The hamburger reads "Collapse sidebar" on desktop
    expect(screen.getByLabelText('Collapse sidebar')).toBeInTheDocument();
  });

  test('desktop: toggling collapses to an icon rail and persists the choice', () => {
    setViewport(true);
    const { container } = renderLayout();

    fireEvent.click(screen.getByLabelText('Collapse sidebar'));

    // Visible labels hidden, INV mark shown, aria-labels on icon buttons
    expect(screen.queryByText('Products')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Products')).toBeInTheDocument();
    expect(screen.getByLabelText('INVENTRAK')).toHaveTextContent('INV');
    expect(screen.getByLabelText('Expand sidebar')).toBeInTheDocument();
    expect(localStorage.getItem('inventrak.sidebar.collapsed')).toBe('1');

    const aside = container.querySelector('aside');
    // The rail is much narrower than the expanded 280px (MUI applies the
    // width via an emotion class, so read it through getComputedStyle).
    expect(Number.parseFloat(getComputedStyle(aside).width)).toBeLessThan(280);
    expect(Number.parseFloat(getComputedStyle(aside).width)).toBe(76);

    // Expanding restores full nav
    fireEvent.click(screen.getByLabelText('Expand sidebar'));
    expect(screen.getByText('Products')).toBeInTheDocument();
    expect(Number.parseFloat(getComputedStyle(aside).width)).toBe(280);
    expect(localStorage.getItem('inventrak.sidebar.collapsed')).toBe('0');
  });

  test('desktop: collapsed choice is restored from localStorage on mount', () => {
    setViewport(true);
    localStorage.setItem('inventrak.sidebar.collapsed', '1');
    const { container } = renderLayout();
    expect(screen.queryByText('Products')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Expand sidebar')).toBeInTheDocument();
    expect(Number.parseFloat(getComputedStyle(container.querySelector('aside')).width)).toBe(76);
  });

  test('mobile: no fixed sidebar; hamburger opens a temporary drawer with the full nav', async () => {
    setViewport(false);
    const { container } = renderLayout();

    // The desktop toggle is absent; the hamburger opens the drawer instead.
    expect(screen.getByLabelText('Open navigation menu')).toBeInTheDocument();
    expect(screen.queryByLabelText('Collapse sidebar')).not.toBeInTheDocument();

    // The temporary drawer is unmounted while closed (no keepMounted).
    // MUI portals the Drawer to document.body, so query there.
    expect(document.querySelector('.MuiDrawer-root')).not.toBeInTheDocument();

    // Opening the drawer reveals the nav; clicking a link closes it.
    // Scope inside the drawer because the desktop aside (display:none at this
    // width) is still in the DOM and contains the same labels.
    fireEvent.click(screen.getByLabelText('Open navigation menu'));
    const drawer = document.querySelector('.MuiDrawer-root');
    expect(drawer).toBeInTheDocument();
    expect(within(drawer).getByText('Products')).toBeInTheDocument();

    act(() => {
      fireEvent.click(within(drawer).getByText('Products'));
    });
    // MUI keeps the drawer mounted during the 195ms exit transition; wait for
    // it to fully unmount (no keepMounted) after the transition finishes.
    await waitFor(() => expect(document.querySelector('.MuiDrawer-root')).not.toBeInTheDocument());
    expect(container.querySelector('main')).toBeInTheDocument();
  });

  test('mobile: the open drawer exposes the navigation landmark', () => {
    setViewport(false);
    renderLayout();
    fireEvent.click(screen.getByLabelText('Open navigation menu'));
    const drawer = document.querySelector('.MuiDrawer-root');
    expect(within(drawer).getByRole('navigation')).toBeInTheDocument();
  });
});

describe('AdminLayout role-based nav (staff vs admin)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('admin sees every module', () => {
    mockUser = { role: 'admin' };
    setViewport(true);
    renderLayout();
    for (const label of ['Products', 'Inventory', 'Inventory Levels', 'Scan & Stock', 'Stock Movement', 'Stock Adjustments', 'Stock Transfers', 'Approvals', 'Order Inquiries', 'Branch Locations', 'Optimization', 'Reports', 'Security']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  test('staff sees only the read/request modules, never the owner-only ones', () => {
    mockUser = { role: 'staff' };
    setViewport(true);
    renderLayout();
    for (const label of ['Dashboard', 'Inventory Levels', 'Stock Movement', 'Stock Adjustments', 'Stock Transfers', 'Scan & Stock', 'Optimization', 'Reports']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const label of ['Products', 'Approvals', 'Order Inquiries', 'Branch Locations', 'Security']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });
});
