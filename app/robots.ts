import type { MetadataRoute } from "next";
import { marketingUrl } from "@/lib/marketing-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // /d/ = customer document links (signed tokens) — pages are noindex too, but a token
      // URL should never be fetched by a crawler in the first place.
      { userAgent: "*", allow: "/", disallow: ["/admin", "/apps", "/api", "/setup", "/d/"] },
    ],
    sitemap: `${marketingUrl}/sitemap.xml`,
  };
}
