import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  GeographicPlaceProvider,
  GeographicPlaceRecord,
} from '../../../src/domain/validation.ts';
import type { Database } from '../../../src/shared/lib/database.types';
import {
  extractResponseText,
  judgeInstructions,
  resultSchema,
  type LockedAnswer,
} from './protocol.ts';
import { GeoapifyPlaceProvider, GeoapifyProviderError } from './geoapifyPlaceProvider.ts';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GEOGRAPHIC_CATEGORIES = new Set(['country', 'city', 'village']);
const COUNTRY_SET = new Set([
  'австрия',
  'азербайджан',
  'албания',
  'алжир',
  'алжир',
  'андора',
  'ангола',
  'антигуа и барбуда',
  'аргентина',
  'армения',
  'австралия',
  'багамски острови',
  'бангладеш',
  'барбадос',
  'бахрейн',
  'беларус',
  'белгия',
  'белиз',
  'бенин',
  'болгария',
  'боливия',
  'босна и херцеговина',
  'ботсвана',
  'бразилия',
  'брюней',
  'бруней-даруссалам',
  'буркина фасо',
  'бурунди',
  'бутан',
  'великобритания',
  'венецуела',
  'виетнам',
  'габон',
  'гамбия',
  'гана',
  'германия',
  'грузия',
  'гватемала',
  'гвинея',
  'гвинея-бисау',
  'гърция',
  'дания',
  'джибути',
  'доминика',
  'доминиканска република',
  'египет',
  'еквадор',
  'еритрея',
  'естония',
  'етнопия',
  'зимбабве',
  'израел',
  'индия',
  'индонезия',
  'ирак',
  'иран',
  'ирландия',
  'исландия',
  'испания',
  'итания',
  'йемен',
  'йордания',
  'камерун',
  'канада',
  'катар',
  'казахстан',
  'кипър',
  'китай',
  'колумбия',
  'комори',
  'конго',
  'коста рика',
  "кот д'ивуар",
  'кроация',
  'куба',
  'кувейт',
  'кыргызстан',
  'лаос',
  'латвия',
  'лебано',
  'лесото',
  'литва',
  'люксембург',
  'мавритания',
  'мадагаскар',
  'македония',
  'малави',
  'малайзия',
  'малдиви',
  'мали',
  'малта',
  'мароко',
  'маршалови острови',
  'мексико',
  'мианмар',
  'молдова',
  'монголия',
  'монтенегро',
  'мозамбик',
  'намибия',
  'науру',
  'немания',
  'непал',
  'нигер',
  'нигерия',
  'нидерландия',
  'норвегия',
  'оман',
  'океания',
  'пакистан',
  'палестина',
  'панама',
  'папуа нова гвинея',
  'парагвай',
  'перу',
  'полша',
  'португалия',
  'руанда',
  'румъния',
  'русия',
  'салвадор',
  'самоа',
  'сан марино',
  'сао томе и принципе',
  'саудитска арабия',
  'свазиленд',
  'северна корея',
  'северна македония',
  'сейшели',
  'сенегал',
  'сейнт винсент и гренадини',
  'сейнт китс и невис',
  'сейнт лусия',
  'сърбия',
  'сингапур',
  'сирия',
  'словакия',
  'словения',
  'соломонови острови',
  'сомалия',
  'судан',
  'суринам',
  'съединени американски щати',
  'съединено кралство',
  'таджикистан',
  'тайван',
  'тайланд',
  'танзания',
  'того',
  'тринидад и тобаго',
  'тунис',
  'туркменистан',
  'турция',
  'уганда',
  'украйна',
  'уругвай',
  'узбекистан',
  'фиджи',
  'филипини',
  'финландия',
  'франция',
  'хаити',
  'холандия',
  'хондурас',
  'хърватия',
  'чад',
  'черна гора',
  'чехия',
  'чили',
  'швейцария',
  'швеция',
  'шри ланка',
  'южна африка',
  'южна корея',
  'ямайка',
  'япония',
]);

const normalize = (value: string) =>
  value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('bg-BG');
const normalizeGeoName = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('bg-BG');

function levenshtein(left: string, right: string): number {
  const distances = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let i = 0; i <= left.length; i++) distances[i]![0] = i;
  for (let j = 0; j <= right.length; j++) distances[0]![j] = j;
  for (let i = 1; i <= left.length; i++) {
    const previousRow = distances[i - 1]!;
    const currentRow = distances[i]!;
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const previousValue = previousRow[j] ?? 0;
      const currentValue = currentRow[j - 1] ?? 0;
      const diagonalValue = previousRow[j - 1] ?? 0;
      currentRow[j] = Math.min(previousValue + 1, currentValue + 1, diagonalValue + cost);
    }
  }
  return distances[left.length]?.[right.length] ?? 0;
}

function validateCountryDecision(
  answer: string,
  letter: string,
): { status: 'VALID' | 'INVALID'; reason: string | null; suggestion: string | null } {
  const normalized = normalize(answer);
  const letterNormalized = normalize(letter);
  if (!normalized) return { status: 'INVALID', reason: 'DOES_NOT_EXIST', suggestion: null };
  if (!normalized.startsWith(letterNormalized)) {
    return { status: 'INVALID', reason: 'WRONG_LETTER', suggestion: null };
  }
  if (COUNTRY_SET.has(normalized)) {
    return { status: 'VALID', reason: null, suggestion: null };
  }
  const closeMatch = Array.from(COUNTRY_SET)
    .filter((countryName) => levenshtein(normalized, countryName) <= 1)
    .sort((left, right) => levenshtein(normalized, left) - levenshtein(normalized, right))[0];
  if (closeMatch) {
    return { status: 'INVALID', reason: 'MISSPELLING', suggestion: closeMatch };
  }
  return { status: 'INVALID', reason: 'DOES_NOT_EXIST', suggestion: null };
}

type GeographicValidationResult = {
  status: 'VALID' | 'INVALID';
  reason: string | null;
  suggestion: string | null;
  model: string;
};

async function fetchCachedGeographicResult(
  admin: SupabaseClient<Database>,
  name: string,
  category: string,
) {
  try {
    const cache = admin.from('geographic_validation_cache' as never) as any;
    const { data, error } = await cache
      .select('*')
      .eq('normalized_name', `geoapify-v1:${normalizeGeoName(name)}`)
      .eq('requested_category', category)
      .maybeSingle();
    if (error) {
      console.warn('Geoapify cache read failed', { code: error.code, message: error.message });
      return undefined;
    }
    const row = data as { result?: unknown } | null;
    if (row && typeof row.result === 'object' && row.result !== null)
      return row.result as Record<string, unknown>;
  } catch (error) {
    console.warn('Geoapify cache read failed', {
      message: error instanceof Error ? error.message.slice(0, 200) : 'Unknown cache error',
    });
  }
  return undefined;
}

async function storeCachedGeographicResult(
  admin: SupabaseClient<Database>,
  name: string,
  category: string,
  decision: Record<string, unknown>,
  canonicalName?: string,
  countryCode?: string,
  rawMetadata?: Record<string, unknown>,
) {
  try {
    const cache = admin.from('geographic_validation_cache' as never) as any;
    const { error } = await cache.upsert(
      {
        normalized_name: `geoapify-v1:${normalizeGeoName(name)}`,
        requested_category: category,
        result: decision,
        osm_type: null,
        osm_id: null,
        canonical_name: canonicalName ?? name,
        country_code: countryCode ?? null,
        raw_metadata: rawMetadata ?? null,
        validated_at: new Date().toISOString(),
      },
      { onConflict: 'normalized_name,requested_category' },
    );
    if (error)
      console.warn('Geoapify cache write failed', { code: error.code, message: error.message });
  } catch (error) {
    console.warn('Geoapify cache write failed', {
      message: error instanceof Error ? error.message.slice(0, 200) : 'Unknown cache error',
    });
  }
}

async function validateGeographicAnswer(
  admin: SupabaseClient<Database>,
  provider: GeographicPlaceProvider,
  answer: string,
  letter: string,
  category: string,
  lookupMemo: Map<string, Promise<GeographicPlaceRecord[]>>,
): Promise<GeographicValidationResult> {
  const normalized = normalizeGeoName(answer);
  const letterNormalized = normalizeGeoName(letter);
  if (!normalized) {
    return { status: 'INVALID', reason: 'DOES_NOT_EXIST', suggestion: null, model: 'geoapify' };
  }
  if (!normalized.startsWith(letterNormalized)) {
    return { status: 'INVALID', reason: 'WRONG_LETTER', suggestion: null, model: 'geoapify' };
  }
  const cached = await fetchCachedGeographicResult(admin, answer, category);
  if (cached?.model === 'geoapify') {
    const status = cached.status === 'VALID' ? 'VALID' : 'INVALID';
    const validReason = new Set([
      'WRONG_LETTER',
      'MISSPELLING',
      'DOES_NOT_EXIST',
      'WRONG_CATEGORY',
      'AMBIGUOUS',
    ]);
    const reason =
      typeof cached.reason === 'string' && validReason.has(cached.reason) ? cached.reason : null;
    return {
      status,
      reason: status === 'VALID' ? null : (reason ?? 'AMBIGUOUS'),
      suggestion: typeof cached.suggestion === 'string' ? cached.suggestion : null,
      model: 'geoapify',
    };
  }

  const normalizedAnswer = normalizeGeoName(answer);
  let placesPromise = lookupMemo.get(normalizedAnswer);
  if (!placesPromise) {
    placesPromise = provider.lookupPlace(answer);
    lookupMemo.set(normalizedAnswer, placesPromise);
  }
  let places: GeographicPlaceRecord[];
  try {
    places = await placesPromise;
  } catch (error) {
    lookupMemo.delete(normalizedAnswer);
    throw error;
  }

  const exactMatches = places.filter((place) =>
    place.names.some((name) => normalizeGeoName(name) === normalizedAnswer),
  );
  if (!exactMatches.length) {
    const misspelling = places
      .flatMap((place) => place.names.map((name) => ({ place, name })))
      .map(({ place, name }) => ({
        place,
        name,
        distance: levenshtein(normalizedAnswer, normalizeGeoName(name)),
      }))
      .filter(({ distance }) => distance > 0 && distance <= 1)
      .sort((left, right) => left.distance - right.distance)[0];
    const decision: GeographicValidationResult = {
      status: 'INVALID',
      reason: misspelling ? 'MISSPELLING' : 'DOES_NOT_EXIST',
      suggestion: misspelling?.name ?? null,
      model: 'geoapify',
    };
    await storeCachedGeographicResult(admin, answer, category, decision);
    return decision;
  }

  const requestedType = category === 'city' ? 'city' : 'village';
  const exactWithRequestedType = exactMatches.find((place) => place.placeType === requestedType);
  if (exactWithRequestedType) {
    const decision: GeographicValidationResult = {
      status: 'VALID',
      reason: null,
      suggestion: null,
      model: 'geoapify',
    };
    await storeCachedGeographicResult(
      admin,
      answer,
      category,
      decision,
      exactWithRequestedType.canonicalName,
      exactWithRequestedType.countryCode,
      exactWithRequestedType.raw,
    );
    return decision;
  }

  const hasAmbiguousExact = exactMatches.some((place) => place.placeType === 'unknown');
  const decision: GeographicValidationResult = {
    status: 'INVALID',
    reason: hasAmbiguousExact ? 'AMBIGUOUS' : 'WRONG_CATEGORY',
    suggestion: null,
    model: 'geoapify',
  };
  await storeCachedGeographicResult(admin, answer, category, decision);
  return decision;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer '))
    return reply(401, { error: 'Authentication required' });
  const projectUrl = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!projectUrl || !serviceRole) return reply(503, { error: 'Validation service unavailable' });
  const admin = createClient<Database>(projectUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await admin.auth.getUser(authorization.slice(7));
  if (authError || !auth.user) return reply(401, { error: 'Authentication required' });
  const text = await req.text();
  if (text.length > 2048) return reply(413, { error: 'Request too large' });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { error: 'Invalid JSON' });
  }
  if (typeof body !== 'object' || body === null) return reply(400, { error: 'Invalid request' });
  const { roomId, roundId } = body as Record<string, unknown>;
  if (
    typeof roomId !== 'string' ||
    typeof roundId !== 'string' ||
    !uuid.test(roomId) ||
    !uuid.test(roundId)
  ) {
    return reply(400, { error: 'Expected roomId and roundId' });
  }
  const { data: member, error: memberError } = await admin
    .from('room_players')
    .select('player_id')
    .eq('room_id', roomId)
    .eq('player_id', auth.user.id)
    .is('left_at', null)
    .maybeSingle();
  if (memberError) {
    console.error('Validation membership lookup failed', {
      code: memberError.code,
      message: memberError.message,
    });
    return reply(503, { error: 'Validation service unavailable' });
  }
  if (!member) return reply(403, { error: 'Not a room member' });
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    console.error('Validation service is missing OPENAI_API_KEY');
    return reply(503, { error: 'Validation service unavailable' });
  }
  const { data: rawJob, error: claimError } = await admin.rpc('claim_ai_validation', {
    p_room_id: roomId,
    p_round_id: roundId,
  });
  if (claimError) {
    console.error('Validation job claim failed', {
      code: claimError.code,
      message: claimError.message,
    });
    return reply(503, { error: 'Validation service unavailable' });
  }
  if (!rawJob) return reply(202, { state: 'already_running_or_finished' });
  const job = rawJob as unknown as { claim: string; letter: string; answers: LockedAnswer[] };
  const geoapifyProvider = new GeoapifyPlaceProvider(Deno.env.get('GEOAPIFY_API_KEY') ?? '');
  const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4.1-mini';
  let stage = 'prepare';
  try {
    const byIndex = new Map<
      number,
      {
        index: number;
        status: 'VALID' | 'INVALID';
        reason: string | null;
        suggestion: string | null;
        model: string;
      }
    >();
    const nonGeographicRows: Array<{ index: number; category: string; value: string }> = [];
    const geographicLookups = new Map<string, Promise<GeographicPlaceRecord[]>>();
    for (const [index, answer] of job.answers.entries()) {
      const trimmed = answer.value.trim();
      if (!trimmed) {
        byIndex.set(index, {
          index,
          status: 'INVALID',
          reason: 'DOES_NOT_EXIST',
          suggestion: null,
          model: 'empty',
        });
        continue;
      }
      if (GEOGRAPHIC_CATEGORIES.has(answer.category)) {
        stage = 'geographic-validation';
        const decision =
          answer.category === 'country'
            ? { ...validateCountryDecision(answer.value, job.letter), model: 'country-database' }
            : await validateGeographicAnswer(
                admin,
                geoapifyProvider,
                answer.value,
                job.letter,
                answer.category,
                geographicLookups,
              );
        byIndex.set(index, { index, ...decision });
        continue;
      }
      nonGeographicRows.push({ index, category: answer.category, value: answer.value });
    }

    if (nonGeographicRows.length) {
      stage = 'openai-validation';
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: AbortSignal.timeout(45_000),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          store: false,
          instructions: judgeInstructions,
          input: JSON.stringify({ letter: job.letter, answers: nonGeographicRows }),
          text: {
            format: {
              type: 'json_schema',
              name: 'round_validation_result',
              strict: true,
              schema: resultSchema,
            },
          },
        }),
      });
      if (!response.ok) throw new Error(`Model request failed with status ${response.status}`);
      const parsed = JSON.parse(extractResponseText(await response.json())) as {
        results?: Array<Record<string, unknown>>;
      };
      const expectedIndexes = new Set(nonGeographicRows.map((entry) => entry.index));
      const receivedIndexes = new Set<number>();
      for (const item of parsed.results ?? []) {
        const index = typeof item.index === 'number' ? item.index : NaN;
        if (!Number.isInteger(index) || !expectedIndexes.has(index)) continue;
        const answer = job.answers[index];
        if (!answer || GEOGRAPHIC_CATEGORIES.has(answer.category)) continue;
        const wrongLetter =
          answer.value.trim() &&
          !answer.value
            .normalize('NFC')
            .trim()
            .toLocaleLowerCase('bg-BG')
            .startsWith(job.letter.toLocaleLowerCase('bg-BG'));
        const status = wrongLetter ? 'INVALID' : (item.status as 'VALID' | 'INVALID');
        const reason = wrongLetter
          ? 'WRONG_LETTER'
          : status === 'VALID'
            ? null
            : typeof item.reason === 'string'
              ? item.reason
              : 'AMBIGUOUS';
        receivedIndexes.add(index);
        byIndex.set(index, {
          index,
          status,
          reason,
          suggestion:
            wrongLetter || status === 'VALID'
              ? null
              : typeof item.suggestion === 'string'
                ? item.suggestion
                : null,
          model,
        });
      }
      if (receivedIndexes.size !== expectedIndexes.size) {
        throw new Error('Incomplete validation response');
      }
    }

    const results = job.answers.map((answer, index) => {
      const decision = byIndex.get(index) ?? {
        index,
        status: 'INVALID',
        reason: 'DOES_NOT_EXIST',
        suggestion: null,
        model: 'empty',
      };
      return {
        player_id: answer.player_id,
        category: answer.category,
        status: decision.status,
        reason: decision.reason,
        suggestion: decision.suggestion,
        model: decision.model,
      };
    });
    stage = 'publish-results';
    const { data: completed, error } = await admin.rpc('complete_ai_validation', {
      p_room_id: roomId,
      p_round_id: roundId,
      p_claim: job.claim,
      p_results: results,
    });
    if (error) throw new Error('Could not publish validation');
    if (!completed) throw new Error('Validation lease was no longer active');
    return reply(200, { state: 'completed' });
  } catch (error) {
    if (error instanceof GeoapifyProviderError) {
      console.error('Geographic provider request failed', {
        provider: 'geoapify',
        status: error.status,
        normalizedQuery: error.normalizedQuery,
        responseBody: error.responseBody,
        durationMs: error.durationMs,
      });
    }
    console.error('Validation worker failed', {
      roomId,
      roundId,
      stage,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message.slice(0, 300) }
          : { name: 'UnknownError' },
    });
    const { error: releaseError } = await admin.rpc('release_ai_validation', {
      p_round_id: roundId,
      p_claim: job.claim,
    });
    if (releaseError) {
      console.error('Validation lease release failed', {
        code: releaseError.code,
        message: releaseError.message,
      });
    }
    return reply(503, { error: 'Validation temporarily unavailable' });
  }
});
