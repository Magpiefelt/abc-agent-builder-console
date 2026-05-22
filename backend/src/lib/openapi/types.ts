/**
 * OpenAPI 3.1 type subset.
 *
 * Hand-rolled, minimal subset of OpenAPI 3.1 covering the features ABC's
 * spec actually uses. We deliberately do NOT depend on the `openapi-types`
 * package to keep the dependency graph small and to make the spec
 * greppable from a single file.
 *
 * If a future change needs a feature missing here, add it; do not loosen to
 * `any`. The whole point of this module is that the spec assembler in
 * `spec.ts` cannot reference an unsupported OpenAPI keyword without a
 * compile error.
 */

export type HttpMethod = "get" | "post" | "put" | "delete" | "patch";

export interface OpenAPIInfo {
  title: string;
  version: string;
  description?: string;
  contact?: { name?: string; email?: string; url?: string };
  license?: { name: string; identifier?: string; url?: string };
}

export interface OpenAPIServer {
  url: string;
  description?: string;
}

export interface OpenAPITag {
  name: string;
  description?: string;
}

export type Reference = { $ref: string };

export interface SchemaObject {
  $ref?: string;
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";
  format?: string;
  description?: string;
  enum?: ReadonlyArray<string | number | boolean | null>;
  nullable?: boolean;
  items?: SchemaObject | Reference;
  properties?: Record<string, SchemaObject | Reference>;
  required?: string[];
  additionalProperties?: boolean | SchemaObject | Reference;
  example?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  oneOf?: ReadonlyArray<SchemaObject | Reference>;
  anyOf?: ReadonlyArray<SchemaObject | Reference>;
  allOf?: ReadonlyArray<SchemaObject | Reference>;
  default?: unknown;
}

export interface ParameterObject {
  name: string;
  in: "query" | "header" | "path" | "cookie";
  description?: string;
  required?: boolean;
  schema: SchemaObject | Reference;
  example?: unknown;
}

export interface MediaTypeObject {
  schema: SchemaObject | Reference;
  example?: unknown;
}

export interface RequestBodyObject {
  description?: string;
  required?: boolean;
  content: Record<string, MediaTypeObject>;
}

export interface ResponseObject {
  description: string;
  content?: Record<string, MediaTypeObject>;
  headers?: Record<string, { description?: string; schema?: SchemaObject | Reference }>;
}

export type SecurityRequirementObject = Record<string, string[]>;

export interface OperationObject {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses: Record<string, ResponseObject>;
  security?: SecurityRequirementObject[];
  deprecated?: boolean;
}

export type PathItemObject = Partial<Record<HttpMethod, OperationObject>> & {
  summary?: string;
  description?: string;
  parameters?: ParameterObject[];
};

export interface APIKeySecurityScheme {
  type: "apiKey";
  in: "cookie" | "header" | "query";
  name: string;
  description?: string;
}

export interface HttpSecurityScheme {
  type: "http";
  scheme: "bearer" | "basic";
  bearerFormat?: string;
  description?: string;
}

export type SecuritySchemeObject = APIKeySecurityScheme | HttpSecurityScheme;

export interface ComponentsObject {
  schemas?: Record<string, SchemaObject>;
  securitySchemes?: Record<string, SecuritySchemeObject>;
}

export interface OpenAPIObject {
  openapi: "3.1.0";
  info: OpenAPIInfo;
  servers: OpenAPIServer[];
  tags: OpenAPITag[];
  paths: Record<string, PathItemObject>;
  components: ComponentsObject;
  security?: SecurityRequirementObject[];
}
