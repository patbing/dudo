// Dudo page configuration.
const local = ['127.0.0.1', 'localhost'].includes(location.hostname);
export const MCP_URL = local ? `${location.origin}/mcp` : 'https://dudo.patbing.workers.dev/mcp';
// Public App Key (pk_...) registered for this page's address. Safe to commit.
export const APP_KEY = 'pk_SiXUUWYDvFKbNBbW';
export const REPO_URL = 'https://github.com/patbing/dudo';
export const DEFAULT_MODELS = ['z-ai/glm-5.3-flash', 'deepseek/deepseek-v4.1-flash', 'minimax/minimax-m3.1-flash', 'openai/gpt-5.4-nano'];
// One game stops sending model calls once this much Pollen could be spent (failed calls counted at worst case).
export const MAX_SPEND = 0.05;
