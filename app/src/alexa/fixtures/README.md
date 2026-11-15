Throwaway test certificates for `alexaSignature.ts`, valid until 2126. None of them is trusted
anywhere but in `alexa.test.ts`, and `signing.key` signs nothing outside it.

- `root.pem`: a test root CA (its key was discarded).
- `signing.pem` / `signing.key`: issued by that root for `echo-api.amazon.com`, standing in for
  Amazon's Alexa signing certificate.
- `wronghost.pem`: issued by the same root for `example.com`, to check that the host is enforced.

The shape of Amazon's real chain, where the last certificate is a trusted root cross-signed by a
retired root that trust stores no longer carry:

- `anchor-root.pem`: a self-signed test root, standing in for one a trust store carries.
- `anchor-cross.pem`: the same CA (same name and key), cross-signed by `old.pem`.
- `old.pem`: the retired root (its key was discarded).
- `anchor-signing.pem`: issued by the anchor for `echo-api.amazon.com`, with the key in `signing.key`.
