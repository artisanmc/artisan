/**
 * A UNIX cron (5 fields, what ArtisanQuests reads with cron-utils) said in words, for the
 * common shapes of a period reset: daily, weekly, monthly, every N hours or minutes.
 * Anything else returns null and the view shows the expression as is.
 */

const DAYS: Record<string, string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  fr: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
};

const NUM = /^\d+$/;

function time(lang: string, h: number, m: number): string {
  const mm = String(m).padStart(2, "0");
  return lang === "fr"
    ? m === 0
      ? `${h} h`
      : `${h} h ${mm}`
    : `${String(h).padStart(2, "0")}:${mm}`;
}

function inRange(v: string, min: number, max: number): boolean {
  return NUM.test(v) && Number(v) >= min && Number(v) <= max;
}

/** Whether `expr` has the 5 fields of a UNIX cron (contents are the server's to judge). */
export function isCronShape(expr: string): boolean {
  return expr.trim().split(/\s+/).length === 5;
}

export function describeCron(expr: string, lang: string): string | null {
  const fr = lang === "fr";
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];
  if (mon !== "*") return null;

  const every = /^\*\/(\d+)$/;
  if (dom === "*" && dow === "*") {
    if (inRange(min, 0, 59) && inRange(hour, 0, 23)) {
      return fr
        ? `tous les jours à ${time(lang, +hour, +min)}`
        : `every day at ${time(lang, +hour, +min)}`;
    }
    const everyHours = every.exec(hour);
    if (inRange(min, 0, 59) && everyHours) {
      return fr
        ? `toutes les ${everyHours[1]} h, à la minute ${min}`
        : `every ${everyHours[1]} hours, at minute ${min}`;
    }
    if (inRange(min, 0, 59) && hour === "*") {
      return fr ? `toutes les heures, à la minute ${min}` : `every hour, at minute ${min}`;
    }
    const everyMinutes = every.exec(min);
    if (everyMinutes && hour === "*") {
      return fr ? `toutes les ${everyMinutes[1]} minutes` : `every ${everyMinutes[1]} minutes`;
    }
    return null;
  }
  if (!inRange(min, 0, 59) || !inRange(hour, 0, 23)) return null;
  const at = time(lang, +hour, +min);
  if (dom === "*" && inRange(dow, 0, 7)) {
    const day = DAYS[fr ? "fr" : "en"]![Number(dow) % 7];
    return fr ? `chaque ${day} à ${at}` : `every ${day} at ${at}`;
  }
  if (dow === "*" && inRange(dom, 1, 31)) {
    return fr
      ? `le ${dom === "1" ? "1er" : dom} de chaque mois à ${at}`
      : `on day ${dom} of each month at ${at}`;
  }
  return null;
}
