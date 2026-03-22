# AI Assistance Log (PROMPTS.md)

This project was built iteratively with the help of AI tools for brainstorming, debugging, and refining ideas. Below are representative prompts used during development.

---

## 1. Project Ideation

**Prompt:**
> I want to build a simple but impactful AI-powered app using Cloudflare Workers AI and Durable Objects within a few hours. Suggest ideas that involve memory, chat interaction, and real-world usefulness.

**Outcome:**
Chose to build a **stateful AI study planner + reminder system**, focusing on personalization and memory.

---

## 2. Architecture Design

**Prompt:**
> How can I design an AI application using Cloudflare Agents that supports chat, persistent state, and tool usage like scheduling reminders?

**Outcome:**
- Used **Durable Objects** for per-user state
- Used **Workers AI** for LLM responses
- Used **tool calling (scheduleTask)** for actions
- Designed system where AI orchestrates tools

---

## 3. Prompt Engineering

**Prompt:**
> Write a system prompt that ensures:
> - plans are realistic and structured
> - reminders are only scheduled when explicitly requested
> - responses feel practical and not overly verbose

**Outcome:**
Refined system behavior to:
- separate planning vs scheduling
- avoid over-triggering tools
- produce structured outputs

---

## 4. Debugging Issues

**Prompt:**
> I’m getting an error where Workers AI binding is undefined in my Cloudflare agent. What could be wrong?

**Outcome:**
- Fixed wrangler config
- ensured AI binding exists
- switched to local mode during development
---

## Summary

AI was used as a **thinking partner and debugging assistant**, not as a replacement for implementation.  
All architecture decisions, integrations, and final code structure were manually reviewed and adapted.