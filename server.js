// server.js (CommonJS) — dual-token failover for GitHub Models
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const ModelClient = require("@azure-rest/ai-inference").default;
const { isUnexpected } = require("@azure-rest/ai-inference");
const { AzureKeyCredential } = require("@azure/core-auth");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const ENDPOINT = "https://models.github.ai/inference";
const MODEL = "openai/gpt-4o-mini";

// =======================
// 🔒 LANGUAGE ENFORCEMENT ADDITION
// =======================
const LANGUAGE_POLICY = `
LANGUAGE POLICY (STRICT):

- All responses must be written entirely in English.
- Never mix French and English in the same response.
- French academic titles may appear as official names only.
- All explanations must remain strictly in English.
`;

// Simple validation guard
function containsFrench(text) {
  return /[àâçéèêëîïôûùüÿœ]/i.test(text);
}
// =======================


// Read tokens from environment (do NOT hardcode tokens in source)
const TOKENS = [
  process.env.GITHUB_TOKEN1 || null,
  process.env.GITHUB_TOKEN2 || null
].filter(Boolean);

if (TOKENS.length === 0) {
  console.error("ERROR: no GITHUB_TOKEN1 or GITHUB_TOKEN2 found in environment");
  process.exit(1);
}

/**
 * Token state to avoid reusing a token that recently failed.
 * failedAt: timestamp (ms) or null
 */
const tokenState = TOKENS.map(() => ({ failedAt: 0 }));
const COOLDOWN_MS = 30 * 1000; // 30s cooldown after a failure

// Personal profile system prompt (unchanged / authoritative)
const SOFYAN_PROFILE = `
You are Sofyan Ben Kalifa’s official AI portfolio assistant.

You are not Sofyan.
You never speak in first person on his behalf.
You always speak ABOUT Sofyan in third person.

Your role is to professionally present:
- His academic background
- His technical expertise
- His projects
- His professional experience
- His long-term vision

IDENTITY

Name: Sofyan Ben Kalifa  
Degree: Licence en Génie Logiciel – ISIMA (2022–2025)  
Full Year Distinction: Mention Bien  
PFE Distinction: Mention Très Bien (highest grade of the promotion)

PROFESSIONAL PROFILE

- Full Stack Developer
- Backend Engineer
- Transitioning toward Data Engineering
- Strong interest in Artificial Intelligence and Distributed Systems

TECHNICAL STACK

Frontend:
- React
- Next.js
- TypeScript

Backend:
- Node.js
- Express.js

Databases:
- MongoDB
- MariaDB
- Couchbase

Big Data:
- Apache Spark (98% pipeline optimization project)

Artificial Intelligence:
- Llama 3.8B
- Hugging Face Transformers

DevOps & Systems:
- Docker
- Linux (Debian / Ubuntu / RedHat)
- Bash scripting
- CronJobs

Networking:
- Cisco fundamentals

KEY PROJECTS

1) CodeFusion (Final Year Project – Solo)
- Intelligent automation platform with AI integration
- Designed and developed entirely independently
- Full system architecture design
- Backend and frontend implementation
- AI integration
- Written and defended in French
- Awarded Mention Très Bien (highest distinction)

2) DevOps Hub Platform
- AI-powered project management platform
- Real-time intelligent suggestions using Llama 3.8B
- Stack: React + Node.js + MongoDB + Docker

3) Lux Shop (E-commerce Platform)
- Next.js frontend
- Express.js backend
- AI-driven product recommendation system
- Review analysis for enhanced relevance and insights

4) Spark Optimization Project
- Began with an inefficient data pipeline
- Used Spark UI diagnostics for bottleneck identification
- Applied broadcast joins and aggregation optimizations
- Reduced execution time by 98%
- Fully benchmarked and documented on GitHub

PROFESSIONAL EXPERIENCE

RB IT Solutions – Backend & Full Stack Developer (6 months)
- REST API development
- Performance optimization
- Linux-based deployment

LONG-TERM VISION

- Complete a Master’s degree in Data Engineering / AI in France
- Work 2–3 years on large-scale industrial data systems
- Return to Tunisia
- Build an AI-focused industrial technology structure

BEHAVIOR RULES

- Always speak in third person.
- Use formulations such as:
  "Sofyan developed..."
  "He implemented..."
  "His objective was..."
- Never say:
  "I built"
  "I developed"
  "my project"
- Never say: "I'm just an AI assistant."

If asked "Who are you?", respond:
"I am Sofyan Ben Kalifa’s AI portfolio assistant. I present his academic background, technical projects, and professional vision."

TONE

- Professional
- Structured
- Precise
- Technically rigorous
- Confident
- Never casual
- Never generic
`;

// Utility: create client from token
function makeClient(token) {
  return ModelClient(ENDPOINT, new AzureKeyCredential(token));
}

// Utility: decide which token index to try first
function getPreferredTokenIndex() {
  const now = Date.now();
  for (let i = 0; i < tokenState.length; i++) {
    if (now - tokenState[i].failedAt > COOLDOWN_MS) return i;
  }
  let earliest = 0;
  for (let i = 1; i < tokenState.length; i++) {
    if (tokenState[i].failedAt < tokenState[earliest].failedAt) earliest = i;
  }
  return earliest;
}

// Attempt request with a given token index
async function requestWithTokenIndex(tokenIndex, messagesPayload) {
  const token = TOKENS[tokenIndex];
  if (!token) throw new Error("No token for index " + tokenIndex);

  const client = makeClient(token);

  try {
    const response = await client.path("/chat/completions").post({
      body: {
        model: MODEL,
        messages: messagesPayload,
        temperature: 0.2, // 🔽 reduced from 0.6 for deterministic language
        max_tokens: 600
      }
    });

    if (isUnexpected(response)) {
      const err = response.body?.error || { message: "Unexpected response" };
      throw err;
    }

    const reply = response.body?.choices?.[0]?.message?.content;
    if (!reply || typeof reply !== "string") {
      throw { message: "Empty or unexpected reply shape" };
    }

    tokenState[tokenIndex].failedAt = 0;
    return reply;
  } catch (err) {
    tokenState[tokenIndex].failedAt = Date.now();
    const normalized = {
      message: err?.message || String(err),
      code: err?.code || err?.status || "unknown_error"
    };
    throw normalized;
  }
}

/**
 * Main endpoint: tries primary token first, falls back to secondary automatically.
 */
app.post("/api/ai", async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ text: "No message provided." });
  }

  const formattedHistory = (Array.isArray(history) ? history : []).map((m) => ({
    role: m.sender === "user" ? "user" : "assistant",
    content: m.text
  }));

  const messagesPayload = [
    { role: "system", content: SOFYAN_PROFILE },
    { role: "system", content: LANGUAGE_POLICY }, // 🔒 added
    ...formattedHistory,
    { role: "user", content: message }
  ];

  const firstIndex = getPreferredTokenIndex();
  const order = [firstIndex];
  for (let i = 0; i < TOKENS.length; i++) if (i !== firstIndex) order.push(i);

  let lastError = null;

  for (const idx of order) {
    try {
      let reply = await requestWithTokenIndex(idx, messagesPayload);

      // 🔒 language validation guard
      if (containsFrench(reply)) {
        reply = await requestWithTokenIndex(idx, messagesPayload);
      }

      return res.json({ text: reply });
    } catch (err) {
      lastError = err;
    }
  }

  console.error("AI ERROR: all tokens failed — last error:", lastError);
  res.status(502).json({ text: "AI service unavailable (all tokens failed)." });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));