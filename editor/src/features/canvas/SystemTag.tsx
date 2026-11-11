import { useTranslation } from "react-i18next";
import { Text } from "react-konva";

/**
 * The line above a module's system menu or dialog on the board: whose it is, in the
 * module commands' color. Never listens: the node under it keeps every gesture.
 */
export function SystemTag({ module, width }: { module: string; width: number }) {
  const { t } = useTranslation();
  return (
    <Text
      y={-14}
      width={width}
      wrap="none"
      ellipsis
      text={t("canvas.systemElement", { module })}
      fontFamily="ui-monospace, monospace"
      fontSize={10}
      fill="#fcd34d"
      listening={false}
    />
  );
}
