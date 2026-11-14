import type { MetadataRoute } from "next";
import { marketingUrl } from "@/lib/marketing-url";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: marketingUrl, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${marketingUrl}/signup`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${marketingUrl}/privacy-policy`, lastModified: new Date("2026-10-20T00:00:00Z"), changeFrequency: "yearly", priority: 0.3,
      alternates: { languages: { en: `${marketingUrl}/privacy-policy`, ar: `${marketingUrl}/privacy-policy?lang=ar` } } },
  ];
}
