import Anthropic from "@anthropic-ai/sdk";

// Распознаёт паспорта, скриншоты рейсов и отеля и возвращает данные для ваучера.
// POST /extract  { images: [{ media_type, data(base64) }], note?: string }
// Заголовок X-Access-Code должен совпадать с секретом ACCESS_CODE.

const MAX_IMAGES = 20;

const nullableString = { type: ["string", "null"] };

const flightSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["date", "flight_number", "dep_airport", "dep_time", "arr_date", "arr_airport", "arr_time", "airline", "aircraft"],
  properties: {
    date: { ...nullableString, description: "Дата вылета DD.MM.YYYY" },
    flight_number: { ...nullableString, description: "Номер рейса как в билете, например HY-5531" },
    dep_airport: { ...nullableString, description: "IATA-код аэропорта вылета, например TAS" },
    dep_time: { ...nullableString, description: "Время вылета HH:MM" },
    arr_date: { ...nullableString, description: "Дата прилёта DD.MM.YYYY (если отличается от даты вылета — обязательно укажи)" },
    airline: { ...nullableString, description: "Название авиакомпании латиницей ЗАГЛАВНЫМИ, например UZBEKISTAN AIRWAYS" },
    aircraft: { ...nullableString, description: "Тип самолёта, например Airbus A321neo" },
    arr_airport: { ...nullableString, description: "IATA-код аэропорта прилёта" },
    arr_time: { ...nullableString, description: "Время прилёта HH:MM" },
  },
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tourists", "hotel", "flights", "operator", "booking_number", "cabin_class", "baggage"],
  properties: {
    booking_number: { ...nullableString, description: "Номер брони авиабилета (PNR) или номер заказа, если виден на скриншоте рейса" },
    cabin_class: { ...nullableString, description: "Класс обслуживания по-русски: Эконом / Бизнес" },
    baggage: { ...nullableString, description: "Норма багажа по-русски, например «Багаж до 20 кг»" },
    operator: { ...nullableString, description: "Принимающая компания / туроператор, если видно" },
    tourists: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "first_name", "last_name", "gender", "birth_date", "citizenship", "document_number", "passport_expiry", "category"],
        properties: {
          title: { type: "string", enum: ["MR", "MRS", "MS", "CHD", "INF"] },
          first_name: { type: "string", description: "Имя латиницей ЗАГЛАВНЫМИ, как в паспорте" },
          last_name: { type: "string", description: "Фамилия латиницей ЗАГЛАВНЫМИ, как в паспорте" },
          gender: { type: "string", enum: ["MALE", "FEMALE"] },
          birth_date: { type: "string", description: "DD.MM.YYYY" },
          citizenship: { type: "string", description: "Код страны ISO 3166-1 alpha-3, например UZB" },
          document_number: { type: "string", description: "Серия и номер паспорта без пробелов" },
          passport_expiry: { type: ["string", "null"], description: "Срок действия паспорта DD.MM.YYYY" },
          category: { type: "string", enum: ["ADULT", "CHILD", "INFANT"], description: "INFANT до 2 лет, CHILD 2–11 лет на дату вылета" },
        },
      },
    },
    hotel: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["name", "room", "meal", "check_in", "check_out"],
      properties: {
        name: { ...nullableString, description: "Название отеля ЗАГЛАВНЫМИ, со звёздностью если указана" },
        room: { ...nullableString, description: "Тип номера ЗАГЛАВНЫМИ" },
        meal: { ...nullableString, description: "Питание ЗАГЛАВНЫМИ, например ULTRA ALL INCLUSIVE" },
        check_in: { ...nullableString, description: "DD.MM.YYYY" },
        check_out: { ...nullableString, description: "DD.MM.YYYY" },
      },
    },
    flights: {
      type: "object",
      additionalProperties: false,
      required: ["outbound", "return"],
      properties: { outbound: flightSchema, return: flightSchema },
    },
  },
};

const SYSTEM = `Ты помогаешь турагентству заполнять ваучер. На вход приходят фото паспортов туристов, скриншоты авиабилетов/рейсов и скриншоты бронирования отеля, в любом сочетании.
Извлеки данные строго по схеме.
- Паспорта: если есть машиночитаемая зона (MRZ), сверяй с ней имя, номер, дату рождения и гражданство. Имена и фамилии — латиницей, заглавными, как в паспорте.
- title: MR для взрослых мужчин, MRS для взрослых женщин, CHD для детей 2–11 лет, INF для младенцев до 2 лет (на дату вылета, если она известна).
- Рейсы: outbound — рейс туда, return — обратно. Если на скриншоте только один рейс, второй = null.
- Даты всегда DD.MM.YYYY, время HH:MM (24 часа).
- Если какого-то значения не видно — ставь null. Ничего не придумывай.`;

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
  const ok = allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Access-Code",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = cors(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return json({ error: "Только POST" }, 405, headers);

    if (!env.ACCESS_CODE || request.headers.get("X-Access-Code") !== env.ACCESS_CODE) {
      return json({ error: "Неверный код доступа" }, 401, headers);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Некорректный запрос" }, 400, headers);
    }

    const images = Array.isArray(body.images) ? body.images : [];
    if (!images.length) return json({ error: "Нет изображений" }, 400, headers);
    if (images.length > MAX_IMAGES) return json({ error: `Не больше ${MAX_IMAGES} файлов за раз` }, 400, headers);

    const content = [];
    images.forEach((img, i) => {
      const isPdf = img.media_type === "application/pdf";
      content.push({ type: "text", text: `Файл ${i + 1}${img.name ? ` (${img.name})` : ""}:` });
      content.push(
        isPdf
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: img.data } }
          : { type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } },
      );
    });
    content.push({
      type: "text",
      text: "Извлеки данные для ваучера." + (body.note ? `\nКомментарий агента: ${String(body.note).slice(0, 1000)}` : ""),
    });

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    try {
      const response = await client.beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM,
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
        messages: [{ role: "user", content }],
      });

      if (response.stop_reason === "refusal") {
        return json({ error: "Модель отказалась обрабатывать эти файлы" }, 422, headers);
      }
      if (response.stop_reason === "max_tokens") {
        return json({ error: "Ответ получился слишком длинным — отправьте меньше файлов за раз" }, 422, headers);
      }

      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      const data = JSON.parse(text);
      return json({ data }, 200, headers);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        return json({ error: "Слишком много запросов, попробуйте через минуту" }, 429, headers);
      }
      if (err instanceof Anthropic.AuthenticationError) {
        return json({ error: "Неверный ANTHROPIC_API_KEY на сервере" }, 500, headers);
      }
      if (err instanceof Anthropic.APIError) {
        return json({ error: `Ошибка Claude API (${err.status}): ${err.message}` }, 502, headers);
      }
      if (err instanceof SyntaxError) {
        return json({ error: "Не удалось разобрать ответ модели" }, 502, headers);
      }
      return json({ error: "Ошибка сервера: " + (err?.message || err) }, 500, headers);
    }
  },
};
