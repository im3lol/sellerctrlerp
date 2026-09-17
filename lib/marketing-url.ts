/**
 * Public origin for crawlable marketing pages. Keep it separate from APP_URL:
 * APP_URL may intentionally point at app.sellerctrl.com for application links.
 */
export const marketingUrl = (process.env.MARKETING_URL ?? "https://sellerctrl.com").replace(/\/$/, "");
