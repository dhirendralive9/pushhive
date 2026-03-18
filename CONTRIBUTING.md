# Contributing to PushHive

Thanks for your interest in contributing to PushHive! This guide will help you get started.

## Getting Started

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- MongoDB 7 (or use Docker)
- Redis 7 (or use Docker)

### Development Setup

```bash
# Clone the repo
git clone https://github.com/dhirendralive9/pushhive.git
cd pushhive

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Generate VAPID keys
npx web-push generate-vapid-keys
# Add the keys to .env

# Start services with Docker
docker compose up -d mongo redis

# Create admin account
node seed.js admin@example.com password123 Admin

# Start the app
npm start

# In another terminal, start the worker
npm run worker
```

The dashboard will be available at `http://localhost:3000`.

## How to Contribute

### Reporting Bugs

- Search [existing issues](https://github.com/dhirendralive9/pushhive/issues) first
- Include steps to reproduce, expected behavior, and actual behavior
- Include browser, OS, and Node.js version
- Include relevant console errors or logs

### Suggesting Features

- Open an issue with the `enhancement` label
- Describe the use case, not just the solution
- Check the [roadmap](./CHANGELOG.md) to see if it's already planned

### Submitting Code

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Test your changes locally
5. Commit with a clear message: `git commit -m "Add: brief description"`
6. Push to your fork: `git push origin feature/my-feature`
7. Open a Pull Request

### Commit Message Convention

```
Add: new feature description
Fix: bug description  
Update: changed behavior description
Remove: removed feature description
Docs: documentation change
Style: formatting, no code change
Refactor: code change that doesn't fix a bug or add a feature
```

## Project Structure

```
server.js          → Express app entry point
worker.js          → Queue worker process
models/            → Mongoose schemas
routes/            → Express route handlers
services/          → Business logic (queue, webhooks, RSS, automations)
middleware/        → Auth, security, roles
views/             → EJS templates
public/            → Static CSS and JS
wordpress/         → WordPress plugin
```

## Code Style

- Use `const` and `let`, never `var` (except in SDK template which targets old browsers)
- Use async/await over raw Promises
- Error handling: always catch and log, never swallow silently
- Keep functions small and focused
- No semicolons are fine, but be consistent within a file

## Areas Where Help is Needed

- **Testing** — Unit tests, integration tests, E2E tests (Jest + Playwright)
- **Translations** — i18n for the dashboard (create JSON locale files)
- **Documentation** — API docs, deployment guides, tutorials
- **Performance** — Database index optimization, caching strategies
- **Integrations** — Shopify app, Zapier integration, GTM template

## Questions?

Open an issue or start a discussion on GitHub. We're happy to help you get started.
