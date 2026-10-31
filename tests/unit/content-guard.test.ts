import { describe, it, expect } from "vitest";
import { ContentGuard, SecretDetectedError, contentGuardFromEnv } from "../../src/content-guard.js";

// Secret-shaped fixtures are assembled at runtime, so the repository never contains a literal
// that secret scanners (and GitHub push protection) would flag.
const fake = {
  pem: ["-----BEGIN", "RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----"].join(" "),
  openssh: ["-----BEGIN", "OPENSSH PRIVATE KEY-----"].join(" "),
  ghp: "ghp" + "_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8",
  githubPat: "github" + "_pat_" + "11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz",
  sk: "sk" + "-ant-api03-" + "Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0",
  aws: "AKIA" + "IOSFODNN7EXAMPL3",
  jwt: ["eyJ" + "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "eyJ" + "zdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ", "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"].join("."),
  slack: "xox" + "b-" + "123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx",
  assignment: "pass" + "word=" + "Xk9#mQ2$vL7pR4zT",
};

describe("ContentGuard", () => {
  const guard = new ContentGuard();

  describe("<private> spans", () => {
    it("removes a private span and keeps the rest", () => {
      expect(guard.sanitize("Deploy with <private>my home server</private> the usual way")).toBe(
        "Deploy with  the usual way",
      );
    });

    it("removes several spans, across lines, case-insensitively", () => {
      expect(guard.sanitize("a <PRIVATE>x\ny</PRIVATE> b <private>z</private> c")).toBe("a  b  c");
    });

    it("drops everything after an unclosed <private> tag", () => {
      expect(guard.sanitize("keep this <private>but not this")).toBe("keep this");
    });

    it("lets a secret inside a private span through, because it is removed", () => {
      expect(guard.sanitize(`token is <private>${fake.ghp}</private> rotated weekly`)).toBe("token is  rotated weekly");
    });

    it("rejects content that is empty once private spans are removed", () => {
      expect(() => guard.sanitize("<private>everything</private>")).toThrow(/empty/);
    });

    it("trims the result", () => {
      expect(guard.sanitize("  <private>x</private> lesson  ")).toBe("lesson");
    });
  });

  describe("secret patterns", () => {
    const cases: Array<[string, string]> = [
      ["private-key", fake.pem],
      ["private-key", fake.openssh],
      ["github-token", fake.ghp],
      ["github-token", fake.githubPat],
      ["api-key", fake.sk],
      ["aws-access-key", fake.aws],
      ["jwt", fake.jwt],
      ["slack-token", fake.slack],
      ["secret-assignment", fake.assignment],
      ["secret-assignment", "API_KEY: 'q8Zr2Lm5Vt9Wx3Ny6Kp1'"],
    ];

    for (const [name, secret] of cases) {
      it(`rejects ${name}`, () => {
        expect(() => guard.sanitize(`note: ${secret} end`)).toThrow(SecretDetectedError);
        try {
          guard.sanitize(`note: ${secret} end`);
        } catch (error) {
          expect((error as SecretDetectedError).pattern).toBe(name);
          expect((error as Error).message).toContain(name);
        }
      });

      it(`never echoes the ${name} value in the error`, () => {
        try {
          guard.sanitize(`note: ${secret} end`);
          expect.unreachable();
        } catch (error) {
          const message = (error as Error).message;
          // No 8-character run of the secret may appear in the message.
          for (let i = 0; i + 8 <= secret.length; i++) {
            const run = secret.slice(i, i + 8);
            if (/[A-Za-z0-9]{8}/.test(run)) expect(message).not.toContain(run);
          }
        }
      });
    }
  });

  describe("no false positives", () => {
    const benign = [
      "Use `pkill -f <pattern>` with care: it kills your own shell too.",
      "The user prefers squash merges and conventional commits.",
      "-----BEGIN CERTIFICATE----- blocks are public and fine to store.",
      "Install scikit-learn; sk-learn-is-a-common-misspelling-of-it.",
      "In TypeScript: const token = await fetchToken(client); return token;",
      "function getKey(name: string) { return map.get(name); }",
      "Set password=changeme only in the local dev compose file.",
      "Read the value from token=$GITHUB_TOKEN, never inline it.",
      "Config uses api_key: <your-key-here> as a placeholder.",
      "secret: ${{ secrets.NPM_TOKEN }} is resolved by Actions at runtime.",
      "KEY=value_from_vault is how the template reads it.",
      "The AWS region is eu-west-1 and the bucket is backups.",
      "JWTs start with eyJ because that is base64 for {\".",
      "ghp_ tokens are classic PATs; fine-grained ones start with github_pat_.",
      "Commit 4ff3368 bumped ip-address; sha256 c2f20fbf1c09ff70 matched.",
      "A UUID like 3f2b8c1e-9d4a-4e6f-8b7c-1a2d3e4f5a6b identifies a memory.",
    ];

    for (const text of benign) {
      it(`accepts: ${text.slice(0, 50)}`, () => {
        expect(guard.sanitize(text)).toBe(text);
      });
    }
  });

  describe("configuration", () => {
    it("can disable a built-in pattern", () => {
      const relaxed = new ContentGuard({ disabled: ["jwt"] });
      expect(relaxed.sanitize(`example ${fake.jwt}`)).toBe(`example ${fake.jwt}`);
      expect(() => relaxed.sanitize(fake.ghp)).toThrow(SecretDetectedError);
    });

    it("can disable every secret pattern but still strips private spans", () => {
      const off = new ContentGuard({ disabled: ["all"] });
      expect(off.sanitize(`${fake.ghp} <private>x</private>`)).toBe(fake.ghp);
    });

    it("rejects an unknown pattern name to disable", () => {
      expect(() => new ContentGuard({ disabled: ["jtw"] })).toThrow(/Unknown content-guard pattern "jtw"/);
    });

    it("adds extra patterns", () => {
      const strict = new ContentGuard({ extra: { "internal-host": "\\b[a-z0-9-]+\\.corp\\.example\\b" } });
      expect(() => strict.sanitize("ssh build01.corp.example")).toThrow(/internal-host/);
    });

    it("rejects an extra pattern with invalid regex syntax", () => {
      expect(() => new ContentGuard({ extra: { broken: "([" } })).toThrow(/broken/);
    });
  });

  describe("contentGuardFromEnv", () => {
    it("uses the defaults when nothing is set", () => {
      expect(() => contentGuardFromEnv({}).sanitize(fake.ghp)).toThrow(SecretDetectedError);
    });

    it("reads MEMORY_GUARD_DISABLE as a comma list", () => {
      const g = contentGuardFromEnv({ MEMORY_GUARD_DISABLE: " jwt , slack-token " });
      expect(g.sanitize(fake.jwt)).toBe(fake.jwt);
      expect(g.sanitize(fake.slack)).toBe(fake.slack);
    });

    it("reads MEMORY_GUARD_EXTRA_PATTERNS as a JSON object", () => {
      const g = contentGuardFromEnv({ MEMORY_GUARD_EXTRA_PATTERNS: '{"ticket":"\\\\bINC-\\\\d{6}\\\\b"}' });
      expect(() => g.sanitize("see INC-123456")).toThrow(/ticket/);
    });

    it("fails clearly on invalid JSON", () => {
      expect(() => contentGuardFromEnv({ MEMORY_GUARD_EXTRA_PATTERNS: "{nope" })).toThrow(/MEMORY_GUARD_EXTRA_PATTERNS/);
    });
  });
});
