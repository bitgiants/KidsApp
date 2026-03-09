# CLAUDE.md — KidsApp

## Project Overview

KidsApp is a project under the **bitgiants** organization. This repository is in its initial setup phase.

> **Note:** This file should be updated as the project evolves — add framework-specific commands, architecture details, and conventions as they are established.

## Repository Structure

```
KidsApp/
├── CLAUDE.md          # This file — guidance for AI assistants
└── (project files TBD)
```

## Getting Started

This is a new repository. Once the project scaffolding is added, update this section with:

- Language/framework and version requirements
- Installation steps (e.g., `npm install`, `pip install -r requirements.txt`)
- Environment variable setup
- Database or service dependencies

## Common Commands

<!-- Update these as the project takes shape -->

| Task | Command |
|------|---------|
| Install dependencies | TBD |
| Run dev server | TBD |
| Run tests | TBD |
| Lint / format | TBD |
| Build for production | TBD |

## Development Workflow

1. Create a feature branch from `main`
2. Make changes and ensure tests pass before committing
3. Write clear, descriptive commit messages
4. Push and open a pull request for review

## Code Conventions

- **Safety first** — This is a kids' application. All content, inputs, and outputs must be age-appropriate and safe. Validate and sanitize user inputs rigorously.
- **Accessibility** — Follow WCAG guidelines; ensure the app is usable for children of varying abilities.
- **Privacy** — Comply with COPPA (Children's Online Privacy Protection Act) and equivalent regulations. Never collect personal data from children without proper consent flows.
- **Keep it simple** — Write clean, readable code. Prefer clarity over cleverness.
- **Test thoroughly** — Every feature should have corresponding tests. Edge cases matter especially in apps used by children.

## AI Assistant Guidelines

When working in this repository:

- Read existing code before proposing changes
- Follow established patterns and conventions already present in the codebase
- Do not introduce unnecessary dependencies
- Prioritize security — never introduce XSS, injection, or other OWASP top-10 vulnerabilities
- Keep child safety as a top concern in all code and content decisions
- Run tests and linters before considering work complete
- Do not create documentation files beyond what is requested
