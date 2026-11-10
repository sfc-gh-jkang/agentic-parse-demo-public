"""Mint a short-lived OAuth token for the deployed app's ingress (headless tests, no browser SSO).

Signs a key-pair JWT for the demo user and exchanges it at the account's /oauth/token endpoint,
scoped to the app host. Prints the token to stdout; send it as `Authorization: Snowflake Token="<t>"`.

Values come from config.env (scripts/demo_config.py); env vars override:
  SNOWFLAKE_PRIVATE_KEY_PATH  path to the user's unencrypted PKCS8 key (required)
  SNOWFLAKE_ACCOUNT           account identifier, e.g. MYORG-MYACCOUNT
  SNOWFLAKE_USER              key-pair user
  APP_HOST                    app host without scheme
Run: uv run python scripts/app_token.py > /tmp/.app_tok   (delete the file afterwards)

PAT connections: if SNOWFLAKE_PAT is set (environment only; never put it in config.env), no exchange is needed. A
programmatic access token is sent directly as `Authorization: Snowflake Token="<pat>"` to the app's public endpoint
(https://docs.snowflake.com/en/developer-guide/snowpark-container-services/tutorials/advanced/tutorial-8-access-public-endpoint-programmatically).
This script then prints nothing to stdout (the PAT is never printed or written) and the e2e scripts read SNOWFLAKE_PAT
themselves (web/e2e/token.mjs). Usage in code: `ingress_token()` returns the token in either mode.
"""
import base64
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import demo_config  # noqa: E402

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def pat_from_env(environ=None) -> str:
    """The programmatic access token from SNOWFLAKE_PAT, or ''. Environment only."""
    return (os.environ if environ is None else environ).get("SNOWFLAKE_PAT", "").strip()


def ingress_header(token: str) -> dict:
    return {"Authorization": f'Snowflake Token="{token}"'}


def ingress_token(cfg=None, environ=None) -> str:
    """Token for the app's ingress: the PAT if SNOWFLAKE_PAT is set, else an OAuth token minted from the key pair."""
    pat = pat_from_env(environ)
    if pat:
        return pat
    token = mint_oauth(cfg or demo_config.load())
    if token is None:
        raise RuntimeError("could not mint an ingress token")
    return token


def main() -> int:
    if pat_from_env():
        print("SNOWFLAKE_PAT is set: the PAT is used directly as the ingress token (Authorization: Snowflake Token=\"<pat>\"). "
              "Nothing printed or written; web/e2e scripts read SNOWFLAKE_PAT from the environment.", file=sys.stderr)
        return 0
    token = mint_oauth(demo_config.load())
    if token is None:
        return 1
    print(token)
    return 0


def mint_oauth(cfg) -> "str | None":
    key_path = cfg.get("SNOWFLAKE_PRIVATE_KEY_PATH", "")
    if not key_path or key_path.startswith("<"):
        print("Set SNOWFLAKE_PRIVATE_KEY_PATH (key-pair), or SNOWFLAKE_PAT in the environment (PAT).", file=sys.stderr)
        sys.exit(2)
    account = cfg["SNOWFLAKE_ACCOUNT"].upper()
    user = cfg["SNOWFLAKE_USER"].upper()
    host = cfg["APP_HOST"]
    key = serialization.load_pem_private_key(open(os.path.expanduser(key_path), "rb").read(), None)
    der = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    fp = "SHA256:" + base64.b64encode(hashlib.sha256(der).digest()).decode()
    qual = f"{account}.{user}"
    url = f"https://{account.lower().replace('_', '-')}.snowflakecomputing.com/oauth/token"
    # A fresh JWT is occasionally rejected with 390144 "JWT token is invalid"; a new one minted
    # a few seconds later is accepted, so retry rather than fail the caller.
    for attempt in range(3):
        now = int(time.time())
        body = b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()) + "." + b64(
            json.dumps({"iss": f"{qual}.{fp}", "sub": qual, "iat": now, "exp": now + 3000}).encode()
        )
        jwt = body + "." + b64(key.sign(body.encode(), padding.PKCS1v15(), hashes.SHA256()))
        data = urllib.parse.urlencode(
            {"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "scope": host, "assertion": jwt}
        ).encode()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data, {"Content-Type": "application/x-www-form-urlencoded"})) as r:
                return r.read().decode().strip()
        except urllib.error.HTTPError as e:
            print(f"attempt {attempt + 1}: {e.code} {e.read()[:300]!r}", file=sys.stderr)
            time.sleep(5)
    return None


if __name__ == "__main__":
    sys.exit(main())
