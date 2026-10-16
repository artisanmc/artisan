export type JsonSchema = StringSchema | NumberSchema | BooleanSchema | ObjectSchema | ArraySchema;

export interface StringSchema {
  type: "string";
  title?: string;
  description?: string;
  enum?: string[];
  format?: "long";
  default?: string;
}

export interface NumberSchema {
  type: "number" | "integer";
  title?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  default?: number;
}

export interface BooleanSchema {
  type: "boolean";
  title?: string;
  description?: string;
  default?: boolean;
}

export interface ObjectSchema {
  type: "object";
  title?: string;
  description?: string;
  properties: Record<string, JsonSchema>;
  required?: string[];
}

export interface ArraySchema {
  type: "array";
  title?: string;
  description?: string;
  items: JsonSchema;
  default?: unknown[];
}

export interface SchemaFormProps {
  schema: JsonSchema;
  value: unknown;
  onChange: (next: unknown) => void;
  widgets?: Record<
    string,
    React.ComponentType<{ value: unknown; onChange: (v: unknown) => void; schema: JsonSchema }>
  >;
}
