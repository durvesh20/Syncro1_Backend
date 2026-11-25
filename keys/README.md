# UIDAI Pehchaan keys

Two files belong in this directory. **Neither is in git** — `.gitignore` has
`keys/*` plus `*.pem`, with only this README tracked.

| File | What it is | Used for |
|---|---|---|
| `pehchaan_private.pem` | **Your RSA private key** | Signs the Intent Request JWT (RS256) |
| `pehchaan_uidai_public.pem` | **UIDAI's public key** | Verifies the returned SD-JWT credential |

`pehchaan_private.pem` is the private half of `pehchaan_public.pem`, generated
per spec §2.1 ("You must generate an RSA key pair"). RSA-2048, signs with RS256.

## Why the Organization DSC is NOT used here

Syncro1 holds a Capricorn Organization DSC, uploaded as a `.cer` during OVSE
registration to prove company identity (the Handbook's "Class 3 public
certificate, 2 year validity"). It **cannot** sign Intent Request JWTs:

- A `.cer` contains only the public key — the private half is not derivable.
- That DSC's private key lives on a USB crypto token and is non-exportable by
  design. Signing with it would need PKCS#11 and the token physically attached
  to the API server, which is not viable for an always-on backend.

So registration identity (the DSC) and the runtime signing key (this RSA pair)
are two separate things. **UIDAI must have `pehchaan_public.pem` registered as
the signing key**, or every Intent Request will fail signature validation at
the Aadhaar App.

`pehchaan_uidai_public.pem` is UIDAI's own certificate, used to verify the
returned credential. The loader accepts either a bare public key or an X.509
certificate, and tolerates indented PEM armor lines (a common artefact of
copying a key out of an email or PDF).

## Permissions

```bash
chmod 700 keys
chmod 600 keys/*.pem
```

## Path resolution — read this before deploying

`PEHCHAAN_PRIVATE_KEY_PATH=./keys/pehchaan_private.pem` is resolved against
**`process.cwd()`** — the directory the Node process was *started from*, not the
location of any source file:

```js
path.isAbsolute(keyPath) ? keyPath : path.resolve(process.cwd(), keyPath)
```

`npm start` runs `node server.js` from the backend root, so the relative path
works locally. It breaks if the process is started from anywhere else — a pm2
`cwd`, a systemd unit without `WorkingDirectory=`, or a container with a
different `WORKDIR`. (`config/env.js` loads `.env.*` the same way, so if the
server starts at all, the cwd is probably right.)

**In production, prefer absolute paths:**

```env
PEHCHAAN_PRIVATE_KEY_PATH=/srv/syncro1-backend/keys/pehchaan_private.pem
PEHCHAAN_UIDAI_PUBLIC_KEY_PATH=/srv/syncro1-backend/keys/pehchaan_uidai_public.pem
```

## Deployment

Keys are read **once at first use** and cached in memory, so replacing a file
needs a process restart.

- **Do not bake them into a container image** — mount them at runtime
  (Docker/compose secret, Kubernetes Secret volume) or hold them in your
  platform's secret store and write them to disk at boot.
- Back up `pehchaan_private.pem` somewhere encrypted. Losing it means
  re-registering with UIDAI.
- Keep the same key pair across environments only if UIDAI registered one key
  for both; otherwise each environment needs its own registration.

## Verifying a key before you rely on it

```bash
# Private key is valid and readable
openssl rsa -in keys/pehchaan_private.pem -check -noout

# Fingerprint of the public half — compare with what UIDAI has on record
openssl rsa -in keys/pehchaan_private.pem -pubout -outform DER | openssl sha256

# UIDAI's public key parses
openssl rsa -pubin -in keys/pehchaan_uidai_public.pem -noout -text | head -3
```

Spec §2.4 also recommends signing a sample JWT and checking it on jwt.io before
going live — development validation only, never with production keys.
