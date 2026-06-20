require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json({ limit: "50mb" }));

function buildPrompt(inputs) {
  let prompt = `Use the uploaded photo of ${inputs.name} as the base.
Do not change facial geometry, proportions, or features.

Generate a full-body image.
Pose: ${inputs.pose || "standing confidently"}.
Expression: ${inputs.expression || "confident and welcoming"}.
Clothing style: ${inputs.clothingStyle || "formal attire"}.
Background: ${inputs.background || "professional backdrop"}.

Art style: ${inputs.artStyle || "cinematic poster style"}.
Mood: ${inputs.mood || "inspirational"}.

Overlay text: "${inputs.mainText || `Happy ${inputs.event} - ${inputs.name}`}"
Short message: "${inputs.shortMessage || ""}"
Quote: "${inputs.quote || ""}"`;

  if (inputs.overlayPhoto) {
    prompt += `\n\nOverlay the second uploaded image semi-transparently in the background with soft borders blending naturally.`;
  }

  return prompt;
}

app.get("/", (req, res) => {
  res.json({ status: "PosterAI backend is running", endpoint: "/generate" });
});

app.post("/generate", async (req, res) => {
  try {
    const {
      name,
      event,
      date,
      photo,
      logo,
      overlayPhoto,
      pose,
      expression,
      clothingStyle,
      background,
      artStyle,
      mood,
      mainText,
      pointsList,
      shortMessage,
      quote,
    } = req.body;

    if (!name || !event) {
      return res.status(400).json({ error: "name and event are required" });
    }

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENCODE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "API key not configured" });
    }

    const prompt = buildPrompt({
      name,
      event,
      date,
      pose,
      expression,
      clothingStyle,
      background,
      artStyle,
      mood,
      mainText: mainText || `Happy ${event} - ${name}`,
      pointsList,
      shortMessage,
      quote,
      overlayPhoto,
    });

    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
        ],
      },
    ];

    if (photo) {
      messages[0].content.push({
        type: "image_url",
        image_url: { url: photo },
      });
    }

    if (logo) {
      messages[0].content.push({
        type: "image_url",
        image_url: { url: logo },
      });
    }

    if (overlayPhoto) {
      messages[0].content.push({
        type: "image_url",
        image_url: { url: overlayPhoto },
      });
    }

    const apiResponse = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://posterai.vercel.app",
          "X-Title": "PosterAI",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-preview",
          messages,
          max_tokens: 4096,
        }),
      }
    );

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      console.error("OpenRouter error:", errText);
      return res.status(apiResponse.status).json({
        error: "AI API request failed",
        details: errText,
      });
    }

    const data = await apiResponse.json();
    const result = data.choices?.[0]?.message?.content;

    res.json({
      success: true,
      name,
      event,
      date,
      prompt,
      generatedContent: result,
      model: data.model,
    });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PosterAI server running on port ${PORT}`);
});

module.exports = app;
