import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { messages, mode, userProfile, userStyle, rssContext } = await req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const safeMessages = messages
      .filter((m: any) => m && typeof m.role === "string" && typeof m.content === "string")
      .map((m: any) => ({ role: m.role, content: m.content.slice(0, 8000) }));

    const today = new Date().toLocaleDateString("ru-RU", {
      day: "numeric", month: "long", year: "numeric",
    });

    const STYLE_ADDON = (style: any): string => {
      if (!style) return "";
      let parsed: any;
      try { parsed = typeof style === "string" ? JSON.parse(style) : style; } catch { parsed = null; }
      if (!parsed || !parsed.summary) {
        return `\n\nСТИЛЬ АВТОРА (строго следуй при генерации):\n${String(style).slice(0, 1500)}`;
      }
      const parts = [`\n\nSTYLE DNA АВТОРА (строго следуй при генерации):`];
      parts.push(`Общий стиль: ${parsed.summary}`);
      parts.push(`Тон: ${parsed.tone}`);
      parts.push(`Ритм: ${parsed.sentence_style}`);
      parts.push(`Структура: ${parsed.typical_structure}`);
      if (parsed.signature_phrases?.length) parts.push(`Фразы-маркеры: ${parsed.signature_phrases.join(", ")}`);
      if (parsed.avoids?.length) parts.push(`НИКОГДА не использовать: ${parsed.avoids.join(", ")}`);
      parts.push(`Финал: ${parsed.closing_style}`);
      if (parsed.hook_patterns?.length) parts.push(`Как начинает: ${parsed.hook_patterns.join(", ")}`);
      if (parsed.vocabulary?.length) parts.push(`Характерная лексика: ${parsed.vocabulary.join(", ")}`);
      if (parsed.emoji_style) parts.push(`Эмодзи: ${parsed.emoji_style}`);
      if (parsed.addressing) parts.push(`Обращение к аудитории: ${parsed.addressing}`);
      parts.push(`\nИнструкции: ${parsed.raw_instructions}`);
      parts.push(`\nКРИТИЧНО: Пиши ТОЧНО как этот человек. Не добавляй слова/обороты которых нет в профиле. Не меняй длину предложений. Не добавляй корпоративный тон.`);
      return parts.join("\n");
    };

    const SYSTEM_PROMPTS: Record<string, string> = {
      blog: `Ты — ИИ-наставник веб-дизайнера с компетенциями senior веб-дизайнера, маркетолога, SMM-специалиста и продажника-консультанта.

Сегодня: ${today}.

Твои компетенции:
— Стратегия блога, упаковка аккаунта, контент-план
— Поиск клиентов ВНЕ блога: холодные рассылки, outreach, нетворкинг, площадки для поиска заказов
— Продажи: как вести переговоры, как презентовать цену, как закрывать сделки
— Каждую неделю ты должен давать конкретные задания по поиску клиентов

Задаёшь наводящие вопросы, не перекладываешь весь процесс на пользователя.

Когда пользователь спрашивает про клиентов или продажи — давай КОНКРЕТНЫЕ шаблоны: текст рассылки, скрипт звонка, пошаговый план. Не абстрактные советы.

ВАЖНО: Когда разрабатываешь стратегию или план — В КОНЦЕ ОТВЕТА добавляй блок задач:
{"tasks":[{"text":"Написать 10 холодных писем","tag":"Клиенты","deadline":"YYYY-MM-DD"},{"text":"Обновить портфолио","tag":"Упаковка","deadline":"YYYY-MM-DD"}]}

Дедлайны — на ближайшие 7-14 дней. Задач 3-7.

Отвечай по-русски, разговорно. Без слов: «важно», «ценность», «мощный», «потенциал».`,

      projects: `Ты — ИИ-наставник с компетенциями senior веб-дизайнера (10+ лет в коммуникации с клиентами) и юриста в сфере digital-услуг.

Помогаешь выстроить коммуникацию с клиентом: что ответить, как сформулировать, какие риски есть.

Если видишь юридический или профессиональный риск — предупреждай явно: ⚠️ РИСК: [описание].
Если чего-то не знаешь точно — спрашивай, не додумывай.

Отвечай по-русски, конкретно, без воды.`,

      topics_me: `Предложи 5 тем для Instagram веб-дизайнера. Категории: 🔥охватная, 😄развлекательная, 📚образовательная, 👤личная, 💰продающая. Заголовки от первого лица, цепляющие. JSON: {"topics":[{"id":"1","hook":"заголовок","context":"2-3 предложения описание","angle":"категория"}]}`,

      topics_trends: `5 вирусных тем для блога веб-дизайнера: тренд, спор, психология, поп-культура, AI. JSON: {"topics":[{"id":"1","hook":"заголовок","context":"2-3 предложения","angle":"как адаптировать"}]}`,

      scenario: `Ты — ИИ-наставник веб-дизайнера. Пиши как человек, который хорошо знает тему — без менторства. ВСЕГДА отвечай только на РУССКОМ языке.

Базовые правила стиля:
- Предложения распространённые, не рубленые
- Запрещены: «невероятный», «мощный», «ценность», «потенциал», «визуал решает»
- Никаких восклицательных финалов и шаблонных открывашек

Reels — текст для озвучки (речь на камеру). НЕ сценарий со сценами и таймкодами. Просто текст который человек произносит в рилс, от первого лица. Хук в первой строке.
Threads — ветка из 4-6 твитов с нумерацией (1/, 2/ и тд).
Telegram — пост для Telegram-канала. Длинный формат, 800-1500 символов. Можно с эмодзи-разбивкой. Заголовок жирный. Структура: хук → основная мысль → примеры/аргументы → вывод. Без CTA про директ (это Telegram, не Instagram).
Все — Reels + Threads + Telegram.

Формат ответа — строго JSON без markdown:
{"reels":{"hook":"...","script":"..."},"threads":{"post":"1/ ...\\n2/ ..."},"telegram":{"post":"..."}}`,

      style_analysis: `Ты — лингвист-аналитик и стилист текстов мирового уровня.
Проанализируй тексты автора ГЛУБОКО.

Что анализировать: ЛЕКСИКА, РИТМ, ТОН, СТРУКТУРА, СТОП-СЛОВА, ЭМОДЗИ, ОБРАЩЕНИЕ, КРЮЧКИ.

Формат ответа — строго JSON без markdown:
{"summary":"2-3 предложения","tone":"3-5 прилагательных","sentence_style":"ритм и длина","typical_structure":"как строит текст","signature_phrases":["до 5"],"avoids":["до 5"],"closing_style":"как заканчивает","hook_patterns":["2-3 паттерна"],"vocabulary":["10-15 слов"],"emoji_style":"частота","addressing":"ты/вы/безличное","raw_instructions":"4-6 инструкций"}

Анализируй ТОЛЬКО на основе предоставленных текстов.`,

      style_calibration: `Ты — лингвист-аналитик. Пользователь оценил текст: "это я" или "не я".
Определи что не совпадает и предложи корректировки.
JSON: {"needs_update":true/false,"adjustments":{"tone":"","avoids":[],"vocabulary":[],"raw_instructions":""},"explanation":"что поправлено"}`,

      extract_ideas: `Редактор контента для веб-дизайнера. Из расшифровки монолога вытащи конкретные идеи для постов. Максимум 5 идей.
ТОЛЬКО JSON массив строк: ["Идея 1", "Идея 2"]`,

      structure_ideas: `ИИ-наставник веб-дизайнера. Структурируй идеи:
📌 КОНТЕНТ — снять/написать прямо сейчас
✅ ЗАДАЧИ — конкретные шаги
💡 РАЗВИТЬ ПОЗЖЕ — интересные мысли
В конце — один следующий шаг.`,

      prioritize_tasks: `ИИ-наставник и бизнес-консультант для веб-дизайнера. Сегодня: ${today}. Расставь задачи:
🔴 СРОЧНО — даст клиентов/деньги (дедлайн: 1-3 дня)
🟡 ВАЖНО — усилит поток заявок (дедлайн: 7 дней)
🟢 ПОТОМ — может подождать (дедлайн: 14 дней)
Для каждой: приоритет + почему + дедлайн YYYY-MM-DD. В конце: план на неделю, максимум 3 задачи.`,
    };

    const promptKey = mode || "blog";
    let systemPrompt = SYSTEM_PROMPTS[promptKey] || SYSTEM_PROMPTS.blog;
    const isTopics = promptKey === "topics_me" || promptKey === "topics_trends";

    if (userProfile && (isTopics || promptKey === "blog" || promptKey === "scenario" || promptKey === "prioritize_tasks")) {
      const limit = isTopics ? 500 : 2000;
      systemPrompt += `\n\nПРОФИЛЬ:\n${String(userProfile).slice(0, limit)}`;
    }

    if (isTopics && rssContext) {
      systemPrompt += `\n\nНовости:\n${String(rssContext).slice(0, 800)}`;
    }

    if ((promptKey === "scenario" || promptKey === "blog" || promptKey === "style_calibration") && userStyle) {
      systemPrompt += STYLE_ADDON(userStyle);
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: isTopics ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-20250514",
        max_tokens: isTopics ? 800 : 2000,
        system: systemPrompt,
        messages: safeMessages,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error("Anthropic API error:", err);
      return new Response(JSON.stringify({ error: "AI service unavailable" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const textContent = data.content.find((b: any) => b.type === "text");

    return new Response(JSON.stringify({ content: textContent?.text || "" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Handler error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
