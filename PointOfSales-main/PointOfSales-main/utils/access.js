export const landingPage = (role) => ({
  cashier: '/pos/terminal',
  inventory: '/pos/inventory',
  staff: '/pos/orders',
}[role] || '/dashboard');

export const ownsOrder = (user, order) =>
  Boolean(user && order && (user.role === 'admin' ||
    (user.role === 'cashier' && Number(order.cashierId) === Number(user.id))));

export const validQuantity = (value) => {
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 999;
};
