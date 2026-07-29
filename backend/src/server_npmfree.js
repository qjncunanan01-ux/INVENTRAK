const http = require('http');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const productsFile = path.join(dataDir, 'products.json');
const inventoryFile = path.join(dataDir, 'inventory.json');
const movementsFile = path.join(dataDir, 'stock_movements.json');
const orderFile = path.join(dataDir, 'order_inquiries.json');

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

if (!fs.existsSync(inventoryFile)) {
  const products = readJSON(productsFile) || [];
  const locs = ['Showroom', 'Stockroom 1', 'Stockroom 2'];
  const items = products.map((p, idx) => {
    const stocks = {};
    let total = 0;
    locs.forEach(l => { const q = Math.floor(Math.random() * 180) + 20; stocks[l] = q; total += q; });
    return {
      id: idx + 1,
      product: {
        id: idx + 1,
        name: p['Product Name'] || p.name,
        category: p['Category'] || p.category,
        size: p['Size'] || p.size,
        price: p['Price'] || p.price
      },
      locations: stocks,
      total
    };
  });
  writeJSON(inventoryFile, { locations: locs, items });
}

if (!fs.existsSync(movementsFile)) writeJSON(movementsFile, []);
if (!fs.existsSync(orderFile)) writeJSON(orderFile, []);

function parseBody(req, callback) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try { callback(null, JSON.parse(body || '{}')); }
    catch (err) { callback(err); }
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  const url = req.url;

  if (req.method === 'GET' && url === '/api/products') {
    const products = readJSON(productsFile) || [];
    const formatted = products.map((p, idx) => ({ id: idx + 1, name: p['Product Name'] || p.name, category: p['Category'] || p.category, brand: p['Brand'] || p.brand || '', description: p['Description'] || '', size: p['Size'] || p.size || '', unit: p['Unit'] || p.unit || '', price: p['Price'] || p.price || 0, status: 'active' }));
    return sendJson(res, 200, formatted);
  }

  if (req.method === 'GET' && url.startsWith('/api/products/')) {
    const id = parseInt(url.split('/').pop(), 10);
    const products = readJSON(productsFile) || [];
    const product = products[id - 1];
    if (!product) return sendJson(res, 404, { error: 'Product not found' });
    return sendJson(res, 200, { id, name: product['Product Name'] || product.name, category: product['Category'] || product.category, brand: product['Brand'] || product.brand || '', description: product['Description'] || product.description || '', size: product['Size'] || product.size || '', unit: product['Unit'] || product.unit || '', price: product['Price'] || product.price || 0, status: 'active' });
  }

  if (req.method === 'GET' && url === '/api/inventory') {
    const inv = readJSON(inventoryFile) || { locations: [], items: [] };
    return sendJson(res, 200, inv);
  }

  if (req.method === 'GET' && url === '/api/stock-movements') {
    const movements = readJSON(movementsFile) || [];
    return sendJson(res, 200, movements);
  }

  if (req.method === 'GET' && url === '/api/locations') {
    const inv = readJSON(inventoryFile) || { locations: [] };
    return sendJson(res, 200, inv.locations.map((name, index) => ({ id: index + 1, name })));
  }

  if (req.method === 'POST' && url === '/api/locations') {
    return parseBody(req, (err, obj) => {
      if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
      const inv = readJSON(inventoryFile) || { locations: [], items: [] };
      if (obj.name) inv.locations.push(obj.name);
      writeJSON(inventoryFile, inv);
      return sendJson(res, 200, { id: inv.locations.length, name: obj.name });
    });
  }

  if (req.method === 'DELETE' && url.startsWith('/api/locations/')) {
    const id = Number(url.split('/').pop());
    const inv = readJSON(inventoryFile) || { locations: [], items: [] };
    if (!Number.isNaN(id) && id > 0 && id <= inv.locations.length) {
      inv.locations.splice(id - 1, 1);
      writeJSON(inventoryFile, inv);
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { error: 'Location not found' });
  }

  if (req.method === 'GET' && url === '/api/stock-lots') {
    const inv = readJSON(inventoryFile) || { locations: [], items: [] };
    const lots = [];
    inv.items.forEach(item => {
      inv.locations.forEach(loc => {
        const qty = item.locations[loc] || 0;
        if (qty > 0) {
          lots.push({ id: `${item.id}-${loc}`, product_id: item.product.id, product_name: item.product.name, location_id: inv.locations.indexOf(loc) + 1, location_name: loc, qty, received_at: new Date().toISOString() });
        }
      });
    });
    return sendJson(res, 200, lots);
  }

  if (req.method === 'POST' && url === '/api/stock-movement') {
    return parseBody(req, (err, obj) => {
      if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
      const movements = readJSON(movementsFile) || [];
      const newMovement = {
        id: movements.length + 1,
        product_id: obj.product_id,
        qty: obj.qty,
        type: obj.type,
        src_location: obj.src_location || null,
        dst_location: obj.dst_location || null,
        notes: obj.notes || '',
        created_at: new Date().toISOString(),
        user: obj.user || 'system'
      };
      movements.unshift(newMovement);
      writeJSON(movementsFile, movements);

      const inv = readJSON(inventoryFile) || { locations: [], items: [] };
      const item = inv.items.find(i => i.id === obj.product_id);
      if (item) {
        if (obj.type === 'stock-in' && obj.dst_location) {
          item.locations[obj.dst_location] = (item.locations[obj.dst_location] || 0) + obj.qty;
        } else if (obj.type === 'stock-out' && obj.src_location) {
          item.locations[obj.src_location] = Math.max(0, (item.locations[obj.src_location] || 0) - obj.qty);
        } else if (obj.type === 'transfer' && obj.src_location && obj.dst_location) {
          item.locations[obj.src_location] = Math.max(0, (item.locations[obj.src_location] || 0) - obj.qty);
          item.locations[obj.dst_location] = (item.locations[obj.dst_location] || 0) + obj.qty;
        } else if (obj.type === 'adjustment' && (obj.dst_location || obj.src_location)) {
          const loc = obj.dst_location || obj.src_location;
          item.locations[loc] = obj.qty;
        }
        item.total = Object.values(item.locations).reduce((sum, qty) => sum + qty, 0);
        writeJSON(inventoryFile, inv);
      }

      return sendJson(res, 200, { ok: true });
    });
  }

  if (req.method === 'GET' && url === '/api/order-inquiries') {
    const orders = readJSON(orderFile) || [];
    return sendJson(res, 200, orders);
  }

  if (req.method === 'PUT' && url.startsWith('/api/order-inquiries/')) {
    return parseBody(req, (err, obj) => {
      if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
      const id = Number(url.split('/').pop());
      const orders = readJSON(orderFile) || [];
      const order = orders.find(o => o.id === id);
      if (!order) return sendJson(res, 404, { error: 'Order inquiry not found' });
      order.status = obj.status || order.status;
      writeJSON(orderFile, orders);
      return sendJson(res, 200, { ok: true });
    });
  }

  if (req.method === 'POST' && url === '/api/order-inquiries') {
    return parseBody(req, (err, obj) => {
      if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
      const orders = readJSON(orderFile) || [];
      const newOrder = {
        id: orders.length + 1,
        customer_name: obj.customer_name,
        customer_email: obj.customer_email,
        products: obj.products,
        estimated_cost: obj.estimated_cost,
        notes: obj.notes,
        status: 'pending',
        created_at: new Date().toISOString()
      };
      orders.unshift(newOrder);
      writeJSON(orderFile, orders);
      return sendJson(res, 200, { ok: true });
    });
  }

  if (req.method === 'POST' && url === '/api/auth/login') {
    return parseBody(req, (err, obj) => {
      if (err) return sendJson(res, 400, { error: 'Invalid JSON' });
      if (!obj.username) return sendJson(res, 400, { error: 'username required' });
      return sendJson(res, 200, { token: 'demo-token', user: { username: obj.username, role: 'admin' } });
    });
  }

  if (req.method === 'GET' && url.startsWith('/api/optimization/')) {
    const parts = url.split('/').filter(Boolean);
    const pid = parts[2];
    if (pid === 'abc') {
      const products = readJSON(productsFile) || [];
      const arr = products.map((p, idx) => ({ id: idx + 1, name: p['Product Name'] || p.name, value: ((idx + 1) * 10) * (p['Price'] || p.price || 1) }));
      arr.sort((a, b) => b.value - a.value);
      const total = arr.reduce((sum, item) => sum + item.value, 0);
      let cum = 0;
      const result = arr.map(item => {
        cum += item.value;
        const pct = (cum / total) * 100;
        let classification = 'C';
        if (pct <= 70) classification = 'A';
        else if (pct <= 90) classification = 'B';
        return { ...item, classification };
      });
      return sendJson(res, 200, result);
    }
    const products = readJSON(productsFile) || [];
    const product = products[pid - 1];
    if (!product) return sendJson(res, 404, { error: 'product not found' });
    const C = product['Price'] || product.price || 1;
    const D = 1000;
    const S = 50;
    const H = 0.2 * C;
    const EOQ = Math.sqrt((2 * D * S) / H);
    const leadTimeDays = 7;
    const ROP = Math.ceil((D / 365) * leadTimeDays);
    const safetyStock = Math.ceil(Math.sqrt(D) * 0.1);
    return sendJson(res, 200, { EOQ: Math.round(EOQ), ROP, safetyStock });
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

function createServer(port = process.env.PORT || 4001) {
  return server.listen(port);
}

if (require.main === module) {
  createServer();
  console.log(`npm-free backend running on ${process.env.PORT || 4001}`);
}

module.exports = { createServer };
