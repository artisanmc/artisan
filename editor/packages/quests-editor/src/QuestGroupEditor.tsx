import {
  Button,
  type DocumentEditorProps,
  type TextWrite,
  injectModuleStyles,
  newTextKey,
  textValue,
  updateDocument,
  useContentLang,
  useProject,
  useUiLang,
} from "@artisan/editor-sdk";
import { type ReactNode, useState } from "react";
import { describeCron, isCronShape } from "./cron";
import { type T, useT } from "./i18n";
import {
  KIND,
  type Objective,
  type Quest,
  type QuestGroup,
  type Raw,
  type Stage,
  type Text,
  freeKey,
  newUid,
  slugKey,
  typedKey,
} from "./model";
import { OBJECTIVE_TYPES, type ParamSpec, defaultParams, objectiveSpec } from "./objectives";
import { QUESTS_CSS } from "./styles";

const DURATION = /^(\d+|(\d+[dhms])+)$/;
const TRIGGERS = ["actor_load", "period_reset", "quest_complete"] as const;
const TIMEZONES: string[] = (() => {
  try {
    return (
      (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ??
      []
    );
  } catch {
    return [];
  }
})();

/** One edit of the group: a copy changed by `recipe`, committed with the texts it sets. */
type Edit = (recipe: (draft: QuestGroup) => void, texts?: TextWrite[]) => void;

interface Ctx {
  project: unknown;
  lang: string;
  t: T;
  edit: Edit;
}

/**
 * The focus view of a `quest_group` (ArtisanQuests design §9), in the Properties panel:
 * the group's rules and its ordered quests, then one quest at a time with its stages,
 * objectives and rewards.
 */
export function QuestGroupEditor({ projectId, documentId, document }: DocumentEditorProps) {
  injectModuleStyles("msquests", QUESTS_CSS);
  const group = document as QuestGroup;
  const project = useProject(projectId);
  const lang = useContentLang();
  const t = useT();
  const [openUid, setOpenUid] = useState<string | null>(null);

  const edit: Edit = (recipe, texts) => {
    const next = structuredClone(group) as QuestGroup;
    recipe(next);
    updateDocument({ projectId, kind: KIND, id: documentId, doc: next, texts });
  };
  const ctx: Ctx = { project, lang, t, edit };

  const index = openUid ? group.quests.findIndex((q) => q.uid === openUid) : -1;
  if (index >= 0) {
    return (
      <div className="aq">
        <Button variant="ghost" size="sm" className="aq-back" onClick={() => setOpenUid(null)}>
          ← {t("back")}
        </Button>
        <QuestView ctx={ctx} group={group} index={index} />
      </div>
    );
  }
  return (
    <div className="aq">
      <GroupView ctx={ctx} group={group} onOpen={setOpenUid} />
    </div>
  );
}

// ------------------------------------------------------------------ fields

function Field({
  label,
  children,
  hint,
}: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the child
    <label className="aq-field">
      <span className="field-label">{label}</span>
      {children}
      {hint}
    </label>
  );
}

function TextField({
  ctx,
  label,
  node,
  multiline,
}: { ctx: Ctx; label: string; node: Text; multiline?: boolean }) {
  const value = textValue(ctx.project, node.key, ctx.lang);
  const write = (v: string) => ctx.edit(() => {}, [{ key: node.key, lang: ctx.lang, value: v }]);
  return (
    <Field label={`${label} · ${ctx.lang}`}>
      {multiline ? (
        <textarea className="textarea" value={value} onChange={(e) => write(e.target.value)} />
      ) : (
        <input className="input" value={value} onChange={(e) => write(e.target.value)} />
      )}
    </Field>
  );
}

function asNumber(value: unknown): string {
  return typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
}

/** A whole number written into `map[key]`; cleared, the key leaves the map. */
function NumberField({
  label,
  value,
  onChange,
}: { label: string; value: unknown; onChange: (v: number | undefined) => void }) {
  return (
    <Field label={label}>
      <input
        className="input"
        type="number"
        min={0}
        step={1}
        value={asNumber(value)}
        onChange={(e) => {
          const raw = e.target.value.trim();
          onChange(raw === "" ? undefined : Math.max(0, Math.trunc(Number(raw))));
        }}
      />
    </Field>
  );
}

function setOrDelete(map: Raw, key: string, value: unknown) {
  if (value === undefined || value === "") delete map[key];
  else map[key] = value;
}

function move<X>(list: X[], from: number, to: number) {
  if (to < 0 || to >= list.length) return;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item!);
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      className="aq-icon-btn"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function Reorder({
  t,
  index,
  count,
  onMove,
  onRemove,
}: {
  t: T;
  index: number;
  count: number;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <IconButton label={t("moveUp")} disabled={index === 0} onClick={() => onMove(index - 1)}>
        ↑
      </IconButton>
      <IconButton
        label={t("moveDown")}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
      >
        ↓
      </IconButton>
      <IconButton label={t("remove")} onClick={onRemove}>
        ×
      </IconButton>
    </>
  );
}

// ------------------------------------------------------------------ group

function GroupView({
  ctx,
  group,
  onOpen,
}: { ctx: Ctx; group: QuestGroup; onOpen: (uid: string) => void }) {
  const { t, edit, project, lang } = ctx;
  const uiLang = useUiLang();
  const cron = typeof group.reset.cron === "string" ? group.reset.cron : "";
  const cronWords = cron ? describeCron(cron, uiLang) : null;
  const timezone = typeof group.reset.timezone === "string" ? group.reset.timezone : "";
  const triggers = Array.isArray(group.distribution.triggers)
    ? (group.distribution.triggers as string[])
    : [];
  const perTier = (group.distribution.tiers ?? {}) as Record<string, unknown>;
  const hooks =
    group.rest.on && typeof group.rest.on === "object"
      ? Object.keys(group.rest.on as Raw).length
      : 0;
  const kept = Object.keys(group.rest).filter((k) => k !== "on");

  const addQuest = () => {
    const titleKey = newTextKey();
    const uid = newUid();
    edit(
      (g) => {
        g.quests.push({
          key: freeKey(
            "quest",
            g.quests.map((q) => q.key),
          ),
          uid,
          tier: "",
          title: { key: titleKey },
          description: { key: newTextKey() },
          duration: "",
          stages: [newStage(1)],
          rest: {},
        });
      },
      [{ key: titleKey, lang, value: t("newQuestTitle") }],
    );
    onOpen(uid);
  };

  return (
    <>
      <section className="aq-section">
        <span className="aq-h">{t("group")}</span>
        <TextField ctx={ctx} label={t("title")} node={group.title} />
        <TextField ctx={ctx} label={t("description")} node={group.description} multiline />
        <Field label={t("actorType")}>
          <select
            className="select"
            value={group.actorType}
            onChange={(e) =>
              edit((g) => {
                g.actorType = e.target.value;
              })
            }
          >
            <option value="player">{t("actor.player")}</option>
            <option value="global">{t("actor.global")}</option>
            {!["player", "global"].includes(group.actorType) && (
              <option value={group.actorType}>{group.actorType}</option>
            )}
          </select>
        </Field>
      </section>

      <section className="aq-section">
        <span className="aq-h">{t("reset")}</span>
        <Field
          label={t("cron")}
          hint={
            !cron ? (
              <span className="aq-hint">{t("noReset")}</span>
            ) : !isCronShape(cron) ? (
              <span className="aq-err">{t("cronInvalid")}</span>
            ) : (
              <span className="aq-ok">
                {cronWords ?? t("cronRaw")}
                {timezone ? `, ${timezone}` : ""}
              </span>
            )
          }
        >
          <input
            className="input"
            value={cron}
            placeholder="0 4 * * *"
            onChange={(e) => edit((g) => setOrDelete(g.reset, "cron", e.target.value))}
          />
        </Field>
        <Field label={t("timezone")}>
          <input
            className="input"
            list="aq-timezones"
            value={timezone}
            placeholder={t("timezoneServer")}
            onChange={(e) => edit((g) => setOrDelete(g.reset, "timezone", e.target.value.trim()))}
          />
          <datalist id="aq-timezones">
            {TIMEZONES.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </Field>
      </section>

      <section className="aq-section">
        <span className="aq-h">{t("distribution")}</span>
        <div className="aq-row">
          <Field label={t("strategy")}>
            <select
              className="select"
              value={
                typeof group.distribution.strategy === "string"
                  ? group.distribution.strategy.toLowerCase()
                  : ""
              }
              onChange={(e) => edit((g) => setOrDelete(g.distribution, "strategy", e.target.value))}
            >
              <option value="">—</option>
              {(["none", "sequential", "random"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`strategy.${s}`)}
                </option>
              ))}
            </select>
          </Field>
          <NumberField
            label={t("amount")}
            value={group.distribution.amount}
            onChange={(v) => edit((g) => setOrDelete(g.distribution, "amount", v))}
          />
        </div>
        <span className="field-label">{t("triggers")}</span>
        {TRIGGERS.map((trigger) => (
          <label key={trigger} className="aq-check">
            <input
              type="checkbox"
              checked={triggers.includes(trigger)}
              onChange={(e) =>
                edit((g) => {
                  const list = (
                    Array.isArray(g.distribution.triggers) ? g.distribution.triggers : []
                  ) as string[];
                  const next = e.target.checked
                    ? [...list, trigger]
                    : list.filter((x) => x !== trigger);
                  setOrDelete(g.distribution, "triggers", next.length ? next : undefined);
                })
              }
            />
            {t(`trigger.${trigger}`)}
          </label>
        ))}
        {group.tiers.length > 0 && (
          <>
            <span className="field-label">{t("perTier")}</span>
            <div className="aq-row">
              {group.tiers.map((tier) => (
                <NumberField
                  key={tier.key}
                  label={textValue(project, tier.title.key, lang) || tier.key}
                  value={perTier[tier.key]}
                  onChange={(v) =>
                    edit((g) => {
                      const map = { ...((g.distribution.tiers ?? {}) as Raw) };
                      setOrDelete(map, tier.key, v);
                      setOrDelete(
                        g.distribution,
                        "tiers",
                        Object.keys(map).length ? map : undefined,
                      );
                    })
                  }
                />
              ))}
            </div>
          </>
        )}
      </section>

      <section className="aq-section">
        <span className="aq-h">{t("limits")}</span>
        <div className="aq-row">
          <NumberField
            label={t("maxActive")}
            value={group.limits.max_active}
            onChange={(v) => edit((g) => setOrDelete(g.limits, "max_active", v))}
          />
          <NumberField
            label={t("maxPerPeriod")}
            value={group.limits.max_per_period}
            onChange={(v) => edit((g) => setOrDelete(g.limits, "max_per_period", v))}
          />
        </div>
        <span className="aq-h">{t("rotation")}</span>
        <div className="aq-row">
          <label className="aq-check">
            <input
              type="checkbox"
              checked={group.rotation.enabled === true}
              onChange={(e) =>
                edit((g) => setOrDelete(g.rotation, "enabled", e.target.checked ? true : undefined))
              }
            />
            {t("rotationEnabled")}
          </label>
          <NumberField
            label={t("maxPerPeriod")}
            value={group.rotation.max_per_period}
            onChange={(v) => edit((g) => setOrDelete(g.rotation, "max_per_period", v))}
          />
        </div>
      </section>

      <section className="aq-section">
        <div className="aq-head">
          <span className="aq-h">{t("tiers")}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              edit((g) => {
                g.tiers.push({
                  key: freeKey(
                    "tier",
                    g.tiers.map((x) => x.key),
                  ),
                  title: { key: newTextKey() },
                  rest: {},
                });
              })
            }
          >
            + {t("addTier")}
          </Button>
        </div>
        {group.tiers.map((tier, i) => (
          <div key={tier.key} className="aq-row">
            <Field label={t("tierKey")}>
              <input
                className="input"
                defaultValue={tier.key}
                onBlur={(e) => {
                  const next = slugKey(e.target.value);
                  if (next === tier.key) return;
                  edit((g) => {
                    const key = freeKey(
                      next,
                      g.tiers.map((x) => x.key),
                    );
                    g.tiers[i]!.key = key;
                    for (const q of g.quests) if (q.tier === tier.key) q.tier = key;
                    const map = g.distribution.tiers as Raw | undefined;
                    if (map && tier.key in map) {
                      map[key] = map[tier.key];
                      delete map[tier.key];
                    }
                  });
                }}
              />
            </Field>
            <TextField ctx={ctx} label={t("title")} node={tier.title} />
            <IconButton
              label={t("remove")}
              onClick={() =>
                edit((g) => {
                  g.tiers.splice(i, 1);
                })
              }
            >
              ×
            </IconButton>
          </div>
        ))}
      </section>

      <section className="aq-section">
        <div className="aq-head">
          <span className="aq-h">
            {t("quests")} · {group.quests.length}
          </span>
          <Button size="sm" variant="primary" onClick={addQuest}>
            + {t("addQuest")}
          </Button>
        </div>
        {group.quests.length === 0 && <span className="aq-hint">{t("noQuests")}</span>}
        <div className="aq-list">
          {group.quests.map((q, i) => (
            <div key={q.uid} className="aq-item">
              <button
                type="button"
                className="aq-item-main"
                onClick={() => onOpen(q.uid)}
                title={t("open")}
              >
                <span className="aq-item-title">
                  {textValue(project, q.title.key, lang) || q.key}
                </span>
                <span className="aq-item-sub">
                  {q.key}
                  {q.tier ? ` · ${q.tier}` : ""}
                  {q.duration ? ` · ${q.duration}` : ""}
                </span>
              </button>
              <Reorder
                t={t}
                index={i}
                count={group.quests.length}
                onMove={(to) => edit((g) => move(g.quests, i, to))}
                onRemove={() =>
                  edit((g) => {
                    g.quests.splice(i, 1);
                  })
                }
              />
            </div>
          ))}
        </div>
        {hooks > 0 && <span className="aq-hint">{t("hooks", { count: hooks })}</span>}
        {kept.length > 0 && (
          <span className="aq-hint">{t("kept", { fields: kept.join(", ") })}</span>
        )}
      </section>
    </>
  );
}

// ------------------------------------------------------------------ quest

function newStage(n: number): Stage {
  return { key: `stage_${n}`, title: { key: newTextKey() }, flow: "", objectives: [], rest: {} };
}

function QuestView({ ctx, group, index }: { ctx: Ctx; group: QuestGroup; index: number }) {
  const { t, edit } = ctx;
  const quest = group.quests[index]!;
  const editQuest = (recipe: (q: Quest) => void, texts?: TextWrite[]) =>
    edit((g) => recipe(g.quests[index]!), texts);
  const keyTaken = group.quests.some((q, i) => i !== index && q.key === quest.key);
  const durationBad =
    quest.duration !== "" && !DURATION.test(quest.duration.replace(/\s/g, "").toLowerCase());
  const rewards = Array.isArray(quest.rest.rewards) ? (quest.rest.rewards as Raw[]) : [];

  return (
    <>
      <section className="aq-section">
        <TextField ctx={ctx} label={t("title")} node={quest.title} />
        <TextField ctx={ctx} label={t("description")} node={quest.description} multiline />
        <div className="aq-row">
          <Field
            label={t("key")}
            hint={keyTaken && <span className="aq-err">{t("keyTaken")}</span>}
          >
            <input
              className="input"
              value={quest.key}
              onChange={(e) =>
                editQuest((q) => {
                  q.key = typedKey(e.target.value);
                })
              }
              onBlur={() => {
                const final = slugKey(quest.key);
                if (final !== quest.key)
                  editQuest((q) => {
                    q.key = final;
                  });
              }}
            />
          </Field>
          <Field label={t("tier")}>
            <select
              className="select"
              value={quest.tier}
              onChange={(e) =>
                editQuest((q) => {
                  q.tier = e.target.value;
                })
              }
            >
              <option value="">{t("noTier")}</option>
              {group.tiers.map((tier) => (
                <option key={tier.key} value={tier.key}>
                  {textValue(ctx.project, tier.title.key, ctx.lang) || tier.key}
                </option>
              ))}
              {quest.tier && !group.tiers.some((x) => x.key === quest.tier) && (
                <option value={quest.tier}>{quest.tier}</option>
              )}
            </select>
          </Field>
        </div>
        <Field
          label={t("duration")}
          hint={
            <span className={durationBad ? "aq-err" : "aq-hint"}>
              {durationBad ? t("durationInvalid") : t("durationHint")}
            </span>
          }
        >
          <input
            className="input"
            value={quest.duration}
            placeholder="24h"
            onChange={(e) =>
              editQuest((q) => {
                q.duration = e.target.value.trim();
              })
            }
          />
        </Field>
      </section>

      <section className="aq-section">
        <div className="aq-head">
          <span className="aq-h">{t("stages")}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              editQuest((q) => {
                const key = freeKey(
                  `stage_${q.stages.length + 1}`,
                  q.stages.map((s) => s.key),
                );
                q.stages.push({ ...newStage(q.stages.length + 1), key });
              })
            }
          >
            + {t("addStage")}
          </Button>
        </div>
        {quest.stages.map((stage, si) => (
          <StageCard
            key={`${stage.key}-${si}`}
            ctx={ctx}
            quest={quest}
            stage={stage}
            si={si}
            editQuest={editQuest}
          />
        ))}
      </section>

      <section className="aq-section">
        <div className="aq-head">
          <span className="aq-h">{t("rewards")}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              editQuest((q) => {
                q.rest.rewards = [...rewards, { type: "command", command: "" }];
              })
            }
          >
            + {t("addReward")}
          </Button>
        </div>
        {rewards.map((reward, ri) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an action has no identity; its inputs are controlled
          <div key={ri} className="aq-row">
            {reward.type === "command" ? (
              <Field label={t("rewardCommand")}>
                <input
                  className="input"
                  value={typeof reward.command === "string" ? reward.command : ""}
                  placeholder="give {player} diamond 1"
                  onChange={(e) =>
                    editQuest((q) => {
                      (q.rest.rewards as Raw[])[ri]!.command = e.target.value;
                    })
                  }
                />
              </Field>
            ) : (
              <span className="aq-hint">{t("rewardOther", { type: String(reward.type) })}</span>
            )}
            <IconButton
              label={t("remove")}
              onClick={() =>
                editQuest((q) => {
                  const next = [...rewards];
                  next.splice(ri, 1);
                  setOrDelete(q.rest, "rewards", next.length ? next : undefined);
                })
              }
            >
              ×
            </IconButton>
          </div>
        ))}
        {Object.keys(quest.rest).filter((k) => k !== "rewards").length > 0 && (
          <span className="aq-hint">
            {t("kept", {
              fields: Object.keys(quest.rest)
                .filter((k) => k !== "rewards")
                .join(", "),
            })}
          </span>
        )}
      </section>

      <section className="aq-section">
        <span className="aq-h">{t("preview")}</span>
        <Preview ctx={ctx} quest={quest} />
      </section>
    </>
  );
}

function StageCard({
  ctx,
  quest,
  stage,
  si,
  editQuest,
}: {
  ctx: Ctx;
  quest: Quest;
  stage: Stage;
  si: number;
  editQuest: (recipe: (q: Quest) => void, texts?: TextWrite[]) => void;
}) {
  const { t } = ctx;
  const editStage = (recipe: (s: Stage) => void) => editQuest((q) => recipe(q.stages[si]!));
  return (
    <div className="aq-card">
      <div className="aq-head">
        <span className="aq-h">{t("stage", { n: si + 1 })}</span>
        <span>
          <Reorder
            t={t}
            index={si}
            count={quest.stages.length}
            onMove={(to) => editQuest((q) => move(q.stages, si, to))}
            onRemove={() =>
              editQuest((q) => {
                q.stages.splice(si, 1);
              })
            }
          />
        </span>
      </div>
      <TextField ctx={ctx} label={t("title")} node={stage.title} />
      <Field label={t("flow")}>
        <select
          className="select"
          value={stage.flow}
          onChange={(e) =>
            editStage((s) => {
              s.flow = e.target.value as Stage["flow"];
            })
          }
        >
          <option value="">{t("flow.default")}</option>
          <option value="parallel">{t("flow.parallel")}</option>
          <option value="sequential">{t("flow.sequential")}</option>
        </select>
      </Field>
      {stage.objectives.length === 0 && <span className="aq-hint">{t("noObjectives")}</span>}
      {stage.objectives.map((objective, oi) => (
        <ObjectiveCard
          key={`${objective.key}-${oi}`}
          t={t}
          objective={objective}
          taken={quest.stages
            .flatMap((s) => s.objectives)
            .filter((o) => o !== objective)
            .map((o) => o.key)}
          onChange={(recipe) => editStage((s) => recipe(s.objectives[oi]!))}
          onRemove={() =>
            editStage((s) => {
              s.objectives.splice(oi, 1);
            })
          }
        />
      ))}
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          editQuest((q) => {
            // Objective keys are unique within a quest: the database keys progress by them.
            const taken = q.stages.flatMap((s) => s.objectives.map((o) => o.key));
            q.stages[si]!.objectives.push({
              key: freeKey("objective", taken),
              type: "block_break",
              params: defaultParams("block_break"),
            });
          })
        }
      >
        + {t("addObjective")}
      </Button>
    </div>
  );
}

function ObjectiveCard({
  t,
  objective,
  taken,
  onChange,
  onRemove,
}: {
  t: T;
  objective: Objective;
  taken: string[];
  onChange: (recipe: (o: Objective) => void) => void;
  onRemove: () => void;
}) {
  const spec = objectiveSpec(objective.type);
  const params: ParamSpec[] = spec
    ? spec.params
    : Object.keys(objective.params).map((name) => ({ name, kind: "text" as const }));
  const keyTaken = taken.includes(objective.key);
  return (
    <div className="aq-sub">
      <div className="aq-row">
        <Field label={t("type")}>
          <select
            className="select"
            value={objective.type}
            onChange={(e) =>
              onChange((o) => {
                o.type = e.target.value;
                o.params = defaultParams(o.type);
              })
            }
          >
            {OBJECTIVE_TYPES.map((s) => (
              <option key={s.type} value={s.type}>
                {t(`objective.${s.type}` as Parameters<T>[0])}
              </option>
            ))}
            {!spec && <option value={objective.type}>{objective.type}</option>}
          </select>
        </Field>
        <Field label={t("key")} hint={keyTaken && <span className="aq-err">{t("keyTaken")}</span>}>
          <input
            className="input"
            value={objective.key}
            onChange={(e) =>
              onChange((o) => {
                o.key = typedKey(e.target.value);
              })
            }
            onBlur={() => {
              const final = slugKey(objective.key);
              if (final !== objective.key)
                onChange((o) => {
                  o.key = final;
                });
            }}
          />
        </Field>
        <IconButton label={t("remove")} onClick={onRemove}>
          ×
        </IconButton>
      </div>
      <div className="aq-row">
        {params.map((p) => (
          <ParamField
            key={p.name}
            t={t}
            spec={p}
            value={objective.params[p.name]}
            onChange={(v) => onChange((o) => setOrDelete(o.params, p.name, v))}
          />
        ))}
      </div>
    </div>
  );
}

function ParamField({
  t,
  spec,
  value,
  onChange,
}: {
  t: T;
  spec: ParamSpec;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = t(`param.${spec.name}` as Parameters<T>[0]);
  const missing = spec.required && (value === undefined || value === "");
  const hint = missing ? <span className="aq-warn">{t("required")}</span> : undefined;
  if (spec.kind === "int") {
    return <NumberField label={label} value={value} onChange={onChange} />;
  }
  const upper = spec.kind === "material" || spec.kind === "entity";
  return (
    <Field label={label} hint={hint}>
      <input
        className="input"
        value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
        placeholder={upper ? t("any") : ""}
        onChange={(e) =>
          onChange(upper ? e.target.value.toUpperCase().replace(/\s+/g, "_") : e.target.value)
        }
      />
    </Field>
  );
}

function Preview({ ctx, quest }: { ctx: Ctx; quest: Quest }) {
  const { t, project, lang } = ctx;
  const line = (o: Objective) => {
    const spec = objectiveSpec(o.type);
    const what = spec?.params
      .filter((p) => p.kind !== "int" && o.params[p.name] !== undefined && o.params[p.name] !== "")
      .map((p) => String(o.params[p.name]))
      .join(" ");
    const amount = o.params.amount ?? o.params.distance;
    const label = spec ? t(`objective.${o.type}` as Parameters<T>[0]) : o.type;
    return `${label}${what ? ` · ${what}` : ""}${amount !== undefined ? ` · 0/${String(amount)}` : ""}`;
  };
  return (
    <div className="aq-preview">
      <span className="aq-preview-title">
        {textValue(project, quest.title.key, lang) || quest.key}
      </span>
      {textValue(project, quest.description.key, lang) && (
        <span className="aq-preview-line">{textValue(project, quest.description.key, lang)}</span>
      )}
      {quest.stages
        .flatMap((s) => s.objectives)
        .map((o) => (
          <span key={o.key} className="aq-preview-line">
            • {line(o)}
          </span>
        ))}
    </div>
  );
}
