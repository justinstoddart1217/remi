// Golden sections derived from the prototype shell's buildModel().
//
// goldenFromModel() is SELF-CONTAINED on purpose: it must not reference anything outside its
// own body, because specs/golden-crosscheck.spec.ts ships its source text into the browser
// (fn.toString()) and runs it against the live prototype's buildModel(). The Node extractor
// (extract.mjs) runs the very same function, so the two outputs are directly comparable.
//
// Every day number (days since 1970-01-01, the prototype's internal date type) is converted
// to an ISO date string. Functions and undefined values are dropped.

/** Hours used for the previewShift grid (every project x every h). */
export const PREVIEW_HOURS = [0, 0.5, 1, 2, 4, 6, 8, 16, 40];

export function goldenFromModel(m) {
  const HOURS = [0, 0.5, 1, 2, 4, 6, 8, 16, 40];
  const iso = (n) => (n == null ? null : m.F.iso(n));
  const plain = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const dayNums = Object.keys(m.CAL.days)
    .map(Number)
    .sort((a, b) => a - b);

  const perMonth = {};
  m.CAL.bds.forEach((n) => {
    const k = m.CAL.days[n].iso.slice(0, 7);
    perMonth[k] = (perMonth[k] || 0) + 1;
  });

  const calendar = {
    from: iso(dayNums[0]),
    to: iso(dayNums[dayNums.length - 1]),
    today: iso(m.TODAY),
    move: iso(m.MOVE),
    decRun: iso(m.DEC_RUN),
    capacity: m.CAPACITY,
    holidays: plain(m.HOL),
    businessDaysPerMonth: perMonth,
    countdown: {
      // The prototype's own bdDiff counts the move day; ADR-0009 counts days strictly between.
      bdDiffTodayToMove: m.CAL.bdDiff(m.TODAY, m.MOVE),
      businessDaysStrictlyBetween: m.CAL.bds.filter((n) => n > m.TODAY && n < m.MOVE).length,
    },
    days: dayNums.map((n) => {
      const d = m.CAL.days[n];
      return { iso: d.iso, weekday: m.F.wd(n), w: d.w, bd: d.bd, bdm: d.bdm, hol: d.hol };
    }),
  };

  const loads = m.CAL.bds.map((n) => {
    const l = m.loads[n];
    return {
      iso: iso(n),
      bdm: m.CAL.days[n].bdm,
      items: l.items.map((i) => ({ id: i.id, pid: i.pid, kind: i.kind, domain: i.domain, h: i.h, name: i.name })),
      bau: l.bau,
      proj: l.proj,
      total: l.total,
      free: l.free,
      over: l.over,
    };
  });

  const projects = m.P.map((p) => {
    const o = plain(p);
    ['startN', 'targetN', 'forecastN', 'prevN'].forEach((k) => {
      o[k] = iso(p[k]);
    });
    return o;
  });

  const verdict = plain(m.verdict);

  const attention = {
    attention: m.attention.map((a) => {
      const o = plain(a);
      if (a.day != null) {
        o.day = iso(a.day);
        o.id = 'o-' + iso(a.day);
      }
      return o;
    }),
    upcoming: m.upcoming.map((u) => ({ iso: iso(u.n), s: u.s, bdm: u.bdm, total: u.total })),
    prompt: m.prompt ? m.prompt.id : null,
    nextDue: m.nextDue ? m.nextDue.id : null,
  };

  const routines = m.routines.map((r) => {
    const o = plain(r);
    o.next = r.next.map((x) => ({ iso: iso(x.n), s: x.s, after: x.after, today: x.today }));
    return o;
  });

  const rotation = m.ROT.map((sg) => ({
    i: sg.i,
    country: sg.country,
    code: sg.code,
    len: sg.len,
    pass: sg.pass,
    s: iso(sg.s),
    e: iso(sg.e),
    sS: sg.sS,
    eS: sg.eS,
  }));

  const previewShift = {};
  m.P.forEach((p) => {
    previewShift[p.id] = HOURS.map((h) => {
      const r = m.previewShift(p.id, h);
      if (!r) return { h, result: null };
      const o = plain(r);
      o.from = iso(r.from);
      o.to = iso(r.to);
      o.newOver = r.newOver.map((x) => ({ iso: iso(x.n), s: x.s, total: x.total }));
      return { h, result: o };
    });
  });

  return { calendar, loads, projects, verdict, attention, routines, rotation, previewShift };
}

/** Section name -> golden file name (parity/golden/<file>). */
export const MODEL_GOLDEN_FILES = {
  calendar: 'calendar.json',
  loads: 'loads.json',
  projects: 'projects.json',
  verdict: 'verdict.json',
  attention: 'attention.json',
  routines: 'routines.json',
  rotation: 'rotation.json',
  previewShift: 'preview_shift.json',
};
