/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** DeepSeek (or any OpenAI-compatible) API key. See .env.example. */
  readonly VITE_DEEPSEEK_API_KEY?: string;
  /** Override the API base URL. Defaults to https://api.deepseek.com */
  readonly VITE_AI_BASE_URL?: string;
  /** Override the model id. Defaults to deepseek-chat */
  readonly VITE_AI_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
