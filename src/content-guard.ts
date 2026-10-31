/**
 * Filters content before it is stored: removes <private> spans and rejects anything that looks like a secret.
 * Memories end up in the database and in its JSON backups, so a secret must never get that far.
 */

export interface ContentGuardConfig {
  /** Built-in pattern names to turn off, or "all" to turn off every built-in pattern. */
  disabled?: string[];
  /** Extra patterns to reject, as name → regular expression source. */
  extra?: Record<string, string>;
}

interface SecretPattern {
  name: string;
  regex: RegExp;
  /** Optional check on a match, to drop look-alikes the regex alone cannot tell apart. */
  accept?: (match: RegExpExecArray) => boolean;
}

export class SecretDetectedError extends Error {
  constructor(readonly pattern: string) {
    super(
      `Refusing to store content: it looks like it contains a secret (${pattern}). ` +
        "Remove the value, or wrap text that must not be stored in <private>…</private>.",
    );
    this.name = "SecretDetectedError";
  }
}

/** Shannon entropy in bits per character. */
function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function characterClasses(value: string): number {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
}

/** A value that reads like a generated secret, not a word, an identifier, a reference or a placeholder. */
function looksRandom(value: string): boolean {
  if (/^[$<{%]/.test(value) || /[()]/.test(value)) return false;
  return value.length >= 8 && characterClasses(value) >= 3 && entropy(value) >= 3;
}

const BUILT_IN_PATTERNS: SecretPattern[] = [
  { name: "private-key", regex: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { name: "github-token", regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/ },
  {
    name: "api-key",
    regex: /\bsk-[A-Za-z0-9_-]{20,}/,
    accept: (m) => /[0-9]/.test(m[0]) && /[A-Za-z]/.test(m[0].slice(3)),
  },
  { name: "aws-access-key", regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "jwt", regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "slack-token", regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  {
    name: "secret-assignment",
    regex: /\b[A-Za-z0-9_-]*(?:password|passwd|pwd|token|secret|api[_-]?key|key)\s*[:=]\s*["'`]?([^\s"'`,;]+)/gi,
    accept: (m) => looksRandom(m[1]),
  },
];

const PRIVATE_SPAN = /<private>[\s\S]*?<\/private>/gi;
const UNCLOSED_PRIVATE = /<private>[\s\S]*$/i;

export class ContentGuard {
  private readonly patterns: SecretPattern[];

  constructor(config: ContentGuardConfig = {}) {
    const disabled = new Set(config.disabled ?? []);
    for (const name of disabled) {
      if (name !== "all" && !BUILT_IN_PATTERNS.some((p) => p.name === name)) {
        throw new Error(`Unknown content-guard pattern "${name}". Known: ${BUILT_IN_PATTERNS.map((p) => p.name).join(", ")}`);
      }
    }

    const builtIn = disabled.has("all") ? [] : BUILT_IN_PATTERNS.filter((p) => !disabled.has(p.name));
    const extra = Object.entries(config.extra ?? {}).map(([name, source]) => {
      try {
        return { name, regex: new RegExp(source) };
      } catch (error) {
        throw new Error(`Invalid content-guard pattern "${name}": ${(error as Error).message}`);
      }
    });
    this.patterns = [...builtIn, ...extra];
  }

  /**
   * Returns the content with <private> spans removed, trimmed.
   * Throws a SecretDetectedError when what remains looks like it holds a secret.
   */
  sanitize(content: string): string {
    const stripped = content.replace(PRIVATE_SPAN, "").replace(UNCLOSED_PRIVATE, "").trim();
    if (stripped === "") throw new Error("Content is empty after removing <private> spans");
    this.check(stripped);
    return stripped;
  }

  /** Throws a SecretDetectedError when the text looks like it holds a secret. */
  check(text: string): void {
    for (const pattern of this.patterns) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags.includes("g") ? pattern.regex.flags : pattern.regex.flags + "g");
      for (let m = regex.exec(text); m; m = regex.exec(text)) {
        if (!pattern.accept || pattern.accept(m)) throw new SecretDetectedError(pattern.name);
        if (m[0] === "") regex.lastIndex++;
      }
    }
  }
}

/** Builds a guard from MEMORY_GUARD_DISABLE (comma list) and MEMORY_GUARD_EXTRA_PATTERNS (JSON name → regex). */
export function contentGuardFromEnv(env: NodeJS.ProcessEnv = process.env): ContentGuard {
  const disabled = (env.MEMORY_GUARD_DISABLE ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let extra: Record<string, string> | undefined;
  if (env.MEMORY_GUARD_EXTRA_PATTERNS) {
    try {
      extra = JSON.parse(env.MEMORY_GUARD_EXTRA_PATTERNS) as Record<string, string>;
    } catch (error) {
      throw new Error(`MEMORY_GUARD_EXTRA_PATTERNS is not valid JSON: ${(error as Error).message}`);
    }
    if (typeof extra !== "object" || extra === null || Array.isArray(extra) || Object.values(extra).some((v) => typeof v !== "string")) {
      throw new Error('MEMORY_GUARD_EXTRA_PATTERNS must be a JSON object of name → regex string, e.g. {"ticket":"INC-\\\\d+"}');
    }
  }

  return new ContentGuard({ disabled, extra });
}
