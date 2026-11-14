import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Mail, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import policy from "@/content/legal/privacy-policy.json";
import { marketingUrl } from "@/lib/marketing-url";

type Props = { searchParams: Promise<{ lang?: string }> };
const POLICY_DATE = "2026-10-20";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const ar = (await searchParams).lang === "ar";
  const copy = ar ? policy.ar : policy.en;
  return {
    title: copy.title,
    description: copy.description,
    alternates: {
      canonical: `${marketingUrl}/privacy-policy`,
      languages: { en: `${marketingUrl}/privacy-policy`, ar: `${marketingUrl}/privacy-policy?lang=ar`, "x-default": `${marketingUrl}/privacy-policy` },
    },
    robots: { index: true, follow: true },
    openGraph: { title: `${copy.title} | SellerCtrl`, description: copy.description, url: `${marketingUrl}/privacy-policy`, type: "website", locale: ar ? "ar_EG" : "en_US" },
    twitter: { card: "summary", title: `${copy.title} | SellerCtrl`, description: copy.description },
  };
}

/** Public SSR notice. Language links work without cookies, an account or JavaScript. */
export default async function PrivacyPolicyPage({ searchParams }: Props) {
  const ar = (await searchParams).lang === "ar";
  const lang = ar ? "ar" : "en";
  const copy = ar ? policy.ar : policy.en;
  return <div lang={lang} dir={ar ? "rtl" : "ltr"} className="min-h-screen bg-background text-foreground print:bg-white print:text-black">
    <a href="#policy" className="sr-only fixed start-4 top-4 z-50 rounded-lg bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only">{copy.skip}</a>
    <header className="border-b bg-background print:hidden">
      <div className="mx-auto flex min-h-20 max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <Link href="/" aria-label={`SellerCtrl · ${copy.home}`}><Logo className="text-2xl text-primary" /></Link>
        <nav aria-label={copy.title} className="flex items-center gap-5 text-sm font-medium">
          <Link href="/" className="text-muted-foreground hover:text-primary">{copy.home}</Link>
          <a href={ar ? "/privacy-policy" : "/privacy-policy?lang=ar"} hrefLang={ar ? "en" : "ar"} lang={ar ? "en" : "ar"} className="rounded-lg border px-3 py-2 hover:bg-muted">{copy.otherLanguage}</a>
        </nav>
      </div>
    </header>
    <main id="policy" className="mx-auto max-w-6xl px-5 pb-16 pt-10 sm:px-8 sm:pt-16" tabIndex={-1}>
      <div className="max-w-3xl">
        <p className="mb-4 flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck className="size-4" aria-hidden="true" />{copy.eyebrow}</p>
        <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{copy.title}</h1>
        <p className="mt-4 text-sm text-muted-foreground">{copy.updated}: <time dateTime={POLICY_DATE}>{copy.date}</time></p>
        <p className="mt-6 text-base leading-8 text-muted-foreground">{copy.summary}</p>
      </div>
      <div className="mt-10 grid items-start gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14 print:block">
        <nav aria-label={copy.contents} className="rounded-2xl border bg-muted/20 p-5 lg:sticky lg:top-6 print:hidden">
          <h2 className="mb-3 text-sm font-bold">{copy.contents}</h2>
          <ol className="space-y-2 text-sm leading-6 text-muted-foreground">
            {copy.sections.map(section => <li key={section.id}><a href={`#${section.id}`} className="block rounded hover:text-primary focus-visible:outline-2 focus-visible:outline-primary">{section.title}</a></li>)}
            <li><a href="#contact" className="block rounded hover:text-primary">{copy.contact}</a></li>
          </ol>
        </nav>
        <article className="min-w-0 space-y-9 [overflow-wrap:anywhere]">
          {copy.sections.map(section => <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-8 border-b pb-8 print:break-inside-avoid">
            <h2 id={`${section.id}-heading`} className="text-xl font-bold leading-8">{section.title}</h2>
            <div className="mt-3 space-y-4 text-sm leading-7 text-muted-foreground sm:text-base sm:leading-8 print:text-black">{section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div>
          </section>)}
          <section id="contact" aria-labelledby="contact-heading" className="scroll-mt-8 rounded-2xl border border-primary/20 bg-primary/5 p-6 sm:p-8">
            <h2 id="contact-heading" className="text-xl font-bold">{copy.contact}</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">{copy.contactText}</p>
            <a href="mailto:info@sellerctrl.com" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground" dir="ltr"><Mail className="size-4" aria-hidden="true" />info@sellerctrl.com<ArrowUpRight className="size-4" aria-hidden="true" /></a>
          </section>
        </article>
      </div>
    </main>
    <footer className="border-t px-5 py-6 text-center text-sm text-muted-foreground">© 2026 SellerCtrl · <a href="mailto:info@sellerctrl.com" className="hover:underline" dir="ltr">info@sellerctrl.com</a></footer>
  </div>;
}
