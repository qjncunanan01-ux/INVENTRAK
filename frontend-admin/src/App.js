import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import DashboardPage from './pages/DashboardPage';
import InventoryPage from './pages/InventoryPage';
import LocationsPage from './pages/LocationsPage';
import LoginPage from './pages/LoginPage';
import OptimizationPage from './pages/OptimizationPage';
import OrderInquiriesPage from './pages/OrderInquiriesPage';
import ProductsPage from './pages/ProductsPage';
import StockMovementPage from './pages/StockMovementPage';

function App() {
  const [user, setUser] = useState(null);
  const handleLogout = () => setUser(null);

  if (!user) return <BrowserRouter><Routes><Route path="/*" element={<LoginPage onLogin={setUser} />} /></Routes></BrowserRouter>;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage user={user} onLogout={handleLogout} />} />
        <Route path="/products" element={<ProductsPage onLogout={handleLogout} />} />
        <Route path="/inventory" element={<InventoryPage onLogout={handleLogout} />} />
        <Route path="/stock-movement" element={<StockMovementPage onLogout={handleLogout} />} />
        <Route path="/order-inquiries" element={<OrderInquiriesPage onLogout={handleLogout} />} />
        <Route path="/locations" element={<LocationsPage onLogout={handleLogout} />} />
        <Route path="/optimization" element={<OptimizationPage onLogout={handleLogout} />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
