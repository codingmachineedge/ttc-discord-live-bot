#!/usr/bin/env node
// api-key-vault — store API keys as ENCRYPTED, readable GitHub *variables*; keep
// the AES-256 master key on the user's computer (~/.ai-secrets/master.key) and in
// GitHub *secrets* (SECRETS_ENCRYPTION_KEY) for CI. No third-party deps.
//
//   node vault.mjs init [--force]              create the master key (local file)
//   node vault.mjs printkey                    print the local master key (base64)
//   node vault.mjs encrypt <plaintext>         -> base64(iv|tag|ciphertext)
//   node vault.mjs decrypt <b64>               -> plaintext
//   node vault.mjs store <NAME> <value> [--repo owner/repo]   set ENC_<NAME> variable
//   node vault.mjs get <NAME> [--repo owner/repo]             fetch + decrypt
//
// Master key resolution order: $SECRETS_ENCRYPTION_KEY, $VAULT_MASTER_KEY, then
// the local key file ($VAULT_KEY_FILE or ~/.ai-secrets/master.key).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const KEY_FILE = process.env.VAULT_KEY_FILE || join(homedir(), ".ai-secrets", "master.key");

function loadKey() {
  const b64 = process.env.SECRETS_ENCRYPTION_KEY
    || process.env.VAULT_MASTER_KEY
    || (existsSync(KEY_FILE) ? readFileSync(KEY_FILE, "utf8").trim() : "");
  if (!b64) {
    throw new Error(`No master key. Set SECRETS_ENCRYPTION_KEY or create ${KEY_FILE} (run: node vault.mjs init).`);
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error(`Master key must decode to 32 bytes (got ${key.length}).`);
  }
  return key;
}

function encrypt(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

function decrypt(b64) {
  const buf = Buffer.from(String(b64).trim(), "base64");
  const decipher = createDecipheriv("aes-256-gcm", loadKey(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

const gh = (args) => execFileSync("gh", args, { encoding: "utf8" }).trim();
const rest = process.argv.slice(3);
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const repoFlag = () => { const r = opt("--repo"); return r ? ["--repo", r] : []; };
const repoSlug = () => opt("--repo") || gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);

try {
  const cmd = process.argv[2];
  if (cmd === "init") {
    mkdirSync(join(homedir(), ".ai-secrets"), { recursive: true });
    if (existsSync(KEY_FILE) && !rest.includes("--force")) {
      throw new Error(`Master key already exists at ${KEY_FILE} (use --force to overwrite).`);
    }
    const key = randomBytes(32).toString("base64");
    writeFileSync(KEY_FILE, key + "\n", { mode: 0o600 });
    console.log(`Master key written to ${KEY_FILE}`);
    console.log(`Push to GitHub secrets:  printf '%s' '${key}' | gh secret set SECRETS_ENCRYPTION_KEY --repo <owner/repo>`);
  } else if (cmd === "printkey") {
    console.log(readFileSync(KEY_FILE, "utf8").trim());
  } else if (cmd === "encrypt") {
    console.log(encrypt(rest[0] ?? ""));
  } else if (cmd === "decrypt") {
    console.log(decrypt(rest[0] ?? ""));
  } else if (cmd === "store") {
    const [name, value] = rest;
    if (!name || value === undefined) throw new Error("usage: store <NAME> <value> [--repo owner/repo]");
    gh(["variable", "set", `ENC_${name}`, "--body", encrypt(value), ...repoFlag()]);
    console.log(`Stored encrypted ENC_${name} as a GitHub Actions variable on ${repoSlug()}.`);
  } else if (cmd === "get") {
    const name = rest[0];
    if (!name) throw new Error("usage: get <NAME> [--repo owner/repo]");
    const enc = gh(["api", `/repos/${repoSlug()}/actions/variables/ENC_${name}`, "--jq", ".value"]);
    process.stdout.write(decrypt(enc));
  } else {
    console.log("usage: vault.mjs <init|printkey|encrypt <text>|decrypt <b64>|store <NAME> <value> [--repo R]|get <NAME> [--repo R]>");
    process.exit(1);
  }
} catch (error) {
  console.error(String(error?.message ?? error));
  process.exit(1);
}
