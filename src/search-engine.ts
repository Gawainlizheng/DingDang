export const defaultSearch = { label: 'Google', endpoint: 'https://www.google.com/search', parameter: 'q' };

export function searchUrl(query: string, engine = defaultSearch) {
  const url = new URL(engine.endpoint);
  url.searchParams.set(engine.parameter, query);
  return url.href;
}
