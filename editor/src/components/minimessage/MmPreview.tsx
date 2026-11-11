import { McActionBar, McChat, McMotd, McScene, McTitle, McTooltip } from "@/components/mc-preview";
import type { MmProfile } from "@/lib/mm/profiles";
import { useTranslation } from "react-i18next";

export interface MmPreviewProps {
  value: string;
  profile: MmProfile;
  /** Title preview: the subtitle drawn under the title. */
  subtitle?: string;
  /** Lore preview: the item's name above the lore. */
  itemName?: string;
  /** MOTD preview: the server's name. */
  serverName?: string;
  scale?: number;
}

/** The in-game rendering a profile calls for: chat, tooltip, title, action bar, MOTD. */
export function MmPreview({
  value,
  profile,
  subtitle,
  itemName,
  serverName,
  scale = 2,
}: MmPreviewProps) {
  const { t } = useTranslation();
  switch (profile.preview) {
    case "chat": {
      const lines = value.split(/\n|<newline>|<br\/?>/i).length;
      return (
        <McScene height={(lines * 9 + 40) * scale}>
          <div
            style={{ position: "absolute", left: 2 * scale, right: 2 * scale, bottom: 12 * scale }}
          >
            <McChat messages={[value]} defaults={profile.defaults} scale={scale} />
          </div>
        </McScene>
      );
    }
    case "tooltip":
      return (
        <McTooltip
          title={itemName ?? t("mmEditor.sampleItemName")}
          lore={value.split("\n")}
          maxWidth={profile.maxWidth}
          loreDefaults={profile.defaults}
          scale={scale}
        />
      );
    case "item-name":
      return <McTooltip title={value} titleDefaults={profile.defaults} scale={scale} />;
    case "title":
      return (
        <McTitle title={value} subtitle={subtitle} defaults={profile.defaults} scale={scale / 2} />
      );
    case "actionbar":
      return <McActionBar text={value} defaults={profile.defaults} scale={scale} />;
    case "motd":
      return <McMotd motd={value} name={serverName} defaults={profile.defaults} scale={scale} />;
  }
}
