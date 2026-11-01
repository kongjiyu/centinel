# Real World App — Business Requirements (presentation demo)

Requirements written by the Centinel team for the Cypress Real World App (RWA), a peer-to-peer payment demo, pinned at commit `9dfcb9869533ce8a8963c556facc0d80457f9d39`. They describe intended behaviour only; they do not list known defects.

## REQ-1 Sign in

A registered user signs in with a username and password. A correct pair opens the home feed with the user's account balance. A wrong pair shows the message "Username or password is invalid" and does not open the application.

## REQ-2 Own account only

A signed-in user can view and change only their own account details (first name, last name, email, phone number). Requests to read or change another user's account must be refused.

## REQ-3 Profile changes persist

When a user saves changes on My Account, the new values are stored and are still shown after the page is reloaded.

## REQ-4 Payments

A user can pay or request money from a contact. An amount is required and must be greater than zero; without it the Pay and Request buttons stay disabled. A completed payment appears in the user's own ("Mine") transaction list.

## REQ-5 Transaction changes by participants only

Only the sender or receiver of a transaction can change it, for example accept or reject a payment request. Other users must not be able to change a transaction.

## REQ-6 Bank accounts belong to their owner

A user can add bank accounts and delete only their own bank accounts.

## REQ-7 Session protection

Sessions must be signed with a secret that is configured per deployment and never stored in source code.

## REQ-8 Sign out

Logout ends the session and returns to the sign-in page. After sign-out, opening a protected page such as `/transaction/new` redirects to sign-in.
