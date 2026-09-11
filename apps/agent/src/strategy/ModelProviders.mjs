export const MODEL_PROVIDERS = Object.freeze({
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-5",
    apiKeyEnv: "OPENAI_API_KEY"
  },
  deepseek: {
    label: "DeepSeek",
    defaultModel: "deepseek-chat",
    apiKeyEnv: "DEEPSEEK_API_KEY"
  },
  claude: {
    label: "Claude",
    defaultModel: "claude-sonnet-4-5",
    apiKeyEnv: "ANTHROPIC_API_KEY"
  },
  glm: {
    label: "GLM",
    defaultModel: "glm-4.5",
    apiKeyEnv: "GLM_API_KEY"
  }
});

export function resolveModelConfig({
  provider = process.env.STRATEGY_AGENT_PROVIDER ?? "openai",
  model = process.env.STRATEGY_AGENT_MODEL
} = {}) {
  const resolvedProvider = String(provider || "openai").trim().toLowerCase();
  const providerConfig = MODEL_PROVIDERS[resolvedProvider];

  if (!providerConfig) {
    throw new Error(`Unsupported STRATEGY_AGENT_PROVIDER=${provider}. Supported providers: ${Object.keys(MODEL_PROVIDERS).join(", ")}`);
  }

  return {
    provider: resolvedProvider,
    model: model || providerConfig.defaultModel,
    apiKeyEnv: providerConfig.apiKeyEnv
  };
}

export function createJsonModelClient({
  provider,
  model,
  fetchImpl = fetch
} = {}) {
  const config = resolveModelConfig({ provider, model });

  if (config.provider === "openai") {
    return new OpenAIResponsesJsonModelClient({ ...config, fetchImpl });
  }

  if (config.provider === "deepseek") {
    return new OpenAICompatibleJsonModelClient({
      ...config,
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY,
      fetchImpl
    });
  }

  if (config.provider === "glm") {
    return new OpenAICompatibleJsonModelClient({
      ...config,
      baseUrl: process.env.GLM_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4",
      apiKey: process.env.GLM_API_KEY,
      fetchImpl
    });
  }

  if (config.provider === "claude") {
    return new ClaudeJsonModelClient({
      ...config,
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
      apiKey: process.env.ANTHROPIC_API_KEY,
      fetchImpl
    });
  }

  throw new Error(`Unsupported model provider: ${config.provider}`);
}

export class OpenAIResponsesJsonModelClient {
  constructor({
    provider,
    model,
    endpoint = process.env.OPENAI_BASE_URL
      ? `${trimTrailingSlash(process.env.OPENAI_BASE_URL)}/responses`
      : "https://api.openai.com/v1/responses",
    apiKey = process.env.OPENAI_API_KEY,
    apiKeyEnv = "OPENAI_API_KEY",
    fetchImpl = fetch
  } = {}) {
    this.provider = provider;
    this.model = model;
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.apiKeyEnv = apiKeyEnv;
    this.fetch = fetchImpl;
  }

  get available() {
    return Boolean(this.apiKey);
  }

  get id() {
    return `${this.provider}:${this.model}`;
  }

  async generateJson({ name, system, user, schema }) {
    this.assertAvailable();

    const payload = await this.postJson({
      url: this.endpoint,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: {
        model: this.model,
        input: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(user) }
        ],
        text: {
          format: {
            type: "json_schema",
            name,
            strict: true,
            schema
          }
        }
      },
      label: `${this.id} ${name}`
    });

    return parseJsonText(payload.output_text ?? extractOpenAIResponsesText(payload), `${this.id} ${name}`);
  }

  assertAvailable() {
    if (!this.available) {
      throw new Error(`${this.apiKeyEnv} is required for ${this.id}`);
    }
  }

  async postJson({ url, headers, body, label }) {
    let response;
    try {
      response = await this.fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw new Error(`${label} network request failed: ${error.message}. Start the server with NODE_USE_ENV_PROXY=1 if your network requires a proxy.`);
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${label} failed with ${response.status}: ${JSON.stringify(payload)}`);
    }

    return payload;
  }
}

export class OpenAICompatibleJsonModelClient extends OpenAIResponsesJsonModelClient {
  constructor({
    provider,
    model,
    baseUrl,
    apiKey,
    apiKeyEnv,
    fetchImpl = fetch
  } = {}) {
    super({
      provider,
      model,
      endpoint: `${trimTrailingSlash(baseUrl)}/chat/completions`,
      apiKey,
      apiKeyEnv,
      fetchImpl
    });
  }

  async generateJson({ name, system, user, schema }) {
    this.assertAvailable();

    const payload = await this.postJson({
      url: this.endpoint,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: {
        model: this.model,
        messages: [
          {
            role: "system",
            content: `${system}\nReturn only valid JSON matching this JSON Schema:\n${JSON.stringify(schema)}`
          },
          { role: "user", content: JSON.stringify(user) }
        ],
        response_format: { type: "json_object" }
      },
      label: `${this.id} ${name}`
    });

    return parseJsonText(payload.choices?.[0]?.message?.content, `${this.id} ${name}`);
  }
}

export class ClaudeJsonModelClient extends OpenAIResponsesJsonModelClient {
  constructor({
    provider,
    model,
    baseUrl,
    apiKey,
    apiKeyEnv,
    fetchImpl = fetch
  } = {}) {
    super({
      provider,
      model,
      endpoint: `${trimTrailingSlash(baseUrl)}/v1/messages`,
      apiKey,
      apiKeyEnv,
      fetchImpl
    });
  }

  async generateJson({ name, system, user, schema }) {
    this.assertAvailable();

    const payload = await this.postJson({
      url: this.endpoint,
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": process.env.ANTHROPIC_VERSION ?? "2023-06-01",
        "content-type": "application/json"
      },
      body: {
        model: this.model,
        max_tokens: 1600,
        system: `${system}\nReturn only valid JSON matching this JSON Schema:\n${JSON.stringify(schema)}`,
        messages: [
          { role: "user", content: JSON.stringify(user) }
        ]
      },
      label: `${this.id} ${name}`
    });

    return parseJsonText(payload.content?.find((item) => item.type === "text")?.text, `${this.id} ${name}`);
  }
}

function extractOpenAIResponsesText(payload) {
  const output = payload.output ?? [];
  const message = output.find((item) => item.type === "message");
  const text = message?.content?.find((item) => item.type === "output_text")?.text;

  if (!text) {
    throw new Error("Model response did not include output text");
  }

  return text;
}

function parseJsonText(text, label) {
  if (!text) {
    throw new Error(`${label} did not return text`);
  }

  const trimmed = stripJsonFence(String(text).trim());
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`);
  }
}

function stripJsonFence(text) {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}
