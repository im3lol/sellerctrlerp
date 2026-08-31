import "server-only";
import { createSign } from "crypto";

// QZ Tray trusts this app's print requests via a self-signed certificate, so the desktop
// app's "Untrusted website" Allow prompt never has to fire. One pair per deployment (each
// customer's stack is isolated), stored in env as a
// single line with literal \n (portable across .env files / Docker env_file / Vercel's
// one-line env UI) and unescaped back to real PEM here. Generate a pair with:
//   openssl genrsa -out private-key.pem 2048
//   openssl req -x509 -new -key private-key.pem -out digital-certificate.pem -days 3650 \
//     -subj "/CN=<org> QZ Signing" \
//     -addext "basicConstraints=critical,CA:TRUE,pathlen:1" \
//     -addext "keyUsage=critical,keyCertSign,cRLSign" \
//     -addext "subjectKeyIdentifier=hash"
// The -addext flags matter: a bare `openssl req -x509` cert (no extensions) gets a QZ Tray
// "Allow" that never sticks in Site Manager even after "Remember this decision" — matching
// QZ's own demo cert's extension set is what makes the trust decision actually persist.
const pem = (envVar: string): string => {
  const v = process.env[envVar];
  if (!v) throw new Error(`${envVar} is not set — QZ Tray print signing is not configured`);
  return v.replace(/\\n/g, "\n");
};

/** Whether this deployment has QZ signing configured — gates the download link on /settings/printing. */
export function isQzConfigured(): boolean {
  return !!process.env.QZ_CERTIFICATE && !!process.env.QZ_PRIVATE_KEY;
}

/** The public certificate QZ Tray uses to verify signed requests. Safe to expose to any signed-in user. */
export function qzCertificate(): string {
  return pem("QZ_CERTIFICATE");
}

/** Sign a QZ Tray request payload with the private key. Matches qz.security.setSignatureAlgorithm("SHA512") client-side. */
export function qzSign(dataToSign: string): string {
  const key = pem("QZ_PRIVATE_KEY");
  const signer = createSign("RSA-SHA512");
  signer.update(dataToSign, "utf8");
  signer.end();
  return signer.sign(key).toString("base64");
}
