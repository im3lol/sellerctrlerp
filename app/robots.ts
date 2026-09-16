import type { MetadataRoute } from "next";

const siteUrl = (process.env.APP_URL ?? "https://app.sellerctrl.com").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // /d/ = customer document links (signed tokens) — pages are noindex too, but a token
      // URL should never be fetched by a crawler in the first place.
      { userAgent: "*", allow: "/", disallow: ["/admin", "/apps", "/api", "/setup", "/d/"] },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
