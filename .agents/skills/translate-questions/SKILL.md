---
name: translate-questions
description: Fill missing Prawko exam question translations (EN/DE/UK) without overwriting ministry Excel strings. Use when the user asks to translate questions, add a language, or update translations_en/de/uk.json.
---

# Translate driving exam questions

Prompt and translation rules live in the repo: `scripts/translate-questions.skill.md`. Scripts substitute `{lang}` (`English` / `German` / `Ukrainian`) and append the `POLISH q:` / `a:` / `b:` / `c:` source. Do not copy those rules into this file.

Repo map: `AGENTS.md`. Run `scripts/translate-questions.ps1` or `.py`. Fill **gaps only**; ministry Excel strings already in `translations_{lang}.json` win. Source is always Polish category JSON.
