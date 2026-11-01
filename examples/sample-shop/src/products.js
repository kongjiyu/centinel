const products = [
  { id: 'p-mug', name: 'Ceramic Mug', price: 12.5 },
  { id: 'p-notebook', name: 'Dot Grid Notebook', price: 8 },
  { id: 'p-bottle', name: 'Steel Water Bottle', price: 24.99 },
  { id: 'p-tote', name: 'Canvas Tote Bag', price: 15 },
];

function listProducts() {
  return products.map(product => ({ ...product }));
}

function findProduct(id) {
  return products.find(product => product.id === id) || null;
}

module.exports = { listProducts, findProduct };
