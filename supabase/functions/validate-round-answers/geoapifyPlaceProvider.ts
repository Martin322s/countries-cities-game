import type {
  GeographicPlaceProvider,
  GeographicPlaceRecord,
} from '../../../src/domain/validation.ts';

export class GeoapifyProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly normalizedQuery: string,
    readonly durationMs: number,
    readonly responseBody: string | null,
  ) {
    super(message);
    this.name = 'GeoapifyProviderError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

function placeNameVariants(source: Record<string, unknown> | undefined): string[] {
  return Object.entries(source ?? {})
    .filter(([key]) =>
      /^(name|alt_name|official_name|short_name)(?::[a-z]{2,3}(?:-[a-z]{4})?(?:-[a-z]{2})?)?$/i.test(
        key,
      ),
    )
    .flatMap(([, value]) => stringValues(value));
}

function placeType(properties: Record<string, unknown>): 'city' | 'village' | 'unknown' {
  const datasource = isRecord(properties.datasource) ? properties.datasource : undefined;
  const raw = datasource && isRecord(datasource.raw) ? datasource.raw : undefined;
  const rawPlace = typeof raw?.place === 'string' ? raw.place.toLowerCase() : null;
  const resultType =
    typeof properties.result_type === 'string' ? properties.result_type.toLowerCase() : null;
  const type = rawPlace ?? resultType;

  switch (type) {
    case 'city':
    case 'town':
      return 'city';
    case 'village':
    case 'hamlet':
      return 'village';
    default:
      return 'unknown';
  }
}

function parsePlace(value: unknown): GeographicPlaceRecord | null {
  if (!isRecord(value)) return null;
  const properties = isRecord(value.properties) ? value.properties : value;
  const datasource = isRecord(properties.datasource) ? properties.datasource : undefined;
  const raw = datasource && isRecord(datasource.raw) ? datasource.raw : undefined;
  const names = [
    ...stringValues(properties.name),
    ...stringValues(properties.name_other),
    ...stringValues(properties.alt_name),
    ...placeNameVariants(properties),
    ...placeNameVariants(raw),
  ]
    .map((name) => name.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  const canonicalName = names[0];
  if (!canonicalName) return null;

  const countryCode =
    typeof properties.country_code === 'string' ? properties.country_code : undefined;
  return {
    names: [...new Set(names)],
    placeType: placeType(properties),
    canonicalName,
    ...(countryCode ? { countryCode } : {}),
    raw: properties,
  };
}

export class GeoapifyPlaceProvider implements GeographicPlaceProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async lookupPlace(query: string): Promise<GeographicPlaceRecord[]> {
    const normalizedQuery = query.trim().replace(/\s+/g, ' ').toLocaleLowerCase('bg-BG');
    const startedAt = Date.now();
    if (!this.apiKey) {
      throw new GeoapifyProviderError(
        'GEOAPIFY_API_KEY is not configured',
        401,
        normalizedQuery,
        0,
        null,
      );
    }
    const url = new URL('https://api.geoapify.com/v1/geocode/search');
    url.searchParams.set('text', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('lang', 'bg');
    url.searchParams.set('limit', '20');
    url.searchParams.set('bias', 'countrycode:none');
    url.searchParams.set('apiKey', this.apiKey);

    let response: Response;
    try {
      response = await this.fetcher(url, { signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new GeoapifyProviderError(
        'Geoapify network request failed',
        null,
        normalizedQuery,
        Date.now() - startedAt,
        null,
      );
    }

    if (!response.ok) {
      const body = (await response.text())
        .replaceAll(this.apiKey, '[REDACTED]')
        .replace(/apiKey\s*[=:]\s*[^&\s"']+/gi, 'apiKey=[REDACTED]')
        .replace(/\s+/g, ' ')
        .slice(0, 300);
      const reason =
        response.status === 401 || response.status === 403
          ? 'Geoapify authentication/configuration failed'
          : response.status === 429
            ? 'Geoapify rate limit exceeded'
            : `Geoapify request failed with status ${response.status}`;
      throw new GeoapifyProviderError(
        `${reason}${body ? ` — ${body}` : ''}`,
        response.status,
        normalizedQuery,
        Date.now() - startedAt,
        body || null,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new GeoapifyProviderError(
        'Geoapify returned invalid JSON',
        response.status,
        normalizedQuery,
        Date.now() - startedAt,
        null,
      );
    }
    if (!isRecord(payload) || !Array.isArray(payload.results)) {
      throw new GeoapifyProviderError(
        'Geoapify returned an invalid result shape',
        response.status,
        normalizedQuery,
        Date.now() - startedAt,
        null,
      );
    }
    return payload.results
      .map(parsePlace)
      .filter((place): place is GeographicPlaceRecord => place !== null);
  }
}
