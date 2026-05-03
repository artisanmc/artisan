import { accountId, commandId, elementId, layerId, menuId, packId } from "@/domain/ids";
import type { Account, Pack } from "@/domain/types";
import { migratePackToI18n } from "@/lib/i18nMigration";

const ts = "2026-04-30T10:00:00Z";

// Fixtures are authored with plain user-facing strings (title, send_message
// text, etc.) for readability — the runtime expects `LText` refs, so we run
// the i18n migration over each pack before exposing it. The cast keeps TS
// happy without duplicating the legacy shape as a separate type.
//
// biome-ignore lint/suspicious/noExplicitAny: legacy fixture shape, see comment
type LegacyPack = any;

const personalPack = (): LegacyPack => {
  const shopMainId = menuId("m_shop_main");
  const profileId = menuId("m_profile");
  const aboutId = menuId("m_about");
  const healCmdId = commandId("c_heal");

  return {
    id: packId("p_personal"),
    name: "Personal",
    description: "Default workspace",
    source: "user_created",
    createdAt: ts,
    updatedAt: ts,
    defaultLang: "en",
    i18nKeys: { greeting: { en: "Welcome" } } as Pack["i18nKeys"],
    assets: [],
    templates: [],
    canvasLayout: {
      [shopMainId]: { x: 60, y: 80 },
      [profileId]: { x: 320, y: 200 },
      [aboutId]: { x: 320, y: 320 },
      [healCmdId]: { x: 540, y: 80 },
    },
    menus: [
      {
        id: shopMainId,
        packId: packId("p_personal"),
        title: "Shop principal",
        rows: 3,
        layers: [
          {
            id: layerId("l_default"),
            name: "default",
            elements: [
              {
                id: elementId("el_btn_profile"),
                positions: "13",
                appearances: [
                  {
                    material: "PAPER",
                    title: "Profil",
                    click: {
                      left: {
                        steps: [
                          { kind: "action", action: { type: "open_menu", menuId: profileId } },
                        ],
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: profileId,
        packId: packId("p_personal"),
        title: "Profil",
        rows: 3,
        layers: [{ id: layerId("l_default_2"), name: "default", elements: [] }],
      },
      {
        id: aboutId,
        packId: packId("p_personal"),
        title: "About",
        rows: 3,
        layers: [{ id: layerId("l_default_about"), name: "default", elements: [] }],
      },
    ],
    commands: [
      {
        id: healCmdId,
        packId: packId("p_personal"),
        name: "heal",
        permission: "interfaze.heal",
        arguments: [],
        steps: [{ kind: "action", action: { type: "send_message", text: "Healed!" } }],
      },
    ],
  };
};

const shopSystemPack = (): LegacyPack => ({
  id: packId("p_shop_system"),
  name: "Shop System",
  description: "Multi-category shop with VIP rank",
  source: "user_created",
  createdAt: ts,
  updatedAt: ts,
  defaultLang: "en",
  i18nKeys: {},
  assets: [],
  templates: [],
  canvasLayout: {},
  menus: [
    {
      id: menuId("m_shop_root"),
      packId: packId("p_shop_system"),
      title: "Shop",
      rows: 6,
      layers: [{ id: layerId("l_def_3"), name: "default", elements: [] }],
    },
    {
      id: menuId("m_cat_armors"),
      packId: packId("p_shop_system"),
      title: "Armors",
      rows: 6,
      layers: [{ id: layerId("l_def_4"), name: "default", elements: [] }],
    },
    {
      id: menuId("m_cat_weapons"),
      packId: packId("p_shop_system"),
      title: "Weapons",
      rows: 6,
      layers: [{ id: layerId("l_def_5"), name: "default", elements: [] }],
    },
  ],
  commands: [
    {
      id: commandId("c_shop"),
      packId: packId("p_shop_system"),
      name: "shop",
      arguments: [],
      steps: [{ kind: "action", action: { type: "open_menu", menuId: menuId("m_shop_root") } }],
    },
  ],
});

const dailyQuestsPack = (): LegacyPack => ({
  id: packId("p_daily_quests"),
  name: "Daily Quests",
  description: "Imported pack from @creator-x",
  source: "imported",
  sourcePackId: packId("p_remote_daily"),
  sourceVersion: "2.1.0",
  createdAt: ts,
  updatedAt: ts,
  defaultLang: "en",
  i18nKeys: {},
  assets: [],
  templates: [],
  canvasLayout: {},
  menus: [
    {
      id: menuId("m_quests_main"),
      packId: packId("p_daily_quests"),
      title: "Daily Quests",
      rows: 6,
      layers: [{ id: layerId("l_def_6"), name: "default", elements: [] }],
    },
  ],
  commands: [],
});

export const mockAccount = (): Account => {
  const packs = [personalPack(), shopSystemPack(), dailyQuestsPack()];
  for (const p of packs) migratePackToI18n(p, p.defaultLang ?? "en");
  return {
    id: accountId("acc_local"),
    packs: packs as Pack[],
    packOrder: [packId("p_personal"), packId("p_shop_system"), packId("p_daily_quests")],
  };
};
