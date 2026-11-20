import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Default caching (no R2/KV): the pages are static, the API lives in a Durable Object.
export default defineCloudflareConfig({});
