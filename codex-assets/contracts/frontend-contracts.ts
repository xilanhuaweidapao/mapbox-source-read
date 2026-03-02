export type DesignTokens = {
  color: Record<string, string>;
  spacing: Record<string, number>;
  fontSize: Record<string, number>;
  shadow: Record<string, string>;
  zIndex: Record<string, number>;
  breakpoints: Record<string, number>;
};

export type PageConfig = {
  mode: "dashboard" | "web";
  pages: Array<{
    id: string;
    route: string;
    title: string;
    authRequired: boolean;
  }>;
  dataSources: Array<{
    id: string;
    endpoint: string;
    method: "GET" | "POST";
    refreshMs?: number;
    timeoutMs?: number;
    auth?: "none" | "token" | "cookie";
    fallback?: "stale-cache" | "empty-state" | "retry-only";
  }>;
  permissions: string[];
  runtime: {
    env: "dev" | "test" | "prod";
    browserSupport: string[];
    targetFps?: number;
  };
};

export type ComponentContract<Props, Emits extends string = never> = {
  name: string;
  props: Props;
  emits: Emits[];
  emptyState: {
    title: string;
    description?: string;
    cta?: string;
  };
  errorState: {
    title: string;
    description?: string;
    retryable: boolean;
  };
};

export type ApiResponse<T> = {
  success: boolean;
  code: string;
  message: string;
  data: T | null;
  requestId?: string;
  ts?: number;
};

export type DoneDefinition = {
  functional: string[];
  visual: string[];
  performance: string[];
  accessibility: string[];
  tests: string[];
};

