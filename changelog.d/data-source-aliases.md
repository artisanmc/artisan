- **Added**: API 1.2.0, a data source may keep its former refs as aliases
  (`DataSourceDeclaration.withAliases`, `DataSourceRegistry.resolve`). A menu written against an
  alias reads the same rows; the editor recognises it and offers the new ref only.
