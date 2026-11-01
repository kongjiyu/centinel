# Sample Shop

A tiny web shop for trying Centinel. It has sign-in, a product list, a cart and checkout, plus a short [requirements document](docs/requirements.md).

> **It has bugs on purpose.** Sample Shop is a practice target. Do not reuse its code.

## Run it

Requires Node.js 18 or newer. There are no dependencies to install.

```bash
node server.js
```

Open <http://localhost:4100>. Set `PORT` to use a different port.

Demo accounts (fictional, for this sample only):

| Email | Password |
| --- | --- |
| `demo@example.com` | `demo-password-123` |
| `alex@example.com` | `alex-password-456` |

## What Centinel should find

| Requirement | Planted problem |
| --- | --- |
| REQ-1 Sign-in | The login error says "No account uses this email", which tells strangers which emails are registered. |
| REQ-3 Checkout | The server never checks that quantity is 1–10, so a request with a negative quantity creates a negative total. |
| REQ-4 Order privacy | `GET /api/orders/:id` returns any order, including another user's shipping address, to any signed-in user. |

Behaviour that works correctly, for browser tests: the product list, sign-in with the demo account, and placing a normal order with the `WELCOME10` discount.
