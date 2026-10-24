import { MmEditor, MmPreview } from "@/components/minimessage";
import { Segmented } from "@/components/ui/segmented";
import { type MmProfile, mmProfile } from "@/lib/mm/profiles";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const PROFILE_IDS = ["chat", "item-name", "lore", "title", "actionbar", "motd"] as const;
type ProfileId = (typeof PROFILE_IDS)[number];

/**
 * The text workshop: the rich MiniMessage editor with every in-game preview, on its
 * own page. It assembles the very components the editor's fields will use.
 */
export function TextToolPage() {
  const { t } = useTranslation();
  const [profileId, setProfileId] = useState<ProfileId>("chat");
  // One text per usage: switching keeps what was written for each one.
  const [texts, setTexts] = useState<Record<ProfileId, string>>(
    () =>
      Object.fromEntries(PROFILE_IDS.map((id) => [id, t(`textTool.samples.${id}`)])) as Record<
        ProfileId,
        string
      >,
  );
  const [subtitle, setSubtitle] = useState("");
  const profile = mmProfile(profileId) as MmProfile;
  const value = texts[profileId];
  const setValue = (v: string) => setTexts((prev) => ({ ...prev, [profileId]: v }));

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8 md:py-10">
        <header className="flex flex-col gap-1.5">
          <h1
            className="display text-[32px] tracking-tight text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {t("textTool.title")}
          </h1>
          <p className="max-w-3xl text-[13px] text-[var(--text-mut)]">{t("textTool.intro")}</p>
        </header>

        <Segmented
          className="self-start"
          label={t("textTool.profileLabel")}
          value={profileId}
          onChange={setProfileId}
          options={PROFILE_IDS.map((id) => ({ value: id, label: t(`textTool.profiles.${id}`) }))}
        />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <MmEditor
              key={profileId}
              value={value}
              onChange={setValue}
              profile={profile}
              minHeight={profile.lines === "single" ? "40px" : "120px"}
            />
            {profileId === "title" && (
              <div className="flex flex-col gap-1">
                <span className="field-label">{t("textTool.subtitle")}</span>
                <MmEditor
                  value={subtitle}
                  onChange={setSubtitle}
                  profile={profile}
                  minHeight="40px"
                  aria-label={t("textTool.subtitle")}
                />
              </div>
            )}
          </div>
          <section
            aria-label={t("mmEditor.previewLabel")}
            className="card flex min-w-0 items-start justify-center overflow-x-auto p-4"
          >
            <MmPreview
              value={value}
              profile={profile}
              subtitle={subtitle}
              serverName={t("textTool.serverName")}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
