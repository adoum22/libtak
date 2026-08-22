"""Fail CI on high-confidence secrets in the tracked working tree.

This intentionally scans the current tree rather than Git history: incident
response and history rewriting are separate, explicitly controlled operations.
Only file names, line numbers and rule names are reported, never secret values.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


TOKEN_RULES = {
    'private key': re.compile(
        r'-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----'
    ),
    'AWS access key': re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
    'GitHub token': re.compile(r'\bgh[pousr]_[A-Za-z0-9]{30,}\b'),
    'GitLab token': re.compile(r'\bglpat-[A-Za-z0-9_-]{20,}\b'),
    'Slack token': re.compile(r'\bxox[baprs]-[A-Za-z0-9-]{20,}\b'),
    'OpenAI-style key': re.compile(r'\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b'),
    'Stripe live key': re.compile(r'\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b'),
    'Google API key': re.compile(r'\bAIza[0-9A-Za-z_-]{35}\b'),
    'JWT literal': re.compile(
        r'\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b'
    ),
    'credential in URL': re.compile(r'https?://[^/\s:@]+:[^@\s/]+@'),
    'documented login pair': re.compile(
        r'(?i)\blogin\s+[^\s/]{2,}\s*/\s*[^\s/]{6,}'
    ),
}

ASSIGNMENT_RULE = re.compile(
    r'''(?ix)
    \b(?:password|passwd|secret(?:_key)?|api[_-]?key|access[_-]?token)\b
    \s*[:=]\s*
    (?P<quote>["'])(?P<value>[^"'\r\n]{8,})(?P=quote)
    '''
)

PLACEHOLDER_MARKERS = (
    '${', '$(', 'os.environ', 'getenv', 'example', 'placeholder', 'replace',
    'changeme', 'dummy', 'fake', 'test', 'dev-key', 'ci-only', 'not-a-real',
    'your-', 'votre-', '<', '>',
)
SENSITIVE_TRACKED_NAMES = {
    '.env',
    'backend/.env',
    'frontend/.env',
    '.npmrc',
    '.pypirc',
}


def tracked_files(root: Path) -> list[str]:
    result = subprocess.run(
        ['git', 'ls-files', '-z'],
        cwd=root,
        check=True,
        capture_output=True,
    )
    return [part.decode('utf-8') for part in result.stdout.split(b'\0') if part]


def is_test_file(path: str) -> bool:
    name = Path(path).name.lower()
    return name.startswith('test') or '/tests/' in path.replace('\\', '/').lower()


def main() -> int:
    root_result = subprocess.run(
        ['git', 'rev-parse', '--show-toplevel'],
        check=True,
        capture_output=True,
        text=True,
    )
    root = Path(root_result.stdout.strip())
    findings: list[tuple[str, int, str]] = []

    for relative_path in tracked_files(root):
        normalized_path = relative_path.replace('\\', '/')
        if normalized_path in SENSITIVE_TRACKED_NAMES:
            findings.append((normalized_path, 1, 'tracked secret file'))
            continue
        path = root / relative_path
        try:
            payload = path.read_bytes()
        except OSError:
            continue
        if b'\0' in payload[:8192] or len(payload) > 5 * 1024 * 1024:
            continue
        text = payload.decode('utf-8', errors='ignore')
        for line_number, line in enumerate(text.splitlines(), start=1):
            for rule_name, pattern in TOKEN_RULES.items():
                if pattern.search(line):
                    findings.append((normalized_path, line_number, rule_name))
            if not is_test_file(normalized_path):
                assignment = ASSIGNMENT_RULE.search(line)
                if assignment:
                    candidate = assignment.group('value').lower()
                    dynamic_generation = any(
                        marker in line.lower()
                        for marker in ('secrets.', 'token_urlsafe', 'token_bytes')
                    )
                    if (
                        not dynamic_generation
                        and not any(
                            marker in candidate for marker in PLACEHOLDER_MARKERS
                        )
                    ):
                        findings.append(
                            (normalized_path, line_number, 'hard-coded credential')
                        )

    if findings:
        print('Potential secrets detected (values intentionally redacted):')
        for path, line_number, rule_name in sorted(set(findings)):
            print(f'  {path}:{line_number}: {rule_name}')
        return 1
    print('No high-confidence secrets detected in tracked files.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
