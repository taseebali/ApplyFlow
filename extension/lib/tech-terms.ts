/**
 * What counts as a thing a posting can ask for.
 *
 * Matching used to work by subtraction: take every word in the posting, remove
 * the ones on a stoplist, call the rest requirements. That fails in a way that
 * cannot be patched. The stoplist was English, the posting was German, and the
 * panel reported "und", "die", "mit", "bei" and "zu" as things the candidate
 * was missing. Before that it reported "why", "days" and "built". Every round
 * of additions leaves the next posting's filler untouched.
 *
 * So the gate is positive instead. A term is a requirement only if it is a
 * technology or a named skill — either one the candidate already lists, or one
 * in the vocabulary below. The worst case flips from "reports `und` as a
 * requirement" to "misses a technology nobody has listed yet", which is the
 * failure worth having: a gap we under-report costs a chip on a screen, and a
 * gap we invent costs the user's trust in the number beside it.
 *
 * Everything here is lowercase; matching lowercases the posting too, so it
 * works the same whether the posting writes "FastAPI", "fastapi" or "FASTAPI".
 */

const LANGUAGES = [
  'python', 'typescript', 'javascript', 'java', 'kotlin', 'swift', 'go', 'golang', 'rust', 'ruby',
  'php', 'scala', 'perl', 'haskell', 'elixir', 'erlang', 'clojure', 'dart', 'lua', 'r', 'matlab',
  'sql', 'plsql', 'tsql', 'bash', 'shell', 'powershell', 'zsh', 'c', 'c++', 'c#', 'objective-c',
  'vba', 'cobol', 'fortran', 'solidity', 'groovy', 'julia', 'abap',
];

const WEB = [
  'react', 'vue', 'angular', 'svelte', 'next.js', 'nextjs', 'nuxt', 'remix', 'astro', 'solidjs',
  'html', 'css', 'sass', 'scss', 'tailwind', 'bootstrap', 'webpack', 'vite', 'rollup', 'esbuild',
  'node.js', 'nodejs', 'node', 'deno', 'bun', 'express', 'nestjs', 'fastify', 'graphql', 'rest',
  'grpc', 'websocket', 'webrtc', 'jquery', 'redux', 'zustand', 'storybook',
];

const BACKEND = [
  'fastapi', 'django', 'flask', 'rails', 'laravel', 'spring', 'springboot', 'dotnet', '.net',
  'asp.net', 'quarkus', 'micronaut', 'phoenix', 'gin', 'echo', 'actix', 'tornado', 'celery',
  'rabbitmq', 'kafka', 'nats', 'mqtt', 'zeromq', 'activemq', 'sqs', 'pubsub',
];

const DATA = [
  'postgres', 'postgresql', 'mysql', 'mariadb', 'sqlite', 'oracle', 'mssql', 'mongodb', 'redis',
  'cassandra', 'dynamodb', 'elasticsearch', 'opensearch', 'clickhouse', 'influxdb', 'timescaledb',
  'neo4j', 'snowflake', 'bigquery', 'redshift', 'databricks', 'duckdb', 'chromadb', 'pinecone',
  'weaviate', 'qdrant', 'milvus', 'faiss', 'pgvector',
  'spark', 'hadoop', 'flink', 'beam', 'airflow', 'dagster', 'prefect', 'dbt', 'etl', 'elt',
  'pandas', 'numpy', 'polars', 'scipy', 'dask',
];

const AI = [
  'pytorch', 'tensorflow', 'keras', 'jax', 'scikit-learn', 'sklearn', 'xgboost', 'lightgbm',
  'catboost', 'huggingface', 'transformers', 'langchain', 'llamaindex', 'ollama', 'vllm',
  'openai', 'anthropic', 'gemini', 'mistral', 'llama',
  'llm', 'llms', 'rag', 'nlp', 'cv', 'ocr', 'asr', 'tts', 'embedding', 'embeddings',
  'fine-tuning', 'finetuning', 'prompt', 'prompting', 'agent', 'agents', 'agentic',
  'yolo', 'yolov8', 'opencv', 'blip', 'clip', 'diffusion', 'shap', 'mlflow', 'wandb',
  'machine-learning', 'deep-learning', 'automl', 'mlops',
];

const CLOUD = [
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'k8s', 'helm', 'terraform', 'pulumi', 'ansible',
  'jenkins', 'gitlab', 'github', 'circleci', 'argocd', 'nginx', 'apache', 'traefik', 'envoy',
  'lambda', 's3', 'ec2', 'eks', 'gke', 'aks', 'cloudformation', 'serverless', 'cloudflare',
  'prometheus', 'grafana', 'datadog', 'sentry', 'telegraf', 'opentelemetry', 'elk',
  'linux', 'unix', 'ubuntu', 'debian', 'windows', 'macos',
  'ci', 'cd', 'ci/cd', 'devops', 'sre', 'iac', 'microservices', 'containerization', 'containers',
];

const TOOLS = [
  'git', 'jira', 'confluence', 'notion', 'figma', 'slack', 'postman', 'swagger', 'openapi',
  'vscode', 'intellij', 'pycharm', 'vim', 'jupyter', 'colab', 'streamlit', 'gradio', 'tableau',
  'powerbi', 'looker', 'excel', 'sharepoint', 'salesforce', 'sap', 'hubspot', 'zapier', 'n8n',
  'selenium', 'playwright', 'cypress', 'pytest', 'jest', 'vitest', 'junit', 'mocha',
];

/**
 * Practices and role skills. Not technologies, but genuinely things a posting
 * asks for and a resume can answer — and unlike "systems" or "solutions" they
 * are specific enough to be worth a chip.
 */
const PRACTICES = [
  'agile', 'scrum', 'kanban', 'tdd', 'bdd', 'ddd', 'pair-programming', 'code-review',
  'refactoring', 'debugging', 'profiling', 'benchmarking', 'monitoring', 'observability',
  'automation', 'scripting', 'testing', 'unit-testing', 'integration-testing',
  'api-design', 'system-design', 'architecture', 'scalability', 'performance', 'security',
  'accessibility', 'localization', 'i18n', 'documentation', 'onboarding', 'mentoring',
  'stakeholder-management', 'requirements', 'analytics', 'reporting', 'forecasting',
  'process-improvement', 'process-automation', 'data-analysis', 'data-engineering',
  'visualization', 'dashboards', 'optimization', 'troubleshooting',
];

export const TECH_TERMS: ReadonlySet<string> = new Set([
  ...LANGUAGES,
  ...WEB,
  ...BACKEND,
  ...DATA,
  ...AI,
  ...CLOUD,
  ...TOOLS,
  ...PRACTICES,
]);

/**
 * The candidate's own vocabulary, which counts as skill-shaped by definition.
 *
 * If someone lists "Repo Triage" or an in-house tool as a skill, a posting
 * naming it is asking for it, whatever a general vocabulary thinks. This is
 * also what makes the matching improve as the profile improves, rather than
 * depending on a list being complete.
 */
export function vocabularyFrom(skills: string[], techStacks: string[]): Set<string> {
  const out = new Set<string>();
  for (const entry of [...skills, ...techStacks]) {
    // "Languages: Python, TypeScript" is one stored skill holding three terms.
    for (const piece of entry.split(/[,;:|]/)) {
      const term = piece.trim().toLowerCase();
      if (term.length >= 2) out.add(term);
    }
  }
  return out;
}
