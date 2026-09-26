import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import {
  BauChip,
  BauTick,
  CapacityBar,
  ConfidenceControl,
  DeltaChip,
  DomainDot,
  DomainTag,
  Eyebrow,
  ForecastEndDiamond,
  Icon,
  MilestoneDiamond,
  RotationSegment,
  RotationTile,
  StaleBadge,
  TargetMarker,
  TimelineBar,
  Tooltip,
} from '../../components';
import {
  COLOUR_GROUPS,
  EMPTIES,
  FRAME_SPECS,
  LOAD_DEFAULT,
  LOAD_FULL,
  LOAD_OVER,
  MOTION_SPEC,
  MOTION_TOKENS,
  SPACES,
  STRIP_LOADS,
  TYPE_SCALE,
} from './data';
import s from './Foundations.module.css';
import { SignatureDemo } from './SignatureDemo';

function SectionHead({ n, title, note }: { n: string; title: string; note: string }) {
  return (
    <div className={s.sectionHead}>
      <span className={s.sectionNum}>{n}</span>
      <h2 className={s.sectionTitle}>{title}</h2>
      <span className={s.sectionNote}>{note}</span>
    </div>
  );
}

function Specimen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={s.specimen}>
      <div className={s.specimenTitle}>{title}</div>
      {children}
    </div>
  );
}

const BAR_STATES = [
  { label: 'On track', state: 'on', w: '70%' },
  { label: 'At risk', state: 'risk', w: '62%', ow: '12%' },
  { label: 'Done', state: 'done', w: '48%' },
  { label: 'Ghost', state: 'ghost', w: '62%' },
  { label: 'No plan yet', state: 'define', w: '80%', domain: 'fi' },
] as const;

const TOOLTIP_SAMPLE = {
  title: 'Wed 4 Nov · BD3',
  chip: 'Overload',
  chipColor: 'var(--overload)',
  lines: ['Returns (BAU) · 6h', 'Returns pipeline · 3.5h'],
};

/**
 * Remi · Foundations: the living style guide (Remi Foundations.dc.html, the Ninety One
 * redesign), dev-only. Sections 01–05 reproduce the prototype page with the real components,
 * text for text; the prototype's copy still names the v1 stand-ins (oklch values, Albert Sans,
 * Libre Caslon, JetBrains Mono) while its swatches and specimens render the new tokens.
 * Every other library component and its states is on `/foundations/library` (LibraryPage).
 */
export function FoundationsPage() {
  const [conf, setConf] = useState(3);
  return (
    <div className={s.page} data-screen-label="Foundations">
      <header className={s.header}>
        <div>
          <Eyebrow>Remi · design foundations</Eyebrow>
          <h1 className={s.h1}>A notebook that recalculates itself</h1>
        </div>
        <p className={s.lede}>
          Tokens, type, spacing, motion and the core components. Colour and type values are stand-ins until the Ninety One values
          arrive; components read tokens only, so the swap touches <span className={s.code}>:root</span> and nothing else. Open{' '}
          <Link to="/app/today" title="The working screens (Remi.dc.html in the prototype)">
            Remi.dc.html
          </Link>{' '}
          for the working screens.
        </p>
      </header>

      <section className={s.section}>
        <SectionHead n="01" title="Colour" note="Colour carries meaning and only meaning. On track is the neutral default." />
        {COLOUR_GROUPS.map((g) => (
          <div key={g.label} className={s.colourRow}>
            <div>
              <div className={s.groupLabel}>{g.label}</div>
              <div className={s.groupNote}>{g.note}</div>
            </div>
            <div className={s.swatches}>
              {g.items.map((c) => (
                <div key={c.name} className={s.swatchCell}>
                  <div className={s.swatch} style={{ background: c.v }} />
                  <span className={s.tokenName}>{c.name}</span>
                  <span className={s.tokenValue}>{c.value}</span>
                  <span className={s.tokenRole}>{c.role}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className={s.section}>
        <SectionHead n="02" title="Type" note="Seven sizes. The serif is reserved for goal statements and day headings." />
        <div className={s.families}>
          <div>
            <div className={s.tokenName}>--font-ui</div>
            <div className={s.familySample}>Albert Sans</div>
            <div className={s.familyNote}>Refined grotesk for all interface text. Stand-in for the brand face.</div>
          </div>
          <div>
            <div className={s.tokenName}>--font-display</div>
            <div className={s.familySample} style={{ fontFamily: 'var(--font-display)' }}>
              Libre Caslon Text
            </div>
            <div className={s.familyNote}>Goal statements and day headings only. Tweakable off.</div>
          </div>
          <div>
            <div className={s.tokenName}>--font-numeric</div>
            <div className={s.familySample} style={{ fontFamily: 'var(--font-numeric)' }}>
              JetBrains 0123
            </div>
            <div className={s.familyNote}>Business-day numbers, hours and any column of figures. Body text also sets tabular-nums.</div>
          </div>
        </div>
        {TYPE_SCALE.map((t) => (
          <div key={t.spec} className={s.typeRow}>
            <span className={s.muted12}>{t.spec}</span>
            <span
              style={
                {
                  fontFamily: t.ff,
                  fontSize: t.fs,
                  fontWeight: t.fw,
                  lineHeight: t.lh,
                  letterSpacing: t.ls,
                  textTransform: t.tt,
                }
              }
            >
              {t.sample}
            </span>
            <span className={s.use}>{t.use}</span>
          </div>
        ))}
      </section>

      <section className={s.section}>
        <SectionHead n="03" title="Space, radius and grid" note="Whitespace and hairlines instead of boxes inside boxes." />
        <div className={s.spaceGrid}>
          <div>
            {SPACES.map((sp) => (
              <div key={sp.name} className={s.spaceRow}>
                <span className={s.mono12}>{sp.name}</span>
                <span className={s.muted12}>{sp.v}</span>
                <span className={s.spaceBar} style={{ width: sp.v }} />
              </div>
            ))}
            <div className={s.radii}>
              <div className={s.radius}>
                <span className={s.radiusBox} style={{ borderRadius: 'var(--radius-s)' }} />
                <span className={s.mono12}>--radius-s · 3px</span>
              </div>
              <div className={s.radius}>
                <span className={s.radiusBox} style={{ borderRadius: 'var(--radius-m)' }} />
                <span className={s.mono12}>--radius-m · 6px</span>
              </div>
            </div>
          </div>
          <div>
            <div className={s.frame}>
              <div className={s.frameRail} />
              <div className={s.frameMain}>
                <div className={s.frameHeader} />
                <div className={s.frameCols}>
                  {Array.from({ length: 12 }, (_, i) => (
                    <span key={i} className={s.frameCol} />
                  ))}
                </div>
              </div>
            </div>
            <div className={s.frameSpecs}>
              {FRAME_SPECS.map(([k, v]) => (
                <FrameSpec key={k} k={k} v={v} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={s.section}>
        <SectionHead n="04" title="Motion" note="Alive, never busy. Motion explains a change; nothing loops." />
        <div className={s.motionTokens}>
          {MOTION_TOKENS.map((t) => (
            <div key={t.name} className={s.motionToken}>
              <span className={s.tokenName}>{t.name}</span>
              <span className={s.motionValue}>{t.v}</span>
              <span className={s.motionNote}>{t.note}</span>
            </div>
          ))}
        </div>
        <SignatureDemo />
        <div className={s.table}>
          <div className={s.tableHead}>
            <span>Interaction</span>
            <span>Values</span>
            <span>Notes</span>
          </div>
          {MOTION_SPEC.map((r) => (
            <div key={r.name} className={s.tableRow}>
              <span className={s.tableName}>{r.name}</span>
              <span className={s.tableValues}>{r.v}</span>
              <span className={s.tableNote}>{r.note}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={s.section}>
        <SectionHead
          n="05"
          title="Components"
          note="Named as they will be in the build. BAU is a tick or chip; a project is a bar."
        />
        <div className={s.components}>
          <Specimen title="CapacityBar · day">
            <div className={s.stack14}>
              <div>
                <CapacityBar variant="day" load={LOAD_DEFAULT} marker={false} />
                <div className={s.caption}>Default · 6h BAU (notched) · 1h project (solid) · 1h free (outline)</div>
              </div>
              <div>
                <CapacityBar variant="day" load={LOAD_OVER} pulseDelay={450} />
                <div className={s.caption} style={{ color: 'var(--overload)' }}>
                  Overload · 9.5h of 8h · the whole bar turns red and pulses once
                </div>
              </div>
            </div>
          </Specimen>
          <Specimen title="CapacityBar · mini and strip">
            <div className={s.miniRow}>
              <div style={{ width: 160 }}>
                <CapacityBar variant="mini" load={LOAD_FULL} notches="gradient" />
                <div className={s.miniLabel}>8h of 8h</div>
              </div>
              <div className={s.strip}>
                {STRIP_LOADS.map((l, i) => (
                  <CapacityBar key={i} variant="strip" load={l} width={12} />
                ))}
              </div>
              <span className={s.stripNote}>Timeline strip: one stacked bar per business day, 5px per hour.</span>
            </div>
          </Specimen>

          <Specimen title="TimelineBar · states">
            <div className={s.stack14}>
              {BAR_STATES.map((b) => (
                <div key={b.label} className={s.barRow}>
                  <span className={s.barLabel}>{b.label}</span>
                  <div className={s.barTrack}>
                    <TimelineBar
                      state={b.state}
                      domain={'domain' in b ? b.domain : 'pc'}
                      width={b.w}
                      overrun={'ow' in b ? b.ow : 0}
                      glide={false}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Specimen>
          <Specimen title="MilestoneDiamond · TargetMarker · BauTick · BauChip">
            <div className={s.markers}>
              <span className={s.marker}>
                <MilestoneDiamond size={10} />
                Upcoming
              </span>
              <span className={s.marker}>
                <MilestoneDiamond size={10} passed />
                Passed
              </span>
              <span className={s.marker}>
                <ForecastEndDiamond variant="plain" />
                Forecast end
              </span>
              <span className={s.marker}>
                <TargetMarker height={20} />
                Target
              </span>
              <span className={s.marker}>
                <BauTick />
                <BauTick handedOver />
                Tick, handed-over tick
              </span>
              <BauChip>Returns · 6h</BauChip>
            </div>
          </Specimen>

          <Specimen title="RotationSegment · RotationTile">
            <div className={s.segments}>
              <RotationSegment pass="Build" width={120}>
                DE · Build
              </RotationSegment>
              <RotationSegment pass="Build" width={100}>
                FR · Build
              </RotationSegment>
              {/* The prototype's specimen wraps onto two lines (Remi Foundations.dc.html:243 sets
                  neither nowrap nor overflow); the shared component clips, as the timelines need. */}
              <RotationSegment pass="Refresh" width={60} style={{ whiteSpace: 'normal', overflow: 'visible' }}>
                DE · Refresh
              </RotationSegment>
            </div>
            <div className={s.tiles}>
              <RotationTile
                index="01"
                code="DE"
                country="Germany"
                pass="Build"
                dates="4 Jan – 11 Jan · 6 BD"
                current
                currentTone="brand"
                topAlign="stretch"
                style={{ width: 200 }}
              />
              <RotationTile
                index="11"
                code="DE"
                country="Germany"
                pass="Refresh"
                dates="9 Mar – 11 Mar · 3 BD"
                topAlign="stretch"
                style={{ width: 200 }}
              />
            </div>
          </Specimen>
          <Specimen title="DeltaChip · DomainTag · ConfidenceControl">
            <div className={s.chips}>
              <DeltaChip tone="risk" label="+3 BD" />
              <DeltaChip tone="neutral" label="−1 BD" />
              <DeltaChip tone="neutral" label="On target" />
              <DeltaChip tone="overload" label="Overload" />
              <span style={{ width: 16 }} />
              <DomainTag domain="pc" />
              <DomainTag domain="fi" />
            </div>
            <div className={s.confRow}>
              <ConfidenceControl value={conf} onChange={setConf} />
            </div>
          </Specimen>

          <Specimen title="GoalStatement · ProjectCard">
            <div className={s.card} style={{ marginTop: 14, borderBottom: '1px solid var(--hairline)' }}>
              <div>
                <div className={s.cardTitle}>PC handover playbook</div>
                <div className={s.goal}>A successor can run every PC process alone from written runbooks.</div>
              </div>
              <div className={s.cardSide}>
                <div className={s.cardDate}>Fri 18 Dec</div>
                <div className={s.cardMeta}>Run · 4/5 · 3 days ago</div>
              </div>
            </div>
            <div className={s.card}>
              <div>
                <div className={s.cardTitleRow}>
                  <span className={s.cardTitle}>ManCo pack automation</span>
                  <StaleBadge days={9} dot={false} joined />
                </div>
                <div className={s.goal} style={{ color: 'var(--ink-muted)' }}>
                  The ManCo pack builds itself from source data; the analyst only writes commentary.
                </div>
              </div>
              <div className={s.cardSide}>
                <div className={s.cardDate}>Fri 11 Dec</div>
                <div className={s.cardMeta} style={{ color: 'color-mix(in oklch, var(--risk) 45%, var(--ink))' }}>
                  9 days ago
                </div>
              </div>
            </div>
          </Specimen>
          <Specimen title="FeedItem · Tooltip · CheckInField">
            <div className={s.feed}>
              <DomainDot color="var(--risk)" size={8} className={s.feedDot} />
              <div>
                <div className={s.feedHead}>
                  <span className={s.feedTitle}>Returns pipeline</span>
                  <span className={s.feedDate}>Sat 3 Oct</span>
                </div>
                <div className={s.feedBody}>Scope added (security-level attribution, +10h). Forecast moved 27 Nov → 2 Dec.</div>
              </div>
              <DeltaChip tone="risk" label="+3 BD" />
            </div>
            <div className={s.feedRow}>
              <Tooltip tip={TOOLTIP_SAMPLE} variant="static" width={280} />
              <div className={s.field}>
                <div className={s.fieldLabel}>Blockers</div>
                <div className={s.fieldBox}>
                  Waiting on the security-level extract
                  <span className={s.caret} />
                </div>
                <div className={s.caption}>Focus state: 1px --focus border, no glow.</div>
              </div>
            </div>
          </Specimen>

          <Specimen title="NavRail · PageHeader · CommandPalette">
            <div className={s.navRow}>
              <div className={s.rail}>
                <div className={s.railItem} data-active="true">
                  <Icon name="today" className={s.railIcon} />
                  <span className={s.railLabel}>Today</span>
                </div>
                <div className={s.railItem}>
                  <Icon name="view_timeline" className={s.railIcon} />
                  <span className={s.railLabel}>Timeline</span>
                </div>
              </div>
              <div className={s.navRight}>
                <div className={s.pageHeader}>
                  <span className={s.phDate}>Mon 5 Oct</span>
                  <span className={s.phDot}>·</span>
                  <span className={s.muted12}>BD3</span>
                  <span className={s.phRule} />
                  <span className={s.phDate}>61</span>
                  <span className={s.phNote}>business days to Fixed Income</span>
                  <span className={s.grow} />
                  <span className={s.phButton}>Check in</span>
                </div>
                <div className={s.palette}>
                  <div className={s.paletteInput}>
                    <Icon name="search" className={s.paletteIcon} />
                    +6h returns
                    <span className={s.paletteCaret} />
                  </div>
                  <div className={s.paletteResults}>
                    <div className={s.paletteRow}>
                      <DomainDot color="pc" size={7} />
                      <span className={s.grow}>Add 6h of scope to Returns pipeline</span>
                      <span className={s.paletteKind}>check-in</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Specimen>
          <Specimen title="EmptyState · written with care">
            <div className={s.empties}>
              {EMPTIES.map((e) => (
                <div key={e.where} className={s.emptyRow}>
                  <span className={s.emptyWhere}>{e.where}</span>
                  <span className={s.emptyText}>{e.text}</span>
                </div>
              ))}
            </div>
            <div className={s.emptyFoot}>
              Side panel (460px) and check-in drawer (1160px) slide from the right on --spring-soft over an 18% ink scrim; see them
              live in the app.
            </div>
          </Specimen>
        </div>
      </section>

    </div>
  );
}

function FrameSpec({ k, v }: { k: string; v: string }) {
  return (
    <>
      <span className={s.muted12}>{k}</span>
      <span>{v}</span>
    </>
  );
}

export default FoundationsPage;
