# Sample Shop: answer key

These are the problems planted in [`sample-shop`](sample-shop). This file lives outside that folder on purpose: if the answers sat inside the project, Centinel's Review would read them as source and report findings against the documentation instead of the code.

| Requirement | Planted problem |
| --- | --- |
| REQ-1 Sign-in | The login error says "No account uses this email", which tells strangers which emails are registered. |
| REQ-3 Checkout | The server never checks that quantity is 1–10, so a request with a negative quantity creates a negative total. |
| REQ-4 Order privacy | `GET /api/orders/:id` returns any order, including another user's shipping address, to any signed-in user. |

Behaviour that works correctly, for browser tests: the product list, sign-in with the demo account, and placing a normal order with the `WELCOME10` discount.
