require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BACKEND_URL = process.env.BACKEND_URL || "https://posterai-eta.vercel.app";

if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN not set. Bot will not start.");
  process.exit(0);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const userSessions = new Map();

const STEPS = [
  { key: "name", question: "What is the person's name?" },
  { key: "event", question: "What is the event? (e.g. Birthday, Yoga Day, Festival)" },
  { key: "date", question: "What date? (e.g. 2026-06-21 or type 'skip')" },
  { key: "photo", question: "Upload a photo of the person (or type 'skip'):" },
  { key: "logo", question: "Upload a logo (or type 'skip'):" },
  { key: "quote", question: "Add an optional quote (or type 'skip'):" },
];

const PRESET_KEYBOARD = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: "🎂 Birthday", callback_data: "preset_birthday" },
        { text: "🧘 Yoga Day", callback_data: "preset_yoga_day" },
      ],
      [
        { text: "📋 Event Flyer", callback_data: "preset_event_flyer" },
        { text: "🎉 Festival", callback_data: "preset_festival" },
      ],
      [
        { text: "💼 Corporate", callback_data: "preset_corporate" },
        { text: "🕊️ Memorial", callback_data: "preset_memorial" },
      ],
      [
        { text: "⏭️ No preset (custom)", callback_data: "preset_none" },
      ],
    ],
  },
};

const WELCOME_MSG = `Welcome to PosterAI! 🎨

I'll help you create stunning AI-generated posters step by step.

Let's start! First, choose a preset style or go custom:`;

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userSessions.delete(chatId);

  bot.sendMessage(chatId, WELCOME_MSG, PRESET_KEYBOARD);
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `How to use PosterAI:

1. Send /start to begin
2. Choose a preset style or go custom
3. Follow the step-by-step prompts
4. Upload photos when asked
5. Get your generated poster!

Commands:
/start - Create a new poster
/cancel - Cancel current poster
/help - Show this message

Presets available: birthday, yoga_day, event_flyer, festival, corporate, memorial`);
});

bot.onText(/\/cancel/, (msg) => {
  const chatId = msg.chat.id;
  userSessions.delete(chatId);
  bot.sendMessage(chatId, "Cancelled. Send /start to create a new poster.");
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith("preset_")) {
    const preset = data.replace("preset_", "");
    const session = {
      preset: preset === "none" ? null : preset,
      step: 0,
      inputs: {},
      photos: {},
    };
    userSessions.set(chatId, session);

    bot.answerCallbackQuery(query.id);

    if (session.preset) {
      bot.sendMessage(chatId, `Great choice! Style: ${preset.replace("_", " ")}\n\nNow let's fill in the details.`);
    } else {
      bot.sendMessage(chatId, "Custom mode selected! Let's build your poster from scratch.");
    }

    bot.sendMessage(chatId, STEPS[0].question);
  }
});

bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  const session = userSessions.get(chatId);

  if (!session) return;

  const photo = msg.photo[msg.photo.length - 1];
  const fileInfo = await bot.getFile(photo.file_id);
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;

  const currentStep = STEPS[session.step];
  if (currentStep && (currentStep.key === "photo" || currentStep.key === "logo")) {
    session.photos[currentStep.key] = fileUrl;
    session.inputs[currentStep.key] = fileUrl;
    advanceStep(chatId, session);
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const session = userSessions.get(chatId);

  if (!session || !STEPS[session.step]) return;
  if (msg.photo) return;

  const text = msg.text || "";
  const currentStep = STEPS[session.step];

  if (text.toLowerCase() === "/cancel") return;
  if (text.toLowerCase() === "/start") return;
  if (text.toLowerCase() === "/help") return;

  if (currentStep.key === "photo" || currentStep.key === "logo") {
    if (text.toLowerCase() === "skip") {
      session.inputs[currentStep.key] = null;
      advanceStep(chatId, session);
      return;
    }
    bot.sendMessage(chatId, "Please upload an image file, or type 'skip'.");
    return;
  }

  if (text.toLowerCase() === "skip") {
    session.inputs[currentStep.key] = null;
  } else {
    session.inputs[currentStep.key] = text;
  }

  advanceStep(chatId, session);
});

function advanceStep(chatId, session) {
  session.step++;

  if (session.step >= STEPS.length) {
    generatePoster(chatId, session);
    return;
  }

  const nextStep = STEPS[session.step];
  bot.sendMessage(chatId, nextStep.question);
}

async function generatePoster(chatId, session) {
  const inputs = session.inputs;

  if (!inputs.name || !inputs.event) {
    bot.sendMessage(chatId, "Oops! Name and event are required. Send /start to try again.");
    userSessions.delete(chatId);
    return;
  }

  bot.sendMessage(chatId, "Generating your poster... ⏳ This may take 30-60 seconds.");

  try {
    const body = {
      name: inputs.name,
      event: inputs.event,
      date: inputs.date || undefined,
      photo: inputs.photo || undefined,
      logo: inputs.logo || undefined,
      quote: inputs.quote || undefined,
      preset: session.preset || undefined,
    };

    const resp = await fetch(`${BACKEND_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await resp.json();

    if (!resp.ok || data.error) {
      bot.sendMessage(chatId, `Generation failed: ${data.friendly || data.error || "Unknown error"}\n\nSend /start to try again.`);
      userSessions.delete(chatId);
      return;
    }

    const resultText = data.generatedContent || "No content generated.";

    bot.sendMessage(chatId, `Poster generated successfully! 🎉\n\n${resultText}\n\nSend /start to create another poster.`);
  } catch (err) {
    console.error("Bot generation error:", err);
    bot.sendMessage(chatId, "Something went wrong. Please try again later.\n\nSend /start to restart.");
  }

  userSessions.delete(chatId);
}

console.log("PosterAI Telegram Bot started.");
