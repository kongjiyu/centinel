# Todo App — Requirements (presentation demo)

Fictional requirements for the local demo app served at `http://localhost:37702` (`sidecar/demo/index.html`). The app intentionally violates REQ-2, REQ-3 and REQ-4 so a Review and a Dynamic test have real defects to find.

## REQ-1 Sign in

A user signs in with a username and password. After a successful sign-in the page shows the todo list and a Logout button. A wrong username or password shows "Invalid username or password" and does not open the list.

## REQ-2 Credential handling

User credentials must not be stored or compared in browser-delivered code. Sign-in must be verified by a server, and passwords must never appear in page source.

## REQ-3 Safe display of todo text

Todo text entered by a user must be displayed as plain text. Text such as `<img src=x onerror=alert(1)>` must appear literally and must never be interpreted as HTML or run as script.

## REQ-4 Todos persist

A todo added by a signed-in user must still be listed after the page is reloaded.

## REQ-5 Sign out

Logout returns to the sign-in form and clears the visible todo list and password field.
