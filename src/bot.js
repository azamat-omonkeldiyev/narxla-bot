import { Telegraf, Scenes, session, Markup } from "telegraf";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Inline Ha/Yo'q tugmalari generatori ---
const yesNoKeyboard = (lang) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback(lang === "uz" ? "✅ Ha" : "✅ Да", "yes"),
      Markup.button.callback(lang === "uz" ? "❌ Yo‘q" : "❌ Нет", "no"),
    ],
  ]);

// --- Narx hisoblash funksiyasi ---
async function getPriceEstimation(data, lang) {
  const promptUz = `
Siz O'zbekiston uy-joy bozori mutaxassisisiz. Quyidagi uy haqida taxminiy narx ayting:
- Manzil: ${data.address}
- Maydon: ${data.area} kv.m
- Qavat: ${data.floor}
- Jihozlar: Wi-Fi: ${data.wifi}, Muzlatgich: ${data.fridge}, Televizor: ${data.tv}, Konditsioner: ${data.ac}
- Qo‘shimcha: ${data.extra}

Iltimos, 2 ta qiymat bering:
1. Agar oylik ijaraga berilsa, oylik narx (so‘mda).
2. Agar sotilsa, umumiy sotuv narxi (so‘mda).

Faqat taxminiy baho chiqaring.
`;

  const promptRu = `
Вы эксперт по рынку недвижимости Узбекистана. Оцените квартиру:
- Адрес: ${data.address}
- Площадь: ${data.area} кв.м
- Этаж: ${data.floor}
- Удобства: Wi-Fi: ${data.wifi}, Холодильник: ${data.fridge}, Телевизор: ${data.tv}, Кондиционер: ${data.ac}
- Дополнительно: ${data.extra}

Пожалуйста, дайте 2 значения:
1. Если сдавать в аренду – месячная цена (в сумах).
2. Если продавать – цена продажи (в сумах).

Укажите только примерную стоимость.
`;

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          lang === "uz"
            ? "Siz O‘zbekiston ko‘chmas mulk bozorida ekspert sifatida javob berasiz."
            : "Вы эксперт по недвижимости в Узбекистане.",
      },
      {
        role: "user",
        content: lang === "uz" ? promptUz : promptRu,
      },
    ],
  });

  return response.choices[0].message.content;
}

// --- WIZARD SCENE ---
const wizard = new Scenes.WizardScene(
  "house_wizard",

  // 1. Til tanlash
  async (ctx) => {
    await ctx.reply(
      "👋 Salom! Assalomu alaykum!\nПривет! Здравствуйте!\n\n" +
        "Iltimos, tilni tanlang:\nПожалуйста, выберите язык:",
      Markup.keyboard([["🇺🇿 O'zbekcha", "🇷🇺 Русский"]])
        .oneTime()
        .resize()
    );
    return ctx.wizard.next();
  },

  // 2. Tilni qabul qilish va manzil so'rash
  async (ctx) => {
    const text = ctx.message.text;
    ctx.wizard.state.lang = text.includes("O'zbekcha") ? "uz" : "ru";
    ctx.wizard.state.userData = {};

    if (ctx.wizard.state.lang === "uz") {
      await ctx.reply("📍 Iltimos, uy manzilini matn ko‘rinishida kiriting:");
    } else {
      await ctx.reply("📍 Пожалуйста, введите адрес квартиры текстом:");
    }
    return ctx.wizard.next();
  },

  // 3. Manzil -> kvadrat metr
  async (ctx) => {
    ctx.wizard.state.userData.address = ctx.message.text;

    if (ctx.wizard.state.lang === "uz") {
      await ctx.reply("🏠 Uyning umumiy maydoni (kv.m) ni kiriting:");
    } else {
      await ctx.reply("🏠 Введите общую площадь квартиры (кв.м):");
    }
    return ctx.wizard.next();
  },

  // 4. Kvadrat metr -> qavat
  async (ctx) => {
    ctx.wizard.state.userData.area = ctx.message.text;

    if (ctx.wizard.state.lang === "uz") {
      await ctx.reply("🏢 Uy qavatini kiriting (masalan: 3/4):");
    } else {
      await ctx.reply("🏢 Введите этаж квартиры (например: 3/4):");
    }
    return ctx.wizard.next();
  },

  // 5. Qavatni tekshirish va keyingi bosqich
  async (ctx) => {
    const floorInput = ctx.message.text.trim();
    const regex = /^(\d{1,2})\/(\d{1,2})$/;

    if (!regex.test(floorInput)) {
      if (ctx.wizard.state.lang === "uz") {
        await ctx.reply(
          "⚠️ Iltimos, qavatni to‘g‘ri formatda kiriting. Masalan: 3/9"
        );
      } else {
        await ctx.reply(
          "⚠️ Пожалуйста, введите этаж в правильном формате. Например: 5/12"
        );
      }
      return;
    }

    ctx.wizard.state.userData.floor = floorInput;

    if (ctx.wizard.state.lang === "uz") {
      await ctx.reply("📶 Uyning Wi-Fi mavjudmi?", yesNoKeyboard("uz"));
    } else {
      await ctx.reply("📶 Есть ли Wi-Fi в квартире?", yesNoKeyboard("ru"));
    }

    ctx.wizard.state.currentQuestion = "wifi";
    return ctx.wizard.next();
  },

  // 6. Jihozlar
  async (ctx) => {
    const q = ctx.wizard.state.currentQuestion;
    const lang = ctx.wizard.state.lang;

    ctx.wizard.state.userData[q] = ctx.callbackQuery.data === "yes";
    await ctx.answerCbQuery();

    if (q === "wifi") {
      ctx.wizard.state.currentQuestion = "fridge";
      await ctx.reply(
        lang === "uz" ? "🧊 Muzlatgich bormi?" : "🧊 Есть ли холодильник?",
        yesNoKeyboard(lang)
      );
    } else if (q === "fridge") {
      ctx.wizard.state.currentQuestion = "tv";
      await ctx.reply(
        lang === "uz" ? "📺 Televizor bormi?" : "📺 Есть ли телевизор?",
        yesNoKeyboard(lang)
      );
    } else if (q === "tv") {
      ctx.wizard.state.currentQuestion = "ac";
      await ctx.reply(
        lang === "uz" ? "❄️ Konditsioner bormi?" : "❄️ Есть ли кондиционер?",
        yesNoKeyboard(lang)
      );
    } else if (q === "ac") {
      if (lang === "uz") {
        await ctx.reply(
          "🖼 Endi uyning rasmlarini yuboring (kamida 3 ta).",
          Markup.removeKeyboard()
        );
      } else {
        await ctx.reply(
          "🖼 Теперь отправьте фото квартиры (минимум 3 штук).",
          Markup.removeKeyboard()
        );
      }
      ctx.wizard.state.userData.photos = [];
      return ctx.wizard.next();
    }
  },

  // 7. Rasm qabul qilish
  async (ctx) => {
    if (ctx.message?.photo) {
      const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

      if (ctx.message.media_group_id) {
        if (!ctx.wizard.state.userData.mediaGroup) {
          ctx.wizard.state.userData.mediaGroup = {
            id: ctx.message.media_group_id,
            photos: [],
          };
        }
        ctx.wizard.state.userData.mediaGroup.photos.push(photoId);

        clearTimeout(ctx.wizard.state.mediaGroupTimer);
        ctx.wizard.state.mediaGroupTimer = setTimeout(async () => {
          ctx.wizard.state.userData.photos.push(
            ...ctx.wizard.state.userData.mediaGroup.photos
          );
          delete ctx.wizard.state.userData.mediaGroup;

          const lang = ctx.wizard.state.lang;
          if (ctx.wizard.state.userData.photos.length >= 3) {
            await ctx.reply(
              lang === "uz"
                ? "✍️ Qo‘shimcha ma’lumot yozishingiz mumkin."
                : "✍️ Можете добавить дополнительную информацию."
            );
            return ctx.wizard.next();
          }
        }, 2000);
      } else {
        ctx.wizard.state.userData.photos.push(photoId);

        const lang = ctx.wizard.state.lang;
        if (ctx.wizard.state.userData.photos.length >= 3) {
          await ctx.reply(
            lang === "uz"
              ? "✍️ Qo‘shimcha ma’lumot yozishingiz mumkin."
              : "✍️ Можете добавить дополнительную информацию."
          );
          return ctx.wizard.next();
        } else {
          await ctx.reply(
            lang === "uz"
              ? `📸 Yana rasm yuboring (${ctx.wizard.state.userData.photos.length}/3)`
              : `📸 Отправьте еще фото (${ctx.wizard.state.userData.photos.length}/3)`
          );
        }
      }
    } else {
      await ctx.reply("📸 Faqat rasm yuboring iltimos!");
    }
  },

  // 8. Qo'shimcha ma'lumot + GPT hisoblash
  async (ctx) => {
    const note = ctx.message.text;
    ctx.wizard.state.userData.extra = note !== "❌" ? note : "";

    const data = ctx.wizard.state.userData;
    const lang = ctx.wizard.state.lang;
    console.log("📊 Yig'ilgan ma'lumotlar:", data);

    if (lang === "uz") {
      await ctx.reply("✅ Rahmat! Barcha ma’lumotlar qabul qilindi.");
      await ctx.reply("⏳ Narx hisoblanmoqda...");
    } else {
      await ctx.reply("✅ Спасибо! Все данные получены.");
      await ctx.reply("⏳ Считаем цену...");
    }

    try {
      const result = await getPriceEstimation(data, lang);
      await ctx.reply(result);
    } catch (err) {
      console.error("GPT error:", err);
      await ctx.reply(
        lang === "uz"
          ? "❌ Afsus, narxni hisoblashda xatolik yuz berdi."
          : "❌ К сожалению, произошла ошибка при расчете цены."
      );
    }

    return ctx.scene.leave();
  }
);

// --- SCENE MANAGER ---
const stage = new Scenes.Stage([wizard]);

bot.use(session());
bot.use(stage.middleware());

bot.telegram.setMyCommands([
  { command: "start", description: "Botni ishga tushirish" },
]);

bot.start((ctx) => ctx.scene.enter("house_wizard"));

bot.launch();
console.log("🤖 Bot ishga tushdi...");
