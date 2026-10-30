# Authentication and Identity Linking Specification

Status: proposed  
Date: 14 September 2026  
Scope: Centinel desktop account registration, sign-in, session handling, and identity linking through Supabase Auth

## Problem Statement

Centinel supports email/password sign-in plus Google and GitHub OAuth, including a desktop deep-link callback. Email registration and the remaining account-linking contract still require completion. Its local fallback also permits entry when Supabase is not configured. This is incompatible with a durable Supabase-backed workspace because the same person can receive inconsistent account behavior and an unauthenticated local session can appear equivalent to a real account.

Centinel must support three ways to access one account:

- Continue with Google;
- Continue with GitHub;
- register and sign in with an email address and password.

These are authentication identities, not separate Centinel profiles. When Google, GitHub, and email/password provide the same verified email address, they must resolve to one Supabase user ID, one Centinel profile, and the same projects and data. Centinel must not implement its own unsafe user merge based only on unverified provider metadata.

GitHub account authentication must also remain separate from Centinel's GitHub repository integration. Signing in with GitHub proves account identity; it must not silently grant Centinel access to private repositories. Repository access remains an explicit action under Settings > Connections.

## Goals

1. Provide Google, GitHub, and email/password registration and sign-in from the same authentication screen.
2. Represent one person with one canonical Supabase `auth.users.id` when identities share the same verified email.
3. Prevent creation of multiple Centinel profiles for the same canonical Supabase user.
4. Preserve the same projects, memberships, reports, evidence, and integrations regardless of which linked identity is used to sign in.
5. Support development callbacks and packaged desktop deep-link callbacks.
6. Keep authentication-provider permissions separate from repository-connector permissions.
7. Avoid account enumeration, insecure email matching, administrative keys in the desktop, and silent account merges.

## Non-Goals

- Building a custom password store or authentication server.
- Storing passwords in `public.profiles` or any Centinel table.
- Using a Supabase secret/service-role key in the renderer or packaged desktop application.
- Granting GitHub repository access as a side effect of Continue with GitHub.
- Automatically merging accounts whose providers return different email addresses.
- Supporting SAML SSO, phone sign-in, anonymous accounts, passkeys, or MFA in this slice.
- Redesigning Settings > Connections or the GitHub repository integration beyond separating it from sign-in.

## Terminology and Invariants

- **User:** the single canonical row in `auth.users`, identified by immutable UUID.
- **Identity:** one sign-in method linked to the user, such as `email`, `google`, or `github`.
- **Profile:** one row in `public.profiles` whose primary key equals `auth.users.id`.
- **Verified email:** an email address whose ownership was verified by Supabase or asserted as verified by a trusted OAuth provider.
- **Repository connection:** a separately authorized GitHub integration stored in `public.integrations`; it is not an authentication identity.

The following invariants are mandatory:

1. Application ownership and membership continue to reference `auth.users.id`, never an email address.
2. A user can have multiple identities but exactly one Centinel profile.
3. Email comparison is owned by Supabase Auth. Centinel does not maintain a second email uniqueness table.
4. Automatic linking is permitted only when Supabase determines that the provider email is verified and matches an existing account.
5. Different verified emails represent different users unless an already-authenticated user explicitly links another identity.
6. Signing in through a newly linked identity must return the existing user UUID.
7. Authentication success is not sufficient until the Supabase session is established and the canonical user UUID is available.
8. Production builds never bypass authentication when Supabase configuration is absent.

## User Experience

### Sign-in screen

Preserve the existing Centinel authentication panel and visual system. Present controls in this order:

1. **Continue with Google**
2. **Continue with GitHub**
3. Divider: **or continue with email**
4. Email address
5. Password
6. **Sign in**
7. **Forgot password?**
8. **Create account**

Only the action currently running is busy. While an OAuth redirect is starting, both provider buttons and email submission are disabled to prevent concurrent attempts. Errors appear in the existing accessible alert region and do not replace entered email values.

The GitHub sign-in button must not imply repository access. If supporting text is required, use: **Repository access is connected separately in Settings.**

### Email registration

Selecting **Create account** changes the panel to registration mode with:

- email address;
- password;
- confirm password;
- **Create account**;
- **Back to sign in**.

Password requirements shown in the UI must match the configured Supabase policy. The client performs basic completeness and confirmation checks; Supabase remains authoritative for acceptance.

After a successful request, show a neutral confirmation state:

> Check your email to finish creating your account.

The response must remain neutral when the address already belongs to an OAuth identity. Do not reveal whether an account exists. Supabase intentionally returns an obfuscated response and sends no duplicate verification message in this case.

### Password recovery

**Forgot password?** asks for an email and always returns the neutral response:

> If an account exists for this email, we sent password reset instructions.

The reset callback must return to Centinel. After the recovery session is established, the user enters and confirms a new password. A recovery request must not reveal whether the email exists.

### Provider callback

OAuth opens in the system browser. The user returns to the same Centinel installation after provider authorization.

- Desktop redirect: `centinel://auth/callback`

The callback view shows a bounded **Completing sign-in…** state, exchanges the authorization code for a Supabase session, restores the original app window, and opens the workspace. It offers a retry and return-to-sign-in action on failure.

Centinel registers and handles the `centinel` URL scheme on Windows, forwarding a callback to an already-running primary instance or retaining it until the renderer loads.

### Account and GitHub connection state

Signing in with GitHub establishes the Centinel identity only. Repository access is a separate, optional OAuth connection with its own scoped token. After a GitHub-authenticated user reaches the workspace, Centinel asks once for the current signed-in account whether to connect repository access. The user can choose **Not now** and connect later in Settings.

The account menu presents the sign-in provider separately from repository-connection status. **Switch account** retains the active session until a replacement sign-in succeeds, and exposes **Back to workspace** as a safe recovery action.

## Authentication Flows

### Email/password registration

1. Trim surrounding whitespace and pass the email to Supabase for canonical handling; do not apply provider-specific transformations such as removing dots.
2. Call `supabase.auth.signUp({ email, password, options: { emailRedirectTo } })`.
3. Display the same confirmation response whether the address is new or already belongs to an OAuth-created user.
4. On email confirmation, complete the callback and establish the session.
5. Ensure exactly one `public.profiles` row for the authenticated UUID.

### Email/password sign-in

1. Call `supabase.auth.signInWithPassword({ email, password })`.
2. On success, cache the authenticated UUID and access token for sidecar requests.
3. On failure, display a generic invalid-credentials message. Do not distinguish nonexistent email from incorrect password.
4. A user originally created through OAuth cannot use a password until a password has been explicitly added to that authenticated account.

### Google sign-in

1. Call `signInWithOAuth` with provider `google`, the configured callback, and PKCE.
2. Request identity-only scopes: `openid`, email, and profile.
3. Supabase completes provider authentication and evaluates verified-email automatic linking.
4. Exchange the callback code, establish the session, and ensure the profile.
5. Do not retain or use a Google provider token for Google Drive access. Google Drive remains a separate Settings connection.

### GitHub sign-in

1. Call `signInWithOAuth` with provider `github`, the configured callback, and PKCE.
2. Request only identity scopes needed to receive the user and verified email (`read:user user:email`). Do not request `repo` for account sign-in.
3. Supabase completes provider authentication and evaluates verified-email automatic linking.
4. Exchange the callback code, establish the session, and ensure the profile.
5. Do not store or reuse the sign-in provider token as the GitHub repository connector token.

### Sign-out

1. Call Supabase sign-out.
2. Clear renderer access-token and user-ID caches.
3. Clear account-specific in-memory UI state.
4. Preserve encrypted external connector records in Supabase; signing out does not disconnect integrations.
5. Return to the sign-in screen.

## Duplicate Email and Identity-Linking Rules

Supabase Auth automatic identity linking is the canonical deduplication mechanism. Supabase keeps emails unique and automatically links a new OAuth identity to an existing user when the provider supplies the same verified email.

| Existing state | Attempt | Required result |
|---|---|---|
| No user for email | Email registration | Create one user with email identity after verification |
| No user for email | Google/GitHub sign-in | Create one user with that OAuth identity |
| Email user exists | OAuth sign-in with same verified email | Link OAuth identity to existing user; preserve UUID and data |
| Google user exists | GitHub sign-in with same verified email | Link GitHub identity to the Google-created user |
| OAuth user exists | Email registration with same email | Do not create a second user; return neutral confirmation behavior |
| OAuth user exists | User wants password sign-in | While authenticated, add a password using the supported account action |
| Provider returns same but unverified email | OAuth sign-in | Do not custom-link; follow Supabase's safe provider result and show actionable guidance if sign-in cannot complete |
| Provider returns a different email | OAuth sign-in | Create/use a different user; never silently merge |
| Signed-in user explicitly links provider | `linkIdentity` flow | Link only after fresh provider authorization and Supabase validation |
| Identity already belongs to another user | Explicit link attempt | Reject; do not move or merge it automatically |

Centinel must never:

- query `auth.users` from the desktop to find a matching email;
- use a service-role key to merge users;
- update project ownership from one UUID to another as part of sign-in;
- match on display name, avatar, GitHub login, provider account ID, or an unverified email;
- reveal that an email already exists through registration or recovery responses.

### Explicit identity management

Add a future-compatible **Sign-in methods** area under the user's profile. It lists Email, Google, and GitHub as linked or not linked. A signed-in user may link an additional OAuth identity using `supabase.auth.linkIdentity` after manual linking is enabled in Supabase.

Unlinking is not required in the first implementation. When added, Centinel must prevent removal of the final usable identity and require recent authentication for sensitive changes.

## Supabase Configuration

Enable the following under Authentication > Sign In / Providers:

- Email with Confirm Email enabled;
- Google;
- GitHub.

Configure the application redirect allow list:

```text
http://localhost:1420/auth/callback
centinel://auth/callback
```

Provider consoles must redirect to Supabase, not directly to Centinel:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

Supabase then redirects the completed session flow to Centinel's configured redirect.

Use separate provider applications/credentials for authentication and data integrations where scopes differ:

- **GitHub authentication OAuth App:** configured inside Supabase; identity-only scopes; Supabase callback.
- **GitHub repository integration OAuth App:** configured for the local sidecar; repository scopes; `http://localhost:37701/integrations/github/callback`.
- **Google authentication client:** configured inside Supabase; identity-only scopes; Supabase callback.
- **Google Drive integration client:** configured for the local sidecar; Drive read scope; `http://localhost:37701/integrations/google_drive/callback`.

Do not place the Google/GitHub authentication provider secrets in `VITE_*` variables. They are entered in the Supabase provider configuration. The existing connector credentials remain sidecar-only environment variables.

## Data Contract

### Canonical user and profile

Continue using `auth.users.id` as every ownership reference. `public.profiles.id` remains a one-to-one foreign key to that UUID.

Do not duplicate the canonical email in `public.profiles`. Read the current email from the verified Supabase session. Profile metadata may contain only presentation fields such as display name and avatar URL.

After every newly established session, run an idempotent profile ensure operation:

```text
insert public.profiles(id, display_name, avatar_url)
on conflict (id) do update only safe presentation fields
```

The operation runs as the authenticated user and remains constrained by RLS. It must not overwrite a user-edited display name with provider metadata on every sign-in.

### Session propagation

The renderer sends the Supabase access token to the sidecar as `Authorization: Bearer <token>`. The sidecar derives and validates the user from that token. `X-Centinel-User-Id` must not be treated as authoritative when it disagrees with the validated token.

Persist the Supabase refresh session using an appropriate desktop-safe mechanism. Do not store provider client secrets, Supabase secret keys, or GitHub repository tokens in renderer-accessible storage.

## Required Code Changes

### Frontend authentication module

Extend `centinel/src/auth/supabaseAuth.ts` with cohesive operations for:

- email registration;
- email/password sign-in;
- password recovery and password update;
- Google OAuth sign-in;
- GitHub OAuth sign-in;
- callback/code exchange;
- session restore and subscription;
- idempotent profile ensure;
- optional explicit identity linking.

Configure the client for PKCE and centralize redirect construction. Google and GitHub must use the same callback completion path.

### Auth screen

Extend `AuthScreen` rather than creating unrelated login screens. Add GitHub, registration, confirmation, recovery, and callback states while preserving existing accessibility and Centinel styling.

Remove the unauthenticated workspace bypass whenever Supabase-backed mode is configured or the app is built for production. Missing configuration must show a clear setup error, not open the workspace.

### Application session boundary

Keep `App.tsx` driven by Supabase session state. Workspace loading begins only after session restoration completes. Switching linked sign-in methods must not change project ownership because the canonical UUID remains stable.

### Sidecar authorization

Validate the bearer token before using an owner UUID for Supabase reads and writes. Treat client-provided identity headers only as transitional metadata, never proof of identity.

### Database migration

Add only the profile-ensure support required by this specification. Do not add a second users table or a unique-email column to `public.profiles`. Preserve all existing foreign keys to `auth.users(id)` and existing project membership RLS.

## Security Requirements

1. Use authorization-code flow with PKCE for desktop OAuth callbacks.
2. Generate and validate OAuth state for every attempt.
3. Accept callbacks only for a pending attempt initiated by this installation.
4. Do not log authorization codes, access tokens, refresh tokens, passwords, provider tokens, or complete callback URLs containing credentials.
5. Keep Supabase secret/service-role keys out of the desktop application.
6. Require verified provider email before relying on automatic same-email linking.
7. Use generic registration, recovery, and invalid-credential responses to limit account enumeration.
8. Rate-limit repeated authentication attempts through Supabase configuration and UI backoff.
9. Use identity-only scopes for sign-in providers.
10. Store GitHub/Google data-integration tokens separately from authentication identities.
11. Do not use provider access tokens returned during social sign-in for external-data features.
12. Clear session caches on sign-out and on invalid/expired refresh state.

## Error and Recovery States

The UI must handle:

- provider disabled or misconfigured;
- user cancels Google/GitHub authorization;
- callback URL is not allowed;
- callback reaches Centinel without a pending PKCE verifier;
- expired or reused authorization code;
- email confirmation still pending;
- invalid email/password;
- registration email already associated with an OAuth identity;
- provider returns no usable verified email;
- explicit identity is already linked to another user;
- offline or unreachable Supabase;
- expired local session that cannot refresh;
- deep link opens a new process while Centinel is already running;
- deep link launches Centinel from a closed state.

Errors must be actionable without exposing whether another person's account exists.

## Testing Requirements

### Unit and component tests

- Auth screen exposes Google, GitHub, email sign-in, registration, and recovery controls with accessible names.
- Busy, validation, confirmation, cancellation, and service-error states are covered.
- Production configuration failure never invokes the workspace callback.
- OAuth functions use the correct provider, shared callback, state, and PKCE configuration.
- GitHub sign-in never requests `repo` or other repository scopes.
- Registration and recovery responses remain neutral.
- Session cache and account UI state clear on sign-out.

### Integration tests

- Email registration, confirmation, sign-in, sign-out, recovery, and new-password flows succeed.
- Google-first then GitHub-with-same-verified-email returns the same `auth.users.id`.
- Email-first then Google/GitHub-with-same-verified-email returns the same UUID.
- OAuth-first then attempted email registration creates no duplicate user.
- Adding a password while authenticated preserves the OAuth-created UUID.
- Different provider emails are not silently merged.
- An unverified email is not used for a custom merge.
- Exactly one `public.profiles` row exists after repeated and concurrent sign-ins.
- Projects created before linking remain accessible through every linked identity.
- Signing in with GitHub does not create a `public.integrations` GitHub repository connection.
- Connecting GitHub under Settings does not alter Supabase authentication identities.
- Sidecar rejects a mismatched or forged `X-Centinel-User-Id`.

### Desktop callback tests

- Development HTTP callback completes a Google and GitHub session.
- Packaged `centinel://auth/callback` works on cold start.
- The same deep link focuses and completes auth in an already-running instance.
- Malformed, duplicated, expired, and unsolicited callback URLs are rejected.
- Refreshing or reopening the app restores the same canonical session.

## Acceptance Criteria

1. The sign-in screen offers Continue with Google, Continue with GitHub, and email/password sign-in.
2. A user can create and confirm an email/password account.
3. A user can recover and change a forgotten password.
4. Google and GitHub callbacks establish a valid Supabase session in development.
5. Packaged builds use a registered Centinel deep link once desktop callback support ships.
6. The same verified email across all three methods produces one Supabase user UUID.
7. That UUID has exactly one profile and sees the same owned/member projects through every linked method.
8. Duplicate email registration does not create another user or disclose existing-account state.
9. Different emails are not silently merged.
10. Continue with GitHub requests identity access only and does not connect repositories.
11. Repository connection remains an explicit Settings action.
12. No service-role/secret key is required or bundled in the desktop runtime.
13. The sidecar validates the Supabase bearer identity before accessing user-scoped data.
14. Relevant frontend, sidecar, Supabase integration, and Windows callback tests pass.

## Rollout Sequence

1. Configure Email, Google, and GitHub providers and callback allow lists in a non-production Supabase project.
2. Implement registration, recovery, generic errors, and GitHub sign-in over the current development HTTP callback.
3. Add identity/profile integration tests, including all same-email orderings.
4. Harden the sidecar bearer-token identity boundary.
5. Add Tauri URL-scheme registration, single-instance callback forwarding, and PKCE callback handling.
6. Verify a signed Windows installer rather than relying only on `tauri dev`.
7. Enable production provider credentials and production redirect entries.
8. Monitor Supabase Auth audit logs for failed linking, callback, and refresh patterns.

## Current-State Constraints

- `AuthScreen` currently has Google and email sign-in controls but no registration, recovery, or GitHub sign-in state.
- `supabaseAuth.ts` currently implements password sign-in, Google OAuth start, session restore, subscription, and sign-out only.
- The current client accepts only `centinel://auth/callback` and explicitly exchanges a PKCE authorization code or restores an implicit session during the browser-to-desktop hand-off.
- `App.tsx` still supports a local unauthenticated entry path when Supabase is absent.
- The renderer caches the Supabase access token and user ID in session storage; the sidecar identity boundary requires hardening before it can treat all remote data as user-isolated.
- `public.profiles` is correctly keyed by `auth.users.id`, but the migration does not currently create/ensure a profile after first authentication.
- The existing GitHub repository connector is a separate sidecar OAuth flow and currently requests `repo read:user`. It must not be reused for Continue with GitHub.

## Reference Behavior

- Supabase Auth automatically links identities that share the same verified email and keeps user emails unique: [Identity Linking](https://supabase.com/docs/guides/auth/auth-identity-linking).
- Supabase documents email registration, confirmation, password sign-in, recovery, and neutral anti-enumeration behavior: [Password-based Auth](https://supabase.com/docs/guides/auth/passwords).
- Supabase's GitHub provider uses the project Auth callback and `signInWithOAuth({ provider: 'github' })`: [Sign in with GitHub](https://supabase.com/docs/guides/auth/social-login/auth-github).
- Supabase's Google provider requires identity scopes and the project Auth callback: [Sign in with Google](https://supabase.com/docs/guides/auth/social-login/auth-google).
- Supabase supports custom deep-link redirect URIs when they are registered in the Auth redirect allow list: [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
