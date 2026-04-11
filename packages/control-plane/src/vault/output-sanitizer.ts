const CREDENTIAL_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'AWS Access Key', pattern: /AKIA[A-Z0-9]{16}/g },
  { name: 'Anthropic API Key', pattern: /sk-ant-[a-zA-Z0-9\-_]{20,}/g },
  { name: 'OpenAI API Key', pattern: /sk-(?:proj-)?[a-zA-Z0-9\-_]{20,}/g },
  { name: 'GitHub PAT', pattern: /ghp_[a-zA-Z0-9]{36,}/g },
  { name: 'GitHub OAuth', pattern: /gho_[a-zA-Z0-9]{36,}/g },
  { name: 'GitHub App Token', pattern: /ghs_[a-zA-Z0-9]{36,}/g },
];

const REDACTED = '[REDACTED]';

export function sanitize(text: string): string {
  let result = text;
  for (const { pattern } of CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

export function containsCredentials(text: string): boolean {
  for (const { pattern } of CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return false;
}
