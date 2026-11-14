import { permanentRedirect } from "next/navigation";

/** Preserve published links while keeping one canonical legal notice. */
export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams;
  permanentRedirect(lang === "ar" ? "/privacy-policy?lang=ar" : "/privacy-policy");
}
