import test from 'node:test';
import assert from 'node:assert/strict';
import { landingPage, ownsOrder, validQuantity } from '../utils/access.js';

test('each operational role lands on its work screen', () => {
  assert.equal(landingPage('cashier'), '/pos/terminal');
  assert.equal(landingPage('inventory'), '/pos/inventory');
  assert.equal(landingPage('staff'), '/pos/orders');
  assert.equal(landingPage('admin'), '/dashboard');
});
test('cashiers cannot checkout orders belonging to another cashier', () => {
  assert.equal(ownsOrder({ id: 1, role: 'cashier' }, { cashierId: 2 }), false);
  assert.equal(ownsOrder({ id: 1, role: 'cashier' }, { cashierId: 1 }), true);
  assert.equal(ownsOrder({ id: 1, role: 'staff' }, { cashierId: 1 }), false);
  assert.equal(ownsOrder({ id: 1, role: 'admin' }, { cashierId: 2 }), true);
});
test('quantities reject fractional, malformed, empty and excessive input', () => {
  for (const value of [0, -1, 1.5, '2abc', '', null, 1000, Infinity]) {
    assert.equal(validQuantity(value), false, String(value));
  }
  assert.equal(validQuantity(1), true);
  assert.equal(validQuantity('999'), true);
});
