const state = { token: null, user: null, products: [], cart: new Map() };

const money = value => `$${value.toFixed(2)}`;

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Something went wrong.');
  return body;
}

function renderProducts() {
  const list = document.getElementById('product-list');
  list.innerHTML = '';
  for (const product of state.products) {
    const item = document.createElement('li');
    item.innerHTML = `<span class="name"></span><span class="price">${money(product.price)}</span>`;
    item.querySelector('.name').textContent = product.name;
    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = 'Add to cart';
    add.addEventListener('click', () => addToCart(product.id));
    item.append(add);
    list.append(item);
  }
}

function addToCart(productId) {
  const quantity = (state.cart.get(productId) || 0) + 1;
  // The browser keeps quantities between 1 and 10.
  state.cart.set(productId, Math.min(quantity, 10));
  renderCart();
}

function renderCart() {
  const lines = document.getElementById('cart-lines');
  lines.innerHTML = '';
  let total = 0;
  for (const [productId, quantity] of state.cart) {
    const product = state.products.find(item => item.id === productId);
    total += product.price * quantity;
    const line = document.createElement('li');
    line.textContent = `${product.name} × ${quantity}`;
    lines.append(line);
  }
  document.getElementById('cart-total').textContent = money(total);
}

document.getElementById('signin-form').addEventListener('submit', async event => {
  event.preventDefault();
  const error = document.getElementById('signin-error');
  error.textContent = '';
  try {
    const result = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('password').value }),
    });
    state.token = result.token;
    state.user = result.user;
    document.getElementById('account-status').textContent = `Signed in as ${result.user.name}`;
    document.getElementById('signin-panel').hidden = true;
  } catch (cause) {
    error.textContent = cause.message;
  }
});

document.getElementById('checkout').addEventListener('click', async () => {
  const message = document.getElementById('checkout-message');
  if (!state.token) {
    message.textContent = 'Sign in to place an order.';
    return;
  }
  const items = [...state.cart].map(([productId, quantity]) => ({ productId, quantity }));
  try {
    const result = await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ items, discountCode: document.getElementById('discount-code').value.trim() || undefined }),
    });
    message.textContent = `Order ${result.order.id} placed. Total ${money(result.order.total)}.`;
    state.cart.clear();
    renderCart();
  } catch (cause) {
    message.textContent = cause.message;
  }
});

api('/api/products').then(result => {
  state.products = result.products;
  renderProducts();
});
