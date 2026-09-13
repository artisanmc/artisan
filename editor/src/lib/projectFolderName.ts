export function isValidProjectFolderName(name: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(name) &&
    !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name)
  );
}
