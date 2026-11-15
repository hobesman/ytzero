import { verify, X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";

/**
 * Checks that a request really comes from Alexa, as Amazon requires of skills
 * hosted outside AWS Lambda: the signing certificate is Amazon's, it chains to
 * a trusted root, it signed this exact body, and the request is recent.
 */
export const ALEXA_SIGNING_HOST = "echo-api.amazon.com";
export const ALEXA_TIMESTAMP_TOLERANCE_MS = 150_000;
const CERT_CACHE_LIMIT = 8;

export interface AlexaSignatureDependencies {
  fetchCertificateChain?: (url: string) => Promise<string>;
  trustedRoots?: readonly string[];
  now?: () => number;
}

/** Amazon's own rules for the certificate URL, applied after normalizing it. */
export function validCertificateUrl(value: string | undefined): URL | null {
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "s3.amazonaws.com") return null;
  if (url.port && url.port !== "443") return null;
  // URL normalizes "/echo.api/../" away, so this sees the real path.
  return url.pathname.startsWith("/echo.api/") ? url : null;
}

export function splitPemChain(pem: string): X509Certificate[] {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  return blocks.map((block) => new X509Certificate(block));
}

function currentlyValid(certificate: X509Certificate, now: number): boolean {
  return Date.parse(certificate.validFrom) <= now && now <= Date.parse(certificate.validTo);
}

function issuedBy(child: X509Certificate, issuer: X509Certificate): boolean {
  return child.checkIssued(issuer) && child.verify(issuer.publicKey);
}

const publicKeyBytes = (certificate: X509Certificate) => certificate.publicKey.export({ format: "der", type: "spki" }) as Buffer;

/** The same CA as a trusted root, even when this copy of it is cross-signed by another. */
function sameAuthority(certificate: X509Certificate, root: X509Certificate): boolean {
  return certificate.subject === root.subject && publicKeyBytes(certificate).equals(publicKeyBytes(root));
}

/**
 * The leaf certificate, when the chain is Amazon's signing certificate and
 * trusted. Trust is reached at the first certificate that is a trusted root
 * or is signed by one. Amazon's chain ends with a Starfield root cross-signed
 * by an older root that current trust stores no longer carry, so whatever
 * follows that point is ignored.
 */
export function trustedSigningCertificate(chain: readonly X509Certificate[], roots: readonly X509Certificate[], now: number): X509Certificate | null {
  const [leaf] = chain;
  if (!leaf || leaf.checkHost(ALEXA_SIGNING_HOST) !== ALEXA_SIGNING_HOST) return null;
  const anchors = roots.filter((root) => currentlyValid(root, now));
  for (let index = 0; index < chain.length; index += 1) {
    const certificate = chain[index];
    if (!currentlyValid(certificate, now)) return null;
    if (index > 0 && !issuedBy(chain[index - 1], certificate)) return null;
    if (anchors.some((root) => sameAuthority(certificate, root) || issuedBy(certificate, root))) return leaf;
  }
  return null;
}

export function createAlexaSignatureVerifier(dependencies: AlexaSignatureDependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const fetchChain = dependencies.fetchCertificateChain ?? (async (url: string) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`certificate fetch failed: ${response.status}`);
    return await response.text();
  });
  let roots: X509Certificate[] | null = null;
  const trustedRoots = () => roots ??= (dependencies.trustedRoots ?? rootCertificates).map((pem) => new X509Certificate(pem));
  const certificates = new Map<string, X509Certificate>();

  async function signingCertificate(url: URL): Promise<X509Certificate | null> {
    const key = url.href;
    const cached = certificates.get(key);
    if (cached && currentlyValid(cached, now())) return cached;
    certificates.delete(key);
    const leaf = trustedSigningCertificate(splitPemChain(await fetchChain(key)), trustedRoots(), now());
    if (!leaf) return null;
    certificates.set(key, leaf);
    while (certificates.size > CERT_CACHE_LIMIT) certificates.delete(certificates.keys().next().value!);
    return leaf;
  }

  /** Why the request is refused, or null when it is genuine. */
  async function check(headers: Headers, rawBody: string, timestamp: unknown): Promise<string | null> {
    const url = validCertificateUrl(headers.get("signaturecertchainurl") ?? undefined);
    if (!url) return "invalid certificate url";
    const signature = headers.get("signature-256");
    if (!signature) return "missing signature";
    const sentAt = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
    if (!Number.isFinite(sentAt) || Math.abs(now() - sentAt) > ALEXA_TIMESTAMP_TOLERANCE_MS) return "stale request";
    let leaf: X509Certificate | null;
    try {
      leaf = await signingCertificate(url);
    } catch {
      return "certificate unavailable";
    }
    if (!leaf) return "untrusted certificate";
    const valid = verify("sha256", Buffer.from(rawBody, "utf8"), leaf.publicKey, Buffer.from(signature, "base64"));
    return valid ? null : "invalid signature";
  }

  return { check };
}

export type AlexaSignatureVerifier = ReturnType<typeof createAlexaSignatureVerifier>;
