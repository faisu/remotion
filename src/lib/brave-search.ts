const BRAVE_API_BASE = "https://api.search.brave.com/res/v1";
const SEARCH_TIMEOUT_MS = 10_000;

function getApiKey(): string | null {
  const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
  return key || null;
}

export type WebSearchResult = {
  title: string;
  url: string;
  description: string;
};

export type ImageSearchResult = {
  url: string;
  thumbnail: string;
  title: string;
  width: number;
  height: number;
  source: string;
};

export async function braveWebSearch(
  query: string,
  count = 5,
): Promise<WebSearchResult[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("BRAVE_SEARCH_API_KEY is not configured");

  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(count, 20)),
  });

  const res = await fetch(`${BRAVE_API_BASE}/web/search?${params}`, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Brave web search failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
      }>;
    };
  };

  return (data.web?.results ?? [])
    .filter((r) => r.title && r.url)
    .map((r) => ({
      title: r.title!,
      url: r.url!,
      description: r.description ?? "",
    }));
}

const MIN_IMAGE_WIDTH = 1024;
const MIN_IMAGE_HEIGHT = 500;

export async function braveImageSearch(
  query: string,
  count = 8,
): Promise<ImageSearchResult[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("BRAVE_SEARCH_API_KEY is not configured");

  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(count, 20)),
    safesearch: "strict",
  });

  const res = await fetch(`${BRAVE_API_BASE}/images/search?${params}`, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(
      `Brave image search failed: ${res.status} ${res.statusText}`,
    );
  }

  const data = (await res.json()) as {
    results?: Array<{
      properties?: { url?: string };
      thumbnail?: { src?: string };
      title?: string;
      width?: number;
      height?: number;
      url?: string;
    }>;
  };

  return (data.results ?? [])
    .filter((r) => {
      const imgUrl = r.properties?.url || r.thumbnail?.src;
      const w = r.width ?? 0;
      const h = r.height ?? 0;
      return imgUrl && w >= MIN_IMAGE_WIDTH && h >= MIN_IMAGE_HEIGHT;
    })
    .map((r) => ({
      url: r.properties?.url ?? r.thumbnail?.src ?? "",
      thumbnail: r.thumbnail?.src ?? "",
      title: r.title ?? "",
      width: r.width!,
      height: r.height!,
      source: r.url ?? "",
    }));
}

export function isBraveSearchConfigured(): boolean {
  return getApiKey() !== null;
}
