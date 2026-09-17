import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { signDocLink, verifyDocLink, LINK_DAYS } from "@/lib/erp/doc-link";

const S = "test-secret";
const NOW = Date.UTC(2026, 8, 14);

describe("a customer link", () => {
  it("opens the document it was made for, until it expires", () => {
    const t = signDocLink(S, { o: "org1", k: "SI", id: "inv1" }, NOW);
    expect(verifyDocLink(S, t, NOW + 86_400_000)).toMatchObject({ o: "org1", k: "SI", id: "inv1" });
    expect(verifyDocLink(S, t, NOW + (LINK_DAYS + 1) * 86_400_000)).toBeNull();
  });

  it("refuses a link someone edited, or signed with another secret", () => {
    const t = signDocLink(S, { o: "org1", k: "QT", id: "q1" }, NOW);
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ o: "org2", k: "QT", id: "q1", exp: NOW + 1e10 })).toString("base64url");
    expect(verifyDocLink(S, `${forged}.${sig}`, NOW)).toBeNull();
    expect(verifyDocLink("other-secret", t, NOW)).toBeNull();
    expect(verifyDocLink(S, body, NOW)).toBeNull();
    expect(verifyDocLink(S, "", NOW)).toBeNull();
  });

  it("can't be forged from another token signed with the same secret", () => {
    // An OAuth-state-style token: same secret, HMAC over the bare body, no doc-link context.
    const body = Buffer.from(JSON.stringify({ o: "org1", k: "SI", id: "inv1", exp: NOW + 1e10 })).toString("base64url");
    const sig = createHmac("sha256", S).update(body).digest().toString("base64url");
    expect(verifyDocLink(S, `${body}.${sig}`, NOW)).toBeNull();
  });
});
