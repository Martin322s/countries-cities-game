import { Link } from 'react-router';

import { MAX_PLAYERS, MIN_PLAYERS, ROUND_DURATION_MS, TOTAL_ROUNDS } from '@/domain';

/** What the game is — and what fair play does and does not mean. */
export function AboutPage() {
  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 text-fg">
      <header>
        <h1 className="font-display text-3xl font-black">За играта</h1>
        <p className="mt-2 text-sm text-fg-muted">Web v1.0</p>
      </header>

      <section className="rounded-panel border border-white/10 bg-ink-900/60 p-5 text-fg-muted">
        <h2 className="mb-2 font-display text-lg font-bold text-fg">Парти игра между приятели</h2>
        <p>
          „Държави и градове“ е класическата игра с лист и химикалка, за {MIN_PLAYERS} до{' '}
          {MAX_PLAYERS} души. Всеки рунд има една буква и {ROUND_DURATION_MS / 1000} секунди за
          седем категории. Играта е {TOTAL_ROUNDS} рунда — по един за всяка буква. Уникален отговор
          носи точка; еднаквите отговори не носят.
        </p>
        <p className="mt-2">
          Стаите са временни и анонимни: без регистрация, достъпни само с кода на стаята, и се
          изтриват автоматично (виж{' '}
          <Link to="/privacy" className="text-brand-300 underline-offset-4 hover:underline">
            Поверителност
          </Link>
          ).
        </p>
      </section>

      <section className="rounded-panel border border-white/10 bg-ink-900/60 p-5 text-fg-muted">
        <h2 className="mb-2 font-display text-lg font-bold text-fg">Честна игра</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Играта показва, когато страницата на някого е била скрита по време на рунд. Това не
            доказва измама — може да е съобщение, обаждане или заключен телефон.
          </li>
          <li>
            Напускането на таба или прозореца заключва отговорите до края на текущия рунд. Вече
            въведените отговори се запазват. Поставянето и влаченето на текст в полетата са
            забранени.
          </li>
          <li>
            След като всички натиснат „ГОТОВ“, държавите, градовете и селата се проверяват по
            географски данни. Останалите отговори се преценяват от хоста.
          </li>
          <li>
            Хостът може да отбележи отговор като невалиден. Това е човешко решение, което компанията
            в стаята обсъжда.
          </li>
          <li>
            Модифициран браузър може да скрие активността си — сигналът е за приятелска игра, не е
            защита срещу измама.
          </li>
        </ul>
      </section>

      <Link to="/" className="text-brand-300 underline-offset-4 hover:underline">
        Към началото
      </Link>
    </article>
  );
}
