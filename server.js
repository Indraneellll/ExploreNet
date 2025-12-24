// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.set("trust proxy", true);
app.use(cors());
app.use(express.json({ limit: "10kb" }));

/* ===================== USAGE LIMITS ===================== */
let usageByIp = {};
let lastReset = Date.now();

const MAX_AI_PER_DAY = 20;
const MAX_WEB_PER_DAY = 100;

function resetIfNeeded() {
  if (Date.now() - lastReset > 24 * 60 * 60 * 1000) {
    usageByIp = {};
    lastReset = Date.now();
  }
}

function getIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.ip ||
    "unknown"
  );
}

function ensureIp(ip) {
  if (!usageByIp[ip]) usageByIp[ip] = { ai: 0, web: 0 };
  return usageByIp[ip];
}

/* ===================== INTELLIGENCE ===================== */

/* ---- Identity questions (MUST NEVER hit Tavily) ---- */
function isIdentityQuestion(query) {
  const q = query.toLowerCase().trim();
  return (
    q === "who are you" ||
    q === "who made you" ||
    q === "who created you" ||
    q === "who built you" ||
    q === "what are you" ||
    q.includes("your creator") ||
    q.includes("who developed you")
  );
}

/* ---- Strict vague detector (ONLY command words) ---- */
function isVagueQuery(query) {
  const q = query.trim().toLowerCase();
  const vagueWords = ["explain", "more", "why", "how", "details"];
  return vagueWords.includes(q);
}

/* ---- Confidence scoring ---- */
function scoreAnswerConfidence(answer) {
  if (!answer) return 0;
  let score = 0;
  if (answer.length > 120) score += 0.4;
  if (answer.includes(".")) score += 0.2;
  if (!answer.toLowerCase().includes("no answer")) score += 0.2;
  if (!answer.toLowerCase().includes("cannot")) score += 0.2;
  return Math.min(score, 1);
}

/* ---- Context builder (SAFE) ---- */
function buildContextualQuery(query, memory = []) {
  // First question → NEVER modify
  if (!Array.isArray(memory) || memory.length === 0) {
    return query;
  }

  const last = memory[memory.length - 1];

  // Only expand true vague follow-ups
  if (isVagueQuery(query)) {
    return `Explain ${last.topic} in more detail with examples and simple language.`;
  }

  // Otherwise, send clean query
  return query;
}

/* ===================== MAIN ROUTE ===================== */
app.post("/api/search", async (req, res) => {
  resetIfNeeded();

  const { query, mode, memory } = req.body || {};
  if (!query || typeof query !== "string") {
    return res.json({ answer: "Invalid query.", confidence: 0 });
  }

  /* ---------- IDENTITY HANDLING (FIRST, ALWAYS) ---------- */
  if (isIdentityQuestion(query)) {
    return res.json({
      answer:
        "I am ExploreNet, a smart search assistant created to help users understand information by connecting questions and summarizing knowledge from the web.",
      confidence: 1,
    });
  }

  const tavKey = process.env.TAVILY_API_KEY;
  if (!tavKey) {
    return res.json({
      answer: `Mock response for "${query}" (TAVILY_API_KEY not set).`,
      confidence: 0.3,
      results: [],
    });
  }

  const ip = getIp(req);
  const usage = ensureIp(ip);

  /* ===================== AI MODE (FAKE AI) ===================== */
  if (mode === "ai") {
    if (usage.ai >= MAX_AI_PER_DAY) {
      return res.json({
        answer: "Daily AI mode limit reached. Try again tomorrow.",
        confidence: 0,
      });
    }
    usage.ai += 1;

    const safeMemory = Array.isArray(memory)
      ? memory.filter(m => m.confidence >= 0.6).slice(-3)
      : [];

    const finalQuery = buildContextualQuery(query, safeMemory);

    try {
      const r = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavKey,
          query: finalQuery,
          search_depth: "advanced",
          include_answer: true,
          max_results: 5,
        }),
      });

      const data = await r.json();
      const answer = data.answer || "No answer found.";
      const confidence = scoreAnswerConfidence(answer);

      return res.json({ answer, confidence });
    } catch (err) {
      console.error("AI mode error:", err);
      return res.json({
        answer: "Network error while searching. Please try again.",
        confidence: 0,
      });
    }
  }

  /* ===================== WEB SUMMARY MODE ===================== */
  if (mode === "web") {
    if (usage.web >= MAX_WEB_PER_DAY) {
      return res.json({
        answer: "Daily Web Summary limit reached.",
        results: [],
      });
    }
    usage.web += 1;

    try {
      const r = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavKey,
          query,
          search_depth: "advanced",
          include_answer: true,
          max_results: 8,
        }),
      });

      const data = await r.json();
      return res.json({
        answer: data.answer || "No summary available.",
        results: data.results || [],
      });
    } catch (err) {
      console.error("Web mode error:", err);
      return res.json({
        answer: "Network error while fetching web results.",
        results: [],
      });
    }
  }

  return res.json({ answer: "Invalid mode.", confidence: 0 });
});

/* ===================== START SERVER ===================== */
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
