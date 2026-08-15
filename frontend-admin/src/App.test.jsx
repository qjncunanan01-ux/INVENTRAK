import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the login screen when logged out', () => {
  render(<App />);
  expect(screen.getByText(/INVENTRAK Admin/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/Username/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
});

test('login screen shows the login button', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument();
});
