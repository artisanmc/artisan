/// <reference path="../../editor/node_modules/vite/client.d.ts" />

declare module "*.yaml" {
  const source: string;
  export default source;
}
