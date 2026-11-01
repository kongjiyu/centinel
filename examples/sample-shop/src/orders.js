const crypto = require('node:crypto');

const DISCOUNT_CODES = { WELCOME10: 0.1 };
const orders = new Map();

// Seed one order that belongs to the second demo user.
orders.set('order-1001', {
  id: 'order-1001',
  userId: 'user-2',
  lines: [{ productId: 'p-bottle', name: 'Steel Water Bottle', price: 24.99, quantity: 2 }],
  discountCode: null,
  total: 49.98,
  shippingAddress: '42 Harbour Road, Penang',
  createdAt: '2026-10-30T09:15:00.000Z',
});

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function createOrder(userId, lines, discountCode) {
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  let discount = 0;
  if (discountCode) {
    const rate = DISCOUNT_CODES[String(discountCode).trim().toUpperCase()];
    if (!rate) return { error: 'This discount code is not valid.' };
    discount = subtotal * rate;
  }
  const order = {
    id: `order-${crypto.randomInt(2000, 9999)}`,
    userId,
    lines,
    discountCode: discountCode || null,
    total: roundMoney(subtotal - discount),
    createdAt: new Date().toISOString(),
  };
  orders.set(order.id, order);
  return { order };
}

function findOrder(id) {
  return orders.get(id) || null;
}

module.exports = { createOrder, findOrder };
