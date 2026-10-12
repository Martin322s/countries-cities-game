export const VALIDATION_REASONS = [
  'WRONG_LETTER',
  'MISSPELLING',
  'DOES_NOT_EXIST',
  'WRONG_CATEGORY',
  'AMBIGUOUS',
] as const;

export const GEOGRAPHIC_CATEGORIES = ['country', 'city', 'village'] as const;
export type GeographicCategory = (typeof GEOGRAPHIC_CATEGORIES)[number];
export type ValidationSource = 'COUNTRY_DATABASE' | 'OPENSTREETMAP' | 'OPENAI' | 'HOST';

export type ValidationReason = (typeof VALIDATION_REASONS)[number];
export type ValidationStatus = 'VALID' | 'INVALID';

export interface ValidationDecision {
  status: ValidationStatus;
  reason: ValidationReason | null;
  suggestion: string | null;
  validationSource?: ValidationSource | null;
}

export interface GeographicPlaceRecord {
  canonicalName: string;
  names: string[];
  placeType: string;
  countryCode?: string;
  osmType?: string;
  osmId?: number;
  raw?: Record<string, unknown>;
}

export interface GeographicPlaceProvider {
  lookupPlace(name: string): Promise<GeographicPlaceRecord[]>;
}

export function normalizeAnswerForValidation(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('bg-BG');
}

export function isAnswerNormalizationSafe(value: string): boolean {
  const normalized = normalizeAnswerForValidation(value);
  return normalized.length > 0 && !/\s{2,}/.test(value);
}

const COUNTRY_SET = new Set<string>([
  'австрия',
  'азербайджан',
  'албания',
  'алжир',
  'андора',
  'ангола',
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
  'бруней',
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
  'океания',
  'оман',
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
  'ямика',
  'ямайка',
  'япония',
]);

function levenshtein(left: string, right: string): number {
  const distances = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i++) distances[i][0] = i;
  for (let j = 0; j <= right.length; j++) distances[0][j] = j;

  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      distances[i][j] = Math.min(
        distances[i - 1][j] + 1,
        distances[i][j - 1] + 1,
        distances[i - 1][j - 1] + cost,
      );
    }
  }

  return distances[left.length][right.length];
}

export function isCountryNameValid(value: string): boolean {
  return COUNTRY_SET.has(normalizeAnswerForValidation(value));
}

export function buildCountryValidationDecision(
  answer: string,
  letter: string,
  knownValue?: string,
): ValidationDecision {
  const normalized = normalizeAnswerForValidation(answer);
  const letterNormalized = normalizeAnswerForValidation(letter);

  if (normalized.length === 0) {
    return { status: 'INVALID', reason: 'DOES_NOT_EXIST', suggestion: null, validationSource: 'COUNTRY_DATABASE' };
  }

  if (!normalized.startsWith(letterNormalized)) {
    return { status: 'INVALID', reason: 'WRONG_LETTER', suggestion: null, validationSource: 'COUNTRY_DATABASE' };
  }

  if (knownValue && normalizeAnswerForValidation(knownValue) === normalized) {
    return { status: 'VALID', reason: null, suggestion: null, validationSource: 'COUNTRY_DATABASE' };
  }

  if (isCountryNameValid(answer)) {
    return { status: 'VALID', reason: null, suggestion: null, validationSource: 'COUNTRY_DATABASE' };
  }

  const closeMatch = Array.from(COUNTRY_SET)
    .filter((countryName) => levenshtein(normalized, countryName) <= 1)
    .sort((left, right) => levenshtein(normalized, left) - levenshtein(normalized, right))[0];

  if (closeMatch) {
    return {
      status: 'INVALID',
      reason: 'MISSPELLING',
      suggestion: closeMatch,
      validationSource: 'COUNTRY_DATABASE',
    };
  }

  return {
    status: 'INVALID',
    reason: 'DOES_NOT_EXIST',
    suggestion: null,
    validationSource: 'COUNTRY_DATABASE',
  };
}

export function buildValidationDecision(
  answer: string,
  letter: string,
  category: string,
  knownValue?: string,
): ValidationDecision {
  const normalized = normalizeAnswerForValidation(answer);
  const letterNormalized = normalizeAnswerForValidation(letter);

  if (normalized.length === 0) {
    return { status: 'INVALID', reason: 'DOES_NOT_EXIST', suggestion: null };
  }

  if (!normalized.startsWith(letterNormalized)) {
    return { status: 'INVALID', reason: 'WRONG_LETTER', suggestion: null };
  }

  if (category === 'country') {
    return buildCountryValidationDecision(answer, letter, knownValue);
  }

  if (knownValue && normalizeAnswerForValidation(knownValue) === normalized) {
    return { status: 'VALID', reason: null, suggestion: null };
  }

  return {
    status: 'INVALID',
    reason: 'AMBIGUOUS',
    suggestion: null,
  };
}
