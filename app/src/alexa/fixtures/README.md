Throwaway test certificates for `alexaSignature.ts`, valid until 2126. None of them is trusted
anywhere but in `alexa.test.ts`, and `signing.key` signs nothing outside it.

- `root.pem`: a test root CA (its key was discarded).
- `signing.pem` / `signing.key`: issued by that root for `echo-api.amazon.com`, standing in for
  Amazon's Alexa signing certificate.
- `wronghost.pem`: issued by the same root for `example.com`, to check that the host is enforced.
