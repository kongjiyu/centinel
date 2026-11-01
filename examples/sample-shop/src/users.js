// Demo accounts. These are fictional test users for the sample app only.
const users = [
  { id: 'user-1', email: 'demo@example.com', name: 'Demo Shopper', password: 'demo-password-123' },
  { id: 'user-2', email: 'alex@example.com', name: 'Alex Rivera', password: 'alex-password-456' },
];

function findUserByEmail(email) {
  return users.find(user => user.email === email.trim().toLowerCase()) || null;
}

/** Fields that are safe to send to the browser. */
function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name };
}

module.exports = { findUserByEmail, publicUser };
