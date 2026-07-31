import { accountId, commandId, elementId, layerId, menuId, projectId } from "@/domain/ids";
import type { Account, I18nKey, MenuTitleLayer, Project } from "@/domain/types";

/** Wrap an existing i18n key into a single text MenuTitleLayer (migration helper for fixtures). */
const textLayer = (key: I18nKey): MenuTitleLayer[] => [
  { kind: "text", value: { key }, x: 8, y: 5 },
];

const ts = "2026-04-30T10:00:00Z";

const k = (key: string): I18nKey => key as I18nKey;

const personalProject = (): Project => {
  const shopMainId = menuId("m_shop_main");
  const profileId = menuId("m_profile");
  const aboutId = menuId("m_about");
  const healCmdId = commandId("c_heal");
  const pId = projectId("p_personal");

  return {
    id: pId,
    name: "Personal",
    description: "Default project",
    source: "user_created",
    createdAt: ts,
    updatedAt: ts,
    defaultLang: "en",
    i18nKeys: {
      [k("menus.m_shop_main.title")]: { en: "Shop principal" },
      [k("menus.m_shop_main.elements.el_btn_profile.default.title")]: { en: "Profil" },
      [k("menus.m_profile.title")]: { en: "Profil" },
      [k("menus.m_about.title")]: { en: "About" },
      [k("commands.c_heal.message")]: { en: "Healed!" },
    } as Project["i18nKeys"],
    assets: [],
    dataSources: [],
    dialogs: [],
    importedConnectors: [],
    canvasLayout: {
      [shopMainId]: { x: 60, y: 80 },
      [profileId]: { x: 320, y: 200 },
      [aboutId]: { x: 320, y: 320 },
      [healCmdId]: { x: 540, y: 80 },
    },
    menus: [
      {
        id: shopMainId,
        projectId: pId,
        title: textLayer(k("menus.m_shop_main.title")),
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
                    title: { key: k("menus.m_shop_main.elements.el_btn_profile.default.title") },
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
        projectId: pId,
        title: textLayer(k("menus.m_profile.title")),
        rows: 3,
        layers: [{ id: layerId("l_default_2"), name: "default", elements: [] }],
      },
      {
        id: aboutId,
        projectId: pId,
        title: textLayer(k("menus.m_about.title")),
        rows: 3,
        layers: [{ id: layerId("l_default_about"), name: "default", elements: [] }],
      },
    ],
    commands: [
      {
        id: healCmdId,
        projectId: pId,
        name: "heal",
        permission: "artisan.heal",
        arguments: [],
        steps: [
          {
            kind: "action",
            action: { type: "send_message", text: { key: k("commands.c_heal.message") } },
          },
        ],
      },
    ],
  };
};

const shopSystemProject = (): Project => {
  const pId = projectId("p_shop_system");
  const shopRootId = menuId("m_shop_root");
  const catArmorsId = menuId("m_cat_armors");
  const catWeaponsId = menuId("m_cat_weapons");
  const shopCmdId = commandId("c_shop");

  return {
    id: pId,
    name: "Shop System",
    description: "Multi-category shop with VIP rank",
    source: "user_created",
    createdAt: ts,
    updatedAt: ts,
    defaultLang: "en",
    i18nKeys: {
      [k("menus.m_shop_root.title")]: { en: "Shop" },
      [k("menus.m_cat_armors.title")]: { en: "Armors" },
      [k("menus.m_cat_weapons.title")]: { en: "Weapons" },
    } as Project["i18nKeys"],
    assets: [],
    dataSources: [],
    dialogs: [],
    importedConnectors: [],
    canvasLayout: {},
    menus: [
      {
        id: shopRootId,
        projectId: pId,
        title: textLayer(k("menus.m_shop_root.title")),
        rows: 6,
        layers: [{ id: layerId("l_def_3"), name: "default", elements: [] }],
      },
      {
        id: catArmorsId,
        projectId: pId,
        title: textLayer(k("menus.m_cat_armors.title")),
        rows: 6,
        layers: [{ id: layerId("l_def_4"), name: "default", elements: [] }],
      },
      {
        id: catWeaponsId,
        projectId: pId,
        title: textLayer(k("menus.m_cat_weapons.title")),
        rows: 6,
        layers: [{ id: layerId("l_def_5"), name: "default", elements: [] }],
      },
    ],
    commands: [
      {
        id: shopCmdId,
        projectId: pId,
        name: "shop",
        arguments: [],
        steps: [
          { kind: "action", action: { type: "open_menu", menuId: shopRootId } },
        ],
      },
    ],
  };
};

const dailyQuestsProject = (): Project => {
  const pId = projectId("p_daily_quests");
  const questsMainId = menuId("m_quests_main");

  return {
    id: pId,
    name: "Daily Quests",
    description: "Imported pack from @creator-x",
    source: "imported",
    sourceProjectId: projectId("p_remote_daily"),
    sourceVersion: "2.1.0",
    createdAt: ts,
    updatedAt: ts,
    defaultLang: "en",
    i18nKeys: {
      [k("menus.m_quests_main.title")]: { en: "Daily Quests" },
    } as Project["i18nKeys"],
    assets: [],
    dataSources: [],
    dialogs: [],
    importedConnectors: [],
    canvasLayout: {},
    menus: [
      {
        id: questsMainId,
        projectId: pId,
        title: textLayer(k("menus.m_quests_main.title")),
        rows: 6,
        layers: [{ id: layerId("l_def_6"), name: "default", elements: [] }],
      },
    ],
    commands: [],
  };
};

export const mockAccount = (): Account => ({
  id: accountId("acc_local"),
  projects: [personalProject(), shopSystemProject(), dailyQuestsProject()],
  projectOrder: [projectId("p_personal"), projectId("p_shop_system"), projectId("p_daily_quests")],
});
