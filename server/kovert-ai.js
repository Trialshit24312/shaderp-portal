/**
 * KOVERT AI — cloud (OpenAI-compatible) with optional local Ollama fallback.
 * Set KOVERT_AI_API_KEY on Render for live website; OLLAMA_URL for local bench.
 */

let ollamaProbe = { at: 0, ok: false, models: [], hasChat: false, hasVision: false };

function ollamaUrl() {
  return process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
}

export function cloudAiConfigured() {
  return Boolean(process.env.KOVERT_AI_API_KEY || process.env.OPENAI_API_KEY);
}

function chatModel() {
  return process.env.KOVERT_AI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
}

function visionModel() {
  return process.env.KOVERT_AI_VISION_MODEL || chatModel();
}

function apiBase() {
  return (process.env.KOVERT_AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(
    /\/$/,
    '',
  );
}

function apiKey() {
  return process.env.KOVERT_AI_API_KEY || process.env.OPENAI_API_KEY || '';
}

export async function probeOllama(maxAgeMs = 12_000) {
  const now = Date.now();
  if (now - ollamaProbe.at < maxAgeMs) return ollamaProbe;
  try {
    const r = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error(`tags ${r.status}`);
    const data = await r.json();
    const models = (data.models || []).map((m) => m.name);
    ollamaProbe = {
      at: now,
      ok: true,
      models,
      hasChat: models.some((m) => /llama|mistral|qwen|gemma|phi/i.test(m)),
      hasVision: models.some((m) => /llava|vision|moondream|bakllava/i.test(m)),
    };
  } catch {
    ollamaProbe = { at: now, ok: false, models: [], hasChat: false, hasVision: false };
  }
  return ollamaProbe;
}

/** @returns {{ ready: boolean, provider: 'cloud'|'ollama'|'none', label: string, models: string[], hasChat: boolean, hasVision: boolean, ollama: boolean }} */
export async function aiStatus() {
  if (cloudAiConfigured()) {
    return {
      ready: true,
      provider: 'cloud',
      label: 'KOVERT AI',
      models: [chatModel(), visionModel()],
      hasChat: true,
      hasVision: true,
      ollama: false,
    };
  }
  const ollama = await probeOllama();
  return {
    ready: Boolean(ollama.ok && ollama.hasChat),
    provider: ollama.ok ? 'ollama' : 'none',
    label: ollama.ok ? 'Ollama' : 'Offline',
    models: ollama.models,
    hasChat: ollama.hasChat,
    hasVision: ollama.hasVision,
    ollama: ollama.ok,
  };
}

async function ollamaChat({ model, messages }) {
  const res = await fetch(`${ollamaUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama error ${res.status}: ${text.slice(0, 240)}`);
  }
  return res.json();
}

async function cloudChat({ messages, useVision }) {
  const model = useVision ? visionModel() : chatModel();
  const openaiMessages = messages.map((m) => {
    if (m.images?.length) {
      const parts = [{ type: 'text', text: String(m.content || '') }];
      for (const img of m.images) {
        const url = String(img).startsWith('data:') ? img : `data:image/png;base64,${img}`;
        parts.push({ type: 'image_url', image_url: { url } });
      }
      return { role: m.role, content: parts };
    }
    return { role: m.role, content: String(m.content || '') };
  });

  const res = await fetch(`${apiBase()}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({ model, messages: openaiMessages, temperature: 0.65 }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI error ${res.status}: ${text.slice(0, 240)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  return { message: { content }, model };
}

/**
 * Unified chat — prefers cloud when API key is set, else Ollama.
 * @param {{ messages: Array<{role:string,content:string,images?:string[]}>, useVision?: boolean }} opts
 */
export async function kovertChat({ messages, useVision = false }) {
  if (cloudAiConfigured()) {
    const out = await cloudChat({ messages, useVision });
    return { content: out.message.content, model: out.model };
  }

  const ollama = await probeOllama();
  if (!ollama.ok || !ollama.hasChat) {
    throw new Error(
      'No AI backend. Set KOVERT_AI_API_KEY on the portal host, or run Ollama locally (OLLAMA_URL).',
    );
  }
  if (useVision && !ollama.hasVision) {
    throw new Error('Vision needs KOVERT_AI_API_KEY or Ollama with llava pulled.');
  }

  const model = useVision ? 'llava:latest' : 'llama3.2:latest';
  const data = await ollamaChat({ model, messages });
  return { content: data.message?.content || '', model };
}
