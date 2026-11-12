# Project collaborator directory

Project owners can search Centinel by exact verified email. With GitHub connected, username searches check the current repository roster first and use GitHub user search when there is no roster match. GitHub search also supports profile names and user qualifiers. Centinel email queries stay in Centinel. The picker uses live GitHub identities and does not use the editable project collaborator snapshot.

Selecting a Centinel account or a verified linked GitHub identity grants Viewer access without replacing an existing project role. Joined results are read-only. A GitHub-only result creates a cancellable, 30-day grant keyed to the stable GitHub account ID. Centinel claims it when the matching linked identity next opens Projects. Removing a member also clears grants for their linked GitHub identity. These actions do not send GitHub repository invitations.

Apply `202611100002_project_collaborator_directory.sql` to the intended Supabase project and restart the sidecar for the new modal workflow. The existing explicit bulk sync continues to use `202611100001_project_github_viewer_sync.sql`.

Verification used frontend tests, sidecar tests, Chromium fixtures at 1440×900, 1200×900 and 390×844, and a local PostgreSQL fixture for owner checks, exact lookup, verified identity claims, cancellation, expiry and role preservation. Hosted Supabase and real GitHub credentials were outside this verification.
