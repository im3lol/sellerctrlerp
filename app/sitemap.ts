import type { MetadataRoute } from "next";
import { marketingUrl } from "@/lib/marketing-url";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: marketingUrl, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${marketingUrl}/signup`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${marketingUrl}/privacy`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
  ];
}
