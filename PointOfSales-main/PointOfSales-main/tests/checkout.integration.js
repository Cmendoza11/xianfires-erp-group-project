// Real HTTP + MySQL acceptance test. Creates a fresh, isolated database per run.
import assert from 'node:assert/strict';
import vm from 'node:vm';
process.env.DB_NAME = `pos_test_${Date.now()}`;
process.env.ELECTRON = '1';
process.env.ERP_API_KEY_POS = '';
process.env.ERP_INTERNAL_KEY = '';
const { default: app } = await import('../index.js');
const { sequelize, User, Category, Product, Inventory, Transaction, Payment, InventoryMovement, Recipe } = await import('../models/index.js');
const { default: bcrypt } = await import('bcrypt');
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
function checkScripts(html) {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    new vm.Script(match[1]);
  }
}
let passed = 0;
function check(value, message) { assert.ok(value, message); console.log(`PASS ${++passed}: ${message}`); }
const client = () => {
  let cookie = '';
  return async (path, data) => {
    const res = await fetch(base + path, {
      method: data ? 'POST' : 'GET', redirect: 'manual',
      headers: { Cookie: cookie, ...(data ? { 'Content-Type': 'application/json' } : {}) },
      body: data ? JSON.stringify(data) : undefined,
    });
    const header = res.headers.get('set-cookie');
    if (header) cookie = header.split(';')[0];
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  };
};
try {
  const hash = await bcrypt.hash('Acceptance123!', 4);
  const [admin, cashier, other] = await Promise.all(['admin', 'cashier', 'cashier'].map((role, i) => User.create({
    name: `Test User ${i}`, email: `user${i}@pos.test`, password: hash, role,
  })));
  const category = await Category.create({ name: 'Acceptance meals' });
  const product = await Product.create({ name: 'Test Burger', categoryId: category.id, price: 100, type: 'Food' });
  await Inventory.create({ productId: product.id, currentStock: 10 });
  const a = client(), c = client(), o = client();
  for (const [request, user] of [[a, admin], [c, cashier], [o, other]]) {
    const login = await request('/login', { email: user.email, password: 'Acceptance123!' });
    check(login.location === (user.role === 'cashier' ? '/pos/terminal' : '/dashboard'), `${user.email} role landing`);
  }
  check((await c('/pos/settings')).location === '/dashboard', 'cashier blocked from Settings');
  const terminal = await c('/pos/terminal');
  check(terminal.status === 200, 'cashier terminal renders');
  checkScripts(terminal.text);
  const bad = await c('/pos/orders', { items: [{ productId: product.id, quantity: 1.5 }] });
  check(bad.location === '/pos/terminal', 'fractional quantity rejected');
  const created = await c('/pos/orders', { orderType: 'Take-Out', items: [{ productId: product.id, quantity: 2 }] });
  check(/^\/pos\/checkout\/\d+$/.test(created.location), 'cart creates checkout order');
  const orderId = Number(created.location.split('/').pop());
  check((await Inventory.findOne({ where: { productId: product.id } })).currentStock === 10, 'unpaid cart does not deduct stock');
  const checkout = await c(created.location);
  check(checkout.status === 200, 'checkout page renders');
  checkScripts(checkout.text);
  check((await o(created.location)).location === '/pos/orders', 'other cashier cannot open checkout');
  const pay = { orderType: 'Take-Out', paymentMethod: 'Cash', amountReceived: '500' };
  await o(`/pos/checkout/${orderId}/pay`, pay);
  check(await Transaction.count() === 0, 'other cashier cannot pay the order');
  await c(`/pos/checkout/${orderId}/pay`, { ...pay, amountReceived: '1' });
  check(await Transaction.count() === 0, 'insufficient cash writes no sale');
  await c(`/pos/checkout/${orderId}/pay`, { ...pay, paymentMethod: 'GCash', referenceNumber: 'TEST-123', verified: '' });
  check(await Transaction.count() === 0, 'unverified electronic payment rejected');
  const paid = await c(`/pos/checkout/${orderId}/pay`, pay);
  check(paid.location?.includes('/confirmation'), 'cash payment succeeds');
  const sale = await Transaction.findOne({ where: { orderId } });
  const payment = await Payment.findOne({ where: { transactionId: sale.id } });
  check(Number(payment.changeDue) === 500 - Number(sale.totalAmount), 'cash change matches saved total');
  check((await Inventory.findOne({ where: { productId: product.id } })).currentStock === 8, 'payment deducts stock once');
  await c(`/pos/checkout/${orderId}/pay`, pay);
  check(await Transaction.count({ where: { orderId } }) === 1, 'repeat payment does not duplicate sale');
  const dashboard = await a('/dashboard');
  check(dashboard.status === 200 && dashboard.text.includes('Weekly Sales Trend') && dashboard.text.includes('Top Selling Products'), 'POS dashboard renders sales panels');
  check(dashboard.text.includes(sale.transactionNumber) && dashboard.text.includes('Test Burger'), 'dashboard shows real recent sale and top product');
  checkScripts(dashboard.text);
  const receipt = await c(`/pos/receipts/${sale.id}`);
  check(receipt.status === 200 && receipt.text.includes('receipt-paper'), 'receipt renders with paper size selector');
  check((await o(`/pos/receipts/${sale.id}`)).status === 302, 'other cashier cannot read receipt');
  check((await a('/pos/reports/sales')).status === 200, 'admin sales report renders');
  await c(`/pos/transactions/${sale.id}/void`, { reason: 'Acceptance reversal' });
  check((await sale.reload()).status === 'Completed', 'cashier cannot void a sale');
  await a(`/pos/transactions/${sale.id}/void`, { reason: 'Acceptance reversal' });
  check((await Inventory.findOne({ where: { productId: product.id } })).currentStock === 10, 'admin void restores stock');
  await a(`/pos/transactions/${sale.id}/void`, { reason: 'Acceptance repeated reversal' });
  check((await Inventory.findOne({ where: { productId: product.id } })).currentStock === 10, 'repeat void does not duplicate restock');
  check(await InventoryMovement.count({ where: { productId: product.id } }) === 2, 'sale and reversal movement audit exists');
  await Inventory.update({ currentStock: 1 }, { where: { productId: product.id } });
  const pending = await Promise.all([c, o].map(request => request('/pos/orders', {
    orderType: 'Take-Out', items: [{ productId: product.id, quantity: 1 }],
  })));
  const ids = pending.map(result => Number(result.location.split('/').pop()));
  const results = await Promise.all([c, o].map((request, i) => request(`/pos/checkout/${ids[i]}/pay`, pay)));
  check(results.filter(result => result.location?.includes('/confirmation')).length === 1, 'only one concurrent last-stock payment succeeds');
  check((await Inventory.findOne({ where: { productId: product.id } })).currentStock === 0, 'concurrent payment cannot oversell');
  await Inventory.update({ currentStock: 2 }, { where: { productId: product.id } });
  const electronicOrder = await c('/pos/orders', {
    orderType: 'Take-Out', paymentMethod: 'GCash', items: [{ productId: product.id, quantity: 1 }],
  });
  const electronicId = Number(electronicOrder.location.split('/').pop());
  const gcashCheckout = await c('/pos/checkout/' + electronicId);
  check(/value="GCash"[^>]*checked/.test(gcashCheckout.text), 'GCash chosen in cart stays selected at checkout');
  const electronic = await c(`/pos/checkout/${electronicId}/pay`, {
    orderType: 'Take-Out', paymentMethod: 'GCash', referenceNumber: 'TEST-GCASH-123', verified: 'on',
  });
  check(electronic.location?.includes('/confirmation'), 'manually verified GCash payment succeeds');
  const modalPage = await a('/pos/reports/inventory?add=1');
  check(modalPage.status === 200 && modalPage.text.includes('<dialog id="product-movement-modal"') && modalPage.text.includes('data-auto-open="true"'), 'Add Movement is a floating dialog in Inventory Reports');
  check(!modalPage.text.includes('name="reason"') && !modalPage.text.includes('name="referenceNumber"'), 'movement modal omits reason and reference fields');
  check((await a('/pos/inventory/movements/new')).location === '/pos/reports/inventory?add=1', 'old Add Movement URL opens report dialog');
  const tablesPage = await a('/pos/tables');
  check(tablesPage.status === 200 && tablesPage.text.includes('id="open-table-modal"') && tablesPage.text.includes('<dialog id="add-table-modal"'), 'Add Table opens from top button as a dialog');
  const tableCreated = await a('/pos/tables', { name: 'Modal Test Table', capacity: 4, location: 'Main Hall' });
  check(tableCreated.location === '/pos/tables', 'modal table form saves table');
  const tableDuplicate = await a('/pos/tables', { name: 'Modal Test Table', capacity: 4, location: 'Main Hall' });
  check(tableDuplicate.location === '/pos/tables?add=table', 'duplicate table reopens modal');
  const tableRetry = await a('/pos/tables?add=table');
  check(tableRetry.text.includes('data-auto-open="true"') && tableRetry.text.includes('value="Modal Test Table"'), 'modal preserves input after validation error');
  const beforeInbound = Number((await Inventory.findOne({ where: { productId: product.id } })).currentStock);
  const inbound = await a('/pos/inventory/movements', { productId: product.id, direction: 'Inbound', quantity: 3, reason: 'Received finished products', referenceNumber: 'TEST-INBOUND' });
  check(inbound.location === '/pos/reports/inventory', 'manual product inbound saved');
  const inboundRow = await InventoryMovement.findOne({ where: { referenceNumber: 'TEST-INBOUND' } });
  check(inboundRow.previousStock === beforeInbound && inboundRow.newStock === beforeInbound + 3 && inboundRow.performedBy === admin.id && Boolean(inboundRow.createdAt), 'inbound records balances user and timestamp');
  await a('/pos/inventory/movements', { productId: product.id, direction: 'Outbound', quantity: 1, reason: 'Removed damaged product', referenceNumber: 'TEST-OUTBOUND' });
  const outboundRows = await a('/pos/reports/inventory?product=' + product.id + '&type=Outbound');
  check(outboundRows.status === 200 && /<tbody>[\s\S]*Outbound[\s\S]*<\/tbody>/.test(outboundRows.text) && !/<tbody>[\s\S]*Inbound[\s\S]*<\/tbody>/.test(outboundRows.text), 'product outbound filter shows matching audit history');
  check(outboundRows.text.includes('Previous Balance') && outboundRows.text.includes('New Balance') && outboundRows.text.includes(admin.name), 'movement page shows separate balances and user');
  await a('/pos/inventory/movements', { productId: product.id, direction: 'Outbound', quantity: 100000, reason: 'Invalid excess outbound' });
  check(Number((await Inventory.findOne({ where: { productId: product.id } })).currentStock) === beforeInbound + 2, 'outbound cannot make product balance negative');
  const ingredientResult = await a('/pos/inventory/ingredients', { name: 'Recipe Beef', unit: 'grams', minStockLevel: '100' });
  check(ingredientResult.location === '/pos/inventory', 'ingredient created through Stock Management');
  const ingredient = await Product.findOne({ where: { name: 'Recipe Beef', type: 'Supply' } });
  await a('/pos/inventory/stock-in', { productId: ingredient.id, quantity: 500, reason: 'Test delivery' });
  check((await Inventory.findOne({ where: { productId: ingredient.id } })).currentStock === 500, 'ingredient stock in uses grams');
  const setup = await a('/pos/inventory/setup?product=' + product.id);
  check(setup.status === 200 && setup.text.includes('Recipe Beef'), 'recipe editor renders ingredient and unit');
  const recipeBody = { productId: product.id, ['ingredient_' + ingredient.id]: 100 };
  await a('/pos/inventory/recipes', recipeBody);
  check(await Recipe.count({ where: { productId: product.id } }) === 1, 'product recipe is saved');
  const stockScreen = await a('/pos/inventory');
  check(stockScreen.status === 200 && stockScreen.text.includes('Recipe Beef') && !stockScreen.text.includes('Test Burger'), 'stock overview lists ingredients instead of menu products');
  check((await a('/pos/inventory/movements')).status === 200, 'unified stock movement screen renders');
  const menuScreen = await a('/pos/products');
  check(menuScreen.status === 200 && menuScreen.text.includes('Test Burger') && !menuScreen.text.includes('Recipe Beef'), 'menu products exclude raw materials');
  const recipeOrder = await c('/pos/orders', { orderType: 'Take-Out', items: [{ productId: product.id, quantity: 2 }] });
  const recipeOrderId = Number(recipeOrder.location.split('/').pop());
  check(Number.isFinite(recipeOrderId), 'recipe-based order created');
  const recipePay = await c('/pos/checkout/' + recipeOrderId + '/pay', pay);
  check(recipePay.location?.includes('/confirmation'), 'recipe-based payment succeeds');
  check((await Inventory.findOne({ where: { productId: ingredient.id } })).currentStock === 300, 'two servings deduct 200 grams of ingredient');
  const recipeSale = await Transaction.findOne({ where: { orderId: recipeOrderId } });
  await a('/pos/inventory/recipes', { ...recipeBody, ['ingredient_' + ingredient.id]: 150 });
  await a('/pos/transactions/' + recipeSale.id + '/void', { reason: 'Recipe changed after payment' });
  check((await Inventory.findOne({ where: { productId: ingredient.id } })).currentStock === 500, 'void restores original deduction despite recipe change');
  await a('/pos/inventory/stock-out', { productId: ingredient.id, quantity: 400, reason: 'Test spoilage' });
  check((await a('/pos/inventory/low-stock')).text.includes('Recipe Beef'), 'ingredient low-stock alert appears at threshold');
  await a('/pos/inventory/adjustment', { productId: ingredient.id, newStock: 0, reason: 'Physical count test' });
  check((await a('/pos/inventory/out-of-stock')).text.includes('Recipe Beef'), 'ingredient out-of-stock alert appears at zero');
  const blockedRecipe = await c('/pos/orders', { orderType: 'Take-Out', items: [{ productId: product.id, quantity: 1 }] });
  check(blockedRecipe.location === '/pos/terminal', 'out-of-stock ingredients block recipe sale');
  console.log(`\n${passed} checks passed. Isolated test database retained: ${process.env.DB_NAME}`);
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  // Outbox delivery is asynchronous; allow its local writes to finish before closing the pool.
  await new Promise(resolve => setTimeout(resolve, 300));
  await sequelize.close();
}
