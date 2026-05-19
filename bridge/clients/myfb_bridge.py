"""
My-Feedbacks DB Bridge — minimal Python client.

Stdlib-only (no `requests`, no SDK). Drop into your CI / monitoring /
admin scripts.

Usage:

    from myfb_bridge import BridgeClient

    bridge = BridgeClient(
        url="https://example.com/myfb-bridge.php",
        secret="0123abcd...64-hex-from-the-wizard...",
    )

    meta   = bridge.meta()
    tables = bridge.tables()
    desc   = bridge.describe("wp_posts")
    sample = bridge.sample("wp_posts", limit=6, strategy="mixed")
    count  = bridge.count("wp_posts")
    md     = bridge.schema_md()

Each method returns the parsed `data` field of the bridge response,
or raises `BridgeError` with the humanised error message.

Mirrors the JS client in sidepanel/db-bridge-client.js — same HMAC
math, same canonical-args quirk for PHP compat (empty args serialize
to `[]`, not `{}`).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
import urllib.error
import urllib.request
from dataclasses import dataclass


MIN_BRIDGE_VERSION = "1.1.0"


class BridgeError(RuntimeError):
    """Raised on any failure (network, auth, app-level)."""


@dataclass
class BridgeClient:
    url: str
    secret: str
    timeout: float = 10.0

    # ── Signing ───────────────────────────────────────────────────

    def _canon_args(self, args: dict) -> str:
        """Match PHP's json_encode($args, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)."""
        if not args:
            return "[]"   # PHP encodes an empty assoc as []
        return json.dumps(args, separators=(",", ":"), ensure_ascii=False)

    def _sign(self, ts: int, nonce: str, op: str, args: dict) -> str:
        canon = self._canon_args(args)
        msg = f"{ts}.{nonce}.{op}.{canon}".encode("utf-8")
        key = self.secret.encode("utf-8")
        return hmac.new(key, msg, hashlib.sha256).hexdigest()

    # ── Transport ─────────────────────────────────────────────────

    def _call(self, op: str, args: dict | None = None) -> dict:
        args = args or {}
        ts    = int(time.time())
        nonce = secrets.token_hex(16)
        body  = {"op": op, "args": args, "ts": ts, "nonce": nonce}
        body["sig"] = self._sign(ts, nonce, op, args)

        req = urllib.request.Request(
            self.url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
                self._check_version(payload)
                if not payload.get("ok"):
                    raise BridgeError(self._humanize(resp.status, payload.get("error")))
                return payload.get("data") or {}
        except urllib.error.HTTPError as e:
            try:
                payload = json.loads(e.read().decode("utf-8"))
                err = payload.get("error", "")
            except Exception:
                err = ""
            raise BridgeError(self._humanize(e.code, err)) from None
        except urllib.error.URLError as e:
            raise BridgeError(f"Bridge inaccessible (réseau / DNS) : {e.reason}") from None

    def _check_version(self, payload: dict) -> None:
        v = payload.get("version")
        if not v:
            return
        if self._cmp_ver(v, MIN_BRIDGE_VERSION) < 0:
            raise BridgeError(
                f"Bridge trop ancien ({v} < {MIN_BRIDGE_VERSION}) — "
                f"mets à jour myfb-bridge.php"
            )

    @staticmethod
    def _cmp_ver(a: str, b: str) -> int:
        pa = [int(x or 0) for x in (a or "0").split(".")]
        pb = [int(x or 0) for x in (b or "0").split(".")]
        for i in range(max(len(pa), len(pb))):
            va = pa[i] if i < len(pa) else 0
            vb = pb[i] if i < len(pb) else 0
            if va < vb:
                return -1
            if va > vb:
                return 1
        return 0

    @staticmethod
    def _humanize(status: int, raw: str) -> str:
        raw = (raw or "").lower()
        if status == 0:
            return "Bridge inaccessible (réseau / DNS / CORS)"
        if status == 404:
            return "Endpoint introuvable — vérifie l'URL du bridge"
        if status == 401:
            if "replay" in raw:
                return "Nonce déjà utilisé — horloge décalée ?"
            if "stale" in raw:
                return "Horloge client/serveur décalée (> 60s)"
            if "nonce" in raw:
                return "Nonce invalide"
            return "Signature HMAC invalide — secret incorrect ?"
        if status == 403:
            return "Table non exposée par la config du bridge"
        if status == 405:
            return "Méthode HTTP refusée — bridge mal configuré"
        if status >= 500:
            return "Erreur interne du bridge — vérifie audit.log"
        return raw or f"Erreur HTTP {status}"

    # ── Operations ────────────────────────────────────────────────

    def meta(self) -> dict:
        return self._call("meta")

    def tables(self) -> list[dict]:
        return self._call("tables").get("tables", [])

    def describe(self, table: str) -> list[dict]:
        return self._call("describe", {"table": table}).get("columns", [])

    def sample(self, table: str, limit: int = 3, strategy: str = "mixed") -> dict:
        return self._call("sample", {"table": table, "limit": limit, "strategy": strategy})

    def count(self, table: str) -> int:
        return int(self._call("count", {"table": table}).get("count", 0))

    def schema_md(self) -> str:
        return self._call("schema_md").get("markdown", "")


if __name__ == "__main__":  # pragma: no cover
    import argparse, os, sys

    ap = argparse.ArgumentParser(description="My-Feedbacks DB Bridge — CLI client")
    ap.add_argument("op", choices=["meta", "tables", "describe", "sample", "count", "schema_md"])
    ap.add_argument("--url",    default=os.environ.get("BRIDGE_URL"))
    ap.add_argument("--secret", default=os.environ.get("BRIDGE_SECRET"))
    ap.add_argument("--table",  default=None)
    ap.add_argument("--limit",  type=int, default=3)
    ns = ap.parse_args()

    if not ns.url or not ns.secret:
        ap.error("BRIDGE_URL / BRIDGE_SECRET env (or --url / --secret) required")

    bridge = BridgeClient(url=ns.url, secret=ns.secret)
    try:
        if ns.op == "describe": out = bridge.describe(ns.table)
        elif ns.op == "sample": out = bridge.sample(ns.table, limit=ns.limit)
        elif ns.op == "count":  out = bridge.count(ns.table)
        elif ns.op == "schema_md": out = bridge.schema_md()
        elif ns.op == "tables": out = bridge.tables()
        else: out = bridge.meta()
        if isinstance(out, str):
            print(out)
        else:
            print(json.dumps(out, indent=2, ensure_ascii=False))
    except BridgeError as e:
        print(f"✗ {e}", file=sys.stderr)
        sys.exit(1)
