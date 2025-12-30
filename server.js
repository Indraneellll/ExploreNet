// ======================= server.js (FINAL, WORKING) =======================
// TAVILY ONLY • NO LLM • STATELESS BACKEND
// Rule:
// 1) Frontend keeps memory
// 2) memory[0].topic = FIRST QUESTION
// 3) In AI mode → base question is ALWAYS appended
// 4) New Chat → frontend clears memory (backend stateless)

import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

/* ---------------- IDENTITY ---------------- */
function isIdentityQuestion(query) {
  const q = query.toLowerCase().trim();
  return (
    q === "who are you" ||
    q === "who made you" ||
    q === "who created you" ||
    q === "who built you" ||
    q === "what are you" ||
    q === "hi"
  );
}

/* ---------------- SEARCH ---------------- */
app.post("/api/search", async (req, res) => {
  const { query, mode, memory } = req.body;

  if (!query || typeof query !== "string") {
    return res.json({ answer: "Invalid query." });
  }

  // Identity never hits Tavily
  if (isIdentityQuestion(query)) {
    return res.json({
      answer:
        "I am ExploreNet, a smart search assistant that connects related searches to help you understand topics better.",
    });
  }

  let finalQuery = query;

  // ONLY AI MODE → auto-append first question
  if (
    mode === "ai" &&
    Array.isArray(memory) &&
    memory.length > 0 &&
    memory[0].topic &&
    query !== memory[0].topic
  ) {
    finalQuery = `${memory[0].topic} — ${query}`;
  }

  try {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: finalQuery,
        search_depth: "advanced",
        include_answer: true,
        max_results: 5,
      }),
    });

    const data = await r.json();

    return res.json({
      answer: data.answer || "No answer found.",
      results: data.results || [],
    });
  } catch (err) {
    return res.json({
      answer: "Unable to fetch results. Please try again.",
    });
  }
});

/* ---------------- NEW CHAT ---------------- */
// Backend is stateless; frontend clears memory
app.post("/api/new-chat", (req, res) => {
  return res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`🚀 ExploreNet running on port ${PORT}`);
});
