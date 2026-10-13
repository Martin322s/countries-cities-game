import { Link } from 'react-router';

import { MAX_PLAYERS } from '@/domain';

/**
 * Operator details must be filled in before a public launch (see
 * docs/release-checklist.md). Until then they are shown as visible placeholders —
 * never invented.
 */
const OPERATOR = {
  name: '[ОПЕРАТОР: име / организация — попълва се преди публичното пускане]',
  contact: '[ОПЕРАТОР: имейл за връзка — попълва се преди публичното пускане]',
};

/**
 * Plain-language privacy notice for this specific game. It describes exactly what the
 * implementation does (see README and docs/security.md). Not legal advice.
 */
export function PrivacyPage() {
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 text-fg">
      <header>
        <h1 className="font-display text-3xl font-black">Поверителност</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Кратко и честно: какво пази играта „Държави и градове“, защо и за колко време.
        </p>
      </header>

      <Section title="Без регистрация">
        <p>
          Не създаваш акаунт и не даваш имейл. При първото отваряне браузърът ти получава анонимна
          самоличност (произволен идентификатор), която се пази в браузъра — така след презареждане
          оставаш същият играч. Нямаме име, имейл, телефон или парола.
        </p>
      </Section>

      <Section title="Какво пазим">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Името, което въвеждаш в стаята (вижда се от другите играчи в нея).</li>
          <li>
            Стаята и играта: код на стаята, участници (до {MAX_PLAYERS}), рундове, буквите, кой е
            готов, точки и класиране.
          </li>
          <li>
            Отговорите ти. Докато рундът тече, само ти ги виждаш; след разкриването ги виждат
            играчите в стаята. Хостът може да отбележи отговор като невалиден — това е човешко
            решение, записва се кой и кога.
          </li>
          <li>Кога си бил на линия за последно (за да знаем кой е свързан и кой е хост).</li>
          <li>Активност по време на рунд — виж по-долу.</li>
        </ul>
      </Section>

      <Section title="Активност (fair play)">
        <p>
          Докато отговаряш в рунд, напускането на таба или прозореца заключва полетата ти до края на
          текущия рунд. Записваме момента на напускане и заключване, а другите играчи виждат
          индикатор, че отговорите ти са заключени. Последните въведени отговори се пазят и при
          презареждане на същия таб до края на сесията.
        </p>
        <p className="mt-2">
          Играта <strong>не</strong> вижда и <strong>не</strong> записва: кой сайт или приложение си
          отворил, какво има на екрана ти, клипборда, историята на браузъра или какво пишеш извън
          играта. Скриването на страницата не доказва измама — това е само информация за приятелите
          в стаята. Няма автоматични наказания.
        </p>
      </Section>

      <Section title="Географска проверка на отговорите">
        <p>
          След като всички са готови, държавите се проверяват чрез локална база данни, а градовете и
          селата — чрез Geoapify Geocoding API с данни от OpenStreetMap. Тези проверки могат да
          повлияят на точките. Останалите категории не се изпращат към външни проверяващи услуги и
          остават за преценка от хоста. Самият отговор не се променя автоматично.
        </p>
      </Section>

      <Section title="В браузъра ти">
        <p>
          Пазим анонимната сесия и настройката за звук (включен/изключен) в браузъра ти
          (localStorage). Звукът се генерира в браузъра — не изпращаме нищо за него. Шрифтовете се
          зареждат от същия сайт, без външни услуги.
        </p>
      </Section>

      <Section title="Колко дълго">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Стая, в която играта не е започнала или е изоставена: изтрива се 24 часа след последната
            активност.
          </li>
          <li>Завършена игра: изтрива се 7 дни след края ѝ.</li>
          <li>
            Анонимна самоличност без нито една стая: изтрива се 30 дни след последното ползване.
          </li>
        </ul>
        <p className="mt-2">
          С изтриването на стаята изчезват и всички отговори, точки и активност в нея.
        </p>
      </Section>

      <Section title="Кой обработва данните">
        <p>
          Играта работи върху Supabase (база данни, анонимно удостоверяване и връзка в реално време)
          и хостинг за уебсайта. Не продаваме данни, не показваме реклами и не използваме
          проследяване или анализи.
        </p>
        <p className="mt-2 text-sm text-fg-muted">
          Отговорен: {OPERATOR.name}. Контакт: {OPERATOR.contact}.
        </p>
      </Section>

      <p className="text-xs text-fg-subtle">
        Този текст описва как работи играта; не е правен съвет.
      </p>
      <Link to="/" className="text-brand-300 underline-offset-4 hover:underline">
        Към началото
      </Link>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-panel border border-white/10 bg-ink-900/60 p-5 text-fg-muted">
      <h2 className="mb-2 font-display text-lg font-bold text-fg">{title}</h2>
      {children}
    </section>
  );
}
