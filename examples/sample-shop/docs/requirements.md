# Sample Shop — Requirements

These are the product requirements Centinel checks the code against.

## REQ-1 Sign-in

- A user signs in with an email address and password.
- A wrong email and a wrong password must show the same message, "Email or password is incorrect.", so nobody can find out which emails have accounts.
- Passwords must never be returned by the API.

## REQ-2 Product catalogue

- Anyone can see the product list with names and prices, without signing in.
- Prices are shown in US dollars with two decimal places.

## REQ-3 Checkout

- Only signed-in users can place an order.
- Each item's quantity must be a whole number from 1 to 10. The server must reject any other quantity, even if the browser allows it.
- The order total is the sum of price × quantity for every item.
- The discount code `WELCOME10` takes 10% off the total. Any other code is rejected with "This discount code is not valid."

## REQ-4 Order privacy

- A signed-in user can only see their own orders.
- Opening another user's order must return "Order not found." and must not reveal any of its details.
