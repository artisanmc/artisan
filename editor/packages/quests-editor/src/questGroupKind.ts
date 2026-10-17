import type { DocumentKindContribution } from "@artisan/editor-sdk";
import { textValue } from "@artisan/editor-sdk";
import { QuestGroupEditor } from "./QuestGroupEditor";
import { LABELS } from "./i18n";
import {
  DIR,
  KIND,
  type QuestGroup,
  SCHEMA,
  newUid,
  parseQuestGroup,
  questGroupTextSites,
  serializeQuestGroup,
} from "./model";

/** The `quest_group` kind: one file per group, holding its quests (design §3). */
export const questGroupKind: DocumentKindContribution = {
  kind: KIND,
  dir: DIR,
  schemaVersion: SCHEMA,
  // A group's id is its key on the server (`quest_group_key`): typed by hand, no prefix.
  label: LABELS.en,
  labels: LABELS,
  component: QuestGroupEditor,
  title: (doc, { project, lang }) => textValue(project, (doc as QuestGroup).title.key, lang),
  create: ({ id, projectId }) =>
    ({
      id,
      projectId,
      uid: newUid(),
      // Empty keys: the host mints them at their canonical address.
      title: { key: "" },
      description: { key: "" },
      actorType: "player",
      reset: {},
      limits: {},
      rotation: {},
      distribution: {},
      tiers: [],
      quests: [],
      rest: {},
    }) satisfies QuestGroup,
  parse: (src, ctx) => parseQuestGroup(src, ctx),
  serialize: (doc, project) => serializeQuestGroup(doc as QuestGroup, project),
  ltextSites: (doc) => questGroupTextSites(doc as QuestGroup),
  board: {
    summary: (doc) => {
      const n = (doc as QuestGroup).quests.length;
      return `quest_group · ${n}`;
    },
  },
};
