/** @type {import('next').NextConfig} */
// HALT-3 (AUTH-001 / OAUTH-001): the previous `env` block inlined GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET into the client bundle (any value placed under Next `env` is exposed to the
// browser). With native Supabase OAuth the Google client id/secret live ONLY in the Supabase
// dashboard — never in app code or the Vercel env for this app. The `env` block is removed entirely.
// A postbuild guard (scripts/check-no-secrets-in-bundle.js) fails the build if any *_SECRET token
// ever reappears in built output.
const nextConfig = {
  experimental: {
    appDir: true,
  },
};

export default nextConfig;
