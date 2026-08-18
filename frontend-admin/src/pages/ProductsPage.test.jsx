import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ProductsPage from './ProductsPage';
import * as api from '../api';

vi.mock('../api', async () => {
  const actual = await vi.importActual('../api');
  return {
    ...actual,
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    apiPut: vi.fn(),
    apiDelete: vi.fn(),
  };
});

const sampleProducts = [
  {
    id: 1,
    name: 'Caramel Syrup',
    category: 'Syrups & Sauce',
    brand: 'Torani',
    unit: 'bottle',
    price: 499,
    size: '750 ML',
    description: 'Rich caramel syrup',
    image: '/images/caramel.jpg',
  },
  {
    id: 2,
    name: 'Espresso Powder',
    category: 'Powder / Premix',
    brand: 'DaVinci',
    unit: 'bag',
    price: 350,
    size: '1 KG',
    description: 'Instant espresso powder',
    image: '',
  },
];

function renderProductsPage() {
  return render(
    <MemoryRouter>
      <ProductsPage onLogout={() => {}} />
    </MemoryRouter>
  );
}

describe('ProductsPage Comboboxes (Category, Brand, Unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.apiGet.mockResolvedValue(sampleProducts);
  });

  it('renders products and fetches existing category, brand, and unit options', async () => {
    renderProductsPage();

    await waitFor(() => {
      expect(screen.getByText('Caramel Syrup')).toBeInTheDocument();
      expect(screen.getByText('Espresso Powder')).toBeInTheDocument();
    });

    const categoryInput = screen.getByLabelText('Category');
    const brandInput = screen.getByLabelText('Brand');
    const unitInput = screen.getByLabelText('Unit');

    expect(categoryInput).toBeInTheDocument();
    expect(brandInput).toBeInTheDocument();
    expect(unitInput).toBeInTheDocument();
  });

  it('allows creating a new category option when typed value does not exist', async () => {
    renderProductsPage();

    await waitFor(() => {
      expect(screen.getByText('Caramel Syrup')).toBeInTheDocument();
    });

    const categoryInput = screen.getByLabelText('Category');
    fireEvent.change(categoryInput, { target: { value: 'Specialty Teas' } });

    expect(categoryInput).toHaveValue('Specialty Teas');
  });

  it('pre-populates category, brand, and unit fields when editing a product', async () => {
    renderProductsPage();

    await waitFor(() => {
      expect(screen.getByText('Caramel Syrup')).toBeInTheDocument();
    });

    const editButtons = screen.getAllByRole('button', { name: 'Edit' });
    fireEvent.click(editButtons[0]);

    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toHaveValue('Caramel Syrup');
      expect(screen.getByLabelText('Category')).toHaveValue('Syrups & Sauce');
      expect(screen.getByLabelText('Brand')).toHaveValue('Torani');
      expect(screen.getByLabelText('Unit')).toHaveValue('bottle');
      expect(screen.getByText('Save product')).toBeInTheDocument();
    });
  });

  it('binds new/selected entries correctly to the form payload on submission', async () => {
    api.apiPost.mockResolvedValue({ id: 3, name: 'New Product' });

    renderProductsPage();

    await waitFor(() => {
      expect(screen.getByText('Caramel Syrup')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Matcha Powder' } });

    const categoryInput = screen.getByLabelText('Category');
    fireEvent.change(categoryInput, { target: { value: 'Tea Premix' } });

    const brandInput = screen.getByLabelText('Brand');
    fireEvent.change(brandInput, { target: { value: 'Monin' } });

    const unitInput = screen.getByLabelText('Unit');
    fireEvent.change(unitInput, { target: { value: 'can' } });

    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '450' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create product' }));

    await waitFor(() => {
      expect(api.apiPost).toHaveBeenCalledWith('/api/products', expect.objectContaining({
        name: 'Matcha Powder',
        category: 'Tea Premix',
        brand: 'Monin',
        unit: 'can',
        price: 450,
      }));
    });
  });
});
