// Test-only webhook settings. playwright.config.ts hands these to the server it
// starts, and the specs import them to call POST /api/webhooks/inbound-email,
// so both sides agree without reading anyone's local server/.env.
export const TEST_WEBHOOK_SECRET = "e2e-test-webhook-secret";
export const TEST_SUPPORT_EMAIL = "support@example.com";
