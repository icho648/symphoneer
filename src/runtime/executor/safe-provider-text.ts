export function safeProviderText(value: string | null, maxLength = 512): string | null {
  if (value === null) return null;
  const redacted = value
    .replace(/(\b(?:cookie|set-cookie)\s*:\s*)[^\r\n]*/gi, "$1<redacted>")
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g,
      "<redacted>",
    )
    .replace(/(\b[A-Za-z][A-Za-z\d+.-]*:\/\/[^/\s:@]+:)[^@\s]+@/g, "$1<redacted>@")
    .replace(/([?&](?:sig|signature)=)[^&\s]+/gi, "$1<redacted>")
    .replace(
      /((?:(?:[A-Za-z][A-Za-z\d_-]*(?:key|token|secret|password|credential|cookie|authorization)[A-Za-z\d_-]*)|api[_-]?key|token|secret|password|credential|cookie|authorization|set-cookie)\s*[=:]\s*)(?:[A-Za-z]+\s+)?(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+)/gi,
      "$1<redacted>",
    );
  return redacted.length > maxLength
    ? `${redacted.slice(0, Math.max(0, maxLength - 3))}...`
    : redacted;
}
