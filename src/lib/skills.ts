// One skill catalogue for both sides: what a posting asks for and what your CV shows.
// Patterns avoid the usual false friends ("Go to market", "react quickly", "excel at", "Spring 2027").

export interface Skill {
  name: string;
  re: RegExp;
  group: "language" | "framework" | "infra" | "data" | "ai" | "fundamentals" | "quant" | "domain" | "tool";
}

const LIST = String.raw`(?:C\+\+|Python|Java|Go|Rust|C#|Scala|Kotlin|JavaScript|TypeScript)`;

export const SKILLS: Skill[] = [
  // languages
  { name: "Python", re: /\bpython\b/i, group: "language" },
  {
    name: "Go",
    re: /\bgolang\b|\bGo\b(?=\s*(?:[,/)]|\band\b|\bor\b|$|programming|developer|engineer|services?|code|data|pipeline|backend|microservices?))|\b(?:in|using|with|written in) Go\b/,
    group: "language",
  },
  { name: "Java", re: /\bjava\b(?!\s*script)/i, group: "language" },
  { name: "C++", re: /c\+\+|\bcpp\b/i, group: "language" },
  { name: "C", re: new RegExp(String.raw`\bC\s*(?:,|\/|\band\b|\bor\b)\s*${LIST}|${LIST}\s*(?:,|\/|\band\b|\bor\b)\s*C\b(?![+#])|\bin C\b(?![+#])|\bC programming\b`), group: "language" },
  { name: "C#", re: /\bc#|\.net\b/i, group: "language" },
  { name: "Rust", re: /\brust\b/i, group: "language" },
  { name: "Scala", re: /\bscala\b/i, group: "language" },
  { name: "Kotlin", re: /\bkotlin\b/i, group: "language" },
  { name: "TypeScript", re: /\btypescript\b/i, group: "language" },
  { name: "JavaScript", re: /\bjavascript\b|\bnode\.?js\b/i, group: "language" },
  { name: "Ruby", re: /\bruby\b/i, group: "language" },
  { name: "PHP", re: /\bphp\b/i, group: "language" },
  { name: "OCaml", re: /\bocaml\b/i, group: "language" },
  { name: "Haskell / functional", re: /\bhaskell\b|\bfunctional programming\b|\bf#/i, group: "language" },
  { name: "kdb+/q", re: /\bkdb\b|\bq\/kdb/i, group: "language" },
  { name: "R", re: /\bR\b(?=\s*(?:,|\/|\band\b|\bor\b)\s*(?:Python|MATLAB|SQL|Julia))|(?:Python|MATLAB|SQL)\s*(?:,|\/|\band\b|\bor\b)\s*R\b|\bR programming\b/, group: "language" },
  { name: "MATLAB", re: /\bmatlab\b/i, group: "language" },
  { name: "SQL", re: /\bsql\b|postgres|mysql|relational databases?/i, group: "data" },
  { name: "Bash / scripting", re: /\bbash\b|\bshell scripting\b|\bscripting languages?\b/i, group: "tool" },
  { name: "Solidity", re: /\bsolidity\b/i, group: "language" },

  // frameworks
  { name: "React", re: /\bReact(?:\.js|JS)?\b(?!\s+(?:quickly|to|fast|swiftly|native))|\breactjs\b/, group: "framework" },
  { name: "Next.js", re: /\bnext\.?js\b/i, group: "framework" },
  { name: "Vue / Angular", re: /\bvue(\.js)?\b|\bangular\b/i, group: "framework" },
  { name: "Node.js", re: /\bnode\.?js\b|\bexpress\.?js\b/i, group: "framework" },
  { name: "FastAPI", re: /\bfastapi\b/i, group: "framework" },
  { name: "Django / Flask", re: /\bdjango\b|\bflask\b/i, group: "framework" },
  { name: "Spring", re: /\bspring boot\b|\bspring framework\b|\bspring (mvc|cloud|data)\b/i, group: "framework" },
  { name: "GraphQL / gRPC", re: /\bgraphql\b|\bgrpc\b|\bprotobuf\b/i, group: "framework" },
  { name: "REST APIs", re: /\brest(ful)? apis?\b|\bapi design\b|\bweb services\b|\bsoap\b/i, group: "framework" },
  { name: "WebSockets / real time", re: /\bwebsockets?\b|\breal[- ]time (systems|data|features|processing)\b/i, group: "framework" },
  { name: "Mobile (iOS/Android)", re: /\bi(OS|Phone)\b|\bandroid\b|\bswiftui\b|\breact native\b|\bflutter\b/i, group: "framework" },
  { name: "Frontend (HTML/CSS)", re: /\bfront[- ]?end\b|\bhtml\b|\bcss\b|\btailwind\b/i, group: "framework" },

  // infra
  { name: "Linux", re: /\blinux\b|\bunix\b/i, group: "infra" },
  { name: "Docker", re: /\bdocker\b|\bcontaineri[sz]/i, group: "infra" },
  { name: "Kubernetes", re: /\bkubernetes\b|\bk8s\b/i, group: "infra" },
  { name: "Terraform / IaC", re: /\bterraform\b|\binfrastructure[- ]as[- ]code\b|\bansible\b|\bpulumi\b/i, group: "infra" },
  { name: "AWS", re: /\baws\b|\bamazon web services\b/i, group: "infra" },
  { name: "GCP", re: /\bgcp\b|\bgoogle cloud\b/i, group: "infra" },
  { name: "Azure", re: /\bazure\b/i, group: "infra" },
  { name: "CI/CD", re: /\bci\/cd\b|\bcontinuous (integration|delivery|deployment)\b|\bgithub actions\b|\bjenkins\b|\bgitlab ci\b/i, group: "infra" },
  { name: "Observability", re: /\bgrafana\b|\bprometheus\b|\bloki\b|\bobservability\b|\bmonitoring\b|\balerting\b/i, group: "infra" },
  { name: "Networking", re: /\btcp\/ip\b|\btcp\b|\budp\b|\bccna\b|\bnetwork (protocols|programming|stack|engineering)\b|\bcomputer networks?\b|\bnetworking\b(?! events)/i, group: "infra" },
  { name: "Microservices", re: /\bmicro-?services?\b|\bservice-oriented\b/i, group: "infra" },
  { name: "Distributed systems", re: /\bdistributed systems?\b/i, group: "fundamentals" },
  { name: "Cloud / deployment", re: /\bvercel\b|\bvps\b|\bcloud (infrastructure|platforms?|services)\b|\bdeploy(ed|ment|ing)\b/i, group: "infra" },

  // data
  { name: "PostgreSQL", re: /\bpostgres(ql)?\b/i, group: "data" },
  { name: "MySQL", re: /\bmysql\b/i, group: "data" },
  { name: "MongoDB / NoSQL", re: /\bmongo(db)?\b|\bnosql\b|\bcassandra\b|\bdynamodb\b/i, group: "data" },
  { name: "Redis", re: /\bredis\b/i, group: "data" },
  { name: "Kafka / queues", re: /\bkafka\b|\brabbitmq\b|\bmessage queues?\b|\basynq\b|\bpub\/sub\b/i, group: "data" },
  { name: "Spark / big data", re: /\bapache spark\b|\bpyspark\b|\bspark\b(?= (streaming|sql|jobs?|clusters?))|\bhadoop\b|\bbig data\b|\bdatabricks\b/i, group: "data" },
  { name: "Data pipelines (ETL)", re: /\betl\b|\bdata pipelines?\b|\bairflow\b|\bdbt\b|\bpipeline\b/i, group: "data" },
  { name: "Pandas / NumPy", re: /\bpandas\b|\bnumpy\b|\bscipy\b/i, group: "data" },

  // AI
  { name: "Machine learning", re: /\bmachine learning\b|\bML\b|\bdeep learning\b|\bneural networks?\b/, group: "ai" },
  { name: "PyTorch / TensorFlow", re: /\bpytorch\b|\btensorflow\b|\bjax\b|\bscikit[- ]learn\b|\bkeras\b/i, group: "ai" },
  { name: "LLM / generative AI", re: /\bllms?\b|\blarge language models?\b|\bgenerative ai\b|\bgenai\b|\bai agents?\b|\bagentic\b|\bprompt engineering\b|\bai-assisted\b/i, group: "ai" },
  { name: "Semantic search / embeddings", re: /\bembeddings?\b|\bsemantic search\b|\bvector (search|databases?|db|store)\b|\bpgvector\b|\brag\b|\bretrieval[- ]augmented\b/i, group: "ai" },
  { name: "NLP", re: /\bnlp\b|\bnatural language processing\b/i, group: "ai" },
  { name: "Computer vision", re: /\bcomputer vision\b|\bimage (processing|recognition)\b/i, group: "ai" },
  { name: "CUDA / GPU", re: /\bcuda\b|\bgpu (programming|kernels?|computing)\b|\btriton\b/i, group: "ai" },
  { name: "MCP", re: /\bmcp( servers?)?\b|\bmodel context protocol\b/i, group: "ai" },

  // CS fundamentals
  { name: "Data structures and algorithms", re: /\bdata structures\b|\balgorithms?\b/i, group: "fundamentals" },
  { name: "Compilers", re: /\bcompilers?\b|\bcode generation\b|\bll\(1\)|\blexical analysis\b/i, group: "fundamentals" },
  { name: "Operating systems", re: /\boperating systems?\b|\bkernel\b|\bos internals\b/i, group: "fundamentals" },
  { name: "Concurrency", re: /\bconcurren(cy|t)\b|\bmulti-?thread(ed|ing)?\b|\bparallel programming\b|\basynchronous\b/i, group: "fundamentals" },
  { name: "Low latency", re: /\blow[- ]latency\b|\blatency[- ]sensitive\b|\bhigh[- ]frequency\b|\bperformance[- ]critical\b/i, group: "fundamentals" },
  { name: "Computer architecture", re: /\bcomputer architecture\b|\bcpu caches?\b|\bmemory hierarchy\b/i, group: "fundamentals" },
  { name: "Testing / QA", re: /\btest automation\b|\bautomated tests?\b|\bunit tests?\b|\bintegration tests?\b|\bquality assurance\b|\bqa\b|\btesting\b/i, group: "fundamentals" },
  { name: "Security", re: /\bcyber ?security\b|\bapplication security\b|\bsecurity engineering\b|\bcryptograph|\bpenetration testing\b|\bthreat (detection|modeling)\b|\bleast[- ]privilege\b|\brow[- ]level security\b|\brls\b/i, group: "domain" },

  // quant & maths
  { name: "Statistics", re: /\bstatistic(s|al)\b/i, group: "quant" },
  { name: "Probability", re: /\bprobabilit(y|ies|istic)\b/i, group: "quant" },
  { name: "Linear algebra", re: /\blinear algebra\b/i, group: "quant" },
  { name: "Stochastic calculus", re: /\bstochastic\b/i, group: "quant" },
  { name: "Time series", re: /\btime[- ]series\b/i, group: "quant" },
  { name: "Mathematical optimization", re: /\bconvex optimi[sz]ation\b|\blinear programming\b|\bnumerical (methods|optimi[sz]ation)\b/i, group: "quant" },
  { name: "Financial markets", re: /\bderivatives\b|\boptions (pricing|trading)\b|\bmarket microstructure\b|\btrading (strategies|systems)\b|\bfixed income\b|\bequities\b/i, group: "quant" },

  // domains & tools
  { name: "Blockchain", re: /\bblockchain\b|\bcrypto(currenc(y|ies))?\b|\bsolana\b|\bethereum\b|\bweb3\b|\bon-chain\b|\bdefi\b/i, group: "domain" },
  { name: "FPGA / hardware", re: /\bfpga\b|\bverilog\b|\bvhdl\b|\basic\b/i, group: "domain" },
  { name: "Embedded", re: /\bembedded\b|\bfirmware\b|\brtos\b|\bmicrocontrollers?\b/i, group: "domain" },
  { name: "Robotics", re: /\brobotics?\b|\bros2?\b(?= )|\bautonomous (vehicles|driving|systems)\b/i, group: "domain" },
  { name: "Graphics / games", re: /\bgraphics programming\b|\bopengl\b|\bvulkan\b|\bunity\b|\bunreal\b|\bgame (engine|development)\b/i, group: "domain" },
  { name: "Git", re: /\bgit\b|\bgithub\b|\bgitlab\b|\bversion control\b/i, group: "tool" },
  { name: "Excel", re: /\bExcel\b(?! (at|in|as|when|under|on|with))|\bVBA\b/, group: "tool" },
];

/** Skills a CV implies even when not written out (PostgreSQL ⇒ SQL…). */
const IMPLIES: Record<string, string[]> = {
  PostgreSQL: ["SQL"],
  MySQL: ["SQL"],
  "Next.js": ["React", "JavaScript"],
  TypeScript: ["JavaScript"],
  FastAPI: ["Python", "REST APIs"],
  "Semantic search / embeddings": ["LLM / generative AI"],
};

export function findSkills(text: string, opts: { implied?: boolean } = {}): string[] {
  const found = new Set(SKILLS.filter((s) => s.re.test(text)).map((s) => s.name));
  if (opts.implied) for (const s of [...found]) for (const x of IMPLIES[s] ?? []) found.add(x);
  return [...found];
}

export const SKILL_GROUP = Object.fromEntries(SKILLS.map((s) => [s.name, s.group])) as Record<string, Skill["group"]>;
