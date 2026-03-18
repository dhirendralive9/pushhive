# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.8.x   | ✅ Active  |
| 2.0-2.7 | ⚠️ Critical fixes only |
| < 2.0   | ❌ Not supported |

## Reporting a Vulnerability

If you discover a security vulnerability in PushHive, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email security details to the project maintainer. Include:

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

We will acknowledge your report within 48 hours and provide a timeline for a fix.

## Security Features

PushHive includes the following security measures:

- **Helmet.js** — Security headers (CSP, HSTS, X-Frame-Options, etc.)
- **CSRF protection** — Token-based protection on all forms
- **Login rate limiting** — 5 attempts per 15 minutes
- **Account lockout** — 30-minute lockout after 10 failed attempts
- **Bcrypt** — Password hashing with 12 salt rounds
- **MongoDB injection guard** — express-mongo-sanitize strips $ operators
- **XSS sanitization** — HTML tags stripped from inputs
- **Session fixation prevention** — Session regenerated on login
- **Non-root Docker** — App runs as unprivileged user in container
- **HMAC-SHA256** — Webhook payload signing

## Best Practices for Deployment

- Always use HTTPS (the install script sets up Let's Encrypt automatically)
- Change the default SESSION_SECRET in .env
- Keep VAPID private key secure — never commit it to git
- Use Cloudflare Turnstile for public-facing login pages
- Regularly update Docker images (`docker compose pull`)
- Monitor the /health endpoint for service status
