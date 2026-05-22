import OpenAI from "openai";

const CLOD_BASE_URL = "https://api.clod.io/v1";
const CLOD_API_KEY = process.env.CLOD_API_KEY ?? "";
export const AI_MODEL = process.env.AI_MODEL ?? "claude-opus-4-5";

export const aiClient = new OpenAI({
  apiKey: CLOD_API_KEY,
  baseURL: CLOD_BASE_URL,
});
