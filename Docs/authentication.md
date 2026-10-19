# OAuth client behavior

The proxy is a public native OAuth client for its upstream MCP HTTP connection. The local MCP client talks to the proxy over stdio and does not need the WordPress tokens. The supported flow is authorization code with PKCE S256, using a configured public client ID or dynamic client registration. This implementation follows the [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) for that profile; it is not a claim to implement every optional authorization extension.

## Discovery and trust

The first unauthenticated upstream request is the client's actual MCP request. Its Bearer challenge selects the protected resource metadata URL and required scopes. Without an explicit metadata URL, discovery tries the endpoint-specific well-known location before the origin fallback. Authorization-server discovery supports root and tenant issuers through OAuth metadata and both OIDC discovery layouts. Discovery documents must identify the expected resource or issuer before their endpoints are used.

OAuth endpoints require HTTPS. HTTP is allowed only for literal loopback addresses and localhost for local development. OAuth endpoint redirects are rejected. CUSTOM_HEADERS are attached to OAuth requests only when their destination has the same origin as WP_API_URL; they are not forwarded to an independently hosted authorization server. A server requiring separate authorization-server credentials needs a different supported integration; placing those secrets in CUSTOM_HEADERS does not grant cross-origin forwarding.

The provider verifies advertised S256 support before opening a browser. Resource indicators are included in authorization, code exchange, and refresh requests, preserving the metadata resource value exactly. Setting OAUTH_RESOURCE_INDICATOR=false fails with an explicit error. The native callback must bind to loopback.

## Registration and stored credentials

New dynamic registrations declare application_type=native, token_endpoint_auth_method=none, and both authorization_code and refresh_token grants. The authorization server still decides whether to issue a refresh token. Existing issuer-bound registrations are reused; the proxy does not register a new client at every startup.

Client registrations and token records carry their issuing authorization server's issuer. A changed issuer cannot receive the old server's refresh token or registration credentials. A configured client ID already bound to another issuer fails with an actionable error; configure a client registered with the new server. Dynamic registrations can be replaced for the new issuer without forwarding the old credentials.

Legacy token records without an issuer can continue serving requests while their access token is valid. On expiry or rejection, the proxy starts a fresh authorization instead of sending an unbound refresh token. Unbound dynamic registrations are replaced once. This may require one new consent after upgrading from an older client. An existing bound registration that does not permit refresh can require a deliberate new registration; the proxy does not repeatedly register clients to probe grant policy.

The token directory remains namespaced by package version. Each resolved upstream resource URL has its own cache and coordination lock, so separate MCP endpoints or package versions can require separate authorization. Cross-process coordination assumes the processes share the same local cache directory and version; it does not coordinate different machines.

## Renewal and permission recovery

Expired or server-rejected access tokens are renewed under the same atomic file lock used for browser authorization. Only the owner refreshes or opens a browser; waiting processes reuse the saved result. The refresh response replaces the token pair atomically. If the server omits a replacement refresh token, the original is retained. A stale rejection cannot delete a replacement token saved by another process.

Only invalid_grant falls back from refresh to browser authorization. Other refresh failures retain credentials and report failure. Waiters have a bounded timeout and fail if the owner ends or becomes stale without saving valid tokens; they do not each open their own login. A later request can recover an orphaned lock.

Initial authorization uses challenged scopes, otherwise explicitly configured scopes or protected metadata scopes. A Bearer insufficient_scope response can request a user-mediated upgrade that includes the prior granted scopes. Each challenged request retries once. Repeated identical scope challenges are not reauthorized, and each method/tool or resource operation allows at most two scope upgrades per connection. Persistent denial or insufficient permissions ends with an error; reconnect deliberately after changing permissions. An arbitrary 403 does not trigger authorization.

Interactive authorization pauses the upstream HTTP deadline while retaining request cancellation. OAUTH_TIMEOUT_MS bounds the interactive flow and lock wait; it defaults to 30 seconds and can be raised for slower consent flows.

## Callback validation

State must match the pending attempt. If the response contains iss, it must match the recorded issuer exactly. If the server advertises authorization_response_iss_parameter_supported=true, missing iss is rejected; otherwise its absence is accepted for compatibility. These checks also apply to error callbacks. A valid denial ends the pending operation promptly.

The callback page acknowledges code receipt and tells the user to check the connection in their app. It does not claim that token exchange or storage succeeded. The legacy implicit-token endpoint is unavailable during a PKCE flow. Explicit legacy implicit flows require matching state and reject callbacks from untrusted origins. Implicit flow remains a compatibility mode outside this MCP OAuth 2.1 profile; its legacy coordinator is separate from PKCE coordination.

## Scope and verification

Client ID Metadata Documents are recommended by MCP but require maintained hosted client metadata and are not provided by this package. Enterprise-managed authorization and client_credentials are optional extensions and are not implemented. OAuth token validation for API access remains the protected server's responsibility; the proxy does not assume access tokens are JWTs.

Regression coverage lives in oauth-discovery.test.ts, oauth-client-contract.test.ts, oauth-renewal.test.ts, wordpress-transport.test.ts, and oauth-processes.test.ts. Process tests use a fake authorization server and browser callback. Setting OAUTH_PROCESS_PROXY_PATH to an installed proxy bundle runs those scenarios against a packed artifact; OAUTH_PROCESS_BROWSER_MODULE supplies the test-only browser adapter during that check. Neither option changes production behavior.

Before publishing, run the repository's clean package gate and test healthy/broken upstream paths plus shared login, expiry refresh, rejected tokens, invalid_grant, transient errors, scope upgrades, denial and stale locks against the installed tarball. A live account's refresh in Codex must be checked after a release is published; synthetic fixtures are not evidence of that live outcome.
