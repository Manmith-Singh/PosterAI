require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
app.use(express.json({ limit: "50mb" }));

// --- Serve Frontend ---
app.use(express.static(path.join(__dirname, "public")));

// --- MongoDB Connection ---
const MONGODB_URI = process.env.MONGODB_URI;
let dbConnected = false;

if (MONGODB_URI) {
  mongoose
    .connect(MONGODB_URI)
    .then(() => {
      dbConnected = true;
      console.log("MongoDB connected");
    })
    .catch((err) => console.error("MongoDB connection error:", err.message));
}

// --- Schemas ---
const sessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  name: String,
  event: String,
  date: String,
  photo: String,
  logo: String,
  overlayPhoto: String,
  pose: String,
  expression: String,
  clothingStyle: String,
  background: String,
  artStyle: String,
  mood: String,
  mainText: String,
  pointsList: String,
  shortMessage: String,
  quote: String,
  preset: String,
  createdAt: { type: Date, default: Date.now },
});

const logSchema = new mongoose.Schema({
  sessionId: String,
  name: String,
  event: String,
  prompt: String,
  generatedContent: String,
  model: String,
  success: Boolean,
  errorMessage: String,
  ip: String,
  createdAt: { type: Date, default: Date.now },
});

const Session = mongoose.model("Session", sessionSchema);
const Log = mongoose.model("Log", logSchema);

// --- Rate Limiting ---
const limiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 20,
  message: {
    friendly:
      "Whoa, you're on a roll! You've hit the daily limit of 20 poster generations. Come back tomorrow for more creative designs!",
    error: "Rate limit exceeded",
    retryAfter: "Try again in 24 hours.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/generate", limiter);

// --- Preset Styles ---
const PRESETS = {
  birthday: {
    name: "Birthday Poster",
    pose: "standing joyfully with a cake",
    expression: "happy and celebratory",
    clothingStyle: "festive party outfit",
    background: "colorful balloons, streamers, and birthday decorations",
    artStyle: "vibrant celebration poster",
    mood: "joyful and festive",
  },
  yoga_day: {
    name: "Yoga Day Poster",
    pose: "performing a yoga asana",
    expression: "confident and welcoming",
    clothingStyle: "white tracksuit",
    background: "bright blue sky with fluffy clouds, plants, and famous places",
    artStyle: "cinematic poster style",
    mood: "inspirational and traditional",
  },
  event_flyer: {
    name: "Event Flyer",
    pose: "standing confidently",
    expression: "professional and engaging",
    clothingStyle: "smart casual attire",
    background: "modern event backdrop with geometric patterns",
    artStyle: "sleek modern flyer",
    mood: "professional and inviting",
  },
  festival: {
    name: "Festival Greeting",
    pose: "celebrating with traditional gestures",
    expression: "warm and joyful",
    clothingStyle: "traditional festive attire",
    background: "festive decorations with lights and flowers",
    artStyle: "warm cultural art style",
    mood: "celebratory and spiritual",
  },
  corporate: {
    name: "Corporate Event",
    pose: "standing professionally",
    expression: "confident and approachable",
    clothingStyle: "business formal",
    background: "corporate stage with company branding",
    artStyle: "clean professional design",
    mood: "authoritative and polished",
  },
  memorial: {
    name: "Memorial Tribute",
    pose: "standing respectfully",
    expression: "serene and dignified",
    clothingStyle: "formal respectful attire",
    background: "peaceful garden with soft lighting",
    artStyle: "elegant portrait style",
    mood: "respectful and commemorative",
  },
};

// --- Friendly Error Messages ---
const FRIENDLY_ERRORS = {
  missing_fields:
    "Oops! It looks like you forgot to include a name or event. Please provide those so we can create your poster!",
  api_key_missing:
    "Hmm, our AI service isn't configured yet. Please let the admin know so we can fix this quickly!",
  api_error:
    "Our AI artist is taking a quick break. Please try again in a moment - we promise it's worth the wait!",
  server_error:
    "Something went wrong on our end. Don't worry, we're looking into it! Please try again shortly.",
  generation_failed:
    "We couldn't generate your poster this time. Try tweaking your inputs or using a different preset - sometimes a small change makes all the difference!",
  rate_limited:
    "You've been creating a lot of posters! Take a break and come back tomorrow for more.",
  invalid_preset:
    "That preset style isn't available yet. Check out our available styles: " +
    Object.keys(PRESETS).join(", "),
  db_error:
    "We had a little trouble saving your session, but your poster should still generate fine!",
};

function friendlyResponse(res, status, errorKey, extra = {}) {
  return res.status(status).json({
    friendly:
      FRIENDLY_ERRORS[errorKey] ||
      "Something unexpected happened. Please try again!",
    error: errorKey,
    ...extra,
  });
}

// --- Build Prompt ---
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

  if (inputs.pointsList) {
    prompt += `\nAdditional points: ${inputs.pointsList}`;
  }

  if (inputs.overlayPhoto) {
    prompt += `\n\nOverlay the second uploaded image semi-transparently in the background with soft borders blending naturally.`;
  }

  return prompt;
}

function buildImagePrompt(inputs) {
  const textOverlay = inputs.mainText || `Happy ${inputs.event} - ${inputs.name}`;
  const quotePart = inputs.quote ? ` with quote: "${inputs.quote}"` : "";

  return `${inputs.artStyle || "cinematic poster style"} poster for ${inputs.event}. ` +
    `${inputs.name} ${inputs.pose || "standing confidently"}, ` +
    `${inputs.expression || "confident expression"}, ` +
    `wearing ${inputs.clothingStyle || "formal attire"}. ` +
    `Background: ${inputs.background || "professional backdrop"}. ` +
    `Mood: ${inputs.mood || "inspirational"}. ` +
    `Text overlay: "${textOverlay}"${quotePart}. ` +
    `High quality, detailed, professional design.`;
}

// --- Routes ---
app.get("/api", (req, res) => {
  res.json({
    status: "PosterAI backend is running",
    endpoints: { generate: "POST /generate" },
    presets: Object.keys(PRESETS),
  });
});

app.get("/presets", (req, res) => {
  res.json({ presets: PRESETS });
});

app.post("/generate", async (req, res) => {
  const sessionId =
    req.headers["x-session-id"] ||
    `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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
      preset,
    } = req.body;

    if (!name || !event) {
      return friendlyResponse(res, 400, "missing_fields");
    }

    const apiKey =
      process.env.OPENROUTER_API_KEY || process.env.OPENCODE_API_KEY;
    if (!apiKey) {
      return friendlyResponse(res, 500, "api_key_missing");
    }

    let style = {};
    if (preset && PRESETS[preset]) {
      style = PRESETS[preset];
    } else if (preset) {
      return friendlyResponse(res, 400, "invalid_preset");
    }

    const imagePrompt = buildImagePrompt({
      name,
      event,
      date,
      pose: pose || style.pose,
      expression: expression || style.expression,
      clothingStyle: clothingStyle || style.clothingStyle,
      background: background || style.background,
      artStyle: artStyle || style.artStyle,
      mood: mood || style.mood,
      mainText: mainText || `Happy ${event} - ${name}`,
      shortMessage,
      quote,
    });

    let imageUrl = null;
    let generatedText = null;

    const stabilityKey = process.env.STABILITY_API_KEY;

    if (stabilityKey) {
      const formData = new URLSearchParams();
      formData.append("prompt", imagePrompt);
      formData.append("output_format", "png");

      const stabilityResp = await fetch(
        "https://api.stability.ai/v2beta/stable-image/generate/sd3",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${stabilityKey}`,
            "Accept": "image/*",
          },
          body: formData,
        }
      );

      if (stabilityResp.ok) {
        const buffer = await stabilityResp.buffer();
        const base64 = buffer.toString("base64");
        imageUrl = `data:image/png;base64,${base64}`;
      } else {
        const errText = await stabilityResp.text();
        console.error("Stability error:", errText);
      }
    }

    if (!imageUrl) {
      const encodedPrompt = encodeURIComponent(imagePrompt);
      imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&seed=${Date.now()}`;
    }

    const messages = [
      {
        role: "user",
        content: `Summarize this poster in 2-3 sentences: ${imagePrompt}`,
      },
    ];

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
          max_tokens: 200,
        }),
      }
    );

    if (apiResponse.ok) {
      const data = await apiResponse.json();
      generatedText = data.choices?.[0]?.message?.content;
    }

    if (dbConnected) {
      const saveOps = [];

      saveOps.push(
        Session.findOneAndUpdate(
          { sessionId },
          {
            sessionId,
            name,
            event,
            date,
            photo,
            logo,
            overlayPhoto,
            pose: pose || style.pose,
            expression: expression || style.expression,
            clothingStyle: clothingStyle || style.clothingStyle,
            background: background || style.background,
            artStyle: artStyle || style.artStyle,
            mood: mood || style.mood,
            mainText,
            pointsList,
            shortMessage,
            quote,
            preset,
          },
          { upsert: true, new: true },
        ).catch((err) => console.error("Session save error:", err.message)),
      );

      saveOps.push(
        Log.create({
          sessionId,
          name,
          event,
          prompt: imagePrompt,
          generatedContent: imageUrl,
          model: stabilityKey ? "stability-ai" : "pollinations",
          success: true,
          errorMessage: null,
          ip: req.ip,
        }).catch((err) => console.error("Log save error:", err.message)),
      );

      await Promise.all(saveOps);
    }

    res.json({
      success: true,
      friendly: `Poster generated successfully for ${name}'s ${event}! Hope you love it.`,
      sessionId,
      name,
      event,
      date,
      prompt: imagePrompt,
      imageUrl,
      description: generatedText,
      model: stabilityKey ? "stability-ai" : "pollinations",
      preset: preset || null,
    });
  } catch (err) {
    console.error("Server error:", err);

    if (dbConnected) {
      await Log.create({
        sessionId,
        name: req.body.name,
        event: req.body.event,
        prompt: null,
        generatedContent: null,
        model: null,
        success: false,
        errorMessage: err.message,
        ip: req.ip,
      }).catch(() => {});
    }

    return friendlyResponse(res, 500, "server_error");
  }
});

app.get("/session/:sessionId", async (req, res) => {
  if (!dbConnected) {
    return friendlyResponse(res, 503, "db_error");
  }

  try {
    const session = await Session.findOne({ sessionId: req.params.sessionId });
    if (!session) {
      return res.status(404).json({
        friendly: "No session found with that ID. Double-check and try again!",
      });
    }
    res.json({ success: true, session });
  } catch (err) {
    return friendlyResponse(res, 500, "server_error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PosterAI server running on port ${PORT}`);
});

module.exports = app;
